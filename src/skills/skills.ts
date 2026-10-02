import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '../i18n';

/**
 * Agent skills in the SKILL.md format that Claude Code and Codex share: one folder per skill,
 * with a SKILL.md whose YAML front matter carries `name` and `description`. PolyMoly keeps
 * one store and hands it to every provider, so a skill installed once works for all models.
 */
export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
  file: string;
  enabled: boolean;
}

/** Skill folders other tools use; offered for import. */
const FOREIGN_SKILL_DIRS = [
  path.join(os.homedir(), '.claude', 'skills'),
  path.join(os.homedir(), '.codex', 'skills'),
  path.join(os.homedir(), '.agents', 'skills')
];

export function skillsRoot(): string {
  const configured = vscode.workspace.getConfiguration('polyagent').get<string>('skills.directory', '').trim();
  const dir = configured ? configured.replace(/^~(?=$|[\\/])/, os.homedir()) : path.join(os.homedir(), '.polyagent', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function disabledSkills(): Set<string> {
  return new Set(vscode.workspace.getConfiguration('polyagent').get<string[]>('skills.disabled', []));
}

/** Reads `name` and `description` from the front matter; supports single-line values. */
export function parseFrontMatter(text: string): Record<string, string> {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  const result: Record<string, string> = {};
  if (!match) {
    return result;
  }
  let key = '';
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      key = pair[1];
      const value = pair[2].trim();
      result[key] = /^[|>][-+]?$/.test(value) ? '' : value.replace(/^(['"])(.*)\1$/, '$2');
    } else if (key && /^\s+\S/.test(line)) {
      result[key] = `${result[key]} ${line.trim()}`.trim();
    }
  }
  return result;
}

function readSkill(dir: string, disabled: Set<string>): SkillInfo | undefined {
  const file = path.join(dir, 'SKILL.md');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  const meta = parseFrontMatter(text);
  const name = path.basename(dir);
  return {
    name,
    description: meta.description || firstParagraph(text),
    dir,
    file,
    enabled: !disabled.has(name)
  };
}

function firstParagraph(text: string): string {
  const body = text.replace(/^---[\s\S]*?\n---/, '');
  const line = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
  return (line ?? '').trim().slice(0, 200);
}

export function listSkills(): SkillInfo[] {
  const root = skillsRoot();
  const disabled = disabledSkills();
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => readSkill(path.join(root, entry.name), disabled))
    .filter((skill): skill is SkillInfo => Boolean(skill))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function activeSkills(): SkillInfo[] {
  return listSkills().filter((skill) => skill.enabled);
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const disabled = disabledSkills();
  if (enabled) {
    disabled.delete(name);
  } else {
    disabled.add(name);
  }
  await vscode.workspace
    .getConfiguration('polyagent')
    .update('skills.disabled', [...disabled], vscode.ConfigurationTarget.Global);
}

export function removeSkill(name: string): void {
  const dir = path.join(skillsRoot(), safeName(name));
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Skills in other tools' folders that are not in the store yet. */
export function importableSkills(): { name: string; dir: string; from: string }[] {
  const installed = new Set(listSkills().map((s) => s.name));
  const found: { name: string; dir: string; from: string }[] = [];
  for (const base of FOREIGN_SKILL_DIRS) {
    for (const dir of findSkillDirs(base, 2)) {
      const name = skillName(dir);
      if (!installed.has(name) && !found.some((f) => f.name === name)) {
        found.push({ name, dir, from: base.replace(os.homedir(), '~') });
      }
    }
  }
  return found;
}

export function importForeignSkills(): string[] {
  return importableSkills().map((skill) => copySkill(skill.dir));
}

/**
 * Installs skills from a local folder, a SKILL.md, a .zip/.skill archive, a git repository
 * (GitHub `tree/<branch>/<path>` links included) or a URL to a SKILL.md or archive.
 * Returns the installed names.
 */
export async function installSkills(source: string): Promise<string[]> {
  const input = source.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!input) {
    throw new Error(t('err.sourceMissing'));
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polyagent-skill-'));
  try {
    const dir = /^(https?|git|ssh):\/\/|^git@/.test(input) ? await fetchRemote(input, temp) : await localSource(input, temp);
    const skills = findSkillDirs(dir, 4);
    if (!skills.length) {
      throw new Error(t('err.noSkillMd'));
    }
    return skills.map((skillDir) => copySkill(skillDir));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function localSource(input: string, temp: string): Promise<string> {
  if (!fs.existsSync(input)) {
    throw new Error(t('err.pathNotFound', { path: input }));
  }
  if (fs.statSync(input).isDirectory()) {
    return input;
  }
  if (/\.(zip|skill)$/i.test(input)) {
    await extractZip(input, temp);
    return temp;
  }
  if (path.basename(input).toLowerCase() === 'skill.md') {
    return path.dirname(input);
  }
  if (/\.md$/i.test(input)) {
    const dir = path.join(temp, path.basename(input, path.extname(input)));
    fs.mkdirSync(dir);
    fs.copyFileSync(input, path.join(dir, 'SKILL.md'));
    return temp;
  }
  throw new Error(t('err.expectedSkill'));
}

async function fetchRemote(url: string, temp: string): Promise<string> {
  const github = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/);
  if (github) {
    const [, owner, repo, branch, sub] = github;
    const target = path.join(temp, 'repo');
    await run('git', ['clone', '--depth', '1', ...(branch ? ['--branch', branch] : []), `https://github.com/${owner}/${repo}.git`, target]);
    const inside = path.join(target, (sub ?? '').replace(/\/SKILL\.md$/i, ''));
    return fs.existsSync(inside) ? inside : target;
  }
  if (/\.git$/.test(url) || /^(git|ssh):\/\/|^git@/.test(url)) {
    const target = path.join(temp, 'repo');
    await run('git', ['clone', '--depth', '1', url, target]);
    return target;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(t('err.httpLoad', { status: response.status, url }));
  }
  const data = Buffer.from(await response.arrayBuffer());
  const zipped = data.subarray(0, 2).toString('latin1') === 'PK';
  if (zipped) {
    const archive = path.join(temp, 'download.zip');
    fs.writeFileSync(archive, data);
    const out = path.join(temp, 'out');
    fs.mkdirSync(out);
    await extractZip(archive, out);
    return out;
  }
  const text = data.toString('utf8');
  if (!text.startsWith('---') && !/\.md$/i.test(new URL(url).pathname)) {
    throw new Error(t('err.urlNeither'));
  }
  const name = parseFrontMatter(text).name || path.basename(path.dirname(new URL(url).pathname)) || 'skill';
  const dir = path.join(temp, safeName(name));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
  return temp;
}

function extractZip(archive: string, out: string): Promise<void> {
  return process.platform === 'win32'
    ? run('tar', ['-xf', archive, '-C', out])
    : run('unzip', ['-q', '-o', archive, '-d', out]);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${command}: ${String(stderr).trim() || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

/** Folders below `base` (itself included) that contain a SKILL.md. */
function findSkillDirs(base: string, depth: number): string[] {
  if (!fs.existsSync(base)) {
    return [];
  }
  if (fs.existsSync(path.join(base, 'SKILL.md'))) {
    return [base];
  }
  if (depth <= 0) {
    return [];
  }
  const found: string[] = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== '__MACOSX') {
      found.push(...findSkillDirs(path.join(base, entry.name), depth - 1));
    }
  }
  return found;
}

function skillName(dir: string): string {
  let meta: Record<string, string> = {};
  try {
    meta = parseFrontMatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    /* fall back to the folder name */
  }
  return safeName(meta.name || path.basename(dir));
}

function safeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

/** Copies one skill folder into the store, replacing an older copy. */
function copySkill(dir: string): string {
  const name = skillName(dir);
  const target = path.join(skillsRoot(), name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dir, target, {
    recursive: true,
    dereference: true,
    filter: (src) => !/[\\/](\.git|node_modules|__MACOSX)([\\/]|$)/.test(src) && !path.basename(src).startsWith('._')
  });
  return name;
}

/**
 * System instructions listing the active skills. Agents with file tools read a SKILL.md
 * when a task matches; plain API models only see the list and get a skill's text inlined
 * when the user invokes it.
 */
export function skillsInstructions(skills: SkillInfo[], canReadFiles: boolean): string | undefined {
  if (!skills.length) {
    return undefined;
  }
  const lines = skills.map((s) =>
    canReadFiles ? `- ${s.name}: ${s.description} (${s.file})` : `- ${s.name}: ${s.description}`
  );
  const how = canReadFiles
    ? 'When a task matches a skill, read its SKILL.md with your file tools before you start and follow it. ' +
      'Files the SKILL.md mentions are relative to its folder. Load a skill only when it is relevant.'
    : 'The user can load a skill into the conversation by starting a message with /<name>. ' +
      'If a listed skill would help, you may suggest it.';
  return `# Skills\n\nThese skills are installed:\n${lines.join('\n')}\n\n${how}`;
}

/** `/name rest` or `$name rest` with an active skill: inlines that skill's SKILL.md before `rest`. */
export function expandSkillInvocation(prompt: string, skills: SkillInfo[]): { prompt: string; skill?: string } {
  const match = prompt.match(/^[/$]([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const skill = match && skills.find((s) => s.name === match[1].toLowerCase());
  if (!skill) {
    return { prompt };
  }
  const body = fs.readFileSync(skill.file, 'utf8');
  const rest = match[2]?.trim() || t('skill.applySkill', { name: skill.name });
  return {
    skill: skill.name,
    prompt: `<skill name="${skill.name}" dir="${skill.dir}">\n${body.trim()}\n</skill>\n\n${rest}`
  };
}
