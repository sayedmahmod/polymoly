import * as vscode from 'vscode';
import { resolveLanguage, t, webviewI18nScript } from '../i18n';
import { PlanExecutor } from '../plan/executor';
import { planMarkdown } from '../plan/planFormat';
import { loadPlan } from '../plan/planStore';
import { Plan, PlanRun, TaskTier, TierAssignment, TierAssignments, brokenDependencies, planWaves } from '../plan/planTypes';
import { enabledProviders } from '../providers/registry';
import { ModelDef, ProviderDef } from '../types';
import { randomNonce } from './chatViewProvider';

const TIER_KEY = 'polyagent.planTiers';

/** The plan itself, its graph and its per-tier models, opened in the editor area. */
export class PlanPanel {
  private panel?: vscode.WebviewPanel;
  private plan?: Plan;
  private readonly executor: PlanExecutor;
  private run?: PlanRun;

  /** Called when a run finishes, so the chat can report it in the transcript. */
  onRunFinished?: (plan: Plan, run: PlanRun) => void;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.executor = new PlanExecutor(context.secrets);
  }

  async show(plan: Plan): Promise<void> {
    this.plan = plan;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('polyagent.plan', t('plan.title'), vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      });
      this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg');
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message) => void this.onMessage(message));
    } else {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.post();
    }
  }

  /** Opens the plan that belongs to a transcript card, re-read from disk so edits count. */
  async openFile(file: string, fallback?: Plan): Promise<void> {
    const plan = loadPlan(file) ?? fallback;
    if (!plan) {
      vscode.window.showWarningMessage(t('plan.fileGone', { path: file }));
      return;
    }
    if (this.plan?.id !== plan.id) {
      this.run = undefined;
    }
    await this.show({ ...plan, path: file });
  }

  dispose(): void {
    this.executor.cancel();
    this.panel?.dispose();
  }

  private assignments(): TierAssignments {
    const stored = this.context.globalState.get<Partial<TierAssignments>>(TIER_KEY, {});
    const providers = enabledProviders();
    const pick = (tier: TaskTier): TierAssignment | undefined => {
      const saved = stored[tier];
      if (saved && providers.some((p) => p.id === saved.providerId)) {
        return saved;
      }
      return defaultAssignment(providers, tier);
    };
    return { low: pick('low'), mid: pick('mid'), hard: pick('hard') };
  }

  private async setAssignment(tier: TaskTier, assignment: TierAssignment | undefined): Promise<void> {
    const stored = { ...this.context.globalState.get<Partial<TierAssignments>>(TIER_KEY, {}) };
    stored[tier] = assignment;
    await this.context.globalState.update(TIER_KEY, stored);
  }

  private post(): void {
    if (!this.panel || !this.plan) {
      return;
    }
    const plan = this.plan;
    this.panel.webview.postMessage({
      type: 'plan',
      plan,
      markdown: planMarkdown(plan),
      waves: planWaves(plan).map((wave) => wave.map((task) => task.id)),
      broken: brokenDependencies(plan),
      assignments: this.assignments(),
      providers: enabledProviders().map((p) => ({
        id: p.id,
        label: p.label,
        kind: p.kind,
        defaultModel: p.defaultModel,
        models: (p.models ?? []).map((m: ModelDef) => ({ id: m.id, label: m.label ?? m.id, tier: m.tier, efforts: m.efforts ?? p.efforts ?? [] }))
      })),
      run: this.run,
      running: this.executor.running
    });
  }

  private async onMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'ready':
        this.post();
        return;

      case 'setTier':
        await this.setAssignment(String(message.tier) as TaskTier, message.assignment ? {
          providerId: String(message.assignment.providerId),
          model: message.assignment.model ? String(message.assignment.model) : undefined,
          effort: message.assignment.effort ? String(message.assignment.effort) : undefined
        } : undefined);
        this.post();
        return;

      case 'reload': {
        if (this.plan?.path) {
          const fresh = loadPlan(this.plan.path);
          if (fresh) {
            this.plan = fresh;
          }
        }
        this.post();
        return;
      }

      case 'openMarkdown': {
        if (!this.plan?.path) {
          return;
        }
        const uri = vscode.Uri.file(this.plan.path);
        await vscode.commands.executeCommand('markdown.showPreview', uri);
        return;
      }

      case 'editMarkdown': {
        if (this.plan?.path) {
          await vscode.window.showTextDocument(vscode.Uri.file(this.plan.path), { preview: false, viewColumn: vscode.ViewColumn.Beside });
        }
        return;
      }

      case 'run':
        await this.runPlan(Array.isArray(message.only) ? message.only.map(String) : undefined);
        return;

      case 'cancel':
        this.executor.cancel();
        return;

      case 'taskChat': {
        if (!this.plan) {
          return;
        }
        const task = this.plan.tasks.find((entry) => entry.id === String(message.taskId));
        if (!task) {
          return;
        }
        await this.executor.followUp(this.plan, task, this.assignments(), String(message.text ?? ''), {
          onTask: (updated) => {
            this.run = this.executor.current;
            this.panel?.webview.postMessage({ type: 'task', task: updated, running: this.executor.running });
          },
          onDone: () => undefined
        });
        return;
      }

      default:
        return;
    }
  }

  private async runPlan(only?: string[]): Promise<void> {
    if (!this.plan || this.executor.running) {
      return;
    }
    // The markdown file is the source of truth: the user may have edited it since it was written.
    if (this.plan.path) {
      this.plan = loadPlan(this.plan.path) ?? this.plan;
    }
    const plan = this.plan;
    const assignments = this.assignments();
    const missing = [...new Set(plan.tasks.map((task) => task.tier))].filter((tier) => !assignments[tier]);
    if (missing.length) {
      vscode.window.showWarningMessage(t('plan.noModelForTier', { tiers: missing.join(', ') }));
      return;
    }
    await this.executor.start(
      plan,
      assignments,
      {
        onTask: (task) => {
          this.run = this.executor.current;
          this.panel?.webview.postMessage({ type: 'task', task, running: this.executor.running });
        },
        onDone: (run) => {
          this.run = run;
          this.post();
          this.onRunFinished?.(plan, run);
        }
      },
      only
    );
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name));
    const nonce = randomNonce();
    const lang = resolveLanguage();
    return `<!DOCTYPE html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<link rel="stylesheet" href="${asset('chat.css')}" />
<link rel="stylesheet" href="${asset('plan.css')}" />
<title>PolyMoly · ${t('plan.title')}</title>
</head>
<body class="plan-body" data-logo="${asset('icon.svg')}">
<div id="root"></div>
${webviewI18nScript(nonce)}
<script nonce="${nonce}" src="${asset('plan.js')}"></script>
</body>
</html>`;
  }
}

/** Sensible first pick per tier: the strongest model for hard, the quickest for low. */
function defaultAssignment(providers: ProviderDef[], tier: TaskTier): TierAssignment | undefined {
  const wanted: Record<TaskTier, ModelDef['tier'][]> = {
    hard: ['frontier', 'flagship'],
    mid: ['flagship', 'balanced'],
    low: ['fast', 'balanced']
  };
  for (const want of wanted[tier]) {
    // A CLI agent can actually edit files, so it wins over an API-only provider.
    for (const kind of ['cli', 'http'] as const) {
      for (const provider of providers.filter((p) => p.kind === kind)) {
        const model = (provider.models ?? []).find((m) => m.tier === want);
        if (model) {
          return { providerId: provider.id, model: model.id, effort: tier === 'hard' ? 'high' : undefined };
        }
      }
    }
  }
  const first = providers.find((p) => (p.models ?? []).length);
  return first ? { providerId: first.id, model: first.defaultModel ?? first.models?.[0]?.id } : undefined;
}
