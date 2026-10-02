import * as vscode from 'vscode';
import { createAdapter } from '../providers';
import { activeMcpServers, findProvider, loadProviders } from '../providers/registry';
import { AgentEvent, Attachment, EffortLevel, ProviderDef, RateLimitInfo, SendRequest } from '../types';
import { activeSkills, expandSkillInvocation, skillsInstructions, skillsRoot } from '../skills/skills';
import { detectQuota, handoffPreamble, QuotaHit, unseenMessages } from './handoff';
import { ChatMessage, Conversation, ConversationStore } from './session';
import { t } from '../i18n';

const RATE_LIMIT_KEY = 'polyagent.rateLimits';

export function readRateLimits(globalState: vscode.Memento): Record<string, RateLimitInfo> {
  return globalState.get<Record<string, RateLimitInfo>>(RATE_LIMIT_KEY, {});
}

/**
 * The effort actually sent for `modelId`: the wanted level when the model accepts it,
 * otherwise the closest level the model has. Undefined when the model has no effort control.
 */
export function effortFor(def: ProviderDef, modelId: string | undefined, wanted: EffortLevel | undefined): EffortLevel | undefined {
  const model = def.models?.find((m) => m.id === modelId);
  const levels = model?.efforts ?? def.efforts ?? [];
  if (!levels.length) {
    return undefined;
  }
  if (wanted && levels.includes(wanted)) {
    return wanted;
  }
  const order = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const rank = order.indexOf(wanted ?? model?.defaultEffort ?? 'high');
  if (rank < 0) {
    return model?.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : levels[0];
  }
  return levels.reduce((best, level) =>
    Math.abs(order.indexOf(level) - rank) < Math.abs(order.indexOf(best) - rank) ? level : best
  );
}

/** Display name of the model behind a message, e.g. "Opus 5". Loads the provider list once. */
export function modelLabeler(): (message: { providerId?: string; model?: string }) => string {
  const providers = loadProviders();
  return (message) => {
    const def = providers.find((p) => p.id === message.providerId);
    const id = message.model ?? def?.defaultModel;
    return def?.models?.find((m) => m.id === id)?.label ?? id ?? def?.label ?? message.providerId ?? 'unknown';
  };
}

export interface TurnOutcome {
  /** Set when the provider ran out of quota during this turn. */
  quota?: QuotaHit;
}

export interface TurnHandlers {
  onEvent(event: AgentEvent, assistant: ChatMessage): void;
}

