import * as vscode from 'vscode';

const ALIASES_KEY = 'polyagent.resolvedAliases';

/** Provider id to alias ("opus") to the concrete model the CLI last ran for it. */
type AliasMap = Record<string, Record<string, { id: string; label: string }>>;

let memento: vscode.Memento | undefined;

/**
 * The claude CLI resolves aliases like `opus` to the newest model on its side, so a label
 * shipped with the extension goes stale. Each run's init event reports the concrete model;
 * remembering it keeps the model menu in step with whatever the CLI actually uses.
 */
export function initModelAliases(state: vscode.Memento): void {
  memento = state;
}

export function resolvedAlias(providerId: string, alias: string): { id: string; label: string } | undefined {
  return memento?.get<AliasMap>(ALIASES_KEY, {})[providerId]?.[alias];
}

/** Records what `alias` resolved to. Returns true when the stored label changed. */
export async function rememberResolvedModel(providerId: string, alias: string, resolvedId: string): Promise<boolean> {
  const label = labelFromModelId(resolvedId);
  if (!memento || !label || alias === resolvedId) {
    return false;
  }
  const all = memento.get<AliasMap>(ALIASES_KEY, {});
  const current = all[providerId]?.[alias];
  if (current?.id === resolvedId && current.label === label) {
    return false;
  }
  await memento.update(ALIASES_KEY, { ...all, [providerId]: { ...all[providerId], [alias]: { id: resolvedId, label } } });
  return true;
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5"; undefined for other ids. */
export function labelFromModelId(id: string): string | undefined {
  const match = /^claude-([a-z]+)-(\d+(?:-\d{1,2})*)(?:-\d{8})?(?:\[.*\])?$/.exec(id);
  if (!match) {
    return undefined;
  }
  const family = match[1][0].toUpperCase() + match[1].slice(1);
  return `${family} ${match[2].replace(/-/g, '.')}`;
}
