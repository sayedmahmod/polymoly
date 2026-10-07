/**
 * One permission dial for every provider, and how each level translates into the flags of
 * the claude CLI, the codex CLI and the local tools of HTTP providers.
 */
import { ProviderDef } from '../types';

/**
 * Provider-independent permission levels, least to most permissive:
 * - `readonly`: read and search only
 * - `edit`: read and edit files, no shell commands
 * - `write`: edit files, shell commands after a confirmation (HTTP providers only)
 * - `auto`: everything without asking (codex keeps its workspace sandbox)
 * - `full`: everything, no sandbox (CLI providers only)
 */
export type PermissionLevel = 'readonly' | 'edit' | 'write' | 'auto' | 'full';

export const PERMISSION_LEVELS: PermissionLevel[] = ['readonly', 'edit', 'write', 'auto', 'full'];

/** `--permission-mode` values of the claude CLI, least to most permissive. */
export const CLAUDE_PERMISSION_MODES = ['plan', 'manual', 'dontAsk', 'acceptEdits', 'auto', 'bypassPermissions'];

/** `--sandbox` values of `codex exec`, least to most permissive. */
export const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'];

/** Local agent modes of an HTTP provider. */
export const HTTP_PERMISSION_MODES = ['readonly', 'edit', 'write', 'auto'];

/** Native CLI values and older stored values, expressed as a level. */
const TO_LEVEL: Record<string, PermissionLevel> = {
  plan: 'readonly',
  'read-only': 'readonly',
  manual: 'edit', // headless runs deny every prompt, so manual and dontAsk keep edits at most
  dontAsk: 'edit',
  acceptEdits: 'edit',
  'workspace-write': 'auto',
  bypassPermissions: 'full',
  'danger-full-access': 'full',
  default: 'edit' // retired claude mode
};

/** The level a stored value stands for, or undefined when it is unknown. */
export function toLevel(value: string | undefined): PermissionLevel | undefined {
  if (!value) {
    return undefined;
  }
  return (PERMISSION_LEVELS as string[]).includes(value) ? (value as PermissionLevel) : TO_LEVEL[value];
}

/** The levels a provider can honour; empty when it has no permission dial. */
export function levelsFor(def: ProviderDef | undefined): PermissionLevel[] {
  if (def?.kind === 'http') {
    return ['readonly', 'edit', 'write', 'auto'];
  }
  if (def?.protocol === 'claude-stream-json') {
    return ['readonly', 'edit', 'auto', 'full'];
  }
  if (def?.protocol === 'codex-jsonl') {
    // codex cannot keep edits apart from commands: workspace-write allows both inside a sandbox.
    return ['readonly', 'auto', 'full'];
  }
  return [];
}

/** The closest level `def` offers that is not more permissive than `level`. */
function fitLevel(level: PermissionLevel, def: ProviderDef | undefined): PermissionLevel | undefined {
  const offered = levelsFor(def);
  if (!offered.length) {
    return level;
  }
  const rank = PERMISSION_LEVELS.indexOf(level);
  const fitting = offered.filter((candidate) => PERMISSION_LEVELS.indexOf(candidate) <= rank);
  // `full` asked of an HTTP provider means "everything": its top level is the match.
  return level === 'full' ? offered[offered.length - 1] : fitting[fitting.length - 1] ?? offered[0];
}

const LEVEL_TO_CLAUDE: Record<PermissionLevel, string> = {
  readonly: 'plan',
  edit: 'acceptEdits',
  write: 'acceptEdits',
  auto: 'auto',
  full: 'bypassPermissions'
};

const LEVEL_TO_CODEX: Record<PermissionLevel, string> = {
  readonly: 'read-only',
  edit: 'workspace-write',
  write: 'workspace-write',
  auto: 'workspace-write',
  full: 'danger-full-access'
};

const LEVEL_TO_HTTP: Record<PermissionLevel, string> = {
  readonly: 'readonly',
  edit: 'edit',
  write: 'write',
  auto: 'auto',
  full: 'auto'
};

/** The `--permission-mode` value the claude CLI accepts for `value`, or the fallback. */
export function normalizeClaudePermission(value: string | undefined, fallback = 'acceptEdits'): string {
  if (value && CLAUDE_PERMISSION_MODES.includes(value)) {
    return value;
  }
  const level = toLevel(value);
  return level ? LEVEL_TO_CLAUDE[level] : fallback;
}

/** The `--sandbox` value the codex CLI accepts for `value`, or the fallback. */
export function normalizeCodexSandbox(value: string | undefined, fallback = 'workspace-write'): string {
  if (value && CODEX_SANDBOX_MODES.includes(value)) {
    return value;
  }
  const level = toLevel(value);
  return level ? LEVEL_TO_CODEX[level] : fallback;
}

/** The local agent mode an HTTP provider runs with for `value`, or the fallback. */
export function normalizeHttpPermission(value: string | undefined, fallback = 'write'): string {
  const level = toLevel(value);
  return level ? LEVEL_TO_HTTP[level] : fallback;
}

/**
 * A stored chat permission as a level `def` offers: native CLI values and older settings are
 * translated, a level the provider lacks steps down to the next safer one. Unknown values are
 * dropped, so the adapter falls back to the `polyagent.*` setting.
 */
export function translatePermission(value: string | undefined, def: ProviderDef | undefined): string | undefined {
  const level = toLevel(value);
  return level ? fitLevel(level, def) : undefined;
}
