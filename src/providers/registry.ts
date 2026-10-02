import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { McpServerDef, ModelDef, ProviderDef } from '../types';
import { BUILTIN_PROVIDERS } from './builtins';

/** Reads the built-in providers plus the user's `polyagent.providers` overrides, disabled ones included. */
export function loadProviders(): ProviderDef[] {
  const configured = vscode.workspace
    .getConfiguration('polyagent')
    .get<Partial<ProviderDef>[]>('providers', []);

  const byId = new Map<string, ProviderDef>();
  for (const def of BUILTIN_PROVIDERS) {
    byId.set(def.id, { ...def });
  }

  for (const raw of configured) {
    if (!raw?.id) {
      continue;
    }
    const existing = byId.get(raw.id);
    const merged = { ...(existing ?? {}), ...raw } as ProviderDef;
    if (!merged.label) {
      merged.label = merged.id;
    }
    if (!merged.kind) {
      merged.kind = merged.command ? 'cli' : 'http';
    }
    byId.set(merged.id, merged);
  }

  return [...byId.values()].map(resolveModels);
}

/** Providers and models the user has not switched off. */
export function enabledProviders(): ProviderDef[] {
  return loadProviders()
    .filter((def) => def.enabled !== false)
    .map((def) => {
      const disabled = new Set(def.disabledModels ?? []);
      return { ...def, models: (def.models ?? []).filter((m) => !disabled.has(m.id)) };
    });
}

/**
 * Checks if a provider ID is defined in the built-in providers list.
 * @param id - The provider ID to check
 * @returns True if the provider is built-in, false otherwise
 */
export function isBuiltin(id: string): boolean {
  return BUILTIN_PROVIDERS.some((def) => def.id === id);
}

/**
 * Resolves and deduplicates models for a provider, merging configured, fetched, and extra models.
 * @param def - The provider definition to resolve models for
 * @returns Provider definition with resolved models
 */
function resolveModels(def: ProviderDef): ProviderDef {
  let models = def.models ?? [];
  if (def.modelsFrom === 'codex-cache') {
    const configured = new Map(models.map((m) => [m.id, m]));
    models =
      readCodexModels()?.map((m) => ({ ...m, tier: m.tier ?? configured.get(m.id)?.tier })) ?? models;
  }
  const seen = new Set<string>();
  const all: ModelDef[] = [];
  for (const model of [...models, ...(def.fetchedModels ?? []), ...(def.extraModels ?? [])]) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    all.push({ ...model, efforts: model.efforts ?? def.efforts ?? [] });
  }
  return { ...def, models: all };
}

/**
 * Returns the codex CLI home directory path.
 * @returns Path to codex home directory
 */
export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/** Model list the codex CLI caches from its own backend, including each model's effort levels. */
function readCodexModels(): ModelDef[] | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8'));
    const models = (raw?.models ?? [])
      .filter((m: any) => m?.slug && m.visibility !== 'hide')
      .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
      .map(
        (m: any): ModelDef => ({
          id: m.slug,
          label: m.display_name ?? m.slug,
          description: m.description,
          efforts: (m.supported_reasoning_levels ?? []).map((level: any) => level.effort).filter(Boolean),
          defaultEffort: m.default_reasoning_level,
          inputs: Array.isArray(m.input_modalities)
            ? m.input_modalities.filter((x: string) => x === 'image' || x === 'pdf')
            : undefined,
          contextWindow: m.context_window
        })
      );
    return models.length ? models : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds a provider by its ID from all loaded providers.
 * @param id - The provider ID to find
 * @returns Provider definition if found, undefined otherwise
 */
export function findProvider(id: string): ProviderDef | undefined {
  return loadProviders().find((p) => p.id === id);
}

/**
 * Merges `patch` into the user's global override entry for provider `id`.
 * @param id - The provider ID to update
 * @param patch - The partial provider definition to merge
 */
export async function updateProviderOverride(id: string, patch: Partial<ProviderDef>): Promise<void> {
  const config = vscode.workspace.getConfiguration('polyagent');
  const list = [...(config.inspect<Partial<ProviderDef>[]>('providers')?.globalValue ?? [])];
  const index = list.findIndex((entry) => entry?.id === id);
  const next = { ...(index >= 0 ? list[index] : { id }), ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) {
      delete (next as Record<string, unknown>)[key];
    }
  }
  if (index >= 0) {
    list[index] = next;
  } else {
    list.push(next);
  }
  await config.update('providers', list, vscode.ConfigurationTarget.Global);
}

/**
 * Removes a provider override from the user's global configuration.
 * @param id - The provider ID to remove
 */
export async function removeProviderOverride(id: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('polyagent');
  const list = (config.inspect<Partial<ProviderDef>[]>('providers')?.globalValue ?? []).filter(
    (entry) => entry?.id !== id
  );
  await config.update('providers', list, vscode.ConfigurationTarget.Global);
}

/**
 * Loads MCP server configurations from the polyagent.mcpServers setting.
 * @returns Record of MCP server names to their definitions
 */
export function loadMcpServers(): Record<string, McpServerDef> {
  return vscode.workspace.getConfiguration('polyagent').get<Record<string, McpServerDef>>('mcpServers', {});
}

/** Shared MCP servers that are switched on. */
export function activeMcpServers(): Record<string, McpServerDef> {
  return Object.fromEntries(Object.entries(loadMcpServers()).filter(([, server]) => !server.disabled));
}

/**
 * Gets the secret storage key for a provider's request API key.
 * @param providerId - The provider identifier
 * @returns The secret key name
 */
export function apiKeySecret(providerId: string): string {
  return `polyagent.apiKey.${providerId}`;
}

/**
 * Gets the secret storage key for a provider's usage/admin key.
 * @param providerId - The provider identifier
 * @returns The secret key name
 */
export function adminKeySecret(providerId: string): string {
  return `polyagent.adminKey.${providerId}`;
}
