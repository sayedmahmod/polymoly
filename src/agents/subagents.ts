/** Subagents: any provider can hand a task to any other provider, model and reasoning effort. */
import * as vscode from 'vscode';
import { effortFor, projectHeader } from '../chat/controller';
import { AgentPermission } from '../chat/localTools';
import { normalizeHttpPermission, PERMISSION_LEVELS, PermissionLevel, toLevel, translatePermission } from '../chat/permissions';
import { createAdapter } from '../providers';
import { activeMcpServers, enabledProviders } from '../providers/registry';
import { ProviderDef } from '../types';
import { LIST_AGENTS_TOOL, SPAWN_AGENT_TOOL, SpawnAgentInput, SUBAGENT_MCP_NAME } from './spawnSchema';

/** What a subagent inherits from the agent that starts it. */
export interface SubagentParent {
  /** Rights of the parent; a subagent never gets more. */
  level: PermissionLevel;
  cwd: string;
  /** Asked before a subagent's confirmed tool call (API providers in `write` mode). */
  confirm: (toolName: string, input: unknown) => Promise<boolean>;
}

export interface SubagentResult {
  output: string;
  isError: boolean;
}

const RESULT_CAP = 24_000;

const SUBAGENT_BRIEF =
  '# Subagent\n\nAnother AI agent delegated this task to you. Work on your own; nobody can answer questions. ' +
  'Finish with a concise report: what you found or changed (with file paths) and anything left open.';

/** The rights a CLI or HTTP provider runs with when the request carries `permission`. */
export function permissionLevelFor(def: ProviderDef, permission: string | undefined): PermissionLevel {
  const config = vscode.workspace.getConfiguration('polyagent');
  const fallback =
    def.kind === 'http'
      ? config.get<string>('http.permissionMode', 'write')
      : def.protocol === 'codex-jsonl'
        ? config.get<string>('codex.sandbox', 'workspace-write')
        : config.get<string>('claude.permissionMode', 'acceptEdits');
  return toLevel(permission) ?? toLevel(fallback) ?? 'readonly';
}

function lowerLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return PERMISSION_LEVELS.indexOf(a) <= PERMISSION_LEVELS.indexOf(b) ? a : b;
}

/** Providers, models and efforts a subagent can run on, one line per provider. */
export function subagentCatalog(): string {
  return enabledProviders()
    .map((def) => {
      const models = (def.models ?? [])
        .map((m) => `${m.id}${m.tier ? ` [${m.tier}]` : ''}${m.id === def.defaultModel ? ' (default)' : ''}`)
        .join(', ');
      const efforts = def.efforts?.length ? `; effort: ${def.efforts.join('|')}` : '';
      return `- ${def.id} — ${def.label}: ${models || def.defaultModel || 'default model'}${efforts}`;
    })
    .join('\n');
}

/** System instructions that tell the agent about `spawn_agent` under the name its runtime uses. */
export function subagentInstructions(def: ProviderDef): string {
  const tool =
    def.kind === 'http'
      ? `\`${SPAWN_AGENT_TOOL}\``
      : def.protocol === 'claude-stream-json'
        ? `\`mcp__${SUBAGENT_MCP_NAME}__${SPAWN_AGENT_TOOL}\``
        : `\`${SPAWN_AGENT_TOOL}\` of the MCP server \`${SUBAGENT_MCP_NAME}\``;
  return (
    `# Subagents\n\nYou can start subagents with the tool ${tool}: any provider, model and reasoning effort below, ` +
    `including models other than yourself. Use them to delegate a self-contained task, to get a second opinion, ` +
    `or to run independent work in parallel by calling the tool several times in one turn. A subagent sees nothing ` +
    `of this conversation, so give it the complete task. Prefer a strong model with high effort for hard work and a ` +
    `fast model for simple lookups. Subagents cannot start further subagents.` +
    (def.kind === 'http' ? '' : ` The tool \`${LIST_AGENTS_TOOL}\` lists the same choices.`) +
    `\n\n${subagentCatalog()}`
  );
}

/** Runs one subagent to the end and returns its final answer. */
export async function runSubagent(
  input: SpawnAgentInput,
  parent: SubagentParent,
  secrets: vscode.SecretStorage,
  signal: AbortSignal
): Promise<SubagentResult> {
  const def = enabledProviders().find((p) => p.id === input.provider);
  if (!def) {
    return {
      output: `Unknown or disabled provider "${input.provider}". Available:\n${subagentCatalog()}`,
      isError: true
    };
  }
  const model = input.model ?? def.defaultModel ?? def.models?.[0]?.id;
  const level = lowerLevel(toLevel(input.permission) ?? parent.level, parent.level);
  const permission = translatePermission(level, def) ?? level;
  const httpMode = def.kind === 'http' ? (normalizeHttpPermission(permission) as AgentPermission) : undefined;

  let text = '';
  const errors: string[] = [];
  try {
    await createAdapter(def, secrets).send(
      {
        prompt: input.prompt,
        model,
        cwd: parent.cwd,
        history: [],
        effort: effortFor(def, model, input.effort),
        thinking: true,
        permission: def.kind === 'cli' ? permission : undefined,
        // Subagents get the user's MCP servers but not the subagent bridge: one level deep only.
        mcpServers: def.kind === 'cli' ? activeMcpServers() : undefined,
        localTools: httpMode ? { mode: httpMode, confirm: parent.confirm } : undefined,
        instructions: [def.kind === 'http' ? projectHeader(parent.cwd, httpMode) : undefined, SUBAGENT_BRIEF]
          .filter(Boolean)
          .join('\n\n'),
        signal
      },
      (event) => {
        if (event.type === 'text_delta') {
          text += event.text;
        } else if (event.type === 'error') {
          errors.push(event.message);
        }
      }
    );
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (signal.aborted) {
    return { output: 'The subagent was stopped.', isError: true };
  }
  const label = `${def.label} · ${model ?? 'default'}`;
  const body = text.trim() || (errors.length ? '' : '(no answer)');
  const output = [`[subagent ${label}]`, body, errors.length ? `Errors:\n${errors.join('\n')}` : ''].filter(Boolean).join('\n\n');
  return {
    output: output.length > RESULT_CAP ? `${output.slice(0, RESULT_CAP)}\n… (report truncated)` : output,
    isError: !text.trim() && errors.length > 0
  };
}
