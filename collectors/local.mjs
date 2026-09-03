#!/usr/bin/env node
/**
 * UsageHalo local provider detector + live readers.
 * Zero-dependency, local-first, privacy-safe.
 *
 * Rules (non-negotiable, from docs/09_SECURITY_PRIVACY.md):
 * - Never read secret values. Only check presence (file exists / env present).
 * - Never collect prompts, completions, message bodies.
 * - Never scrape browser cookies.
 * - Prefer: official status-line / app-server / OTel / official HTTPS APIs / localhost metadata.
 * - Every reading carries provenance: { source, scope, freshness, observed_at, live:boolean }.
 *
 * Cross-platform: Windows (%APPDATA%, %USERPROFILE%), macOS (~/Library), Linux (~/.config).
 * Used by prototype/server.mjs and (later) the Rust sidecar via JSON stdout:
 *   node collectors/local.mjs --json
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const HOME = os.homedir();
const PLATFORM = os.platform(); // win32 | darwin | linux

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJsonSafe(p, maxBytes = 64 * 1024) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > maxBytes) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}
function envPresent(...names) { return names.some(n => (process.env[n] ?? '').trim().length > 0); }

function localhostGet(port, reqPath, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.length > 256 * 1024) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body: buf.slice(0, 256 * 1024) }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    setTimeout(() => { try { req.destroy(); } catch {} resolve(null); }, timeoutMs + 200);
  });
}

// ---------------------------------------------------------------- detection
export function detectProviders() {
  const codexHome = process.env.CODEX_HOME || path.join(HOME, '.codex');
  const claudeSpoolNew = path.join(HOME, '.usagehalo', 'inbox', 'claude-code.jsonl');
  const claudeSpoolLegacy = path.join(HOME, '.viusagever', 'inbox', 'claude-code.jsonl');
  const out = [];

  const push = (id, installed, configured, evidence, hint) => out.push({
    id, installed, configured, evidence, hint,
    platform: PLATFORM, observed_at: new Date().toISOString(),
  });

  // Claude Code: CLI config + spool written by the status-line bridge.
  push('claude-code',
    exists(path.join(HOME, '.claude.json')) || exists(path.join(HOME, '.claude', 'settings.json')) || exists(claudeSpoolNew) || exists(claudeSpoolLegacy),
    exists(claudeSpoolNew) || exists(claudeSpoolLegacy),
    exists(claudeSpoolNew) ? '~/.usagehalo/inbox/claude-code.jsonl' : (exists(claudeSpoolLegacy) ? '~/.viusagever/inbox/claude-code.jsonl' : '~/.claude.json'),
    'Add the UsageHalo bridge to your Claude Code statusLine to stream 5h/7d quota + context.');

  // Codex: auth file presence only (never read the token), app-server is the live path.
  const codexAuth = path.join(codexHome, 'auth.json');
  push('codex', exists(codexHome) || exists(codexAuth),
    exists(codexAuth),
    'CODE_HOME/auth.json (presence only)',
    'Sign in to Codex; UsageHalo reads rate limits via the official app-server protocol.');

  // Gemini CLI: settings + OTel spool dir.
  const geminiSettings = path.join(HOME, '.gemini', 'settings.json');
  push('gemini-cli', exists(path.join(HOME, '.gemini')) || envPresent('GEMINI_API_KEY', 'GOOGLE_API_KEY'),
    exists(geminiSettings) || envPresent('GEMINI_API_KEY', 'GOOGLE_API_KEY'),
    '~/.gemini/settings.json',
    'Enable Gemini CLI telemetry (OTLP) pointing at the UsageHalo receiver.');

  // API providers: env / keychain presence only.
  push('openai-api', envPresent('OPENAI_API_KEY'), envPresent('OPENAI_API_KEY'), 'env: OPENAI_API_KEY', 'Set OPENAI_API_KEY (org admin) for organization usage + costs.');
  push('anthropic-api', envPresent('ANTHROPIC_API_KEY'), envPresent('ANTHROPIC_API_KEY'), 'env: ANTHROPIC_API_KEY', 'Set ANTHROPIC_API_KEY for instrumented + admin usage where authorized.');
  push('openrouter', envPresent('OPENROUTER_API_KEY'), envPresent('OPENROUTER_API_KEY'), 'env: OPENROUTER_API_KEY', 'Use a management key for credits + a regular key for request usage.');

  // IDE / subscription products: config-dir presence (no token reads).
  const cursorCfg = PLATFORM === 'win32'
    ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'Cursor')
    : PLATFORM === 'darwin' ? path.join(HOME, 'Library', 'Application Support', 'Cursor') : path.join(HOME, '.config', 'Cursor');
  push('cursor', exists(cursorCfg), false, 'Cursor config dir', 'Connect via Cursor Admin/Analytics API (Team/Enterprise) or Enterprise OTel export.');
  push('github-copilot', exists(path.join(HOME, '.config', 'github-copilot')) || envPresent('GITHUB_TOKEN', 'GH_TOKEN'), envPresent('GITHUB_TOKEN', 'GH_TOKEN'), 'gh auth / GITHUB_TOKEN presence', 'Uses official Copilot usage-metrics APIs (daily/aggregated, not realtime).');
  push('zai', envPresent('ZAI_API_KEY', 'Z_AI_API_KEY'), envPresent('ZAI_API_KEY', 'Z_AI_API_KEY'), 'env: ZAI_API_KEY', 'Beta: official usage statistics only, no cookie scraping.');
  push('perplexity', envPresent('PERPLEXITY_API_KEY', 'PPLX_API_KEY'), envPresent('PERPLEXITY_API_KEY', 'PPLX_API_KEY'), 'env: PERPLEXITY_API_KEY', 'Request instrumentation reads response `usage` only.');
  push('mistral', envPresent('MISTRAL_API_KEY'), envPresent('MISTRAL_API_KEY'), 'env: MISTRAL_API_KEY', 'Admin usage/analytics for eligible plans.');
  push('windsurf', false, false, 'Enterprise API', 'Enterprise API where your plan exposes it.');
  push('xai', envPresent('XAI_API_KEY'), envPresent('XAI_API_KEY'), 'env: XAI_API_KEY', 'Response usage + console sources where available.');
  for (const [id, env] of [['deepseek', 'DEEPSEEK_API_KEY'], ['groq', 'GROQ_API_KEY'], ['together', 'TOGETHER_API_KEY'], ['fireworks', 'FIREWORKS_API_KEY'], ['cerebras', 'CEREBRAS_API_KEY']]) {
    push(id, envPresent(env), envPresent(env), `env: ${env}`, 'OpenAI-compatible: opt-in request instrumentation only.');
  }
  push('ollama', true, false, 'http://localhost:11434', 'Local model metadata; zero cost, device scope.');
  push('lm-studio', true, false, 'http://localhost:1234', 'Local API response instrumentation.');
  push('litellm', envPresent('LITELLM_MASTER_KEY') || exists(path.join(HOME, '.litellm')), envPresent('LITELLM_MASTER_KEY'), 'LiteLLM proxy telemetry', 'Proxy telemetry / callbacks.');
  push('aws-bedrock', envPresent('AWS_PROFILE', 'AWS_ACCESS_KEY_ID'), envPresent('AWS_ACCESS_KEY_ID'), 'AWS credentials presence', 'Cloud usage/billing + instrumentation.');
  push('azure-openai', envPresent('AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'), envPresent('AZURE_OPENAI_API_KEY'), 'Azure env presence', 'Azure metrics/cost + instrumentation.');
  push('vertex-ai', envPresent('GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS'), envPresent('GOOGLE_APPLICATION_CREDENTIALS'), 'GCP env presence', 'Cloud monitoring/billing + instrumentation.');

  return out;
}

// ---------------------------------------------------------------- live readers
export function readClaudeSpool() {
  for (const p of [path.join(HOME, '.usagehalo', 'inbox', 'claude-code.jsonl'), path.join(HOME, '.viusagever', 'inbox', 'claude-code.jsonl')]) {
    try {
      const data = fs.readFileSync(p, 'utf8').trim();
      if (!data) continue;
      const last = JSON.parse(data.split(/\r?\n/).at(-1));
      const five = last?.rate_limits?.five_hour?.used_percentage;
      const seven = last?.rate_limits?.seven_day?.used_percentage;
      return {
        provider: 'claude-code', live: true, source: 'claude_code_statusline', scope: 'account',
        freshness: 'live', observed_at: new Date().toISOString(),
        primaryPercent: typeof five === 'number' ? Math.round(five) : null,
        secondaryPercent: typeof seven === 'number' ? Math.round(seven) : null,
        model: last?.model?.display_name || last?.model?.id || null,
        cost: typeof last?.cost?.total_cost_usd === 'number' ? last.cost.total_cost_usd : null,
        resets_at_5h: last?.rate_limits?.five_hour?.resets_at ?? null,
      };
    } catch { /* keep trying */ }
  }
  return { provider: 'claude-code', live: false };
}

