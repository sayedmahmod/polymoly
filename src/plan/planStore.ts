/** Plans live as markdown files in the workspace, so they are reviewable and editable like code. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parsePlanFile, planMarkdown } from './planFormat';
import { Plan } from './planTypes';

const FOLDER = path.join('.polymoly', 'plans');

/** Where plans are written: the workspace when there is one, else the extension's storage. */
export function plansRoot(context: vscode.ExtensionContext): string {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return workspace ? path.join(workspace, FOLDER) : path.join(context.globalStorageUri.fsPath, 'plans');
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'plan'
  );
}

/** Writes the plan and returns it with its path filled in. */
export function savePlan(context: vscode.ExtensionContext, plan: Plan): Plan {
  const dir = plansRoot(context);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(plan.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/-/g, '');
  const file = plan.path ?? path.join(dir, `${stamp}-${slug(plan.title)}.md`);
  const stored = { ...plan, path: file };
  fs.writeFileSync(file, planMarkdown(stored), 'utf8');
  return stored;
}

/** Re-reads a plan from disk, so edits made in the markdown file are picked up. */
export function loadPlan(file: string): Plan | undefined {
  try {
    return parsePlanFile(fs.readFileSync(file, 'utf8'), file);
  } catch {
    return undefined;
  }
}

/** First lines of the plan markdown, for the preview card in the transcript. */
export function planPreview(plan: Plan, lines = 6): string {
  const body = planMarkdown(plan)
    .split('\n')
    .filter((line) => !line.startsWith('```'))
    // The card renders with the transcript's small markdown subset, which has no headings.
    .map((line) => line.replace(/^#{1,6}\s+(.*)$/, '**$1**'))
    .slice(0, 40);
  const picked: string[] = [];
  for (const line of body) {
    if (!line.trim() && !picked.length) {
      continue;
    }
    picked.push(line);
    if (picked.filter((entry) => entry.trim()).length >= lines) {
      break;
    }
  }
  return picked.join('\n');
}
