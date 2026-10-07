/**
 * The contract between the planning model and PolyMoly: the instructions that make it emit a
 * `polyplan` block, the parser that reads one back, and the markdown the plan is stored as.
 */
import { LANGUAGE_NAMES, resolveLanguage, t } from '../i18n';
import { Plan, PlanTask, TaskTier, planWaves } from './planTypes';
import * as vscode from 'vscode';

const FENCE = 'polyplan';

/** System instructions for a plan turn. The model reads the repo but changes nothing. */
export function planInstructions(): string {
  const language = LANGUAGE_NAMES[resolveLanguage()];
  const parallelLimit = Math.max(1, Math.min(8, vscode.workspace.getConfiguration('polyagent.plan').get<number>('maxParallelTasks', 4)));
  return `# Plan mode

You are planning, not building. Do not create, edit or delete any file, and do not run commands
that change state. Read the repository as much as you need first: the request must be planned
against what the code actually looks like, not against an assumption.

Then answer with a short prose plan followed by exactly one \`\`\`${FENCE} block containing JSON.

## How to cut the work up

- One task = one atomic, verifiable unit of work that one model finishes in one turn.
- Make tasks parallel by default. Two tasks may only be sequential when one truly needs the other's
  output (a file the other creates, an interface it defines, a migration it applies).
  Touching the same file is a real reason; "it feels tidier" is not.
- Express order only through \`dependsOn\`. Everything without a dependency starts immediately.
- The runner permits up to ${parallelLimit} tasks at once. Make independent work small enough to use
  that capacity, but never split one cohesive edit merely to create parallelism.
- Rate every task:
  - \`low\`: mechanical and fully specified (rename, move, add a string, wire an existing call).
  - \`mid\`: local logic inside one or two files, with a clear shape given.
  - \`hard\`: design decisions, cross-file architecture, tricky edge cases.
- A \`low\` task must be so tightly written that a small model cannot go wrong: exact file paths,
  exact names, exact expected shape, and what it must not touch. If you cannot write it that
  tightly, it is not \`low\`.
- Prefer \`low\` for isolated, mechanical checks, localized wiring and fully-specified follow-up
  edits. Do not promote a task to \`mid\` only because it happens beside another task.
- \`mid\` and \`hard\` tasks get the reasoning, the constraints and the surrounding context they need,
  because the model running them has not read this conversation.
- Every task carries its own context: the executing model sees the plan and its task, nothing else.

## JSON shape

\`\`\`${FENCE}
{
  "title": "short plan title",
  "summary": "one paragraph: what gets built and how the work is cut up",
  "sequencing": "one or two sentences: why the sequential parts cannot run in parallel",
  "tasks": [
    {
      "id": "T1",
      "title": "short imperative title",
      "tier": "low | mid | hard",
      "dependsOn": [],
      "goal": "what this task must achieve",
      "context": ["what the executing model needs to know up front"],
      "boundaries": ["what it must not touch, change or invent"],
      "files": ["path/that/will/change.ts"],
      "acceptance": ["a check that proves the task is done"]
    }
  ]
}
\`\`\`

Ids are \`T1\`, \`T2\`, … in the order you list them. Write every human-readable field in ${language}.
Keep the prose above the block short: the block is the plan, the prose is the reason.`;
}

/** Instructions for ask mode: read and answer, never change anything. */
export function askInstructions(): string {
  return `# Ask mode

Answer questions about this workspace. You may read files and search, but you must not create,
edit or delete anything and must not run commands with side effects. If the user asks for a change,
say what you would do and that ask mode does not apply it.`;
}

/** Pulls the `polyplan` block out of an answer. Returns the plan and the text without the block. */
export function extractPlan(text: string, meta: { providerId?: string; model?: string }): { plan?: Plan; text: string } {
  const match = text.match(new RegExp('```' + FENCE + '\\s*([\\s\\S]*?)```', 'i'));
  if (!match) {
    return { text };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[1].trim());
  } catch {
    return { text };
  }
  const notes = (text.slice(0, match.index) + text.slice((match.index ?? 0) + match[0].length)).trim();
  const plan = normalizePlan(raw, notes, meta);
  return plan ? { plan, text: notes } : { text };
}

