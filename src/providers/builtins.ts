import { ProviderDef } from '../types';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

/**
 * Providers that ship with the extension. Users override any of these, or add new
 * ones, through the `polyagent.providers` setting (merged by `id`).
 */
export const BUILTIN_PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    kind: 'cli',
    description: 'Lokale claude-CLI, nutzt das bestehende Abo oder ANTHROPIC_API_KEY.',
    command: 'claude',
    protocol: 'claude-stream-json',
    defaultModel: 'opus',
    supportsThinking: true,
    efforts: CLAUDE_EFFORTS,
    models: [
      {
        id: 'opus',
        label: 'Opus 5',
        description: 'Strong all-rounder for complex work',
        defaultEffort: 'high',
        tier: 'flagship',
        contextWindow: 200_000
      },
      {
        id: 'sonnet',
        label: 'Sonnet 5',
        description: 'Fast and economical for routine work',
        defaultEffort: 'high',
        tier: 'balanced',
        contextWindow: 200_000
      },
      {
        id: 'claude-fable-5-1',
        label: 'Fable 5.1',
        description: 'Maximum capability for the hardest tasks · needs usage credits',
        defaultEffort: 'high',
        tier: 'frontier',
        contextWindow: 200_000
      },
      {
        id: 'haiku',
        label: 'Haiku 4.5',
        description: 'Quickest for short answers',
        defaultEffort: 'high',
        tier: 'fast',
        contextWindow: 200_000
      },
    ],
    usage: { kind: 'anthropic-admin' }
  },
  {
    id: 'codex',
    label: 'OpenAI',
    kind: 'cli',
    description: 'Lokale codex-CLI (codex exec --json).',
    command: 'codex',
    protocol: 'codex-jsonl',
    modelsFrom: 'codex-cache',
    defaultModel: 'gpt-5.6-sol',
    supportsThinking: true,
    efforts: CODEX_EFFORTS,
    models: [
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6-Sol',
        tier: 'flagship'
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        tier: 'balanced'
      }
    ],
    usage: { kind: 'openai-admin' }
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'http',
    description: 'OpenAI-kompatible API von MiniMax.',
    baseUrl: 'https://api.minimax.io/v1',
    api: 'openai',
    defaultModel: 'MiniMax-M2',
    maxTokens: 8192,
    models: [
      {
        id: 'MiniMax-M2',
        label: 'MiniMax M2',
        pricing: { input: 0.3, output: 1.2 }
      }
    ],
    usage: { kind: 'minimax-token-plan' }
  },
  {
    id: 'anthropic-api',
    label: 'Anthropic API',
    kind: 'http',
    description: 'Direkte Messages-API mit eigenem API-Key.',
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic',
    defaultModel: 'claude-opus-5',
    supportsThinking: true,
    maxTokens: 8192,
    models: [
      {
        id: 'claude-opus-5',
        label: 'Opus 5',
        tier: 'flagship',
        contextWindow: 200_000
      },
      {
        id: 'claude-sonnet-5',
        label: 'Sonnet 5',
        tier: 'balanced',
        contextWindow: 200_000
      },
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Haiku 4.5',
        tier: 'fast',
        contextWindow: 200_000
      }
    ],
    usage: { kind: 'anthropic-admin' }
  }
];
