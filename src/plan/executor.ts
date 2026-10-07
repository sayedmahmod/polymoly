/** Runs a plan: one wave at a time, everything inside a wave at once, each tier on its own model. */
import * as vscode from 'vscode';
import { createAdapter } from '../providers';
import { activeMcpServers, findProvider } from '../providers/registry';
import { effortFor } from '../chat/controller';
import { AgentEvent, LocalToolsRequest, ProviderDef, SendRequest } from '../types';
import { taskPrompt } from './planFormat';
import { Plan, PlanRun, PlanTask, TaskRun, TaskTraceEvent, TierAssignments, planWaves } from './planTypes';
import { projectContext } from '../context/projectContext';

export interface RunHandlers {
  onTask(run: TaskRun): void;
  onDone(run: PlanRun): void;
}

/** Permission level a task runs with: it is allowed to edit, but not to leave the workspace. */
function permissionFor(def: ProviderDef): string | undefined {
  if (def.kind !== 'cli') {
    return undefined;
  }
  return def.protocol === 'codex-jsonl' ? 'workspace-write' : 'acceptEdits';
}

/** HTTP providers get the same rights through their local tools: read and edit, no shell. */
function localToolsFor(def: ProviderDef): LocalToolsRequest | undefined {
  return def.kind === 'http' ? { mode: 'edit', confirm: async () => false } : undefined;
}

export class PlanExecutor {
  private abort?: AbortController;
  private run?: PlanRun;
  private taskChatAbort?: AbortController;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  get running(): boolean {
    return Boolean(this.run?.running);
  }

  get current(): PlanRun | undefined {
    return this.run;
  }

  cancel(): void {
    this.abort?.abort();
    this.taskChatAbort?.abort();
  }

