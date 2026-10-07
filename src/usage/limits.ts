import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { readRateLimits } from '../chat/controller';
import { adminKeySecret, apiKeySecret, codexHome } from '../providers/registry';
import { LimitWindow, ProviderDef, ProviderLimits } from '../types';
import { t } from '../i18n';

const CACHE_MS = 90_000;
/** Retry interval after a failed fetch, e.g. when the usage endpoint answers 429. */
const RETRY_MS = 20_000;

interface RawEntry {
  checkedAt: number;
  /** Last successful answer; kept when a later refresh fails. */
  data?: any;
  dataAt?: number;
}

/**
 * Subscription usage windows per provider. Only providers whose CLI exposes them report
 * anything: Claude through the `rate_limit_event` its CLI prints during a chat, Codex through
 * its session logs, MiniMax and Z.ai through their plan quota endpoints. CLI credentials are never read.
 */
export class LimitsService {
  /** Raw answer per provider. */
  private readonly cache = new Map<string, RawEntry>();

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets: vscode.SecretStorage
  ) {}

  async get(def: ProviderDef, model: string | undefined, force = false): Promise<ProviderLimits | undefined> {
    if (def.usage?.kind === 'minimax-token-plan') {
      return this.miniMax(def, def.usage.baseUrl, force);
    }
    // Before the claude check: the claude CLI against Z.ai prints no rate-limit events.
    const zaiBase = zaiQuotaBase(def);
    if (zaiBase) {
      return this.zai(def, zaiBase, force);
    }
    const isClaude = def.kind === 'cli' && def.protocol === 'claude-stream-json';
    const isCodex = def.kind === 'cli' && def.protocol === 'codex-jsonl';
    if (!isClaude && !isCodex) {
      return undefined;
    }

    if (isClaude) {
      const windows = this.storedClaudeWindows(def.id);
      return windows?.length ? { providerId: def.id, windows, fetchedAt: Date.now() } : undefined;
    }
    const entry = await this.raw(def.id, codexWindows, force);
    const windows: LimitWindow[] | undefined = entry.data;
    return windows?.length ? { providerId: def.id, windows, fetchedAt: entry.dataAt ?? Date.now() } : undefined;
  }

  private async miniMax(def: ProviderDef, baseUrl: string | undefined, force: boolean): Promise<ProviderLimits | undefined> {
    const key = (await this.secrets.get(adminKeySecret(def.id))) ?? (await this.secrets.get(apiKeySecret(def.id)));
    if (!key?.startsWith('sk-cp-')) {
      return undefined;
    }
    const entry = await this.raw(def.id, () => fetchMiniMaxRemains(key, baseUrl), force);
    const windows = entry.data ? miniMaxWindows(entry.data) : [];
    return windows.length ? { providerId: def.id, windows, fetchedAt: entry.dataAt ?? Date.now() } : undefined;
  }

  private async zai(def: ProviderDef, base: string, force: boolean): Promise<ProviderLimits | undefined> {
    const key = (await this.secrets.get(apiKeySecret(def.id))) ?? (await this.secrets.get(adminKeySecret(def.id)));
    if (!key) {
      return undefined;
    }
    const entry = await this.raw(def.id, () => fetchZaiQuota(key, base), force);
    const windows = entry.data ? zaiWindows(entry.data) : [];
    return windows.length ? { providerId: def.id, windows, fetchedAt: entry.dataAt ?? Date.now() } : undefined;
  }

  private async raw(providerId: string, fetcher: () => Promise<any>, force: boolean): Promise<RawEntry> {
    const cached = this.cache.get(providerId);
    const ttl = cached?.data && cached.dataAt === cached.checkedAt ? CACHE_MS : RETRY_MS;
    if (!force && cached && Date.now() - cached.checkedAt < ttl) {
      return cached;
    }
    const now = Date.now();
    const data = await fetcher().catch(() => undefined);
    const entry: RawEntry = data
      ? { checkedAt: now, data, dataAt: now }
      : { checkedAt: now, data: cached?.data, dataAt: cached?.dataAt };
    this.cache.set(providerId, entry);
    return entry;
  }

  /** Last `rate_limit_event` the claude CLI printed during a chat. */
  private storedClaudeWindows(providerId: string): LimitWindow[] | undefined {
    const info = readRateLimits(this.globalState)[providerId];
    if (!info) {
      return undefined;
    }
    const windows: LimitWindow[] = [];
    for (const entry of info.windows) {
      const kind = entry.name === 'five_hour' ? 'session' : entry.name === 'seven_day' ? 'weekly' : undefined;
      if (kind) {
        windows.push({
          kind,
          usedPercent: entry.utilization * 100,
          resetsAt: entry.resetsAt ? entry.resetsAt * 1000 : undefined
        });
      }
    }
    return windows;
  }
}

