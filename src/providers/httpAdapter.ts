import { inlineText, readBase64 } from '../chat/attachments';
import { executeTool, MAX_TOOL_ROUNDS, ToolContext, ToolDef, toolsForMode } from '../chat/localTools';
import { AgentAdapter, AgentEvent, LocalToolsRequest, ModelDef, ProviderDef, SendRequest, TokenUsage } from '../types';
import { t } from '../i18n';

export type KeyLookup = (providerId: string) => Promise<string | undefined>;

/** Final-round instruction that makes a tool-happy model close the turn. */
const TOOL_BUDGET_NOTE =
  'Your tool budget for this turn is used up. Give your final answer now from what you have — do not attempt further tool calls.';

/** Talks to an OpenAI-compatible or Anthropic-compatible HTTP endpoint. */
export class HttpAdapter implements AgentAdapter {
  constructor(readonly def: ProviderDef, private readonly getKey: KeyLookup) {}

  async check(): Promise<{ ok: boolean; detail: string }> {
    if (!this.def.baseUrl) {
      return { ok: false, detail: t('err.noBaseUrl') };
    }
    const key = await this.getKey(this.def.id);
    if (!key) {
      return { ok: false, detail: t('err.noApiKeyHint') };
    }
    return { ok: true, detail: this.def.baseUrl };
  }

  async send(req: SendRequest, emit: (event: AgentEvent) => void): Promise<void> {
    try {
      const key = await this.getKey(this.def.id);
      if (!key) {
        emit({ type: 'error', message: t('err.noApiKeyHint') });
        return;
      }
      if (this.def.api === 'anthropic') {
        await this.sendAnthropic(req, key, emit);
      } else {
        await this.sendOpenAi(req, key, emit);
      }
    } catch (err) {
      if (!req.signal.aborted) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      emit({ type: 'done' });
    }
  }

  /** Models the endpoint reports via GET /models (OpenAI and Anthropic shape). */
  async listModels(): Promise<ModelDef[]> {
    if (!this.def.baseUrl) {
      throw new Error(t('err.noBaseUrl'));
    }
    const key = await this.getKey(this.def.id);
    if (!key) {
      throw new Error(t('err.noApiKey'));
    }
    const headers: Record<string, string> =
      this.def.api === 'anthropic'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(this.def.headers ?? {}) }
        : { authorization: `Bearer ${key}`, ...(this.def.headers ?? {}) };

