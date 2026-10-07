/**
 * Local bridge that lets the CLI agents start subagents: their MCP server (dist/subagent-mcp.js)
 * forwards `spawn_agent` here, and the extension runs it with its own providers and keys.
 * Listens on 127.0.0.1 only and requires a per-window token.
 */
import { randomBytes } from 'node:crypto';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import * as vscode from 'vscode';
import { McpServerDef } from '../types';
import { parseSpawnInput } from './spawnSchema';
import { runSubagent, subagentCatalog, SubagentParent } from './subagents';

interface Session extends SubagentParent {
  signal: AbortSignal;
}

const MAX_BODY = 1_000_000;
/** codex stops waiting for an MCP tool after 60 s by default; subagents take longer. */
const TOOL_TIMEOUT_SEC = 3600;

export class SubagentBridge implements vscode.Disposable {
  private server?: http.Server;
  private port?: Promise<number>;
  private readonly token = randomBytes(24).toString('hex');
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    /** Absolute path of the bundled MCP server script. */
    private readonly mcpScript: string
  ) {}

  /**
   * Registers one agent turn and returns the MCP server entry that gives it `spawn_agent`.
   * Close the session when the turn ends; its subagents stop with `parent.signal`.
   */
  async open(parent: Session): Promise<{ id: string; server: McpServerDef }> {
    const port = await this.listen();
    const id = randomBytes(8).toString('hex');
    this.sessions.set(id, parent);
    return {
      id,
      server: {
        command: process.execPath,
        args: [this.mcpScript],
        env: {
          // VS Code's own executable runs the script as plain Node.
          ELECTRON_RUN_AS_NODE: '1',
          POLYMOLY_BRIDGE: `http://127.0.0.1:${port}`,
          POLYMOLY_TOKEN: this.token,
          POLYMOLY_SESSION: id
        },
        toolTimeoutSec: TOOL_TIMEOUT_SEC
      }
    };
  }

  close(id: string): void {
    this.sessions.delete(id);
  }

  dispose(): void {
    this.sessions.clear();
    this.server?.close();
    this.server = undefined;
    this.port = undefined;
  }

  private listen(): Promise<number> {
    this.port ??= new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => void this.handle(req, res));
      // A subagent can run for many minutes before its single response.
      server.requestTimeout = 0;
      server.timeout = 0;
      server.keepAliveTimeout = 0;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
      this.server = server;
    });
    return this.port;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const reply = (status: number, body: unknown) => {
      if (!res.writableEnded) {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }
    };
    if (req.headers['x-polymoly-token'] !== this.token) {
      reply(403, { error: 'forbidden' });
      return;
    }
    const session = this.sessions.get(String(req.headers['x-polymoly-session'] ?? ''));
    if (!session) {
      reply(410, { output: 'This agent turn has ended; subagents are no longer available.', isError: true });
      return;
    }
    if (req.method === 'GET' && req.url === '/agents') {
      reply(200, { output: subagentCatalog(), isError: false });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/spawn') {
      reply(404, { error: 'not found' });
      return;
    }

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reply(413, { output: 'Request too large.', isError: true });
        return;
      }
    }
    let input: ReturnType<typeof parseSpawnInput>;
    try {
      input = parseSpawnInput(JSON.parse(raw));
    } catch {
      input = undefined;
    }
    if (!input) {
      reply(200, { output: '`provider` and `prompt` are required.', isError: true });
      return;
    }

    // Stops with the parent turn, or when the CLI drops the call (its MCP server exits).
    const dropped = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        dropped.abort();
      }
    });
    const signal = AbortSignal.any([session.signal, dropped.signal]);
    const result = await runSubagent(input, session, this.secrets, signal);
    reply(200, result);
  }
}
