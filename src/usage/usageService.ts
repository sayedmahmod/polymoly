import * as vscode from 'vscode';
import { ProviderDef, UsageBucket, UsageReport, UsageSourceDef } from '../types';
import { adminKeySecret, apiKeySecret, loadProviders } from '../providers/registry';
import { readRateLimits } from '../chat/controller';
import { fetchMiniMaxRemains, fetchZaiQuota, MINIMAX_UNLIMITED, miniMaxUsedPercent, zaiQuotaBase, zaiUsedPercent, zaiWindowKind } from './limits';
import { t } from '../i18n';

function emptyBucket(date = ''): UsageBucket {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    requests: 0,
    costUsd: 0
  };
}

function addInto(target: UsageBucket, source: UsageBucket): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.requests += source.requests;
  target.costUsd += source.costUsd;
}

function baseReport(def: ProviderDef, source: UsageSourceDef, from: Date, to: Date): UsageReport {
  return {
    providerId: def.id,
    providerLabel: def.label,
    sourceKind: source.kind,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: emptyBucket(),
    byModel: [],
    buckets: [],
    fetchedAt: new Date().toISOString()
  };
}

/** Fetches usage for every configured provider from that provider's own API. */
export class UsageService {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  async fetchAll(): Promise<UsageReport[]> {
    const days = vscode.workspace.getConfiguration('polyagent').get<number>('usage.days', 30);
    const to = new Date();
    const from = new Date(to.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    return Promise.all(loadProviders().map((def) => this.fetchOne(def, from, to)));
  }

