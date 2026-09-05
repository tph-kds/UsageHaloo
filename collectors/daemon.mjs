#!/usr/bin/env node
/**
 * UsageHalo collector daemon (prototype runtime).
 * Tick loop honoring each connector's nominal cadence (collectors/scheduler.mjs):
 *  - poll-mode connectors run at most every nominal_seconds
 *  - event connectors are never polled (their ingest endpoints push)
 *  - each tick writes health.json, prunes the store (90d), evaluates alerts
 *
 * Usage:
 *   node collectors/daemon.mjs --once     # single pass (Task Scheduler / cron / launchd / systemd)
 *   node collectors/daemon.mjs --loop     # foreground loop (default interval 60s)
 *   node collectors/daemon.mjs --loop --interval 30
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONNECTOR_SCHEDULE } from './scheduler.mjs';
import { prune, writeHealth, insertQuotaSnapshot } from './store.mjs';
import { evaluateAll, DEFAULT_RULES } from './alerts.mjs';
import { pollOpenRouterKey, pollOpenAIUsage, readOllama, readLMStudio, pollCursor, pollCopilot, pollMistral } from './pollers.mjs';
import { readCodexRateLimits } from './codex-app-server.mjs';

const stateFile = () => path.join(os.homedir(), '.usagehalo', 'store', 'daemon.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { last_poll: {} }; } }
function saveState(s) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), { mode: 0o600 });
}
function due(id, nowMs, last) {
  const meta = CONNECTOR_SCHEDULE[id];
  if (!meta) return false;
  // Event sources are never polled — except Codex, which needs one initial
  // read at startup (after that, app-server notifications drive updates).
  if (meta.mode === 'event') return id === 'codex' && !last[id];
  const nominal = (meta.nominal_seconds ?? 3600) * 1000;
  return nowMs - (last[id] || 0) >= nominal;
}

const POLLERS = {
  'openrouter': () => pollOpenRouterKey(),
  'openai-api': () => pollOpenAIUsage(),
  'ollama': () => readOllama(),
  'lm-studio': () => readLMStudio(),
  'cursor': () => pollCursor(),
  'github-copilot': () => pollCopilot(),
  'mistral': () => pollMistral(),
  'codex': () => readCodexRateLimits(6000).then((r) => ({ provider: 'codex', ...r })),
};

/** Persist a successful poll result as an immutable quota snapshot.
 *  Returns true when a row was written. Pure mapping — tested in test_daemon. */
export function persistPollResult(id, r, nowMs) {
  if (!r || !r.live) return false;
  const observed_at = new Date(nowMs).toISOString();
  const base = { observed_at, source: r.source || 'official_api', scope: r.scope || 'account', freshness: r.freshness || 'poll' };
  const rows = [];
  if (id === 'openrouter' && r.primaryPercent != null) {
    rows.push({ ...base, provider: 'openrouter', limit_id: 'key-limit', label: 'Key limit used', used_percent: r.primaryPercent });
  }
  if (id === 'openai-api' && (r.tokens_window != null || r.cost_window != null)) {
    rows.push({ ...base, provider: 'openai-api', limit_id: `org-usage-${r.days || 7}d`, label: 'Organization usage window', used_value: r.tokens_window ?? null, provider_cost: r.cost_window ?? null });
  }
  if (id === 'cursor' && (r.input_tokens_24h != null || r.cost_24h != null)) {
    rows.push({ ...base, provider: 'cursor', limit_id: 'usage-24h', label: 'Team usage (24h)', used_value: (r.input_tokens_24h || 0) + (r.output_tokens_24h || 0), provider_cost: r.cost_24h ?? null });
  }
  if (id === 'github-copilot' && r.requests_window != null) {
    rows.push({ ...base, provider: 'github-copilot', limit_id: 'metrics-window', label: 'Copilot metrics window', used_value: r.requests_window });
  }
  if (id === 'mistral' && r.cost_month != null) {
    rows.push({ ...base, provider: 'mistral', limit_id: 'spend-month', label: 'Organization spend (month)', provider_cost: r.cost_month, currency: r.currency || null });
  }
  if (id === 'codex' && Array.isArray(r.quotas)) {
    for (const q of r.quotas) {
      rows.push({ ...base, provider: 'codex', limit_id: q.limit_id || 'window', label: q.label || 'Rate window', used_percent: q.used_percent ?? null, source: 'codex_app_server', scope: 'account', freshness: 'live' });
    }
  }
  // Localhost probes (ollama/lm-studio) carry no quota semantics — health only.
  for (const q of rows) {
    try { insertQuotaSnapshot(q); } catch {}
  }
  return rows.length > 0;
}

