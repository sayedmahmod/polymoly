import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAdapter } from '../providers';
import { activeMcpServers, findProvider, loadProviders } from '../providers/registry';
import { labelFromModelId, rememberResolvedModel } from '../providers/modelAliases';
import { AgentEvent, Attachment, EffortLevel, ProviderDef, RateLimitInfo, SendRequest } from '../types';
import { activeSkills, expandSkillInvocation, skillsInstructions, skillsRoot } from '../skills/skills';
import { detectQuota, handoffPreamble, QuotaHit, unseenMessages } from './handoff';
import { ChatMessage, Conversation, ConversationStore } from './session';
import { instructionsForMode, permissionForMode } from './modes';
import { normalizeHttpPermission, translatePermission } from './permissions';
import { AgentPermission, describeToolCall } from './localTools';
import { t } from '../i18n';
import { projectContext } from '../context/projectContext';
import { SubagentBridge } from '../agents/bridge';
import { parseSpawnInput, SUBAGENT_MCP_NAME } from '../agents/spawnSchema';
import { permissionLevelFor, runSubagent, SubagentParent, subagentInstructions } from '../agents/subagents';

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

/** Display name of the model behind a message, e.g. "Opus 5.5". Loads the provider list once. */
export function modelLabeler(): (message: { providerId?: string; model?: string }) => string {
  const providers = loadProviders();
  return (message) => {
    const def = providers.find((p) => p.id === message.providerId);
    const id = message.model ?? def?.defaultModel;
    return (
      def?.models?.find((m) => m.id === id)?.label ??
      (id && labelFromModelId(id)) ??
      id ??
      def?.label ??
      message.providerId ??
      'unknown'
    );
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
  /** Tools the user allowed for the rest of a chat, so `write` mode asks once per kind. */
  private readonly approvedTools = new Map<string, Set<string>>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly store: ConversationStore,
    private readonly globalState: vscode.Memento,
    /** Gives the CLI agents `spawn_agent` over MCP. */
    private readonly bridge?: SubagentBridge
  ) {}

  private async rememberRateLimit(providerId: string, info: RateLimitInfo): Promise<void> {
    const all = this.globalState.get<Record<string, RateLimitInfo>>(RATE_LIMIT_KEY, {});
    all[providerId] = info;
    await this.globalState.update(RATE_LIMIT_KEY, all);
  }

  /** Modal yes/no for a shell command in `write` mode; "always" lasts for the chat. */
  private async confirmTool(conversationId: string, toolName: string, input: unknown): Promise<boolean> {
    if (this.approvedTools.get(conversationId)?.has(toolName)) {
      return true;
    }
    const allow = t('agent.allow');
    const always = t('agent.allowChat');
    const record = typeof input === 'object' && input ? (input as Record<string, unknown>) : {};
    const choice = await vscode.window.showWarningMessage(
      t('agent.confirmTitle'),
      { modal: true, detail: describeToolCall(toolName, record) },
      allow,
      always
    );
    if (choice === always) {
      const approved = this.approvedTools.get(conversationId) ?? new Set<string>();
      approved.add(toolName);
      this.approvedTools.set(conversationId, approved);
    }
    return choice === allow || choice === always;
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
    const abort = new AbortController();
    this.abort = abort;

    const history = conversation.messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m !== assistant && m.role !== 'system' && (Boolean(m.text) || m.role === 'user'))
      .map((m) => ({ role: m.role, content: m.text }))
      .filter((m) => m.content.trim().length > 0);
    history.pop(); // the prompt itself is passed separately

    const model = conversation.model ?? def.defaultModel;
    const mode = conversation.mode ?? 'chat';
    // HTTP providers run local tools with a permission level of their own; CLI agents
    // translate the same chat setting into their CLI's flags below.
    const httpPermission =
      def.kind === 'http'
        ? (normalizeHttpPermission(
            permissionForMode(mode, def) ??
              translatePermission(conversation.permission, def) ??
              vscode.workspace.getConfiguration('polyagent').get<string>('http.permissionMode', 'write')
          ) as AgentPermission)
        : undefined;

    // `/name …` loads a skill for every provider; CLI agents also get the list and read SKILL.md themselves.
    const skills = activeSkills();
    const invoked = expandSkillInvocation(prompt, skills);
    // HTTP providers resend the text history, so earlier skill calls keep their SKILL.md.
    for (const turn of history) {
      if (turn.role === 'user') {
        turn.content = expandSkillInvocation(turn.content, skills).prompt;
      }
    }

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    // Build/read the local map once and send only a bounded, query-ranked outline. This is
    // intentionally not a vector DB and never ships the full repository to a provider.
    const contextBudget = vscode.workspace.getConfiguration('polyagent.context').get<number>('tokenBudget', 1400);
    const repositoryMap = await projectContext.forPrompt(cwd, prompt, contextBudget);

    // A CLI agent only knows its own session; hand it whatever other providers did meanwhile.
    let fullPrompt = invoked.prompt;
    if (def.kind === 'cli') {
      const promptIndex = conversation.messages.lastIndexOf(assistant) - 1;
      const unseen = unseenMessages(conversation, def.id, promptIndex);
      if (unseen.length) {
        const contextWindow = def.models?.find((m) => m.id === model)?.contextWindow;
        fullPrompt = handoffPreamble(unseen, modelLabeler(), contextWindow).text + invoked.prompt;
      }
    } else if (!httpPermission) {
      // A tool-less HTTP provider cannot read an "@path" mention itself, so inline the file.
      // With tools the model reads it like a CLI agent would.
      fullPrompt = inlineMentionedFiles(fullPrompt, cwd);
    }

    // Every agent may start subagents on any provider, never with more rights than its own.
    const cliPermission = def.kind === 'cli' ? permissionForMode(mode, def) ?? conversation.permission : undefined;
    const subagentParent: SubagentParent = {
      level: permissionLevelFor(def, httpPermission ?? cliPermission),
      cwd,
      confirm: (name, input) => this.confirmTool(conversation.id, name, input)
    };
    let mcpServers = def.kind === 'cli' ? activeMcpServers() : undefined;
    let bridgeSession: string | undefined;
    if (mcpServers && this.bridge) {
      try {
        const opened = await this.bridge.open({ ...subagentParent, signal: abort.signal });
        bridgeSession = opened.id;
        mcpServers = { ...mcpServers, [SUBAGENT_MCP_NAME]: opened.server };
      } catch {
        /* no local port: the turn runs without subagents */
      }
    }
    const canSpawn = def.kind === 'http' || Boolean(bridgeSession);

    let rejectedUntil: number | undefined;
    const request: SendRequest = {
      prompt: fullPrompt,
      model,
      cwd,
      history,
      sessionId: conversation.providerSessions[def.id],
      effort: effortFor(def, model, conversation.effort),
      thinking: conversation.thinking,
      permission: cliPermission,
      attachments,
      mcpServers,
      localTools:
        def.kind === 'http' && httpPermission
          ? { mode: httpPermission, confirm: (name, input) => this.confirmTool(conversation.id, name, input) }
          : undefined,
      spawnAgent:
        def.kind === 'http'
          ? async (input, signal) => {
              const spec = parseSpawnInput(input);
              return spec
                ? runSubagent(spec, subagentParent, this.secrets, signal)
                : { output: '`provider` and `prompt` are required.', isError: true };
            }
          : undefined,
      instructions: [
        def.kind === 'http' ? projectHeader(cwd, httpPermission) : undefined,
        instructionsForMode(mode),
        repositoryMap.text,
        skillsInstructions(skills, def.kind === 'cli'),
        canSpawn ? subagentInstructions(def) : undefined
      ]
        .filter(Boolean)
        .join('\n\n') || undefined,
      skillsDir: def.kind === 'cli' && skills.length ? skillsRoot() : undefined,
      signal: abort.signal
    };

    const emit = (event: AgentEvent) => {
      // After Stop, whatever the provider still sends must not reach the transcript.
      if (abort.signal.aborted && event.type !== 'done') {
        return;
      }
      if (event.type === 'rate_limit') {
        void this.rememberRateLimit(conversation.providerId, event.info);
        if (event.info.status === 'rejected') {
          const resets = event.info.windows.map((w) => w.resetsAt ?? 0).filter(Boolean);
          rejectedUntil = resets.length ? Math.max(...resets) * 1000 : Date.now();
        }
      }
      if (event.type === 'session' && event.model && model && def.kind === 'cli') {
        void rememberResolvedModel(def.id, model, event.model);
      }
      applyEvent(conversation, assistant, event);
      handlers.onEvent(event, assistant);
    };

    // Stop ends the turn right away, even when the provider is slow to wind down.
    const stopped = new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
    try {
      await Promise.race([adapter.send(request, emit), stopped]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message });
      emit({ type: 'done' });
    } finally {
      // A newer turn may already own the controller; only clear our own.
      if (this.abort === abort) {
        this.abort = undefined;
      }
      if (bridgeSession) {
        this.bridge?.close(bridgeSession);
      }
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

const ACCESS_NOTE: Record<AgentPermission, string> = {
  readonly:
    'You have read access: list, glob, grep and read files with your tools. You cannot change files or run commands in this mode; say what you would change instead.',
  edit:
    'You have read and write access to files: read, create and edit them with your tools. You cannot run shell commands in this mode; tell the user which command to run.',
  write:
    'You have read and write access to files and can run shell commands; the user confirms each command before it runs.',
  auto: 'You have full read and write access to files and can run shell commands without confirmation.'
};

/** So an HTTP provider knows what project it is talking about, and what it may touch. */
export function projectHeader(cwd: string, permission: AgentPermission | undefined): string {
  if (!permission) {
    return `# Project\n\nWorkspace: ${path.basename(cwd)} (${cwd}). You have no file or shell access; work only from the conversation and any attached files.`;
  }
  return `# Project\n\nWorkspace: ${path.basename(cwd)} (${cwd}). Your tools run here; use paths relative to the workspace root and use the tools instead of asking the user to paste files or run things. ${ACCESS_NOTE[permission]}`;
}

const MENTION_RE = /(?:^|\s)@([^\s]+)/g;
const MAX_FILE_BYTES = 20_000;
const MAX_TOTAL_BYTES = 60_000;

/**
 * An HTTP provider has no tools, so a bare "@relative/path" mention is dead text to it.
 * This reads each mentioned file (kept inside the workspace, size-capped) and appends its
 * content, matching what a CLI agent would do for itself by reading the path.
 */
function inlineMentionedFiles(prompt: string, cwd: string): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  let budget = MAX_TOTAL_BYTES;

  for (const match of prompt.matchAll(MENTION_RE)) {
    if (budget <= 0) {
      break;
    }
    const rel = match[1].replace(/[),.;:!?]+$/, '');
    if (!rel || seen.has(rel)) {
      continue;
    }
    seen.add(rel);

    const abs = path.resolve(cwd, rel);
    if (abs !== cwd && !abs.startsWith(cwd + path.sep)) {
      continue; // outside the workspace, e.g. an email handle or a package name
    }
    let content: string;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > 1_000_000) {
        continue;
      }
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue; // not a real path, e.g. "@here" in prose
    }

    const slice = content.slice(0, Math.min(MAX_FILE_BYTES, budget));
    budget -= slice.length;
    blocks.push(`--- ${rel} ---\n${slice}${slice.length < content.length ? '\n… (truncated)' : ''}`);
  }

  return blocks.length ? `${prompt}\n\n# Referenced files\n\n${blocks.join('\n\n')}` : prompt;
}