  private async fetchOne(def: ProviderDef, from: Date, to: Date): Promise<UsageReport> {
    // A custom provider pointed at Z.ai gets the Coding Plan quota without extra setup.
    const source: UsageSourceDef =
      (!def.usage || def.usage.kind === 'none') && zaiQuotaBase(def) ? { kind: 'zai-coding-plan' } : def.usage ?? { kind: 'none' };
    const report = baseReport(def, source, from, to);
    report.rateLimit = readRateLimits(this.globalState)[def.id];

    if (source.kind === 'none') {
      report.hint = t('usage.noUsageApi');
      return report;
    }

    let key = await this.secrets.get(adminKeySecret(def.id));
    if (!key && (source.kind === 'minimax-token-plan' || source.kind === 'zai-coding-plan')) {
      // A Token Plan key (sk-cp-…) serves both chat and quota, so the request key is enough.
      key = await this.secrets.get(apiKeySecret(def.id));
    }
    if (!key && source.kind !== 'custom-http') {
      report.hint = t('usage.noAdminKey');
      return report;
    }

    try {
      if (source.kind === 'anthropic-admin') {
        await fetchAnthropicUsage(report, source, key!, from, to);
      } else if (source.kind === 'openai-admin') {
        await fetchOpenAiUsage(report, source, key!, from, to);
      } else if (source.kind === 'minimax-token-plan') {
        await fetchMiniMaxTokenPlan(report, source, key!);
      } else if (source.kind === 'zai-coding-plan') {
        await fetchZaiCodingPlan(report, zaiQuotaBase({ ...def, usage: source })!, key!);
      } else {
        await fetchCustomUsage(report, source, key, from, to);
      }
    } catch (err) {
      report.error = err instanceof Error ? err.message : String(err);
    }

    report.buckets.sort((a, b) => a.date.localeCompare(b.date));
    report.byModel.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
    return report;
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  return response.json();
}

/**
 * Anthropic Admin API: usage_report/messages and cost_report.
 * Covers API traffic of the organisation; Claude-subscription usage is not reported there.
 */
async function fetchAnthropicUsage(
  report: UsageReport,
  source: Extract<UsageSourceDef, { kind: 'anthropic-admin' }>,
  key: string,
  from: Date,
  to: Date
): Promise<void> {
  const base = (source.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;

  const byModel = new Map<string, { input: number; output: number; cost: number; requests: number }>();

  const usageUrl =
    `${base}/v1/organizations/usage_report/messages` +
    `?starting_at=${encodeURIComponent(from.toISOString())}` +
    `&ending_at=${encodeURIComponent(to.toISOString())}` +
    `&bucket_width=1d&limit=${Math.min(days, 31)}&group_by[]=model`;

  let page: any = await getJson(usageUrl, headers);
  while (page) {
    for (const bucket of page.data ?? []) {
      const day = emptyBucket(String(bucket.starting_at ?? '').slice(0, 10));
      for (const result of bucket.results ?? []) {
        const cacheWrite = Object.values(result.cache_creation ?? {}).reduce(
          (sum: number, value) => sum + (typeof value === 'number' ? value : 0),
          0
        );
        day.inputTokens += result.uncached_input_tokens ?? 0;
        day.outputTokens += result.output_tokens ?? 0;
        day.cacheReadTokens += result.cache_read_input_tokens ?? 0;
        day.cacheWriteTokens += cacheWrite;

        const model = result.model ?? 'unbekannt';
        const entry = byModel.get(model) ?? { input: 0, output: 0, cost: 0, requests: 0 };
        entry.input += (result.uncached_input_tokens ?? 0) + (result.cache_read_input_tokens ?? 0) + cacheWrite;
        entry.output += result.output_tokens ?? 0;
        byModel.set(model, entry);
      }
      report.buckets.push(day);
      addInto(report.totals, day);
    }
    if (!page.has_more || !page.next_page) {
      break;
    }
    page = await getJson(`${usageUrl}&page=${encodeURIComponent(page.next_page)}`, headers);
  }

  const costUrl =
    `${base}/v1/organizations/cost_report` +
    `?starting_at=${encodeURIComponent(from.toISOString())}` +
    `&ending_at=${encodeURIComponent(to.toISOString())}&limit=${Math.min(days, 31)}`;

  const costs: any = await getJson(costUrl, headers);
  const costByDay = new Map<string, number>();
  for (const bucket of costs.data ?? []) {
    const day = String(bucket.starting_at ?? '').slice(0, 10);
    let amount = 0;
    for (const result of bucket.results ?? []) {
      amount += Number(result.amount ?? 0);
    }
    costByDay.set(day, (costByDay.get(day) ?? 0) + amount);
  }
  for (const bucket of report.buckets) {
    bucket.costUsd = costByDay.get(bucket.date) ?? 0;
  }
  report.totals.costUsd = [...costByDay.values()].reduce((sum, value) => sum + value, 0);

  report.byModel = [...byModel.entries()].map(([model, entry]) => ({
    model,
    inputTokens: entry.input,
    outputTokens: entry.output,
    costUsd: entry.cost,
    requests: entry.requests
  }));
  report.hint = t('usage.anthropicHint');
}

/** OpenAI Admin API: organization/usage/completions and organization/costs. */
async function fetchOpenAiUsage(
  report: UsageReport,
  source: Extract<UsageSourceDef, { kind: 'openai-admin' }>,
  key: string,
  from: Date,
  to: Date
): Promise<void> {
  const base = (source.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${key}` };
  const startUnix = Math.floor(from.getTime() / 1000);
  const endUnix = Math.floor(to.getTime() / 1000);
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;

  const byModel = new Map<string, { input: number; output: number; requests: number }>();

  let url =
    `${base}/v1/organization/usage/completions` +
    `?start_time=${startUnix}&end_time=${endUnix}&bucket_width=1d` +
    `&limit=${Math.min(days, 31)}&group_by[]=model`;

  while (url) {
    const page: any = await getJson(url, headers);
    for (const bucket of page.data ?? []) {
      const day = emptyBucket(new Date((bucket.start_time ?? 0) * 1000).toISOString().slice(0, 10));
      for (const result of bucket.results ?? []) {
        day.inputTokens += result.input_tokens ?? 0;
        day.outputTokens += result.output_tokens ?? 0;
        day.cacheReadTokens += result.input_cached_tokens ?? 0;
        day.requests += result.num_model_requests ?? 0;

        const model = result.model ?? 'unbekannt';
        const entry = byModel.get(model) ?? { input: 0, output: 0, requests: 0 };
        entry.input += result.input_tokens ?? 0;
        entry.output += result.output_tokens ?? 0;
        entry.requests += result.num_model_requests ?? 0;
        byModel.set(model, entry);
      }
      report.buckets.push(day);
      addInto(report.totals, day);
    }
    url = page.has_more && page.next_page ? `${url}&page=${encodeURIComponent(page.next_page)}` : '';
  }

  const costs: any = await getJson(
    `${base}/v1/organization/costs?start_time=${startUnix}&end_time=${endUnix}&limit=${Math.min(days, 31)}`,
    headers
  );
  const costByDay = new Map<string, number>();
  for (const bucket of costs.data ?? []) {
    const day = new Date((bucket.start_time ?? 0) * 1000).toISOString().slice(0, 10);
    let amount = 0;
    for (const result of bucket.results ?? []) {
      amount += Number(result.amount?.value ?? 0);
    }
    costByDay.set(day, (costByDay.get(day) ?? 0) + amount);
  }
  for (const bucket of report.buckets) {
    bucket.costUsd = costByDay.get(bucket.date) ?? 0;
  }
  report.totals.costUsd = [...costByDay.values()].reduce((sum, value) => sum + value, 0);

  report.byModel = [...byModel.entries()].map(([model, entry]) => ({
    model,
    inputTokens: entry.input,
    outputTokens: entry.output,
    costUsd: 0,
    requests: entry.requests
  }));
  report.hint = t('usage.openaiHint');
}

/**
 * MiniMax Token Plan: GET /v1/token_plan/remains, with the older coding_plan endpoint as fallback.
 * Returns remaining percent for the 5h window and the week, per model group (general, video, ...).
 * PAYG balance, credits and the plan name (Plus/Max/...) have no public endpoint; they stay in the console.
 */
async function fetchMiniMaxTokenPlan(
  report: UsageReport,
  source: Extract<UsageSourceDef, { kind: 'minimax-token-plan' }>,
  key: string
): Promise<void> {
  if (!key.startsWith('sk-cp-')) {
    report.hint =
      t('usage.minimaxNoKey');
    return;
  }

  const json: any = await fetchMiniMaxRemains(key, source.baseUrl);

  const status = Number(json?.base_resp?.status_code ?? -1);
  const message = String(json?.base_resp?.status_msg ?? '');
  if (status !== 0 || !Array.isArray(json?.model_remains)) {
    if (/token plan|coding plan|no active/i.test(message)) {
      report.plan = t('usage.minimaxNoPlan');
      report.hint = `MiniMax: ${message}`;
      return;
    }
    throw new Error(
      status === 1004 || /login fail|auth/i.test(message)
        ? t('usage.minimaxInvalid', { status, message })
        : `MiniMax antwortet mit ${status}: ${message || 'unbekannte Antwort'}`
    );
  }

  const windows: { name: string; utilization: number; resetsAt?: number }[] = [];
  const toUtilization = (percent: unknown, windowStatus: unknown) => miniMaxUsedPercent(percent, windowStatus) / 100;
  const toSeconds = (millis: unknown) => {
    const value = Number(millis);
    return Number.isFinite(value) && value > 0 ? Math.floor(value / 1000) : undefined;
  };

  for (const group of json.model_remains) {
    const name = String(group.model_name ?? 'model');
    if (group.current_interval_remaining_percent !== undefined && Number(group.current_interval_status) !== MINIMAX_UNLIMITED) {
      windows.push({
        name: `${name} · 5 h`,
        utilization: toUtilization(group.current_interval_remaining_percent, group.current_interval_status),
        resetsAt: toSeconds(group.end_time)
      });
    }
    if (group.current_weekly_remaining_percent !== undefined && Number(group.current_weekly_status) !== MINIMAX_UNLIMITED) {
      windows.push({
        name: `${name} · Woche`,
        utilization: toUtilization(group.current_weekly_remaining_percent, group.current_weekly_status),
        resetsAt: toSeconds(group.weekly_end_time)
      });
    }
  }

  report.plan = 'Token Plan';
  report.rateLimit = {
    status: windows.some((entry) => entry.utilization >= 1) ? 'exhausted' : 'ok',
    windows,
    observedAt: new Date().toISOString()
  };
  report.hint =
    t('usage.minimaxHint');
}

/** Z.ai GLM Coding Plan: 5-hour and weekly token windows plus the monthly MCP tool calls. */
async function fetchZaiCodingPlan(report: UsageReport, base: string, key: string): Promise<void> {
  const data = await fetchZaiQuota(key, base);
  const windows: { name: string; utilization: number; resetsAt?: number }[] = [];
  for (const entry of data.limits) {
    const kind = zaiWindowKind(entry);
    const name = kind === 'session' ? '5 h' : kind === 'weekly' ? t('usage.week') : entry?.type === 'TIME_LIMIT' ? 'MCP' : undefined;
    if (!name) {
      continue;
    }
    const resetsAt = Number(entry.nextResetTime);
    windows.push({
      name,
      utilization: zaiUsedPercent(entry) / 100,
      resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? Math.floor(resetsAt / 1000) : undefined
    });
  }
  report.plan = data.level ? `GLM Coding ${String(data.level).replace(/^./, (c) => c.toUpperCase())}` : 'GLM Coding Plan';
  report.rateLimit = {
    status: windows.some((entry) => entry.utilization >= 1) ? 'exhausted' : 'ok',
    windows,
    observedAt: new Date().toISOString()
  };
}

/** Any other provider: one configurable request plus dotted paths into the response. */
async function fetchCustomUsage(
  report: UsageReport,
  source: Extract<UsageSourceDef, { kind: 'custom-http' }>,
  key: string | undefined,
  from: Date,
  to: Date
): Promise<void> {
  const substitute = (text: string) =>
    text
      .replace(/\{\{start\}\}/g, from.toISOString())
      .replace(/\{\{end\}\}/g, to.toISOString())
      .replace(/\{\{startUnix\}\}/g, String(Math.floor(from.getTime() / 1000)))
      .replace(/\{\{endUnix\}\}/g, String(Math.floor(to.getTime() / 1000)))
      .replace(/\{\{key\}\}/g, key ?? '');

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(source.headers ?? {})) {
    headers[name] = substitute(value);
  }
  if (key && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) {
    headers.authorization = `Bearer ${key}`;
  }

  const method = source.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method === 'POST' && source.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    init.body = substitute(JSON.stringify(source.body));
  }

  const response = await fetch(substitute(source.url), init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 400)}` : ''}`);
  }
  const json = await response.json();
  const map = source.map ?? {};

  const total = emptyBucket(new Date().toISOString().slice(0, 10));
  total.inputTokens = readNumber(json, map.inputTokens);
  total.outputTokens = readNumber(json, map.outputTokens);
  total.cacheReadTokens = readNumber(json, map.cacheReadTokens);
  total.cacheWriteTokens = readNumber(json, map.cacheWriteTokens);
  total.requests = readNumber(json, map.requests);
  total.costUsd = readNumber(json, map.costUsd);
  report.totals = total;
  report.buckets = [total];

  if (map.balanceUsd) {
    report.balanceUsd = readNumber(json, map.balanceUsd);
  }
  if (map.plan) {
    report.plan = String(readPath(json, map.plan) ?? '');
  }
  if (map.account) {
    report.account = String(readPath(json, map.account) ?? '');
  }
}

function readPath(value: any, path?: string): unknown {
  if (!path) {
    return undefined;
  }
  return path.split('.').reduce<any>((current, part) => {
    if (current == null) {
      return undefined;
    }
    const index = Number(part);
    return Number.isInteger(index) && Array.isArray(current) ? current[index] : current[part];
  }, value);
}

function readNumber(value: any, path?: string): number {
  const found = readPath(value, path);
  const parsed = Number(found);
  return Number.isFinite(parsed) ? parsed : 0;
}
