import { ProviderDef } from '../types';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const OPENAI_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

/**
 * A ready-made API connector that only needs a key. Templates ship switched off; the model
 * list is a starting point and the settings modal refreshes it from the endpoint's /models.
 */
function template(def: Omit<ProviderDef, 'kind'>): ProviderDef {
  return { api: 'openai', enabled: false, usage: { kind: 'none' }, models: [], ...def, kind: 'http' };
}

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
        label: 'Opus 5.5',
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
      { id: 'haiku', label: 'Haiku 4.5', description: 'Quickest for short answers', efforts: [], tier: 'fast', contextWindow: 200_000 }
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
    efforts: OPENAI_EFFORTS,
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', tier: 'flagship' },
      { id: 'gpt-5.5', label: 'GPT-5.5', tier: 'balanced' }
    ],
    usage: { kind: 'openai-admin' }
  },
  {
    id: 'zai',
    label: 'Z.ai GLM (Claude Code)',
    kind: 'cli',
    enabled: false,
    description: 'claude-CLI gegen den Anthropic-Endpoint von Z.ai (GLM Coding Plan).',
    command: 'claude',
    protocol: 'claude-stream-json',
    apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN',
    // Setup from docs.z.ai/devpack/tool/claude: the CLI's opus/sonnet/haiku aliases and
    // background calls all resolve to GLM models.
    env: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-5.3-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'glm-5.3',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      API_TIMEOUT_MS: '3000000'
    },
    defaultModel: 'glm-5.3',
    supportsThinking: true,
    // The claude CLI maps --effort onto the endpoint's reasoning intensity; GLM takes all levels.
    efforts: CLAUDE_EFFORTS,
    models: [
      { id: 'glm-5.3', label: 'GLM-5.3', description: 'Z.ai flagship for agentic coding', inputs: [], tier: 'flagship', defaultEffort: 'high' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', description: 'Fast, multimodal', tier: 'fast', defaultEffort: 'medium' }
    ],
    usage: { kind: 'zai-coding-plan' }
  },

  // ---------- API connectors: drop in a key, then refresh the model list ----------

  // docs.z.ai: the Coding Plan speaks both protocols; the Anthropic one is the drop-in path.
  template({
    id: 'zai-api',
    label: 'Z.ai (Anthropic API)',
    api: 'anthropic',
    baseUrl: 'https://api.z.ai/api/anthropic/v1',
    defaultModel: 'glm-5.3',
    supportsThinking: true,
    maxTokens: 8192,
    models: [
      { id: 'glm-5.3', label: 'GLM-5.3', tier: 'flagship', contextWindow: 200_000 },
      { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', tier: 'fast', contextWindow: 200_000 }
    ],
    usage: { kind: 'zai-coding-plan' }
  }),
  template({
    id: 'zai-coding',
    label: 'Z.ai Coding Plan',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    defaultModel: 'glm-5.3',
    models: [
      { id: 'glm-5.3', label: 'GLM-5.3', tier: 'flagship' },
      { id: 'glm-5.3-flash', label: 'GLM-5.3-Flash', tier: 'fast' }
    ],
    usage: { kind: 'zai-coding-plan' }
  }),
  template({
    id: 'openai-api',
    label: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-sol',
    efforts: OPENAI_EFFORTS,
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', tier: 'flagship' },
      { id: 'gpt-5.5', label: 'GPT-5.5', tier: 'balanced' }
    ],
    usage: { kind: 'openai-admin' }
  }),
  {
    id: 'anthropic-api',
    label: 'Anthropic API',
    kind: 'http',
    enabled: false,
    description: 'Direkte Messages-API mit eigenem API-Key.',
    baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic',
    defaultModel: 'claude-opus-5-5',
    supportsThinking: true,
    maxTokens: 8192,
    models: [
      { id: 'claude-opus-5-5', label: 'Opus 5.5', tier: 'flagship', contextWindow: 200_000 },
      { id: 'claude-sonnet-5', label: 'Sonnet 5', tier: 'balanced', contextWindow: 200_000 },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', tier: 'fast', contextWindow: 200_000 }
    ],
    usage: { kind: 'anthropic-admin' }
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'http',
    enabled: false,
    description: 'OpenAI-kompatible API von MiniMax.',
    baseUrl: 'https://api.minimax.io/v1',
    api: 'openai',
    defaultModel: 'MiniMax-M2',
    maxTokens: 8192,
    models: [{ id: 'MiniMax-M2', label: 'MiniMax M2', pricing: { input: 0.3, output: 1.2 } }],
    usage: { kind: 'minimax-token-plan' }
  },
  // Router: hundreds of models behind one key, so the list starts empty and is fetched.
  template({ id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' }),
  template({
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', tier: 'balanced' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', tier: 'flagship' }
    ]
  }),
  template({
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k3',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', tier: 'flagship', contextWindow: 1_000_000 },
      { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', tier: 'balanced' }
    ]
  }),
  // api.moonshot.ai also speaks the Anthropic protocol under /anthropic.
  template({
    id: 'moonshot-anthropic',
    label: 'Moonshot (Anthropic API)',
    api: 'anthropic',
    baseUrl: 'https://api.moonshot.ai/anthropic/v1',
    defaultModel: 'kimi-k3',
    maxTokens: 8192,
    models: [{ id: 'kimi-k3', label: 'Kimi K3', tier: 'flagship', contextWindow: 1_000_000 }]
  }),
  template({
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    models: [
      { id: 'grok-4.7', label: 'Grok 4.7', tier: 'flagship' },
      { id: 'grok-4.6', label: 'Grok 4.6', tier: 'balanced' }
    ]
  }),
  template({
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large', tier: 'flagship' },
      { id: 'mistral-small-latest', label: 'Mistral Small', tier: 'fast' },
      { id: 'codestral-latest', label: 'Codestral', tier: 'balanced' }
    ]
  }),
  template({
    id: 'gemini',
    label: 'Google Gemini',
    // The OpenAI-compatible surface of the Gemini API (ai.google.dev/gemini-api/docs/openai).
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro',
    models: [
      // The OpenAI-compatible surface documents `reasoning_effort` for the thinking models.
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', tier: 'flagship', efforts: ['low', 'medium', 'high'], defaultEffort: 'high' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', tier: 'fast' }
    ]
  }),
  template({
    id: 'qwen',
    label: 'Qwen (DashScope)',
    // Alibaba Model Studio, international region; mainland China is dashscope.aliyuncs.com.
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-max',
    models: [
      { id: 'qwen-max', label: 'Qwen Max', tier: 'flagship' },
      { id: 'qwen-plus', label: 'Qwen Plus', tier: 'balanced' }
    ]
  }),
  template({
    id: 'perplexity',
    label: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    defaultModel: 'sonar-pro',
    models: [
      { id: 'sonar-pro', label: 'Sonar Pro', tier: 'flagship' },
      { id: 'sonar', label: 'Sonar', tier: 'balanced' },
      { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', tier: 'flagship' }
    ]
  }),
  template({ id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' }),
  template({ id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' }),
  template({ id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' }),
  template({ id: 'fireworks', label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' }),
  template({ id: 'deepinfra', label: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai' }),
  template({ id: 'nebius', label: 'Nebius Token Factory', baseUrl: 'https://api.tokenfactory.nebius.com/v1' }),
  template({ id: 'novita', label: 'Novita AI', baseUrl: 'https://api.novita.ai/openai/v1' }),
  template({ id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.com/v1' }),
  // Model ids are namespaced by publisher; the catalogue lives outside /models, so seed a few.
  template({
    id: 'github-models',
    label: 'GitHub Models',
    baseUrl: 'https://models.github.ai/inference',
    defaultModel: 'openai/gpt-4.1',
    models: [
      { id: 'openai/gpt-4.1', label: 'GPT-4.1', tier: 'balanced' },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini', tier: 'fast' }
    ]
  }),
  template({ id: 'vercel-gateway', label: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1' }),
  template({
    id: 'ollama',
    label: 'Ollama (lokal)',
    description: 'Lokaler Ollama-Server. Der Key wird nicht geprüft, ein Platzhalter genügt.',
    baseUrl: 'http://localhost:11434/v1'
  }),
  template({
    id: 'lmstudio',
    label: 'LM Studio (lokal)',
    description: 'Lokaler LM-Studio-Server. Der Key wird nicht geprüft, ein Platzhalter genügt.',
    baseUrl: 'http://localhost:1234/v1'
  })
];
