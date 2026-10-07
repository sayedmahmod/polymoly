/**
 * A small, local repository map for inexpensive project awareness.
 *
 * This deliberately does not use embeddings or send an entire repository to a model. It keeps
 * just paths, imports and top-level symbols locally, then ranks a compact, query-specific map.
 * The shape follows the useful part of repository-RAG: global structure + a few relevant
 * definitions, under a hard budget.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORED = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.nuxt',
  '.turbo', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv'
]);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.cs',
  '.rb', '.php', '.swift', '.c', '.cc', '.cpp', '.h', '.hpp', '.vue', '.svelte', '.sql', '.sh',
  '.md', '.json', '.yaml', '.yml', '.toml', '.css', '.scss', '.html'
]);
const ROOT_FILES = new Set([
  'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'readme.md',
  'tsconfig.json', 'vite.config.ts', 'next.config.js', 'dockerfile', 'compose.yml', 'docker-compose.yml', '.gitignore'
]);
const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'for', 'are', 'was', 'will', 'can', 'not',
  'eine', 'einen', 'einer', 'einem', 'eines', 'und', 'der', 'die', 'das', 'den', 'dem', 'mit', 'für',
  'von', 'auf', 'ist', 'sind', 'nicht', 'oder', 'wenn', 'projekt', 'project', 'code', 'file', 'datei'
]);

interface IndexedFile {
  path: string;
  symbols: string[];
  outline: string[];
  imports: string[];
  text: string;
  incoming: number;
  root: boolean;
}

interface RepositoryIndex {
  root: string;
  files: IndexedFile[];
  builtAt: number;
}

export interface RepositoryContext {
  text: string;
  files: number;
  cached: boolean;
}

/** A singleton is enough: VS Code extensions have one process per extension host. */
class ProjectContextService {
  private index?: RepositoryIndex;
  private dirty = true;
  private building?: Promise<RepositoryIndex>;

  invalidate(): void {
    this.dirty = true;
  }

  async forPrompt(root: string, prompt: string, tokenBudget: number): Promise<RepositoryContext> {
    const cached = Boolean(this.index && this.index.root === root && !this.dirty);
    const index = await this.getIndex(root);
    return { text: renderMap(index, prompt, tokenBudget), files: index.files.length, cached };
  }

  private async getIndex(root: string): Promise<RepositoryIndex> {
    if (this.index && this.index.root === root && !this.dirty) {
      return this.index;
    }
    if (!this.building) {
      this.building = Promise.resolve().then(() => buildIndex(root)).then((index) => {
        this.index = index;
        this.dirty = false;
        return index;
      }).finally(() => {
        this.building = undefined;
      });
    }
    return this.building;
  }
}

export const projectContext = new ProjectContextService();

function buildIndex(root: string): RepositoryIndex {
  const files: IndexedFile[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 5000) {
        return;
      }
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const abs = path.join(dir, entry.name);
      const relative = path.relative(root, abs).split(path.sep).join('/');
      if (!isIndexable(relative, abs)) {
        continue;
      }
      let text = '';
      try {
        const stat = fs.statSync(abs);
        if (stat.size > 350_000) {
          continue;
        }
        text = fs.readFileSync(abs, 'utf8').slice(0, 80_000);
      } catch {
        continue;
      }
      if (text.includes('\0')) {
        continue;
      }
      files.push({
        path: relative,
        symbols: symbolsOf(text),
        outline: outlineOf(text),
        imports: importsOf(text),
        text,
        incoming: 0,
        root: ROOT_FILES.has(relative.toLowerCase()) || !relative.includes('/')
      });
    }
  };
  walk(root);

  const known = new Set(files.map((file) => file.path));
  for (const file of files) {
    for (const specifier of file.imports) {
      const resolved = resolveImport(file.path, specifier, known);
      if (resolved) {
        const target = files.find((entry) => entry.path === resolved);
        if (target) {
          target.incoming++;
        }
      }
    }
  }
  return { root, files, builtAt: Date.now() };
}

function isIndexable(relative: string, absolute: string): boolean {
  const lower = relative.toLowerCase();
  if (ROOT_FILES.has(lower)) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase());
}

function symbolsOf(text: string): string[] {
  const found = new Set<string>();
  const pattern = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|type|enum|function|const|let|var|def|struct|trait|fn)\s+([A-Za-z_$][\w$]*)/gm;
  for (const match of text.matchAll(pattern)) {
    found.add(match[1]);
    if (found.size >= 30) {
      break;
    }
  }
  return [...found];
}

/** Definition lines carry useful type/signature context without paying to embed full functions. */
function outlineOf(text: string): string[] {
  const lines: string[] = [];
  const pattern = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|type|enum|function|const|def|struct|trait|fn)\s+[A-Za-z_$][\w$]*[^\n{=;]*/gm;
  for (const match of text.matchAll(pattern)) {
    const line = match[0].trim().replace(/\s+/g, ' ').slice(0, 180);
    if (line) lines.push(line);
    if (lines.length >= 12) break;
  }
  return lines;
}

function importsOf(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:from\s*|import\s*\(|require\s*\()\s*['\"]([^'\"]+)['\"]/g;
  for (const match of text.matchAll(pattern)) {
    found.add(match[1]);
    if (found.size >= 40) {
      break;
    }
  }
  return [...found];
}

function resolveImport(from: string, specifier: string, known: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.py`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  return candidates.find((candidate) => known.has(candidate));
}

function termsOf(prompt: string): string[] {
  return [...new Set((prompt.toLowerCase().match(/[a-z0-9_$-]{3,}/g) ?? []).filter((term) => !STOP_WORDS.has(term)))].slice(0, 36);
}

function renderMap(index: RepositoryIndex, prompt: string, tokenBudget: number): string {
  const terms = termsOf(prompt);
  const limit = Math.max(1_600, Math.min(32_000, Math.floor(tokenBudget * 4)));
  const ranked = index.files
    .map((file) => ({ file, score: score(file, terms) }))
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  const lines = ['# Local repository map (generated locally; do not treat as source code)', `Indexed ${index.files.length} text files. Read source only when this map points to it.`];
  let size = lines.join('\n').length;
  for (const { file } of ranked) {
    const symbols = file.outline.length ? ` — ${file.outline.slice(0, 3).join(' | ')}` : file.symbols.length ? ` — ${file.symbols.join(', ')}` : '';
    const imports = file.imports.filter((value) => value.startsWith('.')).slice(0, 4);
    const relation = imports.length ? ` → ${imports.join(', ')}` : '';
    const line = `- ${file.path}${symbols}${relation}`;
    if (size + line.length + 1 > limit) {
      break;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return lines.join('\n');
}

function score(file: IndexedFile, terms: string[]): number {
  const haystack = `${file.path} ${file.symbols.join(' ')} ${file.text.slice(0, 20_000)}`.toLowerCase();
  let score = file.incoming * 2 + (file.root ? 5 : 0);
  for (const term of terms) {
    if (file.path.toLowerCase().includes(term)) score += 14;
    if (file.symbols.some((symbol) => symbol.toLowerCase().includes(term))) score += 10;
    if (haystack.includes(term)) score += 2;
  }
  return score;
}