function normalizePlan(raw: unknown, notes: string, meta: { providerId?: string; model?: string }): Plan | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const list = Array.isArray(source.tasks) ? source.tasks : [];
  const tasks: PlanTask[] = list
    .map((entry, index) => normalizeTask(entry, index))
    .filter((task): task is PlanTask => Boolean(task));
  if (!tasks.length) {
    return undefined;
  }
  const known = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    task.dependsOn = task.dependsOn.filter((id) => known.has(id) && id !== task.id);
  }
  const now = Date.now();
  return {
    id: `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    title: str(source.title) || tasks[0].title,
    summary: str(source.summary),
    sequencing: str(source.sequencing) || undefined,
    tasks,
    notes: notes || undefined,
    createdAt: now,
    authorProviderId: meta.providerId,
    authorModel: meta.model
  };
}

function normalizeTask(entry: unknown, index: number): PlanTask | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const source = entry as Record<string, unknown>;
  const title = str(source.title);
  const goal = str(source.goal);
  if (!title && !goal) {
    return undefined;
  }
  return {
    id: str(source.id) || `T${index + 1}`,
    title: title || goal.slice(0, 60),
    tier: tierOf(str(source.tier)),
    dependsOn: list(source.dependsOn),
    goal: goal || title,
    context: list(source.context),
    boundaries: list(source.boundaries),
    files: list(source.files),
    acceptance: list(source.acceptance)
  };
}

function tierOf(value: string): TaskTier {
  const name = value.toLowerCase();
  if (name.startsWith('hard') || name.startsWith('high')) {
    return 'hard';
  }
  if (name.startsWith('low') || name.startsWith('small')) {
    return 'low';
  }
  return 'mid';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => str(entry)).filter(Boolean);
  }
  const single = str(value);
  return single ? [single] : [];
}

/** The plan as it is written to disk: readable markdown plus the block it is parsed back from. */
export function planMarkdown(plan: Plan): string {
  const waves = planWaves(plan);
  const lines: string[] = [`# ${plan.title}`, ''];
  if (plan.summary) {
    lines.push(plan.summary, '');
  }

  lines.push(`## ${t('plan.flow')}`, '');
  waves.forEach((wave, index) => {
    const label = t('plan.wave', { number: index + 1 });
    const mode = wave.length > 1 ? t('plan.parallel') : t('plan.sequential');
    lines.push(`- **${label}** (${mode}): ${wave.map((task) => `${task.id} ${task.title}`).join(' · ')}`);
  });
  lines.push('');
  if (plan.sequencing) {
    lines.push(plan.sequencing, '');
  }

  lines.push(`## ${t('plan.tasks')}`, '');
  for (const task of plan.tasks) {
    lines.push(`### ${task.id} — ${task.title}  \`${task.tier}\``, '');
    lines.push(`**${t('plan.goal')}:** ${task.goal}`, '');
    lines.push(`**${t('plan.dependsOn')}:** ${task.dependsOn.length ? task.dependsOn.join(', ') : '—'}`, '');
    section(lines, t('plan.files'), task.files);
    section(lines, t('plan.context'), task.context);
    section(lines, t('plan.boundaries'), task.boundaries);
    section(lines, t('plan.acceptance'), task.acceptance);
  }

  if (plan.notes) {
    lines.push(`## ${t('plan.notes')}`, '', plan.notes, '');
  }

  lines.push('```' + FENCE, JSON.stringify(serializable(plan), null, 2), '```', '');
  return lines.join('\n');
}

function section(lines: string[], heading: string, items: string[]): void {
  if (!items.length) {
    return;
  }
  lines.push(`**${heading}:**`, '');
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push('');
}

function serializable(plan: Plan) {
  const { path: _path, ...rest } = plan;
  return rest;
}

/** Reads back a plan markdown file written by `planMarkdown`. */
export function parsePlanFile(text: string, path: string): Plan | undefined {
  const match = text.match(new RegExp('```' + FENCE + '\\s*([\\s\\S]*?)```', 'i'));
  if (!match) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[1].trim());
  } catch {
    return undefined;
  }
  const plan = normalizePlan(raw, '', {});
  if (!plan) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  return {
    ...plan,
    id: str(source.id) || plan.id,
    notes: str(source.notes) || undefined,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : plan.createdAt,
    authorProviderId: str(source.authorProviderId) || undefined,
    authorModel: str(source.authorModel) || undefined,
    path
  };
}

/** The prompt one task is executed with. The model sees the plan and its own task, nothing else. */
export function taskPrompt(plan: Plan, task: PlanTask, upstream: { id: string; title: string; output?: string }[]): string {
  const block = (heading: string, items: string[]) =>
    items.length ? `\n## ${heading}\n${items.map((item) => `- ${item}`).join('\n')}` : '';

  const done = upstream.length
    ? `\n## ${t('plan.upstreamDone')}\n${upstream
        .map((entry) => `- ${entry.id} ${entry.title}${entry.output ? `: ${entry.output.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`)
        .join('\n')}`
    : '';

  return `# ${plan.title} — ${task.id}: ${task.title}

${plan.summary}

You are executing one task of a plan. Other tasks are handled by other models, some of them at the
same time. Stay inside your task: do not fix, tidy or refactor anything it does not name, and do not
start work another task owns.

## ${t('plan.goal')}
${task.goal}
${block(t('plan.files'), task.files)}${block(t('plan.context'), task.context)}${block(t('plan.boundaries'), task.boundaries)}${block(t('plan.acceptance'), task.acceptance)}${done}

Work in the repository, make the change, and check it. Finish with a short summary of what you
changed, file by file, and say plainly if something is left open or if you had to deviate.`;
}
