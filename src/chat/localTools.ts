/** The local file and shell tools that turn an HTTP provider into a working agent. */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { userPath } from '../providers/cliAdapter';

export type AgentPermission = 'readonly' | 'edit' | 'write' | 'auto';

/** How much a tool can change: an edit lands in one file, a command can do anything. */
export type ToolRisk = 'edit' | 'command';

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'read' | 'mutate';
  risk?: ToolRisk;
}

export interface ToolContext {
  cwd: string;
  mode: AgentPermission;
  signal: AbortSignal;
  /** Asked before a risky tool runs; false denies the call. */
  confirm?: (tool: ToolDef, input: Record<string, unknown>) => Promise<boolean>;
}

export interface ToolResult {
  output: string;
  isError: boolean;
}

const MAX_TOOL_ROUNDS = 25;
const READ_LIMITS = { lines: 2000, bytes: 48_000 };
const COMMAND_DEFAULT_MS = 60_000;
const COMMAND_MAX_MS = 600_000;
const OUTPUT_CAP = 16_000;
const WALK_ENTRY_CAP = 20_000;
const RESULT_CAP = 300;
const GREP_MATCH_CAP = 100;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', '.venv', '__pycache__']);

/** The tools a mode hands out: readonly reads, edit also changes files, write/auto also run commands. */
export function toolsForMode(mode: AgentPermission): ToolDef[] {
  const all: ToolDef[] = [
    {
      name: 'run_command',
      description:
        'Run a shell command in the workspace root and return stdout, stderr and the exit code. ' +
        'Use it for builds, tests, git and package managers. Long-running servers do not fit; ' +
        `commands are killed after their timeout (default ${COMMAND_DEFAULT_MS / 1000}s).`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          timeout_ms: { type: 'number', description: 'Kill the command after this many milliseconds (max 600000).' }
        },
        required: ['command']
      },
      kind: 'mutate',
      risk: 'command'
    },
    {
      name: 'read_file',
      description:
        'Read a text file from the workspace as numbered lines, like `cat -n`. ' +
        'Read at most 2000 lines per call; page through larger files with offset.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          offset: { type: 'number', description: '1-based line to start from.' },
          limit: { type: 'number', description: 'Maximum number of lines (default 500, max 2000).' }
        },
        required: ['path']
      },
      kind: 'read'
    },
    {
      name: 'write_file',
      description:
        'Create or overwrite a file inside the workspace with the given content. ' +
        'Overwriting writes the whole file: read it first if any of it should survive.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          content: { type: 'string', description: 'The complete new file content.' }
        },
        required: ['path', 'content']
      },
      kind: 'mutate',
      risk: 'edit'
    },
    {
      name: 'edit_file',
      description:
        'Replace an exact snippet inside a workspace file. `old_text` must match the file ' +
        'exactly once, including whitespace. Use replace_all for an intended global replace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          old_text: { type: 'string', description: 'The exact existing snippet.' },
          new_text: { type: 'string', description: 'The replacement text.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one.' }
        },
        required: ['path', 'old_text', 'new_text']
      },
      kind: 'mutate',
      risk: 'edit'
    },
    {
      name: 'list_dir',
      description: 'List a workspace directory: name, kind and size of each entry.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory relative to the workspace root. Default: the root.' }
        }
      },
      kind: 'read'
    },
    {
      name: 'glob',
      description: 'Find files by glob pattern, e.g. "src/**/*.ts". Skips dependencies and build output.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern relative to the workspace root.' }
        },
        required: ['pattern']
      },
      kind: 'read'
    },
    {
      name: 'grep',
      description: 'Search file contents with a regular expression and get matching lines as path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression (JavaScript syntax).' },
          path: { type: 'string', description: 'Directory or file to search. Default: the workspace root.' },
          include: { type: 'string', description: 'Only files matching this glob, e.g. "*.ts".' },
          ignore_case: { type: 'boolean', description: 'Match case-insensitively.' }
        },
        required: ['pattern']
      },
      kind: 'read'
    }
  ];
  if (mode === 'readonly') {
    return all.filter((tool) => tool.kind === 'read');
  }
  if (mode === 'edit') {
    return all.filter((tool) => tool.risk !== 'command');
  }
  return all;
}

/** Commands need a yes in `write` mode; edits are routine and `auto` trusts everything. */
export function needsConfirmation(tool: ToolDef, mode: AgentPermission): boolean {
  return mode === 'write' && tool.risk === 'command';
}