/** MiniMax status of a quota window. */
export const MINIMAX_EXHAUSTED = 2;
export const MINIMAX_UNLIMITED = 3;

/**
 * MiniMax Token Plan quota: GET /v1/token_plan/remains, with the older coding_plan endpoint as fallback.
 * Needs a Token Plan key (sk-cp-...). Returns the raw answer; `base_resp.status_code` 0 means success.
 */
export async function fetchMiniMaxRemains(key: string, baseUrl?: string): Promise<any> {
  const base = (baseUrl ?? 'https://api.minimax.io').replace(/\/+$/, '').replace(/\/v1$/, '');
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const get = async (url: string) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 400)}` : ''}`);
    }
    return response.json();
  };

  const current: any = await get(`${base}/v1/token_plan/remains`).catch(() => undefined);
  if (Array.isArray(current?.model_remains)) {
    return current;
  }
  const legacy: any = await get(`${base}/v1/api/openplatform/coding_plan/remains`).catch(() => undefined);
  if (Array.isArray(legacy?.model_remains)) {
    return legacy;
  }
  if (current ?? legacy) {
    return current ?? legacy;
  }
  throw new Error(t('err.minimaxEndpoint'));
}

/** Used share of one MiniMax window, 0..100. */
export function miniMaxUsedPercent(remainingPercent: unknown, status: unknown): number {
  if (Number(status) === MINIMAX_EXHAUSTED) {
    return 100;
  }
  const remaining = Number(remainingPercent);
  return Number.isFinite(remaining) ? Math.min(100, Math.max(0, 100 - remaining)) : 0;
}

/** 5h and weekly windows of the text-model group ("general"), for the bar under the chat input. */
function miniMaxWindows(data: any): LimitWindow[] {
  if (Number(data?.base_resp?.status_code) !== 0 || !Array.isArray(data?.model_remains)) {
    return [];
  }
  const group =
    data.model_remains.find((entry: any) => entry.model_name === 'general') ??
    data.model_remains.find((entry: any) => entry.current_interval_remaining_percent !== undefined);
  if (!group) {
    return [];
  }
  const windows: LimitWindow[] = [];
  const add = (kind: LimitWindow['kind'], percent: unknown, status: unknown, end: unknown) => {
    if (percent === undefined || Number(status) === MINIMAX_UNLIMITED) {
      return;
    }
    const resetsAt = Number(end);
    windows.push({
      kind,
      usedPercent: miniMaxUsedPercent(percent, status),
      resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : undefined
    });
  };
  add('session', group.current_interval_remaining_percent, group.current_interval_status, group.end_time);
  add('weekly', group.current_weekly_remaining_percent, group.current_weekly_status, group.weekly_end_time);
  return windows;
}

/**
 * Quota host of a Z.ai / Zhipu GLM Coding Plan provider: the configured one, or the one its
 * base URL (HTTP) or ANTHROPIC_BASE_URL (claude CLI) points at. Undefined for other providers.
 */
export function zaiQuotaBase(def: ProviderDef): string | undefined {
  const usage = def.usage;
  if (usage && usage.kind !== 'none' && usage.kind !== 'zai-coding-plan') {
    return undefined;
  }
  if (usage?.kind === 'zai-coding-plan' && usage.baseUrl) {
    return usage.baseUrl.replace(/\/+$/, '');
  }
  let host = '';
  try {
    host = new URL(def.baseUrl ?? def.env?.ANTHROPIC_BASE_URL ?? '').hostname;
  } catch {
    /* no URL */
  }
  if (/(^|\.)bigmodel\.cn$/i.test(host)) {
    return 'https://open.bigmodel.cn';
  }
  if (/(^|\.)z\.ai$/i.test(host) || usage?.kind === 'zai-coding-plan') {
    return 'https://api.z.ai';
  }
  return undefined;
}

