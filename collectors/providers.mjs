#!/usr/bin/env node
/**
 * Provider response normalizers (P1/P2 expansion).
 * Each normalizer maps provider-native fields → canonical telemetry event
 * while preserving provenance. Never invents totals; unknown → null.
 * Pure functions — fixture-tested in tests/test_workflows.py via node.
 */

// Perplexity Agent API: response.usage { input_tokens?, output_tokens?, total_tokens?, cost? }
export function normalizePerplexityResponse(body, observedAt = null) {
  const u = body?.usage ?? {};
  const input = numOrNull(u.input_tokens ?? u.prompt_tokens);
  const output = numOrNull(u.output_tokens ?? u.completion_tokens);
  return {
    provider: 'perplexity', billing_owner: 'perplexity', model_provider: 'perplexity',
    model: typeof body?.model === 'string' ? body.model : null,
    input_tokens: input, output_tokens: output,
    total_tokens: numOrNull(u.total_tokens ?? (input != null && output != null ? input + output : null)),
    provider_cost: numOrNull(u.cost?.total_cost ?? u.total_cost),
    request_id: typeof body?.id === 'string' ? body.id : null,
    authority: 'instrumented_response', scope: 'instrumented_traffic_only', freshness: 'live',
    observed_at: observedAt || new Date().toISOString(),
  };
}
// Generic OpenAI-compatible: choices + usage { prompt_tokens, completion_tokens, total_tokens }
export function normalizeOpenAICompatible(body, providerId, observedAt = null) {
  const u = body?.usage ?? {};
  return {
    provider: providerId, billing_owner: providerId, model_provider: null,
    model: typeof body?.model === 'string' ? body.model : null,
    input_tokens: numOrNull(u.prompt_tokens), output_tokens: numOrNull(u.completion_tokens),
    total_tokens: numOrNull(u.total_tokens),
    request_id: typeof body?.id === 'string' ? body.id : null,
    authority: 'instrumented_response', scope: 'instrumented_traffic_only', freshness: 'live',
    observed_at: observedAt || new Date().toISOString(),
  };
}
// Ollama generate/chat response metadata (local, zero cost).
export function normalizeOllamaResponse(body, observedAt = null) {
  return {
    provider: 'ollama', billing_owner: 'ollama', model_provider: 'local',
    model: typeof body?.model === 'string' ? body.model : null,
    input_tokens: numOrNull(body?.prompt_eval_count), output_tokens: numOrNull(body?.eval_count),
    total_tokens: addNull(body?.prompt_eval_count, body?.eval_count),
    request_id: null, authority: 'instrumented_response', scope: 'device', freshness: 'live',
    observed_at: observedAt || new Date().toISOString(),
  };
}
// Cursor Analytics API event (Team/Enterprise): token usage + chargedCents (billing truth).
export function normalizeCursorEvent(ev, observedAt = null) {
  return {
    provider: 'cursor', billing_owner: 'cursor', model_provider: null,
    model: typeof ev?.model === 'string' ? ev.model : null,
    input_tokens: numOrNull(ev?.inputTokens ?? ev?.input_tokens),
    output_tokens: numOrNull(ev?.outputTokens ?? ev?.output_tokens),
    total_tokens: numOrNull(ev?.totalTokens ?? ev?.total_tokens),
    provider_cost: ev?.chargedCents != null ? Number(ev.chargedCents) / 100 : null,
    request_id: typeof ev?.id === 'string' ? ev.id : null,
    authority: 'provider_billing', scope: 'team_or_org', freshness: 'hourly',
    observed_at: observedAt || ev?.timestamp || new Date().toISOString(),
  };
}
// GitHub Copilot metrics (daily/aggregated — never live).
export function normalizeCopilotDay(day, observedAt = null) {
  return {
    provider: 'github-copilot', billing_owner: 'github-copilot',
    date: day?.date || null,
    requests: numOrNull(day?.total_requests ?? day?.requests),
    input_tokens: numOrNull(day?.total_prompt_tokens),
    output_tokens: numOrNull(day?.total_completion_tokens),
    authority: 'provider_billing', scope: 'organization_enterprise', freshness: 'daily',
    observed_at: observedAt || new Date().toISOString(),
  };
}
// Codex app-server rate-limit result → quota snapshots (primary/secondary, never fake %).
// Accepts every documented shape: flat {primary, secondary}, {rateLimits:{...}},
// or {rateLimitsByLimitId:{<id>:{primary, secondary}}} (multi-bucket snapshots).
// Unknown → [] (never invent windows).
export function normalizeCodexRateLimits(payload, observedAt = null) {
  const snapshots = [];
  if (payload?.rateLimitsByLimitId && typeof payload.rateLimitsByLimitId === 'object') {
    for (const [id, v] of Object.entries(payload.rateLimitsByLimitId)) snapshots.push([String(id), v]);
  } else if (payload?.rateLimits && typeof payload.rateLimits === 'object') {
    snapshots.push(['codex', payload.rateLimits]);
  } else if (payload && typeof payload === 'object') {
    snapshots.push(['codex', payload]);
  }
  const out = [];
  for (const [limitId, snapshot] of snapshots) {
    for (const [key, label] of [['primary', 'Primary window'], ['secondary', 'Secondary window']]) {
      const w = snapshot?.[key];
      if (!w || w.usedPercent == null) continue;
      out.push({
        provider: 'codex', limit_id: limitId === 'codex' ? key : `${limitId}:${key}`, label,
        used_percent: Number(w.usedPercent),
        window_minutes: w.windowDurationMins ?? null,
        resets_at: w.resetsAt ?? null,
        authority: 'provider_telemetry', scope: 'account', freshness: 'live',
        observed_at: observedAt || new Date().toISOString(),
      });
    }
  }
  return out;
}
// Gemini OTLP metric datum → canonical event (tokens only, never prompts).
export function normalizeGeminiOtlp({ model, type, value, observedAt = null }) {
  const allowed = new Set(['input', 'output', 'thought', 'cache', 'tool']);
  if (!allowed.has(type)) return null;
  const e = {
    provider: 'gemini-cli', billing_owner: 'gemini-cli', model_provider: 'google',
    model: model || null, input_tokens: null, output_tokens: null, thought_tokens: null, cache_tokens: null, tool_tokens: null,
    authority: 'provider_telemetry', scope: 'device', freshness: 'live',
    observed_at: observedAt || new Date().toISOString(),
  };
  const v = Number(value) || 0;
  if (type === 'input') e.input_tokens = v;
  else if (type === 'output') e.output_tokens = v;
  else if (type === 'thought') e.thought_tokens = v;
  else if (type === 'cache') e.cache_tokens = v;
  else e.tool_tokens = v;
  return e;
}
function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function addNull(a, b) { const x = Number(a), y = Number(b); if (!Number.isFinite(x) || !Number.isFinite(y)) return null; return x + y; }

if (process.argv.includes('--selftest')) {
  const cases = [
    normalizePerplexityResponse({ model: 'sonar-large', usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }, id: 'p1' }),
    normalizeOpenAICompatible({ model: 'gpt-4o', usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }, id: 'r1' }, 'deepseek'),
    normalizeOllamaResponse({ model: 'llama3', prompt_eval_count: 11, eval_count: 18 }),
    normalizeCodexRateLimits({ primary: { usedPercent: 74, windowDurationMins: 300 }, secondary: null }),
    normalizeGeminiOtlp({ model: 'gemini-1.5-pro', type: 'input', value: 500 }),
  ];
  console.log(JSON.stringify(cases, null, 2));
}