    const models: ModelDef[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${trimSlash(this.def.baseUrl)}/models`);
      if (this.def.api === 'anthropic') {
        url.searchParams.set('limit', '1000');
        if (afterId) {
          url.searchParams.set('after_id', afterId);
        }
      }
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new Error(await errorText(response));
      }
      const body: any = await response.json();
      const list: any[] = Array.isArray(body) ? body : body?.data ?? body?.models ?? [];
      for (const entry of list) {
        const id = typeof entry === 'string' ? entry : entry?.id ?? entry?.name;
        if (id) {
          models.push({ id: String(id), label: entry?.display_name ?? entry?.name ?? String(id) });
        }
      }
      if (this.def.api !== 'anthropic' || !body?.has_more || !body?.last_id) {
        break;
      }
      afterId = body.last_id;
    }
    return models;
  }

  private model(req: SendRequest): string {
    return req.model ?? this.def.defaultModel ?? this.def.models?.[0]?.id ?? '';
  }

  /** Tool context for the local executor; denied calls come back as readable tool results. */
  private toolContext(req: SendRequest): ToolContext & { tools: ToolDef[] } {
    const local: LocalToolsRequest | undefined = req.localTools;
    const mode = local?.mode ?? 'readonly';
    const tools = toolsForMode(mode);
    return {
      tools,
      cwd: req.cwd,
      mode,
      signal: req.signal,
      confirm: local
        ? async (tool, input) => (await local.confirm(tool.name, input)) !== false
        : undefined
    };
  }

  /**
   * One streamed request plus, with local tools, the follow-up rounds that feed tool results
   * back. The round budget always terminates: on the last allowed round the request goes out
   * without tools, so the model must close with a text answer.
   */
  private async sendOpenAi(req: SendRequest, key: string, emit: (event: AgentEvent) => void) {
    const url = `${trimSlash(this.def.baseUrl!)}/chat/completions`;
    const system = systemText(this.def, req);
    const ctx = this.toolContext(req);
    const messages: unknown[] = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...req.history,
      { role: 'user', content: openAiContent(req) }
    ];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (req.signal.aborted) {
        return;
      }
      const offerTools = ctx.tools.length > 0 && round < MAX_TOOL_ROUNDS - 1;
      if (round === MAX_TOOL_ROUNDS - 1 && ctx.tools.length > 0) {
        messages.push({ role: 'user', content: TOOL_BUDGET_NOTE });
      }
      const response = await fetch(url, {
        method: 'POST',
        signal: req.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...(this.def.headers ?? {})
        },
        body: JSON.stringify({
          model: this.model(req),
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(req.effort ? { reasoning_effort: req.effort } : {}),
          ...(this.def.maxTokens ? { max_tokens: this.def.maxTokens } : {}),
          ...(offerTools ? { tools: ctx.tools.map(openAiTool) } : {}),
          // Z.ai GLM streams tool calls only on request; without it they can go missing.
          ...(offerTools && streamsToolsOnRequest(this.def.baseUrl!) ? { tool_stream: true } : {})
        })
      });

      if (!response.ok || !response.body) {
        emit({ type: 'error', message: await errorText(response) });
        return;
      }

      let text = '';
      const fragments = new Map<number, { id: string; name: string; args: string }>();

      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') {
          break;
        }
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        // Some compatible servers send a whole message instead of deltas.
        const delta = chunk.choices?.[0]?.delta ?? chunk.choices?.[0]?.message;
        if (delta?.content) {
          emit({ type: 'text_delta', text: delta.content });
          text += delta.content;
        }
        if (delta?.reasoning_content) {
          emit({ type: 'thinking_delta', text: delta.reasoning_content });
        }
        for (const call of delta?.tool_calls ?? []) {
          // `index` is optional on some servers: a new id opens a slot, a bare fragment continues the last.
          const index =
            typeof call.index === 'number'
              ? call.index
              : call.id
                ? [...fragments.entries()].find(([, open]) => open.id === call.id)?.[0] ?? fragments.size
                : Math.max(0, fragments.size - 1);
          const slot = fragments.get(index) ?? { id: '', name: '', args: '' };
          slot.id = call.id || slot.id;
          slot.name = call.function?.name || slot.name;
          slot.args += call.function?.arguments ?? '';
          fragments.set(index, slot);
        }
        if (chunk.usage) {
          emit({ type: 'usage', usage: this.priceUsage(req, {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: 0
          }) });
        }
      }

      const calls = [...fragments.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call).filter((call) => call.name);
      if (!calls.length) {
        return; // plain answer, turn finished
      }

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((call, i) => ({
          id: call.id || `call_${round}_${i}`,
          type: 'function',
          function: { name: call.name, arguments: call.args || '{}' }
        }))
      });
      await runCalls(calls.map((call, i) => ({ id: call.id || `call_${round}_${i}`, name: call.name, args: call.args })), ctx, emit, (result) =>
        messages.push({ role: 'tool', tool_call_id: result.id, content: result.output })
      );
    }
  }

  private async sendAnthropic(req: SendRequest, key: string, emit: (event: AgentEvent) => void) {
    const url = `${trimSlash(this.def.baseUrl!)}/messages`;
    const system = systemText(this.def, req);
    const ctx = this.toolContext(req);
    const messages: unknown[] = [...req.history, { role: 'user', content: anthropicContent(req) }];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (req.signal.aborted) {
        return;
      }
      const offerTools = ctx.tools.length > 0 && round < MAX_TOOL_ROUNDS - 1;
      if (round === MAX_TOOL_ROUNDS - 1 && ctx.tools.length > 0) {
        messages.push({ role: 'user', content: TOOL_BUDGET_NOTE });
      }
      const response = await fetch(url, {
        method: 'POST',
        signal: req.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          ...(this.def.headers ?? {})
        },
        body: JSON.stringify({
          model: this.model(req),
          max_tokens: this.def.maxTokens ?? 8192,
          stream: true,
          ...(req.thinking && this.def.supportsThinking
            ? { thinking: { type: 'enabled', budget_tokens: Math.floor((this.def.maxTokens ?? 8192) / 2) } }
            : {}),
          ...(system ? { system } : {}),
          ...(offerTools ? { tools: ctx.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
          messages
        })
      });

      if (!response.ok || !response.body) {
        emit({ type: 'error', message: await errorText(response) });
        return;
      }

      // Content blocks keyed by stream index, so a replayed assistant turn keeps its order.
      const blocks = new Map<number, { type: string; text: string; id: string; name: string; signature: string }>();
      const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      let stopReason = '';

      for await (const data of sseData(response.body)) {
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === 'message_start') {
          const raw = event.message?.usage ?? {};
          usage.inputTokens = raw.input_tokens ?? 0;
          usage.cacheReadTokens = raw.cache_read_input_tokens ?? 0;
          usage.cacheWriteTokens = raw.cache_creation_input_tokens ?? 0;
        } else if (event.type === 'content_block_start') {
          const block = event.content_block ?? {};
          blocks.set(event.index, {
            type: block.type,
            // Compatible endpoints may send a tool's input whole here instead of as deltas.
            text: block.type === 'tool_use' && block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : '',
            id: block.id ?? '',
            name: block.name ?? '',
            signature: ''
          });
        } else if (event.type === 'content_block_delta') {
          const slot = blocks.get(event.index);
          const delta = event.delta ?? {};
          if (delta.type === 'text_delta') {
            emit({ type: 'text_delta', text: delta.text });
            if (slot) {
              slot.text += delta.text ?? '';
            }
          } else if (delta.type === 'thinking_delta') {
            emit({ type: 'thinking_delta', text: delta.thinking });
            if (slot) {
              slot.text += delta.thinking ?? '';
            }
          } else if (delta.type === 'input_json_delta' && slot) {
            slot.text += delta.partial_json ?? '';
          } else if (delta.type === 'signature_delta' && slot) {
            slot.signature += delta.signature ?? '';
          }
        } else if (event.type === 'message_delta') {
          usage.outputTokens = event.usage?.output_tokens ?? usage.outputTokens;
          stopReason = event.delta?.stop_reason ?? stopReason;
        } else if (event.type === 'error') {
          emit({ type: 'error', message: event.error?.message ?? t('err.api') });
        }
      }

      emit({ type: 'usage', usage: this.priceUsage(req, usage) });

      const toolBlocks = [...blocks.values()].filter((block) => block.type === 'tool_use' && block.id);
      // Some compatible endpoints report end_turn even when the turn ends in tool calls.
      if (!toolBlocks.length || (stopReason && stopReason !== 'tool_use' && stopReason !== 'end_turn')) {
        return; // plain answer, turn finished
      }

      // Thinking blocks carry a signature that must be replayed verbatim or not at all.
      const replayed: unknown[] = [];
      for (const block of blocks.values()) {
        if (block.type === 'text' && block.text.trim()) {
          replayed.push({ type: 'text', text: block.text });
        } else if (block.type === 'thinking' && block.text && block.signature) {
          replayed.push({ type: 'thinking', thinking: block.text, signature: block.signature });
        } else if (block.type === 'tool_use' && block.id) {
          replayed.push({ type: 'tool_use', id: block.id, name: block.name, input: parseArgs(block.text) });
        }
      }
      messages.push({ role: 'assistant', content: replayed });
      const results = new Map<string, { output: string; isError: boolean }>();
      await runCalls(
        toolBlocks.map((block) => ({ id: block.id, name: block.name, args: block.text })),
        ctx,
        emit,
        (result) => results.set(result.id, { output: result.output, isError: result.isError })
      );
      messages.push({
        role: 'user',
        content: toolBlocks.map((block) => {
          const result = results.get(block.id);
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: result?.output ?? 'Tool call was not executed.',
            is_error: result?.isError ?? true
          };
        })
      });
    }
  }

  /** Adds a cost estimate when the model carries a pricing table. */
  private priceUsage(req: SendRequest, usage: TokenUsage): TokenUsage {
    const model: ModelDef | undefined = this.def.models?.find((m) => m.id === this.model(req));
    const pricing = model?.pricing;
    if (!pricing) {
      return usage;
    }
    const perMillion = (tokens: number, rate?: number) => (rate ? (tokens / 1_000_000) * rate : 0);
    usage.costUsd =
      perMillion(usage.inputTokens, pricing.input) +
      perMillion(usage.outputTokens, pricing.output) +
      perMillion(usage.cacheWriteTokens, pricing.cacheWrite) +
      perMillion(usage.cacheReadTokens, pricing.cacheRead);
    return usage;
  }
}

/** Runs each call through the local executor, streams its card, and hands `sink` the result. */
async function runCalls(
  calls: { id: string; name: string; args: string }[],
  ctx: ToolContext & { tools: ToolDef[] },
  emit: (event: AgentEvent) => void,
  sink: (result: { id: string; output: string; isError: boolean }) => void
): Promise<void> {
  for (const call of calls) {
    const input = parseArgs(call.args);
    emit({ type: 'tool_start', id: call.id, name: call.name, input });
    const tool = ctx.tools.find((candidate) => candidate.name === call.name);
    const result = tool
      ? await executeTool(tool, input, ctx)
      : { output: `Unknown tool "${call.name}". Available: ${ctx.tools.map((t) => t.name).join(', ')}.`, isError: true };
    emit({ type: 'tool_end', id: call.id, name: call.name, output: result.output, isError: result.isError });
    sink({ id: call.id, output: result.output, isError: result.isError });
  }
}

/** Tool arguments arrive as a streamed JSON string; broken ones must not kill the turn. */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : { value: parsed };
  } catch {
    return { _invalid_json: raw.slice(0, 400) };
  }
}

function openAiTool(tool: ToolDef) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

/** Prompt plus attachments; a plain string when there are no images, for text-only endpoints. */
function openAiContent(req: SendRequest): unknown {
  const files = req.attachments ?? [];
  const text = [...files.filter((f) => f.kind === 'text').map(inlineText), req.prompt].join('\n\n');
  const images = files.filter((f) => f.kind === 'image');
  if (!images.length) {
    return text;
  }
  return [
    ...images.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${readBase64(f)}` } })),
    { type: 'text', text }
  ];
}

function anthropicContent(req: SendRequest): unknown {
  const files = req.attachments ?? [];
  if (!files.length) {
    return req.prompt;
  }
  const blocks: unknown[] = [];
  for (const file of files) {
    if (file.kind === 'image') {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mime, data: readBase64(file) } });
    } else if (file.kind === 'pdf') {
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readBase64(file) } });
    } else if (file.kind === 'text') {
      blocks.push({ type: 'text', text: inlineText(file) });
    }
  }
  blocks.push({ type: 'text', text: req.prompt });
  return blocks;
}

/** The provider's own system prompt plus per-request instructions. */
function systemText(def: ProviderDef, req: SendRequest): string {
  return [def.systemPrompt, req.instructions].filter(Boolean).join('\n\n');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function errorText(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return `HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 600)}` : ''}`;
}

/** Yields the payload of each `data:` line of an SSE stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        yield trimmed.slice(5).trim();
      }
    }
  }
}

/** Endpoints that stream tool calls only when asked to (`tool_stream`), e.g. Z.ai GLM. */
function streamsToolsOnRequest(baseUrl: string): boolean {
  try {
    return /(^|\.)(z\.ai|bigmodel\.cn)$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}