export async function tickOnce(nowMs = Date.now()) {
  const state = loadState();
  const results = {};
  for (const [id, run] of Object.entries(POLLERS)) {
    if (!due(id, nowMs, state.last_poll)) { results[id] = { skipped: true, reason: 'cadence' }; continue; }
    try {
      const r = await run();
      const persisted = persistPollResult(id, r, nowMs);
      results[id] = { live: !!r.live, reason: r.reason || null, persisted };
      state.last_poll[id] = nowMs;
      writeHealth(id, {
        state: r.live ? 'healthy' : 'degraded',
        last_success: r.live ? new Date(nowMs).toISOString() : undefined,
        expected_refresh_seconds: CONNECTOR_SCHEDULE[id]?.nominal_seconds ?? null,
        message: r.live ? null : (r.reason || 'poll returned no data'),
      });
    } catch (e) {
      results[id] = { live: false, reason: 'exception' };
      writeHealth(id, { state: 'degraded', expected_refresh_seconds: CONNECTOR_SCHEDULE[id]?.nominal_seconds ?? null, message: 'poller exception' });
    }
  }
  saveState(state);
  const pruned = prune(90);
  let fired = [];
  // P0-04: alert evaluation receives only real metrics. There is no
  // production budget-percent source yet, so the budget rule gets null and
  // stays in `insufficient_data` (evaluateAll skips null values) instead of
  // firing off a hardcoded constant.
  try { fired = evaluateAll(DEFAULT_RULES, { 'budget:percent': null }, nowMs); } catch {}
  // Converged snapshot cache for file-store consumers (Tauri shell, widgets).
  let cacheWritten = false;
  try {
    const { buildProviderRows } = await import('./snapshot.mjs');
    const { reconcileEvents } = await import('./reconcile.mjs');
    const { readEvents } = await import('./store.mjs');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const os = await import('node:os');
    const regPath = path.join(process.cwd(), 'packages', 'brand-registry', 'providers.json');
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const assetMap = {};
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'assets', 'providers', 'icon-manifest.json'), 'utf8'));
      for (const entry of manifest.providers || []) assetMap[entry.base_stem] = { dir: entry.id, stem: entry.base_stem };
    } catch {}
    const rows = buildProviderRows({ registry, events: reconcileEvents(readEvents(5000)), assetMap });
    const dir = path.join(os.homedir(), '.usagehalo', 'store');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'snapshot-cache.json'),
      JSON.stringify({ generated_at: new Date(nowMs).toISOString(), provider_count: rows.length, providers: rows }), { mode: 0o600 });
    cacheWritten = true;
  } catch {}
  return { at: new Date(nowMs).toISOString(), results, pruned, alerts_fired: fired.length, cacheWritten };
}

const args = process.argv.slice(2);
if (args.includes('--once')) {
  tickOnce().then((r) => { console.log(JSON.stringify(r, null, 2)); });
} else {
  const interval = Number(args[args.indexOf('--interval') + 1]) || 60;
  console.log(`UsageHalo daemon: tick every ${interval}s (Ctrl+C to stop)`);
  const loop = () => tickOnce().then((r) => console.log(`[${r.at}] tick:`, JSON.stringify(r.results))).catch((e) => console.error('tick failed', e?.message));
  loop();
  setInterval(loop, interval * 1000);
}
