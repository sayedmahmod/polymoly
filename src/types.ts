/** Shared types for providers, streaming events and usage reporting. */

export type ProviderKind = 'cli' | 'http';

/** Reasoning effort as the provider names it, e.g. low, medium, high, xhigh, max, ultra. */
export type EffortLevel = string;

/** Wire protocol spoken by a CLI provider on stdout. */
export type CliProtocol = 'claude-stream-json' | 'codex-jsonl';

/** Wire protocol spoken by an HTTP provider. */
export type HttpApi = 'openai' | 'anthropic';

/** Capability class used to suggest an equivalent model on another provider. */
export type ModelTier = 'frontier' | 'flagship' | 'balanced' | 'fast';

export interface ModelDef {
  id: string;
  label?: string;
  /** One line under the model name in the model menu. */
  description?: string;
  /** Effort levels this model accepts, lowest first. Empty or missing: no effort control. */
  efforts?: EffortLevel[];
  defaultEffort?: EffortLevel;
  /** Non-text inputs the model accepts. Missing: the provider's usual default. */
  inputs?: ('image' | 'pdf')[];
  /** Capability class; guessed from the id when missing. */
  tier?: ModelTier;
  contextWindow?: number;
  /** USD per million tokens. */
  pricing?: {
    input?: number;
    output?: number;
    cacheWrite?: number;
    cacheRead?: number;
  };
}

export type UsageSourceDef =
  | { kind: 'none' }
  | { kind: 'anthropic-admin'; baseUrl?: string }
  | { kind: 'openai-admin'; baseUrl?: string }
  /** MiniMax Token Plan quota (sk-cp-… key): 5h and weekly windows per model group. */
  | { kind: 'minimax-token-plan'; baseUrl?: string }
  /** Z.ai / Zhipu GLM Coding Plan quota: 5h and weekly token windows. Found from the base URL when missing. */
  | { kind: 'zai-coding-plan'; baseUrl?: string }
  | {
      kind: 'custom-http';
      /** {{start}} / {{end}} (ISO) and {{startUnix}} / {{endUnix}} are substituted. */
      url: string;
      method?: 'GET' | 'POST';
      headers?: Record<string, string>;
      body?: unknown;
      /** Dotted paths into the JSON response, e.g. "data.total.input_tokens". */
      map?: {
        inputTokens?: string;
        outputTokens?: string;
        cacheReadTokens?: string;
        cacheWriteTokens?: string;
        requests?: string;
        costUsd?: string;
        balanceUsd?: string;
        plan?: string;
        account?: string;
      };
    };

export interface ProviderDef {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Optional short text under the provider name in pickers. */
  description?: string;
  models?: ModelDef[];
  /** Appended to `models`; lets a settings override add models without replacing the list. */
  extraModels?: ModelDef[];
  /** Models last fetched from the provider's /models endpoint. */
  fetchedModels?: ModelDef[];
  /** Model ids hidden from the model menu. */
  disabledModels?: string[];
  /** Read the model list from the local codex CLI cache when it exists. */
  modelsFrom?: 'codex-cache';
  /** Effort levels for models that do not list their own. */
  efforts?: EffortLevel[];
  defaultModel?: string;
  /** false hides the provider everywhere. */
  enabled?: boolean;
  usage?: UsageSourceDef;

  // --- kind: 'cli' ---
  command?: string;
  /** Arguments placed before the generated ones, e.g. the script an Electron binary runs. */
  commandArgs?: string[];
  protocol?: CliProtocol;
  /** Extra arguments appended to the generated argument list. */
  extraArgs?: string[];
  env?: Record<string, string>;
  /**
   * Env var that receives the provider's stored API key, e.g. ANTHROPIC_AUTH_TOKEN to point
   * the claude CLI at an Anthropic-compatible endpoint. Set: a stored key is required.
   */
  apiKeyEnv?: string;

  // --- kind: 'http' ---
  baseUrl?: string;
  api?: HttpApi;
  headers?: Record<string, string>;
  /** Max tokens for a single response (Anthropic requires it). */
  maxTokens?: number;
  systemPrompt?: string;

  supportsThinking?: boolean;
}

/** MCP server shared by every provider that can load MCP servers. */
export type McpServerDef =
  | {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      disabled?: boolean;
      /** How long codex waits for one tool call; its default is 60 s. */
      toolTimeoutSec?: number;
    }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string>; disabled?: boolean };