/** Runs one tool call; every failure becomes a tool result the model can read and react to. */
export async function executeTool(
  tool: ToolDef,
  rawInput: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const input = typeof rawInput === 'object' && rawInput ? (rawInput as Record<string, unknown>) : {};
  try {
    if (needsConfirmation(tool, ctx.mode) && ctx.confirm && !(await ctx.confirm(tool, input))) {
      return { output: 'The user denied this tool call. Continue without it or ask how to proceed.', isError: true };
    }
    switch (tool.name) {
      case 'run_command':
        return await runCommand(String(input.command ?? ''), input.timeout_ms, ctx);
      case 'read_file':
        return ok(readFile(path.resolve(ctx.cwd, String(input.path ?? '')), input.offset, input.limit, ctx.cwd));
      case 'write_file':
        return ok(writeFile(path.resolve(ctx.cwd, String(input.path ?? '')), String(input.content ?? ''), ctx.cwd));
      case 'edit_file':
        return ok(
          editFile(
            path.resolve(ctx.cwd, String(input.path ?? '')),
            String(input.old_text ?? ''),
            String(input.new_text ?? ''),
            Boolean(input.replace_all),
            ctx.cwd
          )
        );
      case 'list_dir':
        return ok(listDir(path.resolve(ctx.cwd, String(input.path ?? '.')), ctx.cwd));
      case 'glob':
        return ok(glob(String(input.pattern ?? ''), ctx));
      case 'grep':
        return ok(grep(input, ctx));
      default:
        return { output: `Unknown tool ${tool.name}.`, isError: true };
    }
  } catch (err) {
    return { output: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function ok(output: string): ToolResult {
  return { output, isError: false };
}

function cap(text: string, note: string): string {
  if (text.length <= OUTPUT_CAP) {
    return text;
  }
  return `${text.slice(0, OUTPUT_CAP)}\n… (${note})`;
}

/** Keeps file tools inside the workspace; the error doubles as guidance for the model. */
function withinWorkspace(abs: string, cwd: string): void {
  const norm = path.resolve(abs);
  if (norm !== cwd && !norm.startsWith(cwd + path.sep)) {
    throw new Error(`Path is outside the workspace: ${abs}. File tools only reach ${cwd}.`);
  }
}

function readFile(abs: string, offset: unknown, limit: unknown, cwd: string): string {
  withinWorkspace(abs, cwd);
  const raw = fs.readFileSync(abs, 'utf8');
  if (raw.includes('\0')) {
    throw new Error('This looks like a binary file; read_file only reads text.');
  }
  const startLine = Math.max(1, Number(offset) || 1);
  const maxLines = Math.min(READ_LIMITS.lines, Math.max(1, Number(limit) || 500));
  const lines = raw.split('\n');
  const from = startLine - 1;
  const slice = lines.slice(from, from + maxLines);
  if (!slice.length) {
    return `File has ${lines.length} lines; offset ${startLine} is past the end.`;
  }
  const numbered = slice.map((line, i) => {
    const clipped = line.length > 2000 ? line.slice(0, 2000) + '…' : line;
    return `${String(from + i + 1).padStart(6)}  ${clipped}`;
  });
  let out = numbered.join('\n');
  if (out.length > READ_LIMITS.bytes) {
    out = out.slice(0, READ_LIMITS.bytes) + '\n… (output truncated, read a smaller range)';
  }
  const end = from + slice.length;
  if (end < lines.length) {
    out += `\n\n(${lines.length} lines total; continue with offset ${end + 1})`;
  }
  return out;
}

function writeFile(abs: string, content: string, cwd: string): string {
  withinWorkspace(abs, cwd);
  if (content.length > 1_000_000) {
    throw new Error('Content is over 1 MB; split the write into smaller files.');
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return `Wrote ${content.length} bytes to ${path.relative(cwd, abs) || abs}.`;
}

function editFile(abs: string, oldText: string, newText: string, replaceAll: boolean, cwd: string): string {
  withinWorkspace(abs, cwd);
  if (!oldText) {
    throw new Error('old_text is empty; use write_file to replace a whole file.');
  }
  const content = fs.readFileSync(abs, 'utf8');
  const count = content.split(oldText).length - 1;
  if (count === 0) {
    throw new Error(
      'old_text not found in the file. Read the file again — the snippet must match exactly, including whitespace.'
    );
  }
  if (count > 1 && !replaceAll) {
    throw new Error(`old_text appears ${count} times; add surrounding lines to make it unique, or set replace_all.`);
  }
  const next = replaceAll ? content.replaceAll(oldText, newText) : content.replace(oldText, newText);
  fs.writeFileSync(abs, next, 'utf8');
  return `Replaced ${replaceAll ? count : 1} occurrence(s) in ${path.relative(cwd, abs) || abs}.`;
}

function listDir(abs: string, cwd: string): string {
  withinWorkspace(abs, cwd);
  const entries = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 500);
  const rows = entries
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => {
      if (entry.isSymbolicLink()) {
        return `${entry.name} -> link`;
      }
      if (entry.isDirectory()) {
        return `${entry.name}/`;
      }
      try {
        return `${entry.name}  (${fs.statSync(path.join(abs, entry.name)).size} bytes)`;
      } catch {
        return entry.name;
      }
    });
  const rel = path.relative(cwd, abs) || '.';
  return cap(`${rel}/\n${rows.join('\n')}`, `${entries.length >= 500 ? 'first 500 entries' : 'output'} truncated`);
}

/** Glob with **, * and ?; small walker, no dependencies. */
function glob(pattern: string, ctx: ToolContext): string {
  const regex = globToRegex(pattern);
  const found: string[] = [];
  walk(ctx.cwd, (_file, rel) => {
    if (regex.test(rel.split(path.sep).join('/'))) {
      found.push(rel.split(path.sep).join('/'));
    }
    return found.length < RESULT_CAP;
  });
  return found.length
    ? found.join('\n')
    : `No files match ${pattern}. Top level of the workspace:\n${safeList(ctx.cwd)}`;
}

function grep(input: Record<string, unknown>, ctx: ToolContext): string {
  const pattern = String(input.pattern ?? '');
  if (!pattern) {
    throw new Error('pattern is empty.');
  }
  const flags = input.ignore_case ? 'i' : '';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags + 'g');
  } catch (err) {
    throw new Error(`Invalid regular expression: ${err instanceof Error ? err.message : err}`);
  }
  const include = input.include ? globToRegex(String(input.include)) : undefined;
  const root = path.resolve(ctx.cwd, String(input.path ?? '.'));
  withinWorkspace(root, ctx.cwd);
  const underRoot = (file: string) => file === root || file.startsWith(root + path.sep);
  const matches: string[] = [];
  let truncated = false;
  walk(ctx.cwd, (file, rel) => {
    if (!underRoot(file)) {
      return true;
    }
    if (include && !include.test(rel.split(path.sep).join('/'))) {
      return true;
    }
    let text: string;
    try {
      if (fs.statSync(file).size > 512_000) {
        return true;
      }
      text = fs.readFileSync(file, 'utf8');
      if (text.includes('\0')) {
        return true; // binary
      }
    } catch {
      return true;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length && matches.length < GREP_MATCH_CAP; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        matches.push(`${rel.split(path.sep).join('/')}:${i + 1}: ${lines[i].slice(0, 400)}`);
      }
    }
    if (matches.length >= GREP_MATCH_CAP) {
      truncated = true;
      return false;
    }
    return true;
  });
  return matches.length
    ? cap(matches.join('\n') + (truncated ? `\n… (stopped at ${GREP_MATCH_CAP} matches)` : ''), 'output truncated')
    : 'No matches.';
}

