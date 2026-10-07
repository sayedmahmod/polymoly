/**
 * The `spawn_agent` tool as every provider sees it: a local tool for API providers, an MCP tool
 * for the CLI agents. Kept free of the VS Code API so the bundled MCP server can use it too.
 */

export const SPAWN_AGENT_TOOL = 'spawn_agent';
export const LIST_AGENTS_TOOL = 'list_agents';

/** MCP server name the CLI agents see; claude exposes its tools as `mcp__polymoly__<tool>`. */
export const SUBAGENT_MCP_NAME = 'polymoly';

export const SPAWN_AGENT_DESCRIPTION =
  'Start a subagent on any configured provider and model (Claude, Codex, GLM, …) with its own reasoning effort, ' +
  'and get its final report back. Use it to delegate a self-contained task, to get a second opinion from another ' +
  'model, or to run independent tasks in parallel (call it several times in one turn). The subagent starts from ' +
  'scratch: put every detail it needs into `prompt`. Its rights never exceed yours.';

export const SPAWN_AGENT_PARAMETERS = {
  type: 'object',
  properties: {
    provider: { type: 'string', description: 'Provider id from the subagent list, e.g. "claude", "codex" or "zai".' },
    model: { type: 'string', description: "Model id of that provider. Default: the provider's default model." },
    effort: {
      type: 'string',
      description: 'Reasoning effort, e.g. low, medium, high, xhigh or max. Default: the model default. Ignored by models without effort levels.'
    },
    prompt: {
      type: 'string',
      description: 'The complete, self-contained task. The subagent sees nothing of this conversation.'
    },
    permission: {
      type: 'string',
      enum: ['readonly', 'edit', 'write', 'auto', 'full'],
      description: 'Rights of the subagent: readonly, edit (files, no commands), write, auto or full. Capped at your own rights. Default: your rights.'
    }
  },
  required: ['provider', 'prompt']
} as const;

export const LIST_AGENTS_DESCRIPTION = 'List the providers, models and effort levels `spawn_agent` can start.';

export interface SpawnAgentInput {
  provider: string;
  model?: string;
  effort?: string;
  prompt: string;
  permission?: string;
}

/** Reads a tool input into a spawn request; undefined when provider or prompt is missing. */
export function parseSpawnInput(input: Record<string, unknown>): SpawnAgentInput | undefined {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const provider = text(input.provider);
  const prompt = text(input.prompt);
  if (!provider || !prompt) {
    return undefined;
  }
  return { provider, prompt, model: text(input.model), effort: text(input.effort), permission: text(input.permission) };
}
