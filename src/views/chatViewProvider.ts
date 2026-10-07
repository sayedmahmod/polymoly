import * as vscode from 'vscode';
import { LANGS, LANGUAGE_NAMES, resolveLanguage, t, tOptional, webviewI18nScript } from '../i18n';
import { ChatController, effortFor, modelLabeler } from '../chat/controller';
import { attachmentSupport, describeFile, storeDroppedFile } from '../chat/attachments';
import { HandoffTarget, lastUsage, planTransfer, QuotaHit, suggestTarget } from '../chat/handoff';
import { Conversation, ConversationStore, newConversation } from '../chat/session';
import { ChatMode, CHAT_MODES, isStrongPlanner, looksLikeBigTask, looksLikeRequestToAct } from '../chat/modes';
import { normalizeClaudePermission, translatePermission } from '../chat/permissions';
import { extractPlan } from '../plan/planFormat';
import { planPreview, savePlan } from '../plan/planStore';
import { Plan, PlanRun, planWaves } from '../plan/planTypes';
import { PlanPanel } from './planPanel';
import {
  adminKeySecret,
  apiKeySecret,
  enabledProviders,
  isBuiltin,
  loadMcpServers,
  loadProviders,
  needsApiKey,
  removeProviderOverride,
  updateProviderOverride
} from '../providers/registry';
import { createAdapter } from '../providers';
import { BUILTIN_PROVIDERS } from '../providers/builtins';
import { HttpAdapter } from '../providers/httpAdapter';
import {
  activeSkills,
  importableSkills,
  importForeignSkills,
  installSkills,
  listSkills,
  removeSkill,
  setSkillEnabled,
  skillsRoot
} from '../skills/skills';
import { SubagentBridge } from '../agents/bridge';
import { LimitsService } from '../usage/limits';
import { Attachment, McpServerDef, ModelDef, ProviderDef } from '../types';
import { UsagePanel } from './usagePanel';

const LIMITS_REFRESH_MS = 60_000;
const MODELS_REFRESHED_KEY = 'polyagent.modelsRefreshedAt';
const MODELS_REFRESH_MS = 24 * 60 * 60 * 1000;
/** How long a provider counts as exhausted when it does not say when its limit resets. */
const EXHAUSTED_FALLBACK_MS = 60 * 60_000;

/**
 * A message held back because the mode does not fit it: chat mode was handed a project,
 * plan mode a weak model, ask mode an order. The user answers, then it is sent.
 */
interface PendingSend {
  kind: 'planSuggest' | 'planWarn' | 'askSuggest';
  text: string;
}

/** Offer to continue the conversation on another model after a quota hit. */
interface PendingHandoff {
  from: HandoffTarget;
  quota: QuotaHit;
  to?: HandoffTarget;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'polyagent.chat';