/** One subscription window, normalised across providers. */
export interface LimitWindow {
  kind: 'session' | 'weekly';
  /** Extra qualifier, e.g. "Opus" for a model-specific weekly window. */
  scope?: string;
  usedPercent: number;
  /** Epoch milliseconds. */
  resetsAt?: number;
}

export interface ProviderLimits {
  providerId: string;
  windows: LimitWindow[];
  fetchedAt: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;
}

/** Subscription rate-limit windows, as reported by the claude CLI. */
export interface RateLimitInfo {
  status?: string;
  windows: { name: string; utilization: number; resetsAt?: number }[];
  isUsingOverage?: boolean;
  observedAt: string;
}

export type AgentEvent =
  | { type: 'session'; sessionId: string; model?: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; input?: unknown }
  | { type: 'tool_end'; id: string; name?: string; output?: string; isError?: boolean }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'rate_limit'; info: RateLimitInfo }
  | { type: 'notice'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'other';

/** A file the user attached to a message. */
export interface Attachment {
  id: string;
  /** Absolute path on disk. Files dropped from outside VS Code are copied to extension storage first. */
  path: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
}

/** Local tool execution for HTTP providers, which have no agent runtime of their own. */
export interface LocalToolsRequest {
  /** readonly: reading tools only; edit: no shell; write: shell commands confirmed; auto: everything. */
  mode: 'readonly' | 'edit' | 'write' | 'auto';
  /** Asked before a confirmed tool call runs; false denies it. */
  confirm: (toolName: string, input: unknown) => Promise<boolean>;
}

export interface SendRequest {
  prompt: string;
  model?: string;
  cwd: string;
  /** Prior turns, used by HTTP adapters; CLI adapters resume by session id instead. */
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Provider session id from a previous turn, for CLI resume. */
  sessionId?: string;
  /** Reasoning effort, forwarded only to providers that support it. */
  effort?: EffortLevel;
  /** Extended thinking, forwarded only to providers that support it. */
  thinking?: boolean;
  /**
   * Per-chat override of the CLI's permission mode: Claude's `--permission-mode`
   * (`plan` | `manual` | `dontAsk` | `acceptEdits` | `auto` | `bypassPermissions`) or Codex's
   * `--sandbox` (`read-only` | `workspace-write` | `danger-full-access`). The adapters translate
   * a value of the other protocol. Missing: the provider's own setting.
   */
  permission?: string;
  /** Files for this prompt that the model can take. */
  attachments?: Attachment[];
  /** Shared MCP servers, loaded by CLI providers that support MCP. */
  mcpServers?: Record<string, McpServerDef>;
  /** Extra system instructions, e.g. the list of installed skills. */
  instructions?: string;
  /** Skill store folder the agent may read from. */
  skillsDir?: string;
  /** Local file/shell tools for HTTP providers; CLI agents bring their own. */
  localTools?: LocalToolsRequest;
  /** Starts a subagent from an HTTP provider's `spawn_agent` tool; CLI agents get it over MCP. */
  spawnAgent?: (input: Record<string, unknown>, signal: AbortSignal) => Promise<{ output: string; isError: boolean }>;
  signal: AbortSignal;
}

export interface AgentAdapter {
  readonly def: ProviderDef;
  send(req: SendRequest, emit: (event: AgentEvent) => void): Promise<void>;
  /** Checks that the provider can run at all (binary present, key stored). */
  check(): Promise<{ ok: boolean; detail: string }>;
}

export interface UsageBucket {
  /** ISO date, start of the bucket (one day). */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  costUsd: number;
}

export interface UsageReport {
  providerId: string;
  providerLabel: string;
  sourceKind: string;
  /** Present when the provider could not be queried. */
  error?: string;
  /** Free-form hint shown in the card, e.g. missing admin key. */
  hint?: string;
  account?: string;
  plan?: string;
  balanceUsd?: number;
  /** Subscription windows captured from the provider CLI during chats. */
  rateLimit?: RateLimitInfo;
  from: string;
  to: string;
  totals: UsageBucket;
  byModel: { model: string; inputTokens: number; outputTokens: number; costUsd: number; requests: number }[];
  buckets: UsageBucket[];
  fetchedAt: string;
}
