/** The three chat modes and the small judgements that make them switch at the right moment. */
import { ModelDef, ProviderDef } from '../types';
import { askInstructions, planInstructions } from '../plan/planFormat';

export type ChatMode = 'chat' | 'plan' | 'ask';

export const CHAT_MODES: ChatMode[] = ['chat', 'plan', 'ask'];

/** Permission level a mode forces on a provider: plan and ask read only, chat keeps the chat's own setting. */
export function permissionForMode(mode: ChatMode, def: ProviderDef | undefined): string | undefined {
  return !def || mode === 'chat' ? undefined : 'readonly';
}

/** Extra system instructions for a mode. Chat mode adds none. */
export function instructionsForMode(mode: ChatMode): string | undefined {
  if (mode === 'plan') {
    return planInstructions();
  }
  if (mode === 'ask') {
    return askInstructions();
  }
  return undefined;
}

const EFFORT_RANK = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/**
 * Whether a model is strong enough to write a plan worth executing: a frontier or flagship model,
 * and, when it has effort levels, turned up to high or above.
 */
export function isStrongPlanner(def: ProviderDef | undefined, modelId: string | undefined, effort: string | undefined): boolean {
  if (!def) {
    return false;
  }
  const model: ModelDef | undefined = def.models?.find((m) => m.id === (modelId ?? def.defaultModel));
  const tier = model?.tier ?? guessTier(model?.id ?? modelId ?? '');
  if (tier !== 'frontier' && tier !== 'flagship') {
    return false;
  }
  const levels = model?.efforts ?? def.efforts ?? [];
  if (!levels.length) {
    return true;
  }
  const chosen = effort && levels.includes(effort) ? effort : model?.defaultEffort ?? levels[levels.length - 1];
  return EFFORT_RANK.indexOf(chosen) >= EFFORT_RANK.indexOf('high');
}

/** Rough capability guess for models that carry no tier, e.g. ones fetched from an endpoint. */
function guessTier(id: string): ModelDef['tier'] {
  const name = id.toLowerCase();
  if (/(fable|opus|ultra|max\b)/.test(name)) {
    return 'frontier';
  }
  if (/(haiku|mini|flash|small|lite|nano|fast|turbo)/.test(name)) {
    return 'fast';
  }
  if (/(sonnet|gpt-5|pro|large|k3|grok|deepseek-reasoner|glm-)/.test(name)) {
    return 'flagship';
  }
  return 'balanced';
}

const BIG_WORDS =
  /(implement|implementier|\bbuild\b|\bbaue?\b|refactor|umbau|umschreib|migrat|migrier|architekt|architecture|feature|\bsystem\b|integrat|integrier|redesign|rewrite|neu schreiben|end.to.end|pipeline|test suite|testabdeckung|umsetzen|umsetzung|aufsetzen|erstelle ein|\bcreate an?\b|add support|unterstütz|modus|mode\b)/i;
const STEP_WORDS = /(\bdann\b|\bdanach\b|\bthen\b|\bafterwards\b|\bschritt\b|\bstep\b|\bphase\b|\bzuerst\b|\bfirst\b|\banschließend\b)/gi;
const ACTION_WORDS =
  /(\bmach\w*|\bschreib\w*|\berstell\w*|\berzeug\w*|\bänder\w*|\bfüg\w*\b[^.!?]*\bhinzu\b|\bhinzufüg\w*|\bergänz\w*|\blösch\w*|\bentfern\w*|\bbenenn\w*|\bkorrigier\w*|\brepariere?\b|\bfixe?\b|\bimplementier\w*|\bbaue?\b|\brefactor\w*|\bverschieb\w*|\bupdate\b|\baktualisier\w*|\bwrite\b|\bcreate\b|\badd\b|\bchange\b|\bremove\b|\bdelete\b|\brename\b|\bimplement\b|\bmove\b|\breplace\b|\bersetz\w*)/i;
const QUESTION_WORDS = /^(wie|was|warum|wieso|wo|wer|wann|welche|erklär|erkläre|zeig|kannst du erklären|how|what|why|where|who|which|when|explain|show|does|is|are|can you explain)\b/i;

/** A chat message that is really a project, not a question: worth planning first. */
export function looksLikeBigTask(text: string): boolean {
  const body = text.trim();
  if (body.length < 60 || QUESTION_WORDS.test(body)) {
    return false;
  }
  const words = body.split(/\s+/).length;
  let score = 0;
  if (BIG_WORDS.test(body)) {
    score += 2;
  }
  if (words > 45) {
    score += 2;
  } else if (words > 18) {
    score += 1;
  }
  score += Math.min(2, body.match(STEP_WORDS)?.length ?? 0);
  const bullets = body.match(/^\s*(?:[-*•]|\d+[.)])\s+/gm)?.length ?? 0;
  if (bullets >= 3) {
    score += 2;
  }
  if ((body.match(/@[\w./-]+/g)?.length ?? 0) >= 2) {
    score += 1;
  }
  const verbs = body.match(new RegExp(ACTION_WORDS.source, 'gi'))?.length ?? 0;
  if (verbs >= 3) {
    score += 1;
  }
  return score >= 4;
}

/** An ask-mode message that asks for work rather than for an answer. */
export function looksLikeRequestToAct(text: string): boolean {
  const body = text.trim();
  if (!body || QUESTION_WORDS.test(body)) {
    return false;
  }
  return ACTION_WORDS.test(body);
}