  private view?: vscode.WebviewView;
  private conversation: Conversation;
  private readonly controller: ChatController;
  private readonly limits: LimitsService;
  private limitsTimer?: NodeJS.Timeout;
  private handoff?: PendingHandoff;
  /** Message waiting for the user to answer a mode question. */
  private pending?: PendingSend;
  /** Plans written this session, so a card still opens when its file was moved away. */
  private readonly plans = new Map<string, Plan>();
  /** Files attached to the message being written. */
  private attachments: Attachment[] = [];
  /** Provider id to epoch ms until which it is out of quota. */
  private readonly exhausted = new Map<string, number>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ConversationStore,
    private readonly usagePanel: UsagePanel,
    private readonly planPanel: PlanPanel
  ) {
    planPanel.onRunFinished = (plan, run) => this.noteRun(plan, run);
    const bridge = new SubagentBridge(context.secrets, context.asAbsolutePath('dist/subagent-mcp.js'));
    context.subscriptions.push(bridge);
    this.controller = new ChatController(context.secrets, store, context.globalState, bridge);
    this.limits = new LimitsService(context.globalState, context.secrets);
    const defaultProvider = vscode.workspace
      .getConfiguration('polyagent')
      .get<string>('defaultProvider', 'claude');
    this.conversation = newConversation(defaultProvider);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('polyagent.language') && this.view) {
          this.view.webview.html = this.html(this.view.webview);
        } else if (event.affectsConfiguration('polyagent')) {
          this.postState();
        }
      }),
      { dispose: () => clearInterval(this.limitsTimer) }
    );
    void this.refreshAllModels();
  }

  /** Fetches /models for every enabled API provider with a stored key, at most once a day each. */
  private async refreshAllModels(): Promise<void> {
    const stamps = this.context.globalState.get<Record<string, number>>(MODELS_REFRESHED_KEY, {});
    for (const def of loadProviders()) {
      if (def.kind !== 'http' || def.enabled === false || Date.now() - (stamps[def.id] ?? 0) < MODELS_REFRESH_MS) {
        continue;
      }
      if (!(await this.context.secrets.get(apiKeySecret(def.id)))) {
        continue;
      }
      try {
        await this.refreshModels(def);
        stamps[def.id] = Date.now();
        await this.context.globalState.update(MODELS_REFRESHED_KEY, stamps);
      } catch {
        // Offline or bad key: the settings modal reports it when the user fetches by hand.
      }
    }
  }

  /** Stores the provider's /models list; returns it with the count of ids not known before. */
  private async refreshModels(def: ProviderDef): Promise<{ fetched: ModelDef[]; added: number }> {
    const fetched = await new HttpAdapter(def, async (key) => this.context.secrets.get(apiKeySecret(key))).listModels();
    if (!fetched.length) {
      return { fetched, added: 0 };
    }
    const known = new Set((def.models ?? []).map((m) => m.id));
    const added = fetched.filter((m) => !known.has(m.id)).length;
    const disabled = new Set(def.disabledModels ?? []);
    // Long catalogues (e.g. routers) would flood the model menu, so new entries start switched off.
    if (fetched.length > 15) {
      for (const model of fetched) {
        if (!known.has(model.id)) {
          disabled.add(model.id);
        }
      }
    }
    const same = (a: ModelDef[] = [], b: ModelDef[]) =>
      a.length === b.length && a.every((m, i) => m.id === b[i].id && m.label === b[i].label);
    if (!added && same(def.fetchedModels, fetched)) {
      return { fetched, added };
    }
    await updateProviderOverride(def.id, {
      fetchedModels: fetched,
      disabledModels: disabled.size ? [...disabled] : undefined
    });
    return { fetched, added };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => this.onMessage(message));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.refreshLimits();
      }
    });

    clearInterval(this.limitsTimer);
    this.limitsTimer = setInterval(() => {
      if (this.view?.visible) {
        void this.refreshLimits();
      }
    }, LIMITS_REFRESH_MS);
  }

  newChat(): void {
    this.controller.cancel();
    this.handoff = undefined;
    this.pending = undefined;
    this.attachments = [];
    const mode = this.conversation.mode ?? 'chat';
    this.conversation = newConversation(this.conversation.providerId, this.conversation.model);
    this.conversation.mode = mode;
    this.postState();
  }

  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  private postState(): void {
    this.post({ type: 'state', state: this.state() });
  }

  private state() {
    return {
      providers: enabledProviders().map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        protocol: p.protocol,
        description: providerDescription(p),
        defaultModel: p.defaultModel,
        supportsThinking: p.supportsThinking !== false,
        models: localizedModels(p)
      })),
      conversation: this.conversation,
      mode: this.conversation.mode ?? 'chat',
      pending: this.pending ? { kind: this.pending.kind, text: this.pending.text, modelLabel: this.switchLabel(this.conversation.providerId, this.conversation.model, this.conversation.effort) } : null,
      handoff: this.handoffView(),
      attachments: this.attachmentView(),
      skills: activeSkills().map((skill) => ({ name: skill.name, description: skill.description })),
      running: this.controller.running,
      // What each adapter falls back to when the chat has no permission of its own.
      permissionDefaults: {
        claude: vscode.workspace.getConfiguration('polyagent').get<string>('claude.permissionMode', 'acceptEdits'),
        codex: vscode.workspace.getConfiguration('polyagent').get<string>('codex.sandbox', 'workspace-write'),
        http: vscode.workspace.getConfiguration('polyagent').get<string>('http.permissionMode', 'write')
      },
      version: this.context.extension.packageJSON.version
    };
  }

  /** Attached files with what the current model can do with each. */
  private attachmentView() {
    const def = enabledProviders().find((p) => p.id === this.conversation.providerId);
    return this.attachments.map((file) => ({
      ...file,
      support: attachmentSupport(def, this.conversation.model ?? def?.defaultModel, file)
    }));
  }

  /** Adds files by path; folders become an @-mention in the draft instead. */
  private addAttachmentPaths(paths: string[], temp = false): void {
    const folders: string[] = [];
    for (const filePath of paths) {
      if (this.attachments.some((a) => a.path === filePath)) {
        continue;
      }
      const file = describeFile(filePath, temp);
      if (file) {
        this.attachments.push(file);
      } else {
        folders.push(filePath);
      }
    }
    if (folders.length) {
      this.post({ type: 'insert', text: folders.map((f) => `@${vscode.workspace.asRelativePath(f)}`).join(' ') + ' ' });
    }
    this.postState();
  }

  /** Pending hand-off with labels and the transfer size, as the webview renders it. */
  private handoffView() {
    const pending = this.handoff;
    if (!pending) {
      return null;
    }
    const label = modelLabeler();
    const providers = enabledProviders();
    const fromDef = providers.find((p) => p.id === pending.from.providerId);
    const toDef = pending.to && providers.find((p) => p.id === pending.to!.providerId);
    const to =
      pending.to && toDef
        ? (() => {
            const model = pending.to!.model ?? toDef.defaultModel;
            const pricing = toDef.models?.find((m) => m.id === model)?.pricing;
            const transfer = planTransfer(this.conversation, toDef, model, label);
            return {
              providerId: toDef.id,
              providerLabel: toDef.label,
              model,
              label: label(pending.to!),
              effort: effortFor(toDef, model, this.conversation.effort),
              transfer,
              costUsd: pricing?.input !== undefined ? (transfer.tokens / 1e6) * pricing.input : undefined
            };
          })()
        : undefined;
    return {
      reason: pending.quota.message,
      resetsAt: pending.quota.resetsAt,
      from: {
        providerId: pending.from.providerId,
        providerLabel: fromDef?.label ?? pending.from.providerId,
        label: label(pending.from),
        lastUsage: lastUsage(this.conversation, pending.from.providerId)
      },
      to
    };
  }

  /** Suggests where to continue after `providerId` ran out of quota. */
  private async offerHandoff(from: HandoffTarget, quota: QuotaHit): Promise<void> {
    const until = quota.resetsAt && quota.resetsAt > Date.now() ? quota.resetsAt : Date.now() + EXHAUSTED_FALLBACK_MS;
    this.exhausted.set(from.providerId, until);

    const providers = enabledProviders();
    const withKey = new Set<string>();
    for (const def of providers) {
      if (!needsApiKey(def) || (await this.context.secrets.get(apiKeySecret(def.id)))) {
        withKey.add(def.id);
      }
    }
    const preferred = vscode.workspace.getConfiguration('polyagent').get<string[]>('fallbackOrder', []);
    const to = suggestTarget(
      providers,
      from,
      (def) => withKey.has(def.id) && (this.exhausted.get(def.id) ?? 0) <= Date.now(),
      preferred
    );
    this.handoff = { from, quota, to };
    this.postState();
  }

  /** Switches to the hand-off target and asks it to finish the interrupted turn. */
  private async acceptHandoff(): Promise<void> {
    const pending = this.handoff;
    if (!pending?.to || this.controller.running) {
      return;
    }
    const label = modelLabeler();
    const def = enabledProviders().find((p) => p.id === pending.to!.providerId);
    this.conversation.providerId = pending.to.providerId;
    this.conversation.model = pending.to.model ?? def?.defaultModel;
    if (def) {
      this.conversation.effort = effortFor(def, this.conversation.model, this.conversation.effort) ?? this.conversation.effort;
    }
    this.handoff = undefined;
    await this.send(
      t('handoff.prompt', { name: label(pending.from), reason: pending.quota.message }),
      true
    );
  }

  private async refreshLimits(force = false): Promise<void> {
    const def = loadProviders().find((p) => p.id === this.conversation.providerId);
    const providerId = this.conversation.providerId;
    if (!def) {
      this.post({ type: 'limits', providerId, limits: null });
      return;
    }
    const limits = await this.limits.get(def, this.conversation.model ?? def.defaultModel, force);
    this.post({ type: 'limits', providerId, limits: limits ?? null });
  }

  /** "Sonnet 5 High" for the picker chip and the switch notice; label falls back to the id. */
  private switchLabel(providerId: string, model?: string, effort?: string): string {
    const def = enabledProviders().find((p) => p.id === providerId);
    const id = model ?? def?.defaultModel;
    const modelLabel = def?.models?.find((m) => m.id === id)?.label ?? id ?? def?.label ?? providerId;
    const chosen = def?.models?.find((m) => m.id === id);
    const showsEffort = effort && chosen?.efforts && chosen.efforts.length > 1;
    return showsEffort ? `${modelLabel} ${t(`effort.${effort}`)}` : modelLabel;
  }

  /** Prints a `Sonnet 5 Low → Luna High` notice in the transcript, like a CLI's /model echo. */
  private noteSwitch(before: { providerId: string; model?: string; effort: string }): void {
    const after = { providerId: this.conversation.providerId, model: this.conversation.model, effort: this.conversation.effort };
    if (before.providerId === after.providerId && before.model === after.model && before.effort === after.effort) {
      return;
    }
    const fromLabel = this.switchLabel(before.providerId, before.model, before.effort);
    const toLabel = this.switchLabel(after.providerId, after.model, after.effort);
    if (fromLabel === toLabel) {
      return;
    }
    this.conversation.messages.push({
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'system',
      text: `${fromLabel} → ${toLabel}`,
      createdAt: Date.now()
    });
    void this.store.save(this.conversation);
  }

  private selectModel(providerId: string, model?: string): void {
    const before = { providerId: this.conversation.providerId, model: this.conversation.model, effort: this.conversation.effort };
    const def = enabledProviders().find((p) => p.id === providerId);
    this.conversation.providerId = providerId;
    this.conversation.model = model ?? def?.defaultModel ?? def?.models?.[0]?.id;
    if (this.handoff) {
      this.handoff.to = { providerId, model: this.conversation.model };
    }
    const chosen = def?.models?.find((m) => m.id === this.conversation.model);
    if (chosen?.efforts?.length && !chosen.efforts.includes(this.conversation.effort)) {
      this.conversation.effort = chosen.defaultEffort ?? chosen.efforts[chosen.efforts.length - 1];
    }
    // A codex sandbox value would abort a claude run (and vice versa); keep the chat's choice,
    // expressed for the new provider's CLI.
    this.conversation.permission = translatePermission(this.conversation.permission, def);
    this.noteSwitch(before);
    this.postState();
    void this.refreshLimits();
    // The held message was only waiting for a stronger planner: a good pick sends it.
    if (this.pending?.kind === 'planWarn' && !this.gate(this.pending.text)) {
      const held = this.pending.text;
      this.pending = undefined;
      void this.send(held, false, true);
    }
  }

  private async onMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'ready':
        this.postState();
        void this.refreshLimits();
        return;

      case 'send':
        await this.send(String(message.text ?? ''));
        return;

      case 'setMode': {
        const mode = String(message.mode) as ChatMode;
        if (CHAT_MODES.includes(mode) && mode !== (this.conversation.mode ?? 'chat')) {
          this.conversation.mode = mode;
          this.pending = undefined;
          await this.store.save(this.conversation);
        }
        this.postState();
        return;
      }

      case 'pendingResolve':
        await this.resolvePending(String(message.action));
        return;

      case 'openPlan': {
        const file = message.path ? String(message.path) : undefined;
        const plan = this.planOf(String(message.messageId ?? ''));
        if (file) {
          await this.planPanel.openFile(file, plan);
        } else if (plan) {
          await this.planPanel.show(plan);
        }
        return;
      }

      case 'addAttachments': {
        const paths = (Array.isArray(message.uris) ? message.uris : [])
          .map((raw: unknown) => {
            try {
              const uri = vscode.Uri.parse(String(raw).trim(), true);
              return uri.scheme === 'file' ? uri.fsPath : undefined;
            } catch {
              return undefined;
            }
          })
          .filter(Boolean) as string[];
        this.addAttachmentPaths(paths);
        return;
      }

      case 'addAttachmentData': {
        const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'attachments').fsPath;
        try {
          const file = storeDroppedFile(dir, String(message.name ?? 'file'), String(message.data ?? ''));
          this.addAttachmentPaths([file], true);
        } catch (err) {
          vscode.window.showErrorMessage(t('dialog.attachFailed', { error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      case 'notify':
        vscode.window.showWarningMessage(String(message.text ?? ''));
        return;

      case 'removeAttachment':
        this.attachments = this.attachments.filter((a) => a.id !== String(message.id));
        this.postState();
        return;

      case 'handoffAccept':
        await this.acceptHandoff();
        return;

      case 'handoffDismiss':
        this.handoff = undefined;
        this.postState();
        return;

      case 'abort':
        this.controller.cancel();
        this.post({ type: 'event', event: { type: 'done' } });
        return;

      case 'newChat':
        this.newChat();
        return;

      case 'selectModel':
        this.selectModel(String(message.providerId), message.model ? String(message.model) : undefined);
        return;

      case 'setEffort': {
        const before = { providerId: this.conversation.providerId, model: this.conversation.model, effort: this.conversation.effort };
        this.conversation.effort = String(message.effort);
        this.noteSwitch(before);
        this.postState();
        return;
      }

      case 'setThinking':
        this.conversation.thinking = Boolean(message.thinking);
        this.postState();
        return;

      case 'setPermission':
        this.conversation.permission = message.mode ? String(message.mode) : undefined;
        this.postState();
        return;

      case 'setShowTools':
        this.conversation.showTools = Boolean(message.showTools);
        this.postState();
        return;

      case 'refreshLimits':
        await this.refreshLimits(true);
        return;

      case 'openUsage':
        await this.usagePanel.show();
        return;

      case 'checkProviders':
        await this.checkProviders();
        return;

      case 'history':
        this.postHistory();
        return;

      case 'openConversation': {
        const picked = this.store.get(String(message.id));
        if (picked && picked.id !== this.conversation.id) {
          this.controller.cancel();
          this.handoff = undefined;
          this.attachments = [];
          this.conversation = picked;
          // Chats stored before a provider switch can carry a permission of the wrong protocol.
          this.conversation.permission = translatePermission(
            this.conversation.permission,
            enabledProviders().find((p) => p.id === picked.providerId)
          );
          this.postState();
          void this.refreshLimits();
        }
        return;
      }

      case 'deleteConversation': {
        const id = String(message.id);
        const title = this.store.get(id)?.title ?? 'Chat';
        const deleteLabel = t('common.delete');
        const confirmed = await vscode.window.showWarningMessage(
          t('history.deleteQuestion', { title }),
          { modal: true, detail: t('history.deleteDetail') },
          deleteLabel
        );
        if (confirmed !== deleteLabel) {
          return;
        }
        await this.store.remove(id);
        if (id === this.conversation.id) {
          this.newChat();
        }
        this.postHistory();
        return;
      }

      case 'clear':
        this.handoff = undefined;
        this.conversation.messages = [];
        this.conversation.providerSessions = {};
        await this.store.save(this.conversation);
        this.postState();
        return;

      case 'rewind': {
        const messages = this.conversation.messages;
        while (messages.length && messages[messages.length - 1].role !== 'user') {
          messages.pop();
        }
        messages.pop();
        await this.store.save(this.conversation);
        this.postState();
        return;
      }

      case 'attachFile': {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: t('dialog.attach') });
        if (picked?.length) {
          this.addAttachmentPaths(picked.map((uri) => uri.fsPath));
        }
        return;
      }

      case 'mentionFile': {
        const files = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,out}/**', 2000);
        const items = files.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: t('dialog.mention') });
        if (picked) {
          this.post({ type: 'insert', text: `@${picked.label} ` });
        }
        return;
      }

      case 'openSettingsJson':
        await vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: 'polyagent.providers' } });
        return;

      case 'getSettings':
        await this.postSettings();
        return;

      case 'settings':
        try {
          await this.applySetting(message);
        } catch (err) {
          this.post({ type: 'settingsError', message: err instanceof Error ? err.message : String(err) });
        }
        await this.postSettings();
        return;

      default:
        return;
    }
  }

  /** Everything the settings modal edits. Secrets are reported as present or not, never sent. */
  private async postSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('polyagent');
    const providers = await Promise.all(
      loadProviders().map(async (p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        description: providerDescription(p),
        builtin: isBuiltin(p.id),
        enabled: p.enabled !== false,
        command: p.command,
        protocol: p.protocol,
        apiKeyEnv: p.apiKeyEnv,
        needsApiKey: needsApiKey(p),
        baseUrl: p.baseUrl,
        api: p.api,
        models: (p.models ?? []).map((m) => ({
          id: m.id,
          label: m.label ?? m.id,
          enabled: !(p.disabledModels ?? []).includes(m.id),
          custom: (p.extraModels ?? []).some((x) => x.id === m.id)
        })),
        hasApiKey: Boolean(await this.context.secrets.get(apiKeySecret(p.id))),
        hasAdminKey: Boolean(await this.context.secrets.get(adminKeySecret(p.id)))
      }))
    );
    this.post({
      type: 'settingsData',
      settings: {
        providers,
        mcpServers: loadMcpServers(),
        skills: {
          root: skillsRoot(),
          installed: listSkills().map(({ name, description, dir, enabled }) => ({ name, description, dir, enabled })),
          importable: importableSkills()
        },
        general: {
          defaultProvider: config.get<string>('defaultProvider', 'claude'),
          claudePermissionMode: normalizeClaudePermission(config.get<string>('claude.permissionMode', 'acceptEdits')),
          codexSandbox: config.get<string>('codex.sandbox', 'workspace-write'),
          httpPermissionMode: config.get<string>('http.permissionMode', 'write'),
          planMaxParallelTasks: config.get<number>('plan.maxParallelTasks', 4),
          contextTokenBudget: config.get<number>('context.tokenBudget', 1400),
          language: config.get<string>('language', 'auto'),
          languages: LANGS.map((id) => [id, LANGUAGE_NAMES[id]])
        }
      }
    });
  }

  private async applySetting(message: any): Promise<void> {
    const config = vscode.workspace.getConfiguration('polyagent');
    const id = String(message.providerId ?? '');
    const def = id ? loadProviders().find((p) => p.id === id) : undefined;

    switch (message.op) {
      case 'providerEnabled':
        await updateProviderOverride(id, { enabled: message.enabled ? undefined : false });
        return;

      case 'providerField': {
        const field = String(message.field);
        if (!['label', 'command', 'baseUrl', 'api'].includes(field)) {
          throw new Error(t('err.fieldNotEditable', { field }));
        }
        const value = String(message.value ?? '').trim();
        await updateProviderOverride(id, { [field]: value || undefined } as Partial<ProviderDef>);
        return;
      }

      case 'modelEnabled': {
        const disabled = new Set(def?.disabledModels ?? []);
        if (message.enabled) {
          disabled.delete(String(message.modelId));
        } else {
          disabled.add(String(message.modelId));
        }
        await updateProviderOverride(id, { disabledModels: disabled.size ? [...disabled] : undefined });
        return;
      }

      case 'addModel': {
        const modelId = String(message.modelId ?? '').trim();
        if (!modelId) {
          throw new Error(t('err.modelIdMissing'));
        }
        const extra: ModelDef[] = [...(def?.extraModels ?? []).filter((m) => m.id !== modelId)];
        extra.push({ id: modelId, label: String(message.label ?? '').trim() || modelId });
        await updateProviderOverride(id, { extraModels: extra });
        return;
      }

      case 'fetchModels': {
        if (!def || def.kind !== 'http') {
          throw new Error(t('err.fetchApiOnly'));
        }
        let fetched: ModelDef[];
        let added: number;
        try {
          ({ fetched, added } = await this.refreshModels(def));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          this.post({ type: 'providerCheck', providerId: id, ok: false, detail: t('err.fetchFailed', { detail }) });
          return;
        }
        if (!fetched.length) {
          this.post({ type: 'providerCheck', providerId: id, ok: false, detail: t('err.noModelsReturned') });
          return;
        }
        this.post({
          type: 'providerCheck',
          providerId: id,
          ok: true,
          detail: t('models.fetched', { count: fetched.length, added, off: fetched.length > 15 && added ? t('models.fetchedOff') : '' })
        });
        return;
      }

      case 'setAllModels': {
        const ids = (def?.models ?? []).map((m) => m.id);
        await updateProviderOverride(id, { disabledModels: message.enabled ? undefined : ids });
        return;
      }

      case 'removeModel': {
        const extra = (def?.extraModels ?? []).filter((m) => m.id !== String(message.modelId));
        await updateProviderOverride(id, { extraModels: extra.length ? extra : undefined });
        return;
      }

      case 'setSecret': {
        const key = message.which === 'admin' ? adminKeySecret(id) : apiKeySecret(id);
        const value = String(message.value ?? '');
        if (value) {
          await this.context.secrets.store(key, value);
        } else {
          await this.context.secrets.delete(key);
        }
        return;
      }

      case 'addProvider': {
        const newId = String(message.id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        if (!newId) {
          throw new Error(t('err.providerIdMissing'));
        }
        if (loadProviders().some((p) => p.id === newId)) {
          throw new Error(t('err.providerExists', { id: newId }));
        }
        const models = String(message.models ?? '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
          .map((m) => ({ id: m, label: m }));
        await updateProviderOverride(newId, {
          label: String(message.label ?? '').trim() || newId,
          kind: 'http',
          api: message.api === 'anthropic' ? 'anthropic' : 'openai',
          baseUrl: String(message.baseUrl ?? '').trim(),
          models,
          defaultModel: models[0]?.id,
          maxTokens: 8192
        });
        if (message.apiKey) {
          await this.context.secrets.store(apiKeySecret(newId), String(message.apiKey));
        }
        return;
      }

      case 'removeProvider':
        if (isBuiltin(id)) {
          throw new Error(t('err.builtinOnlyDisable'));
        }
        await removeProviderOverride(id);
        await this.context.secrets.delete(apiKeySecret(id));
        await this.context.secrets.delete(adminKeySecret(id));
        return;

      case 'resetProvider':
        await removeProviderOverride(id);
        return;

      case 'checkProvider': {
        if (!def) {
          return;
        }
        const result = await createAdapter(def, this.context.secrets).check();
        this.post({ type: 'providerCheck', providerId: id, ...result });
        return;
      }

      case 'mcpSet': {
        const name = String(message.name ?? '').trim();
        if (!/^[A-Za-z0-9_-]+$/.test(name)) {
          throw new Error(t('err.mcpName'));
        }
        const servers = { ...loadMcpServers() };
        if (message.previousName && message.previousName !== name) {
          delete servers[String(message.previousName)];
        }
        servers[name] = normalizeMcp(message.server);
        await config.update('mcpServers', servers, vscode.ConfigurationTarget.Global);
        return;
      }

      case 'mcpToggle': {
        const servers = { ...loadMcpServers() };
        const server = servers[String(message.name)];
        if (server) {
          servers[String(message.name)] = { ...server, disabled: message.enabled ? undefined : true };
          await config.update('mcpServers', servers, vscode.ConfigurationTarget.Global);
        }
        return;
      }

      case 'mcpRemove': {
        const servers = { ...loadMcpServers() };
        delete servers[String(message.name)];
        await config.update('mcpServers', servers, vscode.ConfigurationTarget.Global);
        return;
      }

      case 'skillInstall':
      case 'skillPick':
      case 'skillImport': {
        let names: string[];
        if (message.op === 'skillImport') {
          names = importForeignSkills();
        } else {
          let source = String(message.source ?? '');
          if (message.op === 'skillPick') {
            const picked = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: t('skills.dialogInstall'),
              filters: { Skill: ['md', 'zip', 'skill'], [t('skills.allFiles')]: ['*'] }
            });
            if (!picked?.length) {
              return;
            }
            source = picked[0].fsPath;
          }
          this.post({ type: 'skillStatus', ok: true, detail: t('skills.installing') });
          try {
            names = await installSkills(source);
          } catch (err) {
            this.post({ type: 'skillStatus', ok: false, detail: err instanceof Error ? err.message : String(err) });
            return;
          }
        }
        this.post({
          type: 'skillStatus',
          ok: true,
          detail: names.length ? t('skills.installed', { names: names.join(', ') }) : t('skills.nothingNew')
        });
        this.postState();
        return;
      }

      case 'skillToggle':
        await setSkillEnabled(String(message.name), Boolean(message.enabled));
        return;

      case 'skillRemove': {
        const name = String(message.name);
        const deleteLabel = t('common.delete');
        const answer = await vscode.window.showWarningMessage(t('skills.deleteQuestion', { name }), { modal: true }, deleteLabel);
        if (answer === deleteLabel) {
          removeSkill(name);
          this.postState();
        }
        return;
      }

      case 'skillReveal': {
        const dir = listSkills().find((s) => s.name === message.name)?.dir ?? skillsRoot();
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
        return;
      }

      case 'general': {
        const keys: Record<string, string> = {
          defaultProvider: 'defaultProvider',
          claudePermissionMode: 'claude.permissionMode',
          codexSandbox: 'codex.sandbox',
          httpPermissionMode: 'http.permissionMode',
          planMaxParallelTasks: 'plan.maxParallelTasks',
          contextTokenBudget: 'context.tokenBudget',
          language: 'language'
        };
        const key = keys[String(message.key)];
        if (key) {
          if (key === 'plan.maxParallelTasks' || key === 'context.tokenBudget') {
            const value = Number(message.value);
            const valid = key === 'plan.maxParallelTasks'
              ? Number.isInteger(value) && value >= 1 && value <= 8
              : Number.isInteger(value) && value >= 400 && value <= 8000;
            if (!valid) {
              throw new Error(t('err.invalidNumber'));
            }
            await config.update(key, value, vscode.ConfigurationTarget.Global);
          } else {
            await config.update(key, String(message.value), vscode.ConfigurationTarget.Global);
          }
        }
        return;
      }

      default:
        return;
    }
  }

  /** The plan a transcript card belongs to, as far as this session still has it in memory. */
  private planOf(messageId: string): Plan | undefined {
    const message = this.conversation.messages.find((m) => m.id === messageId);
    return message?.plan ? this.plans.get(message.plan.id) : undefined;
  }

  /** Why the message the user just wrote does not fit the current mode, if it does not. */
  private gate(prompt: string): PendingSend['kind'] | undefined {
    const mode = this.conversation.mode ?? 'chat';
    if (mode === 'chat') {
      return looksLikeBigTask(prompt) ? 'planSuggest' : undefined;
    }
    if (mode === 'ask') {
      return looksLikeRequestToAct(prompt) ? 'askSuggest' : undefined;
    }
    const def = enabledProviders().find((p) => p.id === this.conversation.providerId);
    return isStrongPlanner(def, this.conversation.model ?? def?.defaultModel, this.conversation.effort)
      ? undefined
      : 'planWarn';
  }

  /** Answers the mode question: the held message is sent, switched or dropped. */
  private async resolvePending(action: string): Promise<void> {
    const pending = this.pending;
    if (!pending) {
      return;
    }
    if (action === 'cancel') {
      this.pending = undefined;
      this.post({ type: 'insert', text: pending.text });
      this.postState();
      return;
    }
    if (action === 'models') {
      // The model menu opens in the webview; the message stays held until a model is picked.
      return;
    }
    this.pending = undefined;
    if (action === 'plan' || action === 'chat' || action === 'ask') {
      this.conversation.mode = action;
      await this.store.save(this.conversation);
      // Switching mode can raise a new question, e.g. a weak model for the plan it just accepted.
      const next = this.gate(pending.text);
      if (next && next !== pending.kind) {
        this.pending = { kind: next, text: pending.text };
        this.postState();
        return;
      }
    }
    await this.send(pending.text, false, true);
  }

  /** Writes the plan an answer produced to disk and hangs a preview card on the message. */
  private async capturePlan(): Promise<void> {
    const message = this.conversation.messages[this.conversation.messages.length - 1];
    if (!message || message.role !== 'assistant' || !message.text) {
      return;
    }
    const meta = { providerId: message.providerId, model: message.model };
    let { plan, text } = extractPlan(message.text, meta);
    if (!plan) {
      // A CLI agent in plan mode may hand its plan to a tool (Claude's ExitPlanMode) instead of
      // printing it, so the block is looked for in the tool inputs too.
      for (const value of message.tools?.flatMap((tool) => stringValues(tool.input)) ?? []) {
        const found = extractPlan(value, meta);
        if (found.plan) {
          plan = found.plan;
          break;
        }
      }
    }
    if (!plan) {
      this.conversation.messages.push({
        id: `m_${Date.now().toString(36)}_noplan`,
        role: 'system',
        text: t('plan.notStructured'),
        createdAt: Date.now()
      });
      await this.store.save(this.conversation);
      return;
    }
    let stored = plan;
    try {
      stored = savePlan(this.context, plan);
    } catch (err) {
      vscode.window.showWarningMessage(t('plan.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
    message.text = text;
    message.plan = {
      id: stored.id,
      path: stored.path,
      title: stored.title,
      preview: planPreview(stored),
      taskCount: stored.tasks.length,
      waveCount: planWaves(stored).length
    };
    this.plans.set(stored.id, stored);
    await this.store.save(this.conversation);
  }

  /** Reports a finished plan run in the transcript, so the chat keeps the whole story. */
  private noteRun(plan: Plan, run: PlanRun): void {
    const tasks = Object.values(run.tasks);
    const done = tasks.filter((task) => task.status === 'done').length;
    const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length;
    this.conversation.messages.push({
      id: `m_${Date.now().toString(36)}_run`,
      role: 'system',
      text: t('plan.runDone', { title: plan.title, done, total: tasks.length, failed }),
      createdAt: Date.now()
    });
    void this.store.save(this.conversation);
    this.postState();
  }

  private async send(text: string, handoff = false, force = false): Promise<void> {
    const files = handoff ? [] : this.attachmentView();
    const prompt = text.trim() || (files.length ? t('prompt.lookAtFiles') : '');
    if (!prompt || this.controller.running) {
      return;
    }
    if (!handoff && !force) {
      const question = this.gate(prompt);
      if (question) {
        this.pending = { kind: question, text: prompt };
        this.postState();
        return;
      }
    }
    this.pending = undefined;
    this.handoff = undefined;
    if (!handoff) {
      this.attachments = [];
    }
    const sent: Attachment[] = files
      .filter((f) => f.support.level !== 'block')
      .map(({ support: _support, ...file }) => file);
    const skipped = files
      .filter((f) => f.support.level === 'block')
      .map((f) => ({ name: f.name, note: f.support.note ?? '' }));

    this.conversation.messages.push({
      id: `m_${Date.now().toString(36)}`,
      role: 'user',
      text: prompt,
      attachments: sent.length ? sent : undefined,
      skippedAttachments: skipped.length ? skipped : undefined,
      handoff: handoff || undefined,
      createdAt: Date.now()
    });
    await this.store.save(this.conversation);
    this.postState();
    this.post({ type: 'running', running: true });

    const from = { providerId: this.conversation.providerId, model: this.conversation.model };
    const outcome = await this.controller.run(
      this.conversation,
      prompt,
      { onEvent: (event) => this.post({ type: 'event', event }) },
      sent
    );
    this.post({ type: 'running', running: false });
    if (!outcome.quota && (this.conversation.mode ?? 'chat') === 'plan') {
      await this.capturePlan();
    }
    if (outcome.quota) {
      await this.offerHandoff(from, outcome.quota);
    } else {
      this.exhausted.delete(from.providerId);
    }
    this.postState();
    void this.refreshLimits(true);
  }

  private async checkProviders(): Promise<void> {
    const results = await Promise.all(
      enabledProviders().map(async (def) => {
        const adapter = createAdapter(def, this.context.secrets);
        const result = await adapter.check();
        return { id: def.id, label: def.label, ...result };
      })
    );
    this.post({ type: 'providerChecks', results });
  }

  /** Stored chats for the history panel, newest first, without their messages. */
  private postHistory(): void {
    this.post({
      type: 'historyList',
      currentId: this.conversation.id,
      items: this.store.all().map((c) => ({
        id: c.id,
        title: c.title,
        providerId: c.providerId,
        model: c.model,
        messageCount: c.messages.length,
        updatedAt: c.updatedAt
      }))
    });
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const nonce = randomNonce();
    const lang = resolveLanguage();

    return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${asset('chat.css')}" />
<title>PolyMoly</title>
</head>
<body data-logo="${asset('icon.svg')}" data-logo-animated="${asset('icon-animated.svg')}">
<div id="root"></div>
${webviewI18nScript(nonce)}
<script nonce="${nonce}" src="${asset('chat.js')}"></script>
</body>
</html>`;
  }
}

/** Every string inside a tool input, so a plan handed to a tool is still found. */
function stringValues(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (depth > 3 || !value || typeof value !== 'object') {
    return [];
  }
  return Object.values(value as Record<string, unknown>).flatMap((entry) => stringValues(entry, depth + 1));
}

function normalizeMcp(raw: any): McpServerDef {
  const record = (value: unknown): Record<string, string> | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const entries = Object.entries(value as Record<string, unknown>).filter(([k]) => k.trim());
    return entries.length ? Object.fromEntries(entries.map(([k, v]) => [k.trim(), String(v)])) : undefined;
  };
  if (raw?.type === 'http' || raw?.type === 'sse') {
    const url = String(raw.url ?? '').trim();
    if (!url) {
      throw new Error(t('err.mcpUrl'));
    }
    return { type: raw.type, url, headers: record(raw.headers) };
  }
  const command = String(raw?.command ?? '').trim();
  if (!command) {
    throw new Error(t('err.mcpCommand'));
  }
  const args = Array.isArray(raw?.args) ? raw.args.map(String).filter((a: string) => a.length) : [];
  return { command, args, env: record(raw?.env) };
}

export function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/** Built-in descriptions follow the UI language; user-edited ones stay as written. */
function providerDescription(p: ProviderDef): string | undefined {
  const builtin = BUILTIN_PROVIDERS.find((b) => b.id === p.id);
  const own =
    builtin && p.description === builtin.description ? tOptional(`desc.${p.id}`) ?? p.description : p.description;
  if (own) {
    return own;
  }
  // API connectors carry no prose of their own; name the protocol and the host instead.
  if (p.kind === 'http' && p.baseUrl) {
    return `${t(p.api === 'anthropic' ? 'desc.anthropicApi' : 'desc.openaiApi')} · ${hostOf(p.baseUrl)}`;
  }
  return undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function localizedModels(p: ProviderDef): ModelDef[] {
  const builtin = BUILTIN_PROVIDERS.find((b) => b.id === p.id);
  return (p.models ?? []).map((m) => {
    const original = builtin?.models?.find((x) => x.id === m.id);
    return original && m.description === original.description
      ? { ...m, description: tOptional(`modeldesc.${m.id}`) ?? m.description }
      : m;
  });
}