/**
 * Z.ai Coding Plan quota: GET /api/monitor/usage/quota/limit with the chat key. Returns the
 * `data` object: `limits` holds TOKENS_LIMIT entries (unit 3 = 5 h, unit 6 = week) and a
 * TIME_LIMIT entry for the monthly MCP tool calls.
 */
export async function fetchZaiQuota(key: string, base: string): Promise<any> {
  const url = `${base}/api/monitor/usage/quota/limit`;
  let json: any;
  // Documented with a bearer token; some accounts only take the bare key. A bad key comes back
  // as HTTP 200 with `code: 401` in the body.
  for (const authorization of [`Bearer ${key}`, key]) {
    const response = await fetch(url, { headers: { authorization, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok && response.status !== 401) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 400)}` : ''}`);
    }
    json = await response.json().catch(() => undefined);
    if (response.status !== 401 && Number(json?.code) !== 401) {
      break;
    }
  }
  if (json?.success === false || (json?.code !== undefined && Number(json.code) !== 0 && Number(json.code) !== 200)) {
    throw new Error(`Z.ai: ${json?.msg ?? json?.message ?? json?.code}`);
  }
  const data = json?.data ?? json;
  if (!Array.isArray(data?.limits)) {
    throw new Error(t('err.zaiQuota'));
  }
  return data;
}

/** Used share of one Z.ai limit entry, 0..100. */
export function zaiUsedPercent(entry: any): number {
  const percent = Number(entry?.percentage);
  if (Number.isFinite(percent)) {
    return Math.min(100, Math.max(0, percent));
  }
  const total = Number(entry?.usage);
  const used = Number(entry?.currentValue);
  return total > 0 && Number.isFinite(used) ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
}

/** Window kind of a Z.ai TOKENS_LIMIT entry: unit 3 is the 5-hour window, unit 6 the week. */
export function zaiWindowKind(entry: any): LimitWindow['kind'] | undefined {
  if (entry?.type !== 'TOKENS_LIMIT') {
    return undefined;
  }
  const unit = Number(entry.unit);
  return unit === 3 ? 'session' : unit === 6 ? 'weekly' : undefined;
}

function zaiWindows(data: any): LimitWindow[] {
  const windows: LimitWindow[] = [];
  for (const entry of data?.limits ?? []) {
    const kind = zaiWindowKind(entry);
    if (!kind) {
      continue;
    }
    const resetsAt = Number(entry.nextResetTime);
    windows.push({
      kind,
      usedPercent: zaiUsedPercent(entry),
      resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : undefined
    });
  }
  return windows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1));
}

/** Newest `rate_limits` block the codex CLI wrote into its session logs. */
async function codexWindows(): Promise<LimitWindow[] | undefined> {
  const files = await newestFiles(path.join(codexHome(), 'sessions'), 8);
  for (const file of files) {
    const limits = await lastCodexRateLimits(file);
    if (limits) {
      const windows: LimitWindow[] = [];
      for (const entry of [limits.primary, limits.secondary]) {
        if (!entry || typeof entry.used_percent !== 'number') {
          continue;
        }
        const resetsAt = entry.resets_at ? entry.resets_at * 1000 : undefined;
        const expired = resetsAt !== undefined && resetsAt < Date.now();
        windows.push({
          kind: (entry.window_minutes ?? 0) > 24 * 60 ? 'weekly' : 'session',
          usedPercent: expired ? 0 : entry.used_percent,
          resetsAt: expired ? undefined : resetsAt
        });
      }
      return windows;
    }
  }
  return undefined;
}

async function lastCodexRateLimits(file: string): Promise<any> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"rate_limits"')) {
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const limits = parsed?.payload?.rate_limits ?? parsed?.rate_limits ?? parsed?.msg?.rate_limits;
        if (limits?.primary || limits?.secondary) {
          return limits;
        }
      } catch {
        /* partial first line of the tail window */
      }
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/** Newest `*.jsonl` files below `root`, which codex lays out as YYYY/MM/DD. */
async function newestFiles(root: string, limit: number): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (found.length >= limit) {
      return;
    }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    const names = entries.map((e) => e.name).sort().reverse();
    for (const name of names) {
      const full = path.join(dir, name);
      const entry = entries.find((e) => e.name === name)!;
      if (entry.isDirectory() && depth < 3) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && name.endsWith('.jsonl')) {
        found.push(full);
      }
      if (found.length >= limit) {
        return;
      }
    }
  };
  await walk(root, 0);
  return found;
}
