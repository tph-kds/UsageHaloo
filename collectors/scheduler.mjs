#!/usr/bin/env node
/**
 * Per-connector scheduler metadata + rollup builder.
 * Poll cadence belongs to connector metadata, never one global timer.
 * Event sources (Claude/Codex/Gemini) are push; poll sources declare nominal interval + max healthy age.
 */
export const CONNECTOR_SCHEDULE = {
  'claude-code': { mode: 'event', nominal_seconds: null, max_healthy_age_seconds: 24 * 3600, note: 'status-line events; stale after 24h without session' },
  'codex': { mode: 'event', nominal_seconds: null, max_healthy_age_seconds: 3600, note: 'app-server notifications + initial read' },
  'gemini-cli': { mode: 'event', nominal_seconds: null, max_healthy_age_seconds: 3600, note: 'OTLP events' },
  'openai-api': { mode: 'poll', nominal_seconds: 3600, max_healthy_age_seconds: 2 * 3600, note: 'org usage is delayed; hourly poll is plenty' },
  'anthropic-api': { mode: 'poll', nominal_seconds: 3600, max_healthy_age_seconds: 2 * 3600, note: 'admin/instrumented mix' },
  'openrouter': { mode: 'poll_mix', nominal_seconds: 900, max_healthy_age_seconds: 1800, note: 'credits poll + live response usage' },
  'cursor': { mode: 'poll', nominal_seconds: 3600, max_healthy_age_seconds: 2 * 3600, note: 'respect hourly aggregation guidance' },
  'github-copilot': { mode: 'poll', nominal_seconds: 86400, max_healthy_age_seconds: 2 * 86400, note: 'daily/aggregated reports, never live' },
  'mistral': { mode: 'poll', nominal_seconds: 3600, max_healthy_age_seconds: 2 * 3600, note: 'admin API for eligible plans' },
  'perplexity': { mode: 'event', nominal_seconds: null, max_healthy_age_seconds: 86400, note: 'instrumented responses only' },
  'ollama': { mode: 'poll', nominal_seconds: 60, max_healthy_age_seconds: 300, note: 'localhost, cheap' },
  'lm-studio': { mode: 'poll', nominal_seconds: 60, max_healthy_age_seconds: 300, note: 'localhost, cheap' },
};
export function freshnessState(connectorId, ageSeconds) {
  const meta = CONNECTOR_SCHEDULE[connectorId];
  if (!meta) return 'unknown';
  if (meta.mode === 'event' && ageSeconds == null) return 'unknown';
  if (ageSeconds == null) return 'unknown';
  // Honesty cap: slow poll sources (nominal > 5 min) report daily/hourly
  // aggregates, so their best state is 'fresh' — never 'live'. Localhost
  // polls (60s) and event/poll_mix sources may report 'live'.
  const liveCap = meta.mode === 'poll' && (meta.nominal_seconds ?? 300) > 300 ? 'fresh' : 'live';
  if (ageSeconds <= (meta.nominal_seconds ?? 300)) return liveCap;
  if (ageSeconds <= meta.max_healthy_age_seconds) return 'fresh';
  return 'stale';
}
/** Build day/provider/model rollups from reconciled events (pure, testable). */
export function buildRollups(events, timezone = 'UTC') {
  const map = new Map();
  for (const e of events) {
    const day = (e.observed_at || '').slice(0, 10) || 'unknown';
    const key = [day, e.provider, e.billing_owner || e.provider, e.model || ''].join('|');
    const cur = map.get(key) || { local_date: day, timezone, provider: e.provider, billing_owner: e.billing_owner || e.provider, model: e.model || '', input_tokens: 0, output_tokens: 0, requests: 0, provider_cost: 0, estimated_cost: 0 };
    cur.input_tokens += e.input_tokens || 0;
    cur.output_tokens += e.output_tokens || 0;
    cur.requests += e.requests || 0;
    cur.provider_cost += e.provider_cost || 0;
    cur.estimated_cost += e.estimated_cost || 0;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => a.local_date.localeCompare(b.local_date));
}
