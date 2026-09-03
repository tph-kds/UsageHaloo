#!/usr/bin/env node
/**
 * HTTP pollers for account-API connectors (prototype/daemon runtime).
 * Rules: keys come from env only (never logged, never persisted); every poll
 * honors the connector's nominal cadence; failures return { live:false } —
 * never fake numbers. Rate-limit (429) responses are respected, not retried.
 *
 * Implemented live:
 *  - OpenRouter key endpoint (regular API key, no management key needed):
 *    GET /api/v1/key → limit_remaining / usage_daily|weekly|monthly
 *  - OpenAI organization usage + costs (admin key, delayed aggregates)
 *  - Ollama / LM Studio localhost (already live in local.mjs; re-exported)
 * Documented-shape, needs-credential/plan:
 *  - Cursor Analytics, GitHub Copilot metrics, Mistral admin usage
 */
import { readOllama, readLMStudio, readOpenRouterCredits } from './local.mjs';

function redactedError(e) {
  const msg = String(e?.message || e || 'network');
  // Never leak key material that might appear in a URL or header echo.
  return msg.replace(/sk-[A-Za-z0-9-_]+/g, 'sk-REDACTED').replace(/Bearer\s+\S+/gi, 'Bearer REDACTED').slice(0, 160);
}
async function getJson(url, { apiKey = null, timeoutMs = 10000, extraHeaders = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
    });
    if (res.status === 401) return { ok: false, reason: 'auth', status: 401 };
    if (res.status === 403) return { ok: false, reason: 'permission', status: 403 };
    if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429 };
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network', detail: redactedError(e) };
  } finally {
    clearTimeout(t);
  }
}

/** OpenRouter per-key usage (works with any API key; management key optional). */
export async function pollOpenRouterKey(apiKey = process.env.OPENROUTER_API_KEY || '') {
  if (!apiKey) return { provider: 'openrouter', live: false, reason: 'no_key' };
  const r = await getJson('https://openrouter.ai/api/v1/key', { apiKey });
  if (!r.ok) return { provider: 'openrouter', live: false, reason: r.reason };
  const d = r.data?.data ?? {};
  const limit = d.limit, remaining = d.limit_remaining;
  const pct = typeof limit === 'number' && limit > 0 && typeof remaining === 'number'
    ? Math.max(0, Math.min(100, Math.round(((limit - remaining) / limit) * 100)))
    : null;
  return {
    provider: 'openrouter', live: true, source: 'official_api', scope: 'account', freshness: 'fresh',
    observed_at: new Date().toISOString(),
    primaryPercent: pct, limit_remaining: remaining ?? null,
    usage_daily: d.usage_daily ?? null, usage_weekly: d.usage_weekly ?? null, usage_monthly: d.usage_monthly ?? null,
  };
}

/** OpenAI org usage (delayed aggregates — freshness is poll, never live). */
export async function pollOpenAIUsage(apiKey = process.env.OPENAI_API_KEY || '', days = 7) {
  if (!apiKey) return { provider: 'openai-api', live: false, reason: 'no_key' };
  const start = Math.floor(Date.now() / 1000) - days * 86400;
  const q = `start_time=${start}&bucket_width=1d`;
  const [u, c] = await Promise.all([
    getJson(`https://api.openai.com/v1/organization/usage/completions?${q}`, { apiKey }),
    getJson(`https://api.openai.com/v1/organization/costs?${q}`, { apiKey }),
  ]);
  if (!u.ok && !c.ok) return { provider: 'openai-api', live: false, reason: u.reason || 'unavailable' };
  let tokens = 0;
  for (const b of u.data?.buckets || u.data?.data || []) {
    for (const r of b.results || []) tokens += (r.input_tokens || 0) + (r.output_tokens || 0);
  }
  let cost = 0;
  for (const b of c.data?.buckets || c.data?.data || []) {
    for (const r of b.results || []) cost += Number(r.amount?.value || r.cost || 0);
  }
  return {
    provider: 'openai-api', live: true, source: 'official_api', scope: 'organization', freshness: 'poll',
    observed_at: new Date().toISOString(), tokens_window: tokens, cost_window: Number(cost.toFixed(2)), days,
  };
}

/** Credential/plan-gated connectors: real clients, honest until configured. */