  /** Runs every task whose id is in `only`, or the whole plan when `only` is missing. */
  async start(plan: Plan, assignments: TierAssignments, handlers: RunHandlers, only?: string[]): Promise<PlanRun> {
    if (this.running) {
      return this.run!;
    }
    const picked = only?.length ? new Set(only) : undefined;
    const run: PlanRun = { planId: plan.id, running: true, startedAt: Date.now(), tasks: {} };
    for (const task of plan.tasks) {
      run.tasks[task.id] = { taskId: task.id, status: picked && !picked.has(task.id) ? 'skipped' : 'pending' };
    }
    this.run = run;
    this.abort = new AbortController();

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const report = (taskRun: TaskRun) => {
      run.tasks[taskRun.taskId] = taskRun;
      handlers.onTask(taskRun);
    };

    for (const wave of planWaves(plan)) {
      if (this.abort.signal.aborted) {
        break;
      }
      const due = wave.filter((task) => run.tasks[task.id].status === 'pending');
      for (const task of wave) {
        // A task whose dependency failed cannot run on a half-built repository.
        if (run.tasks[task.id].status === 'pending' && task.dependsOn.some((id) => run.tasks[id]?.status === 'failed' || run.tasks[id]?.status === 'blocked')) {
          report({ taskId: task.id, status: 'blocked' });
        }
      }
      const ready = due.filter((task) => run.tasks[task.id].status === 'pending');
      const limit = Math.max(1, Math.min(8, vscode.workspace.getConfiguration('polyagent.plan').get<number>('maxParallelTasks', 4)));
      for (let i = 0; i < ready.length; i += limit) {
        await Promise.all(ready.slice(i, i + limit).map((task) => this.runTask(plan, task, assignments, cwd, run, report)));
      }
    }

    run.running = false;
    run.endedAt = Date.now();
    for (const task of Object.values(run.tasks)) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'blocked';
      }
    }
    this.abort = undefined;
    handlers.onDone(run);
    return run;
  }

  private async runTask(
    plan: Plan,
    task: PlanTask,
    assignments: TierAssignments,
    cwd: string,
    run: PlanRun,
    report: (taskRun: TaskRun) => void
  ): Promise<void> {
    const assignment = assignments[task.tier];
    const def = assignment ? findProvider(assignment.providerId) : undefined;
    if (!def) {
      report({ taskId: task.id, status: 'failed', error: `No model assigned for tier "${task.tier}".` });
      return;
    }
    const model = assignment?.model ?? def.defaultModel;
    const state: TaskRun = {
      taskId: task.id,
      status: 'running',
      providerId: def.id,
      model,
      startedAt: Date.now(),
      output: '',
      trace: []
    };
    report({ ...state });

    const upstream = task.dependsOn.map((id) => ({
      id,
      title: plan.tasks.find((entry) => entry.id === id)?.title ?? id,
      output: run.tasks[id]?.output
    }));

    let text = '';
    let error = '';
    const addTrace = (event: TaskTraceEvent) => {
      state.trace = [...(state.trace ?? []), event].slice(-240);
    };
    const emit = (event: AgentEvent) => {
      const at = Date.now();
      if (event.type === 'text_delta') {
        text += event.text;
        state.output = text.slice(-4000);
        addTrace({ at, type: 'text', text: event.text });
      } else if (event.type === 'thinking_delta') {
        addTrace({ at, type: 'thinking', text: event.text });
      } else if (event.type === 'tool_start') {
        addTrace({ at, type: 'tool_start', name: event.name, input: compact(event.input) });
      } else if (event.type === 'tool_end') {
        addTrace({ at, type: 'tool_end', name: event.name, output: event.output?.slice(-3000), isError: event.isError });
      } else if (event.type === 'notice') {
        addTrace({ at, type: 'notice', text: event.text });
      } else if (event.type === 'session') {
        state.sessionId = event.sessionId;
      } else if (event.type === 'usage') {
        addTrace({ at, type: 'usage', text: `${event.usage.inputTokens} in · ${event.usage.outputTokens} out` });
      } else if (event.type === 'error') {
        error = [error, event.message].filter(Boolean).join('\n');
        addTrace({ at, type: 'error', text: event.message });
      }
      report({ ...state });
    };

    const map = await projectContext.forPrompt(cwd, `${plan.title}\n${task.title}\n${task.goal}\n${task.files.join(' ')}`, contextTokenBudget());

    const request: SendRequest = {
      prompt: taskPrompt(plan, task, upstream),
      model,
      cwd,
      history: [],
      effort: effortFor(def, model, assignment?.effort),
      thinking: true,
      permission: permissionFor(def),
      mcpServers: def.kind === 'cli' ? activeMcpServers() : undefined,
      localTools: localToolsFor(def),
      instructions: map.text,
      signal: this.abort!.signal
    };

    try {
      await createAdapter(def, this.secrets).send(request, emit);
    } catch (err) {
      error = [error, err instanceof Error ? err.message : String(err)].filter(Boolean).join('\n');
    }

    state.endedAt = Date.now();
    state.output = text.trim().slice(-4000);
    if (this.abort?.signal.aborted) {
      state.status = 'blocked';
      state.error = error || undefined;
    } else if (error && !text.trim()) {
      state.status = 'failed';
      state.error = error;
    } else {
      state.status = 'done';
      state.error = error || undefined;
    }
    report({ ...state });
  }

  /** Continue a completed task in its own inspector chat without contaminating the main chat. */
  async followUp(plan: Plan, task: PlanTask, assignments: TierAssignments, message: string, handlers: RunHandlers): Promise<void> {
    const run = this.run;
    const state = run?.tasks[task.id];
    if (!run || !state || this.taskChatAbort || !message.trim()) {
      return;
    }
    const assignment = assignments[task.tier];
    const def = assignment && findProvider(assignment.providerId);
    if (!def) {
      return;
    }
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const model = assignment.model ?? def.defaultModel;
    this.taskChatAbort = new AbortController();
    const abort = this.taskChatAbort;
    const addTrace = (event: TaskTraceEvent) => {
      state.trace = [...(state.trace ?? []), event].slice(-240);
      handlers.onTask({ ...state });
    };
    addTrace({ at: Date.now(), type: 'user', text: message.trim() });
    let response = '';
    let error = '';
    const emit = (event: AgentEvent) => {
      const at = Date.now();
      if (event.type === 'session') state.sessionId = event.sessionId;
      if (event.type === 'text_delta') { response += event.text; addTrace({ at, type: 'text', text: event.text }); }
      else if (event.type === 'thinking_delta') addTrace({ at, type: 'thinking', text: event.text });
      else if (event.type === 'tool_start') addTrace({ at, type: 'tool_start', name: event.name, input: compact(event.input) });
      else if (event.type === 'tool_end') addTrace({ at, type: 'tool_end', name: event.name, output: event.output?.slice(-3000), isError: event.isError });
      else if (event.type === 'notice') addTrace({ at, type: 'notice', text: event.text });
      else if (event.type === 'usage') addTrace({ at, type: 'usage', text: `${event.usage.inputTokens} in · ${event.usage.outputTokens} out` });
      else if (event.type === 'error') { error = [error, event.message].filter(Boolean).join('\n'); addTrace({ at, type: 'error', text: event.message }); }
    };
    const map = await projectContext.forPrompt(cwd, `${task.title}\n${task.goal}\n${message}`, contextTokenBudget());
    try {
      await createAdapter(def, this.secrets).send({
        prompt: `# Task follow-up — ${task.id}: ${task.title}\n\n${task.goal}\n\nUser: ${message}\n\nStay inside this task. Answer directly; only change files when explicitly asked.`,
        model,
        cwd,
        history: [],
        sessionId: state.sessionId,
        effort: effortFor(def, model, assignment.effort),
        thinking: true,
        permission: permissionFor(def),
        mcpServers: def.kind === 'cli' ? activeMcpServers() : undefined,
        localTools: localToolsFor(def),
        instructions: map.text,
        signal: abort.signal
      }, emit);
    } catch (err) {
      error = [error, err instanceof Error ? err.message : String(err)].filter(Boolean).join('\n');
    } finally {
      if (response.trim()) state.output = response.trim().slice(-4000);
      if (error) state.error = error;
      this.taskChatAbort = undefined;
      handlers.onTask({ ...state });
    }
  }
}

function compact(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try { return JSON.stringify(value).slice(0, 2500); } catch { return String(value).slice(0, 2500); }
}

function contextTokenBudget(): number {
  return vscode.workspace.getConfiguration('polyagent.context').get<number>('tokenBudget', 1400);
}
