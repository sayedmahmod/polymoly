/** Shared types for plan mode: the plan itself, its tasks and a running execution. */

/** How much model muscle a task needs. Drives which model the user assigns to it. */
export type TaskTier = 'low' | 'mid' | 'hard';

export const TASK_TIERS: TaskTier[] = ['low', 'mid', 'hard'];

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'blocked' | 'skipped';

export interface PlanTask {
  /** Short stable id used by `dependsOn`, e.g. "T1". */
  id: string;
  title: string;
  tier: TaskTier;
  /** Ids of tasks that must finish first. Empty: the task may start in the first wave. */
  dependsOn: string[];
  /** What the task must achieve, in one or two sentences. */
  goal: string;
  /** What the executing model already needs to know: conventions, prior decisions, file layout. */
  context: string[];
  /** Hard limits: what must not be touched, changed or invented. */
  boundaries: string[];
  /** Files the task is expected to create or change. */
  files: string[];
  /** Checks that prove the task is finished. */
  acceptance: string[];
}

export interface Plan {
  id: string;
  title: string;
  /** One paragraph: what the plan builds and how it is cut up. */
  summary: string;
  /** Why the iterative parts cannot run in parallel. */
  sequencing?: string;
  tasks: PlanTask[];
  /** Prose the model wrote around the task list, kept for the markdown file. */
  notes?: string;
  /** Absolute path of the markdown file on disk. */
  path?: string;
  createdAt: number;
  /** Provider and model that wrote the plan. */
  authorProviderId?: string;
  authorModel?: string;
}

/** Which model runs a tier during execution. */
export interface TierAssignment {
  providerId: string;
  model?: string;
  effort?: string;
}

export type TierAssignments = Record<TaskTier, TierAssignment | undefined>;

export interface TaskRun {
  taskId: string;
  status: TaskStatus;
  providerId?: string;
  model?: string;
  startedAt?: number;
  endedAt?: number;
  /** Last lines the model produced, shown in the panel. */
  output?: string;
  /** Provider session used by the task. A task follow-up resumes this session when supported. */
  sessionId?: string;
  /** Ordered, bounded trace for the task inspector. It is kept in memory for the open plan. */
  trace?: TaskTraceEvent[];
  error?: string;
}

/** A human-readable event emitted while one plan task runs. */
export interface TaskTraceEvent {
  at: number;
  type: 'user' | 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'notice' | 'error' | 'usage';
  text?: string;
  name?: string;
  input?: string;
  output?: string;
  isError?: boolean;
}

export interface PlanRun {
  planId: string;
  running: boolean;
  startedAt: number;
  endedAt?: number;
  tasks: Record<string, TaskRun>;
}

/** Tasks grouped into waves: every wave runs in parallel, waves run one after another. */
export function planWaves(plan: Plan): PlanTask[][] {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const done = new Set<string>();
  const waves: PlanTask[][] = [];
  let left = plan.tasks.slice();

  while (left.length) {
    const wave = left.filter((task) => task.dependsOn.every((id) => done.has(id) || !byId.has(id)));
    if (!wave.length) {
      // A dependency cycle: run whatever is left one task at a time rather than dropping it.
      waves.push(...left.map((task) => [task]));
      break;
    }
    waves.push(wave);
    for (const task of wave) {
      done.add(task.id);
    }
    left = left.filter((task) => !wave.includes(task));
  }
  return waves;
}

/** Ids of tasks whose dependencies are missing or loop back on each other. */
export function brokenDependencies(plan: Plan): string[] {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const resolved = new Set<string>();
  let left = plan.tasks.slice();
  for (;;) {
    const ready = left.filter((task) => task.dependsOn.every((id) => resolved.has(id) || !ids.has(id)));
    if (!ready.length) {
      break;
    }
    for (const task of ready) {
      resolved.add(task.id);
    }
    left = left.filter((task) => !ready.includes(task));
  }
  return plan.tasks
    .filter((task) => !resolved.has(task.id) || task.dependsOn.some((id) => !ids.has(id)))
    .map((task) => task.id);
}