/** Runs one turn against the conversation's provider and keeps the transcript in sync. */
export class ChatController {
  private abort?: AbortController;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly store: ConversationStore,
    private readonly globalState: vscode.Memento
  ) {}

  private async rememberRateLimit(providerId: string, info: RateLimitInfo): Promise<void> {
    const all = this.globalState.get<Record<string, RateLimitInfo>>(RATE_LIMIT_KEY, {});
    all[providerId] = info;
    await this.globalState.update(RATE_LIMIT_KEY, all);
  }

  get running(): boolean {
    return Boolean(this.abort);
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = undefined;
  }

  async run(
    conversation: Conversation,
    prompt: string,
    handlers: TurnHandlers,
    attachments: Attachment[] = []
  ): Promise<TurnOutcome> {
    const def = findProvider(conversation.providerId);
    const assistant: ChatMessage = {
      id: `m_${Date.now().toString(36)}`,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      providerId: conversation.providerId,
      model: conversation.model,
      createdAt: Date.now()
    };
    conversation.messages.push(assistant);

    if (!def) {
      assistant.error = t('err.providerNotFound', { id: conversation.providerId });
      handlers.onEvent({ type: 'error', message: assistant.error }, assistant);
      handlers.onEvent({ type: 'done' }, assistant);
      await this.store.save(conversation);
      return {};
    }

    const adapter = createAdapter(def, this.secrets);
    this.abort = new AbortController();

    const history = conversation.messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m !== assistant && m.role !== 'system' && (Boolean(m.text) || m.role === 'user'))
      .map((m) => ({ role: m.role, content: m.text }))
      .filter((m) => m.content.trim().length > 0);
    history.pop(); // the prompt itself is passed separately

    const model = conversation.model ?? def.defaultModel;

    // `/name …` loads a skill for every provider; CLI agents also get the list and read SKILL.md themselves.
    const skills = activeSkills();
    const invoked = expandSkillInvocation(prompt, skills);
    // HTTP providers resend the text history, so earlier skill calls keep their SKILL.md.
    for (const turn of history) {
      if (turn.role === 'user') {
        turn.content = expandSkillInvocation(turn.content, skills).prompt;
      }
    }

    // A CLI agent only knows its own session; hand it whatever other providers did meanwhile.
    let fullPrompt = invoked.prompt;
    if (def.kind === 'cli') {
      const promptIndex = conversation.messages.lastIndexOf(assistant) - 1;
      const unseen = unseenMessages(conversation, def.id, promptIndex);
      if (unseen.length) {
        const contextWindow = def.models?.find((m) => m.id === model)?.contextWindow;
        fullPrompt = handoffPreamble(unseen, modelLabeler(), contextWindow).text + invoked.prompt;
      }
    }

    let rejectedUntil: number | undefined;
    const request: SendRequest = {
      prompt: fullPrompt,
      model,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
      history,
      sessionId: conversation.providerSessions[def.id],
      effort: effortFor(def, model, conversation.effort),
      thinking: conversation.thinking,
      attachments,
      mcpServers: def.kind === 'cli' ? activeMcpServers() : undefined,
      instructions: skillsInstructions(skills, def.kind === 'cli'),
      skillsDir: def.kind === 'cli' && skills.length ? skillsRoot() : undefined,
      signal: this.abort.signal
    };

    const emit = (event: AgentEvent) => {
      if (event.type === 'rate_limit') {
        void this.rememberRateLimit(conversation.providerId, event.info);
        if (event.info.status === 'rejected') {
          const resets = event.info.windows.map((w) => w.resetsAt ?? 0).filter(Boolean);
          rejectedUntil = resets.length ? Math.max(...resets) * 1000 : Date.now();
        }
      }
      applyEvent(conversation, assistant, event);
      handlers.onEvent(event, assistant);
    };

    try {
      await adapter.send(request, emit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message });
      emit({ type: 'done' });
    } finally {
      this.abort = undefined;
      await this.store.save(conversation);
    }

    if (request.signal.aborted) {
      return {};
    }
    const quota = detectQuota(assistant);
    if (quota) {
      return { quota: { ...quota, resetsAt: quota.resetsAt ?? rejectedUntil } };
    }
    if (rejectedUntil !== undefined && (assistant.error || !assistant.text.trim())) {
      return { quota: { message: t('err.rateLimit'), resetsAt: rejectedUntil } };
    }
    return {};
  }
}

/**
 * Applies an agent event to the conversation and assistant message.
 * Updates the conversation state and message content based on the event type.
 */
function applyEvent(conversation: Conversation, assistant: ChatMessage, event: AgentEvent): void {
  switch (event.type) {
    case 'session':
      conversation.providerSessions[conversation.providerId] = event.sessionId;
      if (event.model && !conversation.model) {
        conversation.model = event.model;
      }
      return;
    case 'text_delta':
      assistant.text += event.text;
      return;
    case 'thinking_delta':
      assistant.thinking = (assistant.thinking ?? '') + event.text;
      return;
    case 'tool_start':
      assistant.tools?.push({ id: event.id, name: event.name, input: event.input, done: false });
      return;
    case 'tool_end': {
      const tool = assistant.tools?.find((t) => t.id === event.id);
      if (tool) {
        tool.output = event.output;
        tool.isError = event.isError;
        tool.done = true;
      }
      return;
    }
    case 'usage':
      assistant.usage = event.usage;
      return;
    case 'error':
      assistant.error = [assistant.error, event.message].filter(Boolean).join('\n');
      return;
    default:
      return;
  }
}
