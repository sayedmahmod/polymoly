/**
 * Stdio MCP server the CLI agents (claude, codex) load to start subagents. Bundled on its own as
 * dist/subagent-mcp.js and run by VS Code's executable as Node; it only forwards to the
 * extension's local bridge (src/agents/bridge.ts), which owns providers, keys and permissions.
 */
import * as http from 'node:http';
import * as readline from 'node:readline';
import {
  LIST_AGENTS_DESCRIPTION,
  LIST_AGENTS_TOOL,
  SPAWN_AGENT_DESCRIPTION,
  SPAWN_AGENT_PARAMETERS,
  SPAWN_AGENT_TOOL,
  SUBAGENT_MCP_NAME
} from './spawnSchema';

const bridge = process.env.POLYMOLY_BRIDGE ?? '';
const token = process.env.POLYMOLY_TOKEN ?? '';
const session = process.env.POLYMOLY_SESSION ?? '';

interface BridgeResult {
  output: string;
  isError: boolean;
}

let pending = 0;
let closed = false;

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** One request to the bridge; plain node:http, which has no response timeout of its own. */
function callBridge(method: 'GET' | 'POST', path: string, body?: unknown): Promise<BridgeResult> {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${bridge}${path}`,
      {
        method,
        headers: {
          'x-polymoly-token': token,
          'x-polymoly-session': session,
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve({ output: String(parsed.output ?? parsed.error ?? raw), isError: Boolean(parsed.isError ?? res.statusCode !== 200) });
          } catch {
            resolve({ output: raw || `Bridge answered ${res.statusCode}.`, isError: true });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ output: `PolyMoly is not reachable: ${err.message}`, isError: true }));
    req.end(payload);
  });
}

const tools = [
  { name: SPAWN_AGENT_TOOL, description: SPAWN_AGENT_DESCRIPTION, inputSchema: SPAWN_AGENT_PARAMETERS },
  { name: LIST_AGENTS_TOOL, description: LIST_AGENTS_DESCRIPTION, inputSchema: { type: 'object', properties: {} } }
];

async function handle(message: any): Promise<void> {
  const { id, method, params } = message ?? {};
  if (id === undefined || id === null) {
    return; // notification, e.g. notifications/initialized
  }
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: SUBAGENT_MCP_NAME, version: '1.0.0' }
        }
      });
      return;
    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools } });
      return;
    case 'tools/call': {
      const result =
        params?.name === SPAWN_AGENT_TOOL
          ? await callBridge('POST', '/spawn', params?.arguments ?? {})
          : params?.name === LIST_AGENTS_TOOL
            ? await callBridge('GET', '/agents')
            : { output: `Unknown tool ${params?.name}.`, isError: true };
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result.output }], isError: result.isError } });
      return;
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) {
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // Calls run concurrently, so parallel subagents really run in parallel.
  pending++;
  void handle(message).finally(() => {
    pending--;
    if (closed && !pending) {
      process.exit(0);
    }
  });
});
process.stdin.on('end', () => {
  closed = true;
  if (!pending) {
    process.exit(0);
  }
});