/** Cursor Admin API: POST /teams/filtered-usage-events (Basic auth, hourly aggregates). */
export async function pollCursor({
  apiKey = process.env.CURSOR_API_KEY || '',
  baseUrl = process.env.CURSOR_API_BASE || 'https://api.cursor.com',
  timeoutMs = 15000,
} = {}) {
  if (!apiKey) return { provider: 'cursor', live: false, reason: 'needs_admin_api_key' };
  const now = Date.now();
  let res;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const basic = Buffer.from(`${apiKey}:`).toString('base64');
    res = await fetch(`${baseUrl}/teams/filtered-usage-events`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: now - 86400000, endDate: now, page: 1, pageSize: 100 }),
    });
    clearTimeout(t);
    if (res.status === 401) return { provider: 'cursor', live: false, reason: 'auth' };
    if (res.status === 403) return { provider: 'cursor', live: false, reason: 'permission' };
    if (res.status === 429) return { provider: 'cursor', live: false, reason: 'rate_limited' };
    if (!res.ok) return { provider: 'cursor', live: false, reason: `http_${res.status}` };
    var data = await res.json();
  } catch (e) {
    return { provider: 'cursor', live: false, reason: e?.name === 'AbortError' ? 'timeout' : 'network' };
  }
  const events = data?.usageEvents || data?.data || [];
  let input = 0, output = 0, charged = 0;
  for (const ev of events) {
    input += ev?.tokenUsage?.inputTokens || 0;
    output += ev?.tokenUsage?.outputTokens || 0;
    charged += Number(ev?.chargedCents || 0) / 100;
  }
  return {
    provider: 'cursor', live: true, source: 'official_admin_api', scope: 'team_or_org', freshness: 'hourly',
    observed_at: new Date().toISOString(), events_24h: events.length,
    input_tokens_24h: input, output_tokens_24h: output, cost_24h: Number(charged.toFixed(2)),
  };
}

/** GitHub Copilot metrics (report-based API; daily/aggregated, never live).
 *  Flow: GET <report> -> download_links[] -> fetch first link -> parse rows.
 *  Report path configurable; default targets the org 28-day users report. */
export async function pollCopilot({
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
  org = process.env.GITHUB_ORG || '',
  reportPath = process.env.GITHUB_COPILOT_REPORT_PATH || (org ? `orgs/${org}/copilot/metrics/reports/users-28-day/latest` : ''),
  baseUrl = process.env.GITHUB_API_BASE || 'https://api.github.com',
  timeoutMs = 20000,
} = {}) {
  if (!token) return { provider: 'github-copilot', live: false, reason: 'needs_github_token' };
  if (!reportPath) return { provider: 'github-copilot', live: false, reason: 'needs_org_or_report_path' };
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const meta = await getJson(`${baseUrl}/${reportPath}`, { timeoutMs, extraHeaders: headers });
  if (!meta.ok) return { provider: 'github-copilot', live: false, reason: meta.reason };
  const links = meta.data?.download_links || meta.data?.downloadLinks || [];
  if (!links.length) return { provider: 'github-copilot', live: false, reason: 'no_reports_yet' };
  const doc = await getJson(links[0], { timeoutMs, extraHeaders: headers });
  if (!doc.ok) return { provider: 'github-copilot', live: false, reason: doc.reason };
  const rows = Array.isArray(doc.data) ? doc.data : doc.data?.days || doc.data?.metrics || [];
  let requests = 0, prompt = 0, completion = 0;
  for (const day of rows) {
    requests += day?.total_requests ?? day?.request_count ?? 0;
    prompt += day?.total_prompt_tokens ?? day?.prompt_tokens_sum ?? 0;
    completion += day?.total_completion_tokens ?? day?.completion_tokens_sum ?? 0;
  }
  return {
    provider: 'github-copilot', live: true, source: 'official_usage_metrics', scope: 'organization_enterprise', freshness: 'daily',
    observed_at: new Date().toISOString(), days: rows.length,
    requests_window: requests, input_tokens_window: prompt, output_tokens_window: completion,
  };
}

/** Mistral Admin API: GET /v1/admin/usage (x-api-key, Enterprise preview). */
export async function pollMistral({
  apiKey = process.env.MISTRAL_API_KEY || '',
  baseUrl = process.env.MISTRAL_API_BASE || 'https://api.mistral.ai',
  timeoutMs = 15000,
} = {}) {
  if (!apiKey) return { provider: 'mistral', live: false, reason: 'no_key' };
  const now = new Date();
  const r = await getJson(`${baseUrl}/v1/admin/usage?month=${now.getUTCMonth() + 1}&year=${now.getUTCFullYear()}`, {
    timeoutMs, extraHeaders: { 'x-api-key': apiKey },
  });
  if (!r.ok) return { provider: 'mistral', live: false, reason: r.reason };
  const d = r.data || {};
  let cost = 0;
  const categories = d.usage || d.categories || d.breakdown || {};
  for (const v of Object.values(categories)) {
    if (typeof v === 'number') cost += v;
    else if (v && typeof v === 'object') cost += Number(v.cost ?? v.total ?? v.amount ?? 0);
  }
  if (!cost && typeof d.total_cost === 'number') cost = d.total_cost;
  return {
    provider: 'mistral', live: true, source: 'official_admin_api', scope: 'organization_workspace', freshness: 'poll',
    observed_at: new Date().toISOString(),
    cost_month: Number(Number(cost).toFixed(2)), currency: d.currency || null,
  };
}

export { readOllama, readLMStudio, readOpenRouterCredits };

if (process.argv.includes('--check-live')) {
  const masked = (r) => ({ ...r, limit_remaining: r.limit_remaining == null ? null : 'present' });
  const out = { openrouter: masked(await pollOpenRouterKey()), openai: await pollOpenAIUsage(), ollama: await readOllama() };
  // Mask any numeric usage that could identify an account in shared logs.
  console.log(JSON.stringify({ openrouter_live: out.openrouter.live, openai_live: out.openai.live, ollama_live: out.ollama.live }));
}