export async function readOllama() {
  const r = await localhostGet(11434, '/api/ps');
  if (!r || r.status !== 200) return { provider: 'ollama', live: false };
  try {
    const j = JSON.parse(r.body);
    const models = j?.models ?? [];
    return {
      provider: 'ollama', live: true, source: 'local_response_metadata', scope: 'device',
      freshness: 'live', observed_at: new Date().toISOString(),
      models_loaded: models.map((m) => m?.name).filter(Boolean).slice(0, 12),
      count: models.length,
    };
  } catch { return { provider: 'ollama', live: false }; }
}

export async function readLMStudio() {
  const r = await localhostGet(1234, '/v1/models');
  if (!r || r.status !== 200) return { provider: 'lm-studio', live: false };
  try {
    const j = JSON.parse(r.body);
    const ids = (j?.data ?? []).map((m) => m?.id).filter(Boolean).slice(0, 12);
    return { provider: 'lm-studio', live: true, source: 'local_response_metadata', scope: 'device', freshness: 'live', observed_at: new Date().toISOString(), models_loaded: ids, count: ids.length };
  } catch { return { provider: 'lm-studio', live: false }; }
}

export async function readOpenRouterCredits(apiKey) {
  if (!apiKey) return { provider: 'openrouter', live: false, reason: 'no_key' };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return { provider: 'openrouter', live: false, reason: `http_${res.status}` };
    const j = await res.json();
    const total = Number(j?.data?.total_credits);
    const used = Number(j?.data?.total_usage);
    if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return { provider: 'openrouter', live: false, reason: 'bad_payload' };
    return {
      provider: 'openrouter', live: true, source: 'official_api', scope: 'account',
      freshness: 'fresh', observed_at: new Date().toISOString(),
      primaryPercent: Math.max(0, Math.min(100, Math.round((used / total) * 100))),
      total_credits: total, total_usage: used,
    };
  } catch (e) { return { provider: 'openrouter', live: false, reason: 'network' }; }
}

export async function collectLive() {
  const [ollama, lmstudio] = await Promise.all([readOllama(), readLMStudio()]);
  const claude = readClaudeSpool();
  const openrouter = await readOpenRouterCredits(process.env.OPENROUTER_API_KEY || '');
  return { 'claude-code': claude, ollama, 'lm-studio': lmstudio, openrouter };
}

if (process.argv.includes('--json')) {
  const live = await collectLive().catch(() => ({}));
  console.log(JSON.stringify({ platform: PLATFORM, detected: detectProviders(), live }, null, 2));
}
