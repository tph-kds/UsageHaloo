import type { ProviderDefinition } from './types';

// Provider catalog: definition only (§6). A catalog entry must never
// automatically create a connection or observations.
export const PROVIDER_CATALOG: ProviderDefinition[] = [
  {
    id: 'codex', name: 'Codex', vendor: 'OpenAI', monogram: 'X', accent: '#3fc3ae',
    group: 'Coding tools', maturity: 'stable', docs: 'Codex app-server protocol over stdio. Never touches auth files.',
    icon: '/assets/providers/codex/codex.svg',
    methods: [
      { id: 'cli_bridge', label: 'Codex app-server bridge', detail: 'Official app-server protocol over stdio', capabilities: ['tokens', 'requests', 'quota windows', 'models'] },
      { id: 'api_key', label: 'OpenAI API instrumentation', detail: 'Opt-in response telemetry', capabilities: ['tokens', 'requests', 'models'], quotaNote: 'Quota is provider dependent' },
    ],
  },
  {
    id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', monogram: 'C', accent: '#e37d57',
    group: 'Coding tools', maturity: 'stable', docs: 'Sanitized status-line payload. Prompts are never stored.',
    icon: '/assets/providers/claude-code/claude-code.svg',
    methods: [
      { id: 'cli_bridge', label: 'Status-line bridge', detail: 'Sanitized local session payload', capabilities: ['quota windows', 'session cost', 'models'], quotaNote: 'Session cost is not a calendar-day total' },
    ],
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', vendor: 'Google', monogram: 'G', accent: '#7c9dff',
    group: 'Coding tools', maturity: 'stable', docs: 'OTLP telemetry receiver. Prompts and responses are NOT collected.',
    icon: '/assets/providers/gemini-cli/gemini-cli.svg',
    methods: [
      { id: 'otlp', label: 'Gemini CLI OTLP telemetry', detail: 'Local telemetry receiver', capabilities: ['tokens', 'requests', 'models', 'tool calls'], quotaNote: 'Quota is provider dependent' },
      { id: 'api_key', label: 'Gemini API instrumentation', detail: 'Opt-in response telemetry', capabilities: ['tokens', 'requests', 'models'] },
    ],
  },
  {
    id: 'cursor', name: 'Cursor', vendor: 'Anysphere', monogram: 'Cu', accent: '#e8eaee',
    group: 'Coding tools', maturity: 'beta', docs: 'Admin API or OTLP. Model vendor stays distinct from billing owner.',
    icon: '/assets/providers/cursor/cursor.svg',
    methods: [
      { id: 'admin_api', label: 'Cursor Admin API', detail: 'Team usage via admin token', capabilities: ['tokens', 'requests', 'included usage'] },
      { id: 'otlp', label: 'OTLP telemetry', detail: 'Enterprise live telemetry', capabilities: ['tokens', 'requests'] },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', monogram: 'R', accent: '#b998ff',
    group: 'API providers', maturity: 'stable', docs: 'Official credits API. Credits, usage and model cost.',
    icon: '/assets/providers/openrouter/openrouter.svg',
    methods: [
      { id: 'api_key', label: 'OpenRouter API key', detail: 'Credits + usage endpoints', capabilities: ['credits', 'usage', 'model cost'] },
    ],
  },
  {
    id: 'openai-api', name: 'OpenAI API', vendor: 'OpenAI', monogram: 'O', accent: '#60d6a7',
    group: 'API providers', maturity: 'stable', docs: 'Official usage API. Organization scope.',
    icon: '/assets/providers/openai/openai-api.svg',
    methods: [
      { id: 'api_key', label: 'OpenAI API key', detail: 'Usage + budget endpoints', capabilities: ['tokens', 'cost', 'requests'] },
    ],
  },
  {
    id: 'anthropic-api', name: 'Anthropic API', vendor: 'Anthropic', monogram: 'A', accent: '#d8a27a',
    group: 'API providers', maturity: 'stable', docs: 'Official API or instrumented traffic.',
    icon: '/assets/providers/anthropic/anthropic-api.svg',
    methods: [
      { id: 'api_key', label: 'Anthropic API key', detail: 'Usage endpoints where available', capabilities: ['tokens', 'cost'] },
    ],
  },
  {
    id: 'mistral', name: 'Mistral', vendor: 'Mistral AI', monogram: 'M', accent: '#ffb33e',
    group: 'API providers', maturity: 'beta', docs: 'Admin API, organization scope.',
    icon: '/assets/providers/mistral/mistral.svg',
    methods: [
      { id: 'admin_api', label: 'Mistral Admin API', detail: 'Organization spend', capabilities: ['spend', 'tokens'] },
    ],
  },
  {
    id: 'ollama', name: 'Ollama', vendor: 'Ollama', monogram: 'Ol', accent: '#d9d9d9',
    group: 'Local', maturity: 'stable', docs: 'Local daemon. Device scope only, no cost.',
    icon: '/assets/providers/ollama/ollama.svg',
    methods: [
      { id: 'local_protocol', label: 'Local daemon protocol', detail: 'Localhost model list + response metadata', capabilities: ['tokens', 'requests', 'models'], quotaNote: 'Local models expose no quota or cost' },
    ],
  },
  {
    id: 'lm-studio', name: 'LM Studio', vendor: 'LM Studio', monogram: 'LM', accent: '#a58bff',
    group: 'Local', maturity: 'stable', docs: 'Local daemon. Device scope only, no cost.',
    icon: '/assets/providers/lmStudio/lm-studio.svg',
    methods: [
      { id: 'local_protocol', label: 'Local daemon protocol', detail: 'Localhost model list + response metadata', capabilities: ['tokens', 'requests', 'models'], quotaNote: 'Local models expose no quota or cost' },
    ],
  },
  {
    id: 'github-copilot', name: 'GitHub Copilot', vendor: 'GitHub', monogram: 'Gh', accent: '#9a7bff',
    group: 'API providers', maturity: 'beta', docs: 'Organization usage metrics. Daily freshness.',
    icon: '/assets/providers/github-copilot/github-copilot.svg',
    methods: [
      { id: 'oauth', label: 'GitHub account', detail: 'Organization usage metrics', capabilities: ['requests', 'active users'], quotaNote: 'Daily freshness' },
    ],
  },
  {
    id: 'perplexity', name: 'Perplexity', vendor: 'Perplexity', monogram: 'P', accent: '#47c7c4',
    group: 'API providers', maturity: 'beta', docs: 'Response instrumentation only. Instrumented traffic scope.',
    icon: '/assets/providers/perplexity/perplexity.svg',
    methods: [
      { id: 'api_key', label: 'Response instrumentation', detail: 'Opt-in telemetry, instrumented traffic only', capabilities: ['tokens', 'requests'] },
    ],
  },
];

export const catalogById = (id: string) => PROVIDER_CATALOG.find((p) => p.id === id);