function safeList(cwd: string): string {
  try {
    return fs
      .readdirSync(cwd, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .slice(0, 60)
      .join('\n');
  } catch {
    return '(unreadable)';
  }
}

/** Walks files below `root`, skipping dependency and build folders; `visit` returns false to stop. */
function walk(root: string, visit: (file: string, rel: string) => boolean): void {
  let seen = 0;
  const stack: string[] = [root];
  while (stack.length && seen < WALK_ENTRY_CAP) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > WALK_ENTRY_CAP) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push(full);
        }
        continue;
      }
      if (entry.isFile() && !visit(full, path.relative(root, full))) {
        return;
      }
    }
  }
}

function globToRegex(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') {
          i++; // "**/" also matches the level it stands on
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** Runs a shell command with a hard timeout; the killed run still returns what it printed. */
function runCommand(command: string, timeoutMs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const timeout = Math.min(COMMAND_MAX_MS, Math.max(1000, Number(timeoutMs) || COMMAND_DEFAULT_MS));
  return new Promise((resolve) => {
    const shell = process.platform === 'win32' ? ['cmd', '/c'] : ['/bin/sh', '-c'];
    const child = spawn(shell[0], [...shell.slice(1), command], {
      cwd: ctx.cwd,
      env: { ...process.env, PATH: userPath() },
      shell: process.platform === 'win32'
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killer);
      ctx.signal.removeEventListener('abort', onAbort);
      const rel = `exit ${code ?? 'killed'}`;
      const body = [
        stdout.trim() ? `$ ${command}\n${cap(stdout, 'stdout truncated')}` : '',
        stderr.trim() ? `stderr:\n${cap(stderr, 'stderr truncated')}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      resolve({
        output: cap(
          `${timedOut ? `Timed out after ${timeout / 1000}s and was killed.\n` : ''}${body || '(no output)'}\n(${rel})`,
          'output truncated'
        ),
        isError: timedOut || code !== 0
      });
    };
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeout);
    const onAbort = () => {
      timedOut = true;
      child.kill('SIGTERM');
      finish(null);
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < OUTPUT_CAP * 2) {
        stdout += chunk;
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < OUTPUT_CAP * 2) {
        stderr += chunk;
      }
    });
    child.on('error', (err) => {
      stderr += `${err.message}\n`;
      finish(127);
    });
    child.on('close', (code) => finish(code));
  });
}

/** Human-readable one-liner for the confirmation dialog, e.g. the command itself. */
export function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'run_command') {
    return String(input.command ?? '').slice(0, 300);
  }
  return String(input.path ?? '');
}

export { MAX_TOOL_ROUNDS };
