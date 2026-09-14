#!/usr/bin/env node
/**
 * Zero-dependency UsageHalo prototype runtime.
 *
 * This is not the intended production daemon; the production architecture is
 * Rust/Tauri. It exists so this ZIP contains an immediately runnable
 * end-to-end example:
 *
 *   node prototype/server.mjs
 *   open http://127.0.0.1:4897
 *
 * It serves the demo UI, exposes a sanitized Claude Code snapshot endpoint,
 * a registry-driven snapshot of all providers, and the brand SVG icons used
 * by the demo rail.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectProviders, readOllama, readLMStudio, readClaudeSpool, readOpenRouterCredits } from '../collectors/local.mjs';
import { readEvents } from '../collectors/store.mjs';
import { reconcileEvents } from '../collectors/reconcile.mjs';
import { buildRollups, CONNECTOR_SCHEDULE, freshnessState, localDate } from '../collectors/scheduler.mjs';
import { forecastQuota, forecastSpend } from '../collectors/forecast.mjs';
import { evaluateAll, DEFAULT_RULES } from '../collectors/alerts.mjs';
import { readCodexRateLimits } from '../collectors/codex-app-server.mjs';
import { ingestOtlpMetrics } from '../collectors/gemini-otlp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'demo');
const ASSETS = path.join(ROOT, 'assets');
const REGISTRY = path.join(ROOT, 'packages', 'brand-registry', 'providers.json');
const ICON_MANIFEST = path.join(ASSETS, 'providers', 'icon-manifest.json');
const PORT = Number(process.env.VIUSAGEVER_PORT || 4897);
const SPOOL = path.join(os.homedir(), '.usagehalo', 'inbox', 'claude-code.jsonl');
const SPOOL_LEGACY = path.join(os.homedir(), '.viusagever', 'inbox', 'claude-code.jsonl');
const FIXTURE = path.join(ROOT, 'fixtures', 'claude-statusline.json');

function sanitizeClaude(input) {
  return {
    observed_at: new Date().toISOString(),
    session_id: input.session_id ?? null,
    version: input.version ?? null,
    model: input.model ? { id: input.model.id ?? null, display_name: input.model.display_name ?? null } : null,
    cost: input.cost ? { total_cost_usd: input.cost.total_cost_usd ?? null, total_duration_ms: input.cost.total_duration_ms ?? null } : null,
    context_window: input.context_window ? {
      total_input_tokens: input.context_window.total_input_tokens ?? null,
      total_output_tokens: input.context_window.total_output_tokens ?? null,
      context_window_size: input.context_window.context_window_size ?? null,
      used_percentage: input.context_window.used_percentage ?? null,
      remaining_percentage: input.context_window.remaining_percentage ?? null,
      current_usage: input.context_window.current_usage ? {
        input_tokens: input.context_window.current_usage.input_tokens ?? null,
        output_tokens: input.context_window.current_usage.output_tokens ?? null,
        cache_creation_input_tokens: input.context_window.current_usage.cache_creation_input_tokens ?? null,
        cache_read_input_tokens: input.context_window.current_usage.cache_read_input_tokens ?? null
      } : null
    } : null,
    rate_limits: input.rate_limits ?? null,
    prompt_cache: input.prompt_cache ? {
      warm: input.prompt_cache.warm ?? null,
      hit_ratio: input.prompt_cache.hit_ratio ?? null,
      requests: input.prompt_cache.requests ?? null,
      misses: input.prompt_cache.misses ?? null
    } : null
  };
}

function latestSpoolRecord() {
  // Read from the new canonical spool first. If empty, fall back to the
  // legacy viusagever spool so existing users don't lose their last
  // observation. The legacy-import endpoint (added in Wave 6) performs a
  // one-time copy of the legacy file into the new path.
  for (const candidate of [SPOOL, SPOOL_LEGACY]) {
    try {
      const data = fs.readFileSync(candidate, 'utf8').trim();
      if (data) return JSON.parse(data.split(/\r?\n/).at(-1));
    } catch {}
  }
  return sanitizeClaude(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
}

function loadRegistry() {
  const providers = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  let assetMap = {};
  if (fs.existsSync(ICON_MANIFEST)) {
    const manifest = JSON.parse(fs.readFileSync(ICON_MANIFEST, 'utf8'));
    for (const entry of manifest.providers || []) {
      assetMap[entry.base_stem] = { dir: entry.id, stem: entry.base_stem };
    }
  }
  for (const p of providers) assetMap[p.id] ||= { dir: p.id, stem: p.id };
  return providers.map(p => ({ ...p, _asset: assetMap[p.id] }));
}

// Deterministic 32-bit hash so a given (provider, day) yields the same numbers
// every reload. No external deps, no Math.random().
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const PRIMARY_LABEL = {
  quota_5h: '5-hour limit',
  primary_quota: 'Primary window',
  tokens_today: 'Tokens today',
  budget_month: 'Monthly budget',
  credit_usage: 'Credits used',
  included_usage: 'Included usage',
  quota_5h_credits: '5-hour credits',
  spend_month: 'Spend this month',
  requests_day: 'Daily requests',
  usage: 'Usage',
  spend: 'Spend',
  tokens: 'Tokens',
  cost: 'Cost',
  requests: 'Requests'
};

const FRESHNESS_HEALTH = {
  live: 'healthy',
  live_poll_mix: 'healthy',
  fresh: 'healthy',
  poll: 'healthy',
  hourly: 'fresh',
  hourly_or_live_enterprise: 'fresh',
  daily: 'fresh',
  provider_reported: 'fresh',
  mixed: 'fresh',
  delayed: 'stale',
  manual: 'stale'
};

function pctFromSeed(seed) {
  // Bias toward 20-80% so the rail looks plausible; clamp 5-95.
  return Math.max(5, Math.min(95, 20 + (seed % 61)));
}

// Day-of-month fraction 0..1, used to ramp budget-style metrics.
function dayFraction(date) {
  const d = new Date(date);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return (d.getUTCDate() - 1) / Math.max(1, last - 1);
}
function dayOfWeek(date) {
  return new Date(date).getUTCDay();
}

// Per-day realistic primary percent, keyed off the registry's primaryMetric
// and the day-of-month / day-of-week.
function realisticPrimary(metric, basePct, dayF, dow) {
  switch (metric) {
    case 'quota_5h':
    case 'primary_quota':
    case 'quota_5h_credits': {
      const wkend = (dow === 0 || dow === 6) ? -8 : 0;
      return Math.max(2, Math.min(98, Math.round(basePct + (dayF * 22) + wkend)));
    }
    case 'tokens_today': {
      const weekly = [38, 60, 78, 82, 70, 28, 14][dow];
      return Math.max(2, Math.min(98, Math.round(weekly + (basePct % 11))));
    }
    case 'budget_month': {
      const wkend = (dow === 5) ? 6 : 0;
      return Math.max(2, Math.min(98, Math.round(8 + dayF * 78 + wkend)));
    }
    case 'credit_usage': {
      return Math.max(2, Math.min(98, Math.round(6 + dayF * 70)));
    }
    case 'included_usage': {
      return Math.max(2, Math.min(98, Math.round(4 + dayF * 55)));
    }
    case 'spend_month': {
      return Math.max(2, Math.min(98, Math.round(5 + dayF * 75)));
    }
    case 'requests_day': {
      return Math.max(2, Math.min(98, Math.round(20 + dayF * 60)));
    }
    case 'usage':
    case 'spend':
    case 'tokens':
    case 'cost':
    case 'requests':
    default: {
      return Math.max(2, Math.min(98, Math.round(basePct + dayF * 30)));
    }
  }
}

function numericTokens(seed, dow) {
  const weekly = [1.2, 1.8, 2.4, 2.6, 2.1, 0.9, 0.5][dow];
  return Math.round(200_000 + (seed % 9_800_000) * weekly);
}

function realisticTokens(seed, dow) {
  const t = numericTokens(seed, dow);
  return t < 1_000_000 ? `${Math.round(t / 1000)}K` : `${(t / 1_000_000).toFixed(2)}M`;
}

function numericCost(connector, seed, dow) {
  if (connector === 'subscription' || connector === 'zai') return null;
  if (connector === 'cloud-billing' || connector === 'openai' || connector === 'openrouter') {
    const wkend = (dow === 0 || dow === 6) ? 0.7 : 1.0;
    return Number((((((seed >>> 4) % 2800) / 100) + 0.20) * wkend).toFixed(2));
  }
  return null;
}

function realisticCost(connector, seed, dow) {
  if (connector === 'subscription' || connector === 'zai') return 'subscription';
  const dollars = numericCost(connector, seed, dow);
  if (dollars == null) return '—';
  return `$${dollars.toFixed(2)}`;
}

function utcDayString(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function honestSnapshot(registry, claude, day = new Date()) {
  // Honest default: no invented percentages. Every provider renders with
  // null metrics + explicit estimated/sample provenance until a live source
  // overlays it in snapshotWithLive(). This is the production default.
  const dayStr = utcDayString(day);
  const providers = registry.map(p => ({
    id: p.id,
    displayName: p.displayName,
    vendor: p.vendor,
    monogram: p.monogram,
    accent: p.accent,
    connector: p.connector,
    status: p.status,
    sourceMode: p.sourceMode,
    freshness: p.freshness,
    scope: p.scope,
    primaryMetric: p.primaryMetric,
    primaryLabel: PRIMARY_LABEL[p.primaryMetric] || p.primaryMetric,
    primaryPercent: null,
    primaryReset: null,
    secondaryLabel: p.connector === 'generic-response' || p.connector === 'cloud-billing' ? 'Model mix' : '7-day limit',
    secondaryPercent: null,
    secondaryReset: null,
    tokensToday: null,
    costToday: null,
    // Canonical numerics (Phase 1): null = unavailable, never zero-by-default.
    // The honest path has no real token rollup yet (Phase 3), and the Claude
    // session cost below is a session figure, not a calendar-day total, so
    // both stay null here by design.
    tokens_today_value: null,
    cost_today_value: null,
    source: p.sourceMode,
    health: 'unknown',
    icon: `/assets/providers/${p._asset.dir}/${p._asset.stem}.svg`,
    live: false,
    provenance: { source: p.sourceMode, scope: p.scope, freshness: p.freshness, authority: 'estimated', sample: true },
  }));

  // Real Claude spool overlay (same ingest path as demo mode).
  const claudeEntry = providers.find(p => p.id === 'claude-code');
  if (claudeEntry) {
    const fiveHour = claude.rate_limits?.five_hour?.used_percentage;
    const sevenDay = claude.rate_limits?.seven_day?.used_percentage;
    if (typeof fiveHour === 'number') claudeEntry.primaryPercent = Math.round(fiveHour);
    if (typeof sevenDay === 'number') claudeEntry.secondaryPercent = Math.round(sevenDay);
    if (claude.model?.display_name || claude.model?.id) {
      claudeEntry.tokensToday = `model: ${claude.model.display_name || claude.model.id}`;
    }
    if (typeof claude.cost?.total_cost_usd === 'number') {
      claudeEntry.costToday = `$${claude.cost.total_cost_usd.toFixed(2)} session`;
    }
    if (typeof fiveHour === 'number' || claude.model?.id || claude.model?.display_name) {
      claudeEntry.source = 'claude_code_statusline';
      claudeEntry.health = 'healthy';
    }
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    day_utc: dayStr,
    data_basis: 'registry+live-overlay',
    sample_data: false,
    demo_mode: false,
    provider_count: providers.length,
    providers,
    models: [],
  };
}

function determinSnapshot(registry, claude, day = new Date()) {
  const dayStr = utcDayString(day);
  const dayF = dayFraction(day);
  const dow = dayOfWeek(day);

  const providers = registry.map(p => {
    const seed = hash32(p.id + ':' + dayStr);
    const basePct = pctFromSeed(seed);
    const primaryPercent = realisticPrimary(p.primaryMetric, basePct, dayF, dow);
    const secondaryPercent = Math.max(2, Math.min(98, primaryPercent + ((seed >>> 8) % 21) - 10));
    return {
      id: p.id,
      displayName: p.displayName,
      vendor: p.vendor,
      monogram: p.monogram,
      accent: p.accent,
      connector: p.connector,
      status: p.status,
      sourceMode: p.sourceMode,
      freshness: p.freshness,
      scope: p.scope,
      primaryMetric: p.primaryMetric,
      primaryLabel: PRIMARY_LABEL[p.primaryMetric] || p.primaryMetric,
      primaryPercent,
      primaryReset: p.primaryMetric === 'budget_month'
        ? `Resets in ${Math.max(1, 30 - new Date(day).getUTCDate())}d`
        : (p.primaryMetric === 'quota_5h' || p.primaryMetric === 'primary_quota' ? '2h 12m' : (p.primaryMetric === 'credit_usage' ? 'next cycle' : null)),
      secondaryLabel: p.connector === 'generic-response' || p.connector === 'cloud-billing' ? 'Model mix' : '7-day limit',
      secondaryPercent,
      secondaryReset: p.connector === 'cloud-billing' ? 'Sep 30' : 'Thu 00:00',
      tokensToday: realisticTokens(seed, dow),
      costToday: realisticCost(p.connector, seed, dow),
      // Canonical numerics backing the display strings above (Phase 1).
      tokens_today_value: numericTokens(seed, dow),
      cost_today_value: numericCost(p.connector, seed, dow),
      freshness: p.freshness,
      source: p.sourceMode,
      health: FRESHNESS_HEALTH[p.freshness] || 'fresh',
      icon: `/assets/providers/${p._asset.dir}/${p._asset.stem}.svg`
    };
  });

  // Apply real Claude snapshot if present (preserves the existing ingest path).
  // A real overlay supersedes demo numbers: synthetic numeric twins are
  // nulled for this entry so demo values never mix with real observations.
  const claudeEntry = providers.find(p => p.id === 'claude-code');
  if (claudeEntry) {
    const fiveHour = claude.rate_limits?.five_hour?.used_percentage;
    const sevenDay = claude.rate_limits?.seven_day?.used_percentage;
    const hasReal = typeof fiveHour === 'number' || claude.model?.id || claude.model?.display_name;
    if (typeof fiveHour === 'number') claudeEntry.primaryPercent = Math.round(fiveHour);
    if (typeof sevenDay === 'number') claudeEntry.secondaryPercent = Math.round(sevenDay);
    if (claude.model?.display_name || claude.model?.id) {
      claudeEntry.tokensToday = `model: ${claude.model.display_name || claude.model.id}`;
    }
    if (typeof claude.cost?.total_cost_usd === 'number') {
      claudeEntry.costToday = `$${claude.cost.total_cost_usd.toFixed(2)} session`;
    }
    if (hasReal) {
      claudeEntry.tokens_today_value = null;
      claudeEntry.cost_today_value = null;
    }
    claudeEntry.source = 'claude_code_statusline';
    claudeEntry.health = 'healthy';
  }

  // Model activity — router providers (generic-response, cloud-billing,
  // openrouter) emit a row where model_provider != billing_owner, so the
  // billing-owner invariant is visible in the rail.
  const models = [];
  for (const p of providers) {
    const isRouter = p.connector === 'generic-response' || p.connector === 'cloud-billing' || p.connector === 'openrouter';
    if (!isRouter) continue;
    const seed = hash32(p.id + ':model:' + dayStr);
    let modelVendor;
    if (p.connector === 'cloud-billing') {
      modelVendor = p.id === 'aws-bedrock' ? 'anthropic' : p.id === 'azure-openai' ? 'openai' : 'google';
    } else if (p.connector === 'openrouter') {
      modelVendor = 'anthropic';
    } else {
      modelVendor = 'openai';
    }
    const modelPool = ['claude-3.5-sonnet', 'gpt-4o-mini', 'llama-3.1-70b', 'mixtral-8x7b', 'gemini-1.5-pro'];
    const model = modelPool[seed % modelPool.length];
    const weekly = [1.0, 1.4, 1.8, 1.9, 1.6, 0.9, 0.6][dow];
    const tokens = Math.round((100_000 + (seed % 4_900_000)) * weekly);
    const cost = (((seed >>> 4) % 999) / 100) * weekly + 0.05;
    models.push({
      surface: p.displayName,
      model_provider: modelVendor,
      billing_owner: p.id,
      model,
      tokens,
      cost: `$${cost.toFixed(2)}`
    });
  }
  if (!models.some(m => m.surface === 'Claude Code')) {
    models.unshift({
      surface: 'Claude Code',
      model_provider: 'anthropic',
      billing_owner: 'claude-code',
      model: claude.model?.display_name || claude.model?.id || 'claude-example',
      tokens: 412_000,
      cost: '$0.31'
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    day_utc: dayStr,
    data_basis: 'registry+per-day-deterministic',
    sample_data: true,
    demo_mode: true,
    provider_count: providers.length,
    providers,
    models
  };
}
function latestRealSpoolRecord() {
  // Honest path: real spool files only, never the checked-in fixture.
  for (const candidate of [SPOOL, SPOOL_LEGACY]) {
    try {
      const data = fs.readFileSync(candidate, 'utf8').trim();
      if (data) return { record: JSON.parse(data.split(/\r?\n/).at(-1)), real: true };
    } catch {}
  }
  return { record: null, real: false };
}
function isDemoRequest(url) {
  return url.searchParams.get('demo') === '1' || process.env.SAMPLE_MODE === '1';
}

// ---- real store-backed overlays (no invented numbers) ---------------------
// Reads the immutable file store (~/.usagehalo/store/) written by ingest
// endpoints and the daemon. All rows flow through reconciliation; missing
// dimensions stay null and never become zero.
function readQuotaSnapshots(limit = 2000) {
  try {
    const file = path.join(os.homedir(), '.usagehalo', 'store', 'quota_snapshots.jsonl');
    const data = fs.readFileSync(file, 'utf8').trim();
    if (!data) return [];
    return data.split(/\r?\n/).filter(Boolean).slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function aggregateStoreEvents() {
  let events = [];
  try { events = reconcileEvents(readEvents(5000)); } catch { events = []; }
  const byProvider = new Map();
  const models = [];
  for (const e of events) {
    const key = e.provider || e.billing_owner;
    if (!key) continue;
    const cur = byProvider.get(key) || { tokens: 0, cost: 0, requests: 0, hasTokens: false, hasCost: false, n: 0, latest: null };
    const t = (e.input_tokens || 0) + (e.output_tokens || 0);
    if (e.input_tokens != null || e.output_tokens != null) { cur.tokens += t; cur.hasTokens = true; }
    if (e.provider_cost != null) { cur.cost += e.provider_cost; cur.hasCost = true; }
    if (e.requests != null) cur.requests += e.requests;
    cur.n++;
    if (e.observed_at && (!cur.latest || String(e.observed_at) > String(cur.latest))) cur.latest = e.observed_at;
    byProvider.set(key, cur);
    if (e.model) {
      models.push({
        surface: e.provider || e.billing_owner || 'unknown',
        model_provider: e.model_provider || e.provider || 'unknown',
        billing_owner: e.billing_owner || e.provider || 'unknown',
        model: e.model,
        tokens: t,
        cost: e.provider_cost != null ? `$${Number(e.provider_cost).toFixed(2)}` : 'Cost unavailable',
      });
    }
  }
  // Collapse models to one row per (surface, model): billing owner invariant kept.
  const collapsed = new Map();
  for (const m of models) {
    const k = `${m.surface}|${m.model}|${m.billing_owner}`;
    const cur = collapsed.get(k) || { ...m, tokens: 0 };
    cur.tokens += m.tokens;
    collapsed.set(k, cur);
  }
  return { byProvider, models: [...collapsed.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 24) };
}
function snapshotLive(url) {
  const registry = loadRegistry();
  if (url && isDemoRequest(url)) return determinSnapshot(registry, latestSpoolRecord());
  const { record } = latestRealSpoolRecord();
  return honestSnapshot(registry, record || {});
}

// Mirror of connectors/claude-code/src/lib.rs ClaudeCodeProviderAdapter (Phase B1).
const CLAUDE_V2_STALE_MS = 24 * 60 * 60 * 1000;
const CLAUDE_V2_WINDOWS = [['five_hour', '5-hour limit'], ['seven_day', '7-day limit']];

function claudeV2Home() {
  try {
    const h = process.env.HOME || process.env.USERPROFILE;
    if (h && h.trim()) return h;
    return os.homedir();
  } catch { return null; }
}

// Newest non-empty spool line only: slice from the end instead of parsing
// every line, since the spool is append-only. Returns { record, mtimeMs }.
function claudeV2NewestLine(file) {
  const st = fs.statSync(file);
  const text = fs.readFileSync(file, 'utf8');
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r' || text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  if (end <= 0) return null;
  const nl = text.lastIndexOf('\n', end - 1);
  const line = text.slice(nl + 1, end).trim();
  if (!line) return null;
  return { record: JSON.parse(line), mtimeMs: st.mtimeMs };
}

// Pure core over one spool record at explicit now (deterministic for tests).
function claudeV2FromRecord(record, nowMs) {
  const windows = [];
  let invalid = false;
  const rl = record != null && typeof record === 'object' ? record.rate_limits : null;
  if (rl != null && typeof rl === 'object') {
    for (const [id, label] of CLAUDE_V2_WINDOWS) {
      const w = rl[id];
      if (w == null || typeof w !== 'object' || w.used_percentage == null) continue;
      const used = Number(w.used_percentage);
      if (!Number.isFinite(used) || used < 0 || used > 100) { invalid = true; continue; }
      let resets_at = null;
      if (w.resets_at != null && Number.isFinite(Number(w.resets_at))) {
        const d = new Date(Number(w.resets_at) * 1000);
        if (!Number.isNaN(d.getTime())) resets_at = d.toISOString();
      }
      windows.push({ id, label, used_fraction: used / 100, resets_at, source_metric_id: id });
    }
  }
  return { windows, invalid };
}

function claudeV2Snapshot(nowMs = Date.now()) {
  const collected_at = new Date(nowMs).toISOString();
  const base = (health_state, windows, active_source_id, observed_at = null) => ({
    health_state, account_key: null, headline_metric_id: 'five_hour',
    active_source_id, collected_at, observed_at, windows,
  });
  try {
    const home = claudeV2Home();
    if (!home) return base('unavailable', [], null);
    let found = null;
    for (const rel of ['.usagehalo/inbox/claude-code.jsonl', '.viusagever/inbox/claude-code.jsonl']) {
      try {
        found = claudeV2NewestLine(path.join(home, rel));
        if (found) break;
      } catch { /* try next candidate */ }
    }
    // stats-cache (~/.claude/stats-cache.json) is telemetry-only: its presence
    // never creates windows, so both branches below stay at zero windows.
    if (!found) return base('unavailable', [], null);
    const { record, mtimeMs } = found;
    let observedMs = Date.parse(record != null && typeof record === 'object' ? record.observed_at : null);
    if (!Number.isFinite(observedMs)) observedMs = Number.isFinite(mtimeMs) ? mtimeMs : nowMs;
    const observed_at = new Date(observedMs).toISOString();
    if (nowMs - observedMs > CLAUDE_V2_STALE_MS) return base('stale', [], 'statusline-spool', observed_at);
    const { windows, invalid } = claudeV2FromRecord(record, nowMs);
    if (invalid) return base('error', windows, 'statusline-spool', observed_at);
    if (windows.length === 0) return base('unavailable', [], 'statusline-spool', observed_at);
    return base('live', windows, 'statusline-spool', observed_at);
  } catch { return base('unavailable', [], null); }
}

// Codex V2 display snapshot (Phase B2 unit 2). Mirrors the Claude V2 shape
// above: live-first windows from a cached app-server read, else the same
// persisted rows the quota pipeline used — observed_at always from the data.
const CODEX_V2_TTL_MS = 60 * 1000;
const CODEX_V2_LIVE_TIMEOUT_MS = 3000;
let codexV2Cache = { at: 0, quotas: null, observed_at: null };

function codexV2ResetsIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function codexV2Windows(quotas) {
  return (quotas || [])
    .filter((q) => q && typeof q.used_percent === 'number' && Number.isFinite(q.used_percent))
    .map((q) => ({
      id: String(q.limit_id),
      label: q.label || String(q.limit_id),
      used_fraction: Math.max(0, Math.min(1, q.used_percent / 100)),
      resets_at: codexV2ResetsIso(q.resets_at),
      source_metric_id: String(q.limit_id),
    }));
}

async function codexV2Snapshot(nowMs = Date.now()) {
  const collected_at = new Date(nowMs).toISOString();
  const base = (health_state, windows, active_source_id, observed_at = null) => ({
    health_state, account_key: null, headline_metric_id: 'primary',
    active_source_id, collected_at, observed_at, windows,
  });
  let quotas = null, observed_at = null, active = null;
  try {
    if (nowMs - codexV2Cache.at < CODEX_V2_TTL_MS && codexV2Cache.quotas) {
      ({ quotas, observed_at } = codexV2Cache);
      active = 'app-server-live';
    } else {
      const r = await readCodexRateLimits(CODEX_V2_LIVE_TIMEOUT_MS);
      if (r.live && (r.quotas || []).length) {
        quotas = r.quotas; active = 'app-server-live';
        observed_at = quotas.map((q) => q.observed_at).filter(Boolean).sort().at(-1) || collected_at;
        codexV2Cache = { at: nowMs, quotas, observed_at };
      }
    }
  } catch { quotas = null; }
  if ((quotas || []).length) return base('live', codexV2Windows(quotas), active, observed_at);
  try {
    const rows = readQuotaSnapshots().filter((q) => q && q.provider === 'codex' && typeof q.used_percent === 'number');
    if (!rows.length) return base('unavailable', [], 'quota-snapshot');
    const newest = rows.map((q) => String(q.observed_at)).sort().at(-1);
    const ageMs = Date.now() - new Date(newest).getTime();
    const ageS = Number.isFinite(ageMs) && ageMs >= 0 ? Math.round(ageMs / 1000) : null;
    const liveNow = freshnessState('codex', ageS) === 'live';
    const latest = new Map();
    for (const q of rows) {
      const cur = latest.get(q.limit_id);
      if (!cur || String(q.observed_at) > String(cur.observed_at)) latest.set(q.limit_id, q);
    }
    const wins = codexV2Windows([...latest.values()]);
    if (!wins.length) return base('unavailable', [], 'quota-snapshot', newest || null);
    return base(liveNow ? 'live' : 'stale', wins, 'quota-snapshot', newest || null);
  } catch { return base('unavailable', [], null); }
}

// Mirror of connectors/gemini-cli/src/lib.rs GeminiCliAdapter (Phase B4):
// ~/.gemini holds identity only (active account id), quota semantics belong
// to the Antigravity product with no verified local source, so the display
// snapshot is Unsupported with zero windows. OTLP request counts are
// DERIVED-only and never quota.
function geminiV2Snapshot(nowMs = Date.now()) {
  const collected_at = new Date(nowMs).toISOString();
  const base = (health_state, active_source_id) => ({
    health_state, account_key: null, headline_metric_id: null,
    active_source_id, collected_at, observed_at: null, windows: [],
  });
  try {
    const home = os.homedir();
    const geminiDir = home ? path.join(home, '.gemini') : null;
    const antigravityDir = home ? path.join(home, '.antigravity') : null;
    let installed = false;
    try {
      if (geminiDir && fs.existsSync(geminiDir)) {
        installed = fs.existsSync(path.join(geminiDir, 'google_accounts.json'))
          || fs.existsSync(path.join(geminiDir, 'tmp'))
          || fs.existsSync(path.join(geminiDir, 'antigravity'));
      }
      if (!installed && antigravityDir && fs.existsSync(antigravityDir)) installed = true;
    } catch { /* fall through to unavailable */ }
    if (installed) return base('unsupported', 'local-state');
    return base('unavailable', null);
  } catch { return base('unavailable', null); }
}

// Mirror of connectors/cursor/src/lib.rs CursorAdapter (Phase B3): local
// state carries identity only, so the display snapshot is Unsupported with
// zero windows. Installed presence is asserted by file existence; token
// material is never read here (sqlite stays in the Rust adapter).
function cursorV2Snapshot(nowMs = Date.now()) {
  const collected_at = new Date(nowMs).toISOString();
  const base = (health_state, active_source_id) => ({
    health_state, account_key: null, headline_metric_id: null,
    active_source_id, collected_at, observed_at: null, windows: [],
  });
  try {
    const appdata = process.env.APPDATA;
    const db = appdata ? path.join(appdata, 'Cursor', 'User', 'globalStorage', 'state.vscdb') : null;
    if (db) {
      try {
        if (fs.existsSync(db)) return base('unsupported', 'local-state');
      } catch { /* fall through to unavailable */ }
    }
    return base('unavailable', null);
  } catch { return base('unavailable', null); }
}

async function snapshotWithLive(url) {
  const base = snapshotLive(url);
  const demoMode = base.demo_mode === true;
  // Overlay honest live readings (local spool, localhost, official APIs with key).
  // Never invent numbers: only override when a live source actually answered.
  let live = {};
  try {
    const [ollama, lmstudio] = await Promise.all([readOllama(), readLMStudio()]);
    const claudeLive = readClaudeSpool();
    const openrouter = await readOpenRouterCredits(process.env.OPENROUTER_API_KEY || '');
    live = { 'claude-code': claudeLive, ollama, 'lm-studio': lmstudio, openrouter };
  } catch { live = {}; }
  let detected = [];
  try { detected = detectProviders(); } catch { detected = []; }
  const byId = new Map(detected.map((d) => [d.id, d]));
  for (const p of base.providers) {
    const d = byId.get(p.id);
    if (d) {
      p.installed = !!d.installed;
      p.configured = !!d.configured;
      p.evidence = d.evidence;
      // Honest staleness: not-configured providers are explicitly sample data.
      p.live = false;
      p.provenance = { source: p.source, scope: p.scope, freshness: p.freshness, authority: 'estimated', sample: true };
    }
  }
  const or = live.openrouter;
  if (or && or.live) {
    const e = base.providers.find((p) => p.id === 'openrouter');
    if (e) {
      e.primaryPercent = or.primaryPercent;
      e.source = 'official_api';
      e.freshness = 'fresh';
      e.health = 'healthy';
      e.live = true;
      e.costToday = `$${Number(or.total_usage).toFixed(2)} used`;
      e.provenance = { source: 'official_api', scope: 'account', freshness: 'fresh', authority: 'provider_billing', sample: false };
    }
  }
  const ol = live.ollama;
  if (ol && ol.live) {
    const e = base.providers.find((p) => p.id === 'ollama');
    if (e) {
      e.source = 'local_response_metadata';
      e.freshness = 'live';
      e.health = 'healthy';
      e.live = true;
      e.tokensToday = ol.count ? `${ol.count} model${ol.count === 1 ? '' : 's'} loaded` : 'daemon reachable';
      e.provenance = { source: 'local_response_metadata', scope: 'device', freshness: 'live', authority: 'instrumented_response', sample: false };
    }
  }
  const lm = live['lm-studio'];
  if (lm && lm.live) {
    const e = base.providers.find((p) => p.id === 'lm-studio');
    if (e) {
      e.source = 'local_response_metadata'; e.freshness = 'live'; e.health = 'healthy'; e.live = true;
      e.tokensToday = lm.count ? `${lm.count} model${lm.count === 1 ? '' : 's'} loaded` : 'daemon reachable';
      e.provenance = { source: 'local_response_metadata', scope: 'device', freshness: 'live', authority: 'instrumented_response', sample: false };
    }
  }
  const cl = live['claude-code'];
  // P0-09: a real spool record exists even when stale. Stale real data keeps
  // its values with a real (non-sample) provenance and the computed
  // freshness — it is never relabeled sample and never hidden. Freshness and
  // health always follow the spool age; a stale spool is never shown as
  // live/healthy (that contradiction masked staleness in the showcase).
  if (cl && 'observed_at' in cl) {
    const e = base.providers.find((p) => p.id === 'claude-code');
    if (e) {
      e.live = !!cl.live;
      e.freshness = cl.freshness || 'unknown';
      e.health = cl.live ? 'healthy' : (cl.freshness && cl.freshness !== 'unknown' ? cl.freshness : 'stale');
      e.observed_at = cl.observed_at || null;
      e.age_seconds = cl.age_seconds ?? null;
      e.provenance = { source: 'claude_code_statusline', scope: 'account', freshness: e.freshness, authority: 'provider_telemetry', sample: false };
    }
  }
  // Real store overlays: reconciled usage events → tokens/cost/models;
  // daemon quota snapshots → Codex + polled-provider quota windows.
  // Demo mode keeps its synthetic generator untouched; honest mode only
  // ever overlays rows that were actually observed.
  if (!demoMode) {
    try {
      const { byProvider, models } = aggregateStoreEvents();
      for (const p of base.providers) {
        const agg = byProvider.get(p.id);
        if (!agg) continue;
        if (agg.hasTokens) {
          p.tokensToday = agg.tokens >= 1_000_000 ? `${(agg.tokens / 1_000_000).toFixed(2)}M` : agg.tokens >= 1000 ? `${(agg.tokens / 1000).toFixed(1)}K` : `${agg.tokens}`;
          p.tokens_today_value = agg.tokens;
        }
        if (agg.hasCost) {
          p.costToday = `$${agg.cost.toFixed(2)}`;
          p.cost_today_value = Number(agg.cost.toFixed(2));
        }
        if (agg.requests > 0) p.requestsToday = agg.requests;
        if (agg.latest) {
          p.observed_at = agg.latest;
          const ageMs = Date.now() - new Date(agg.latest).getTime();
          if (Number.isFinite(ageMs) && ageMs >= 0) p.age_seconds = Math.round(ageMs / 1000);
        }
        if (agg.n > 0 && !p.live) {
          p.live = true;
          p.source = p.source && p.source !== p.sourceMode ? p.source : 'instrumented_store';
          p.freshness = 'fresh';
          p.health = 'healthy';
          p.provenance = { source: p.source, scope: p.scope, freshness: 'fresh', authority: 'instrumented_response', sample: false };
        }
      }
      if (models.length && base.models.length === 0) base.models = models;
    } catch { /* store overlay is best-effort; honest nulls remain */ }
    try {
      const quotas = readQuotaSnapshots();
      const latestByProvider = new Map();
      const latestCodexByLimit = new Map();
      for (const q of quotas) {
        if (q == null || !q.provider) continue;
        if (q.provider === 'codex' && q.limit_id) {
          const cur = latestCodexByLimit.get(q.limit_id);
          if (!cur || String(q.observed_at) > String(cur.observed_at)) latestCodexByLimit.set(q.limit_id, q);
          continue;
        }
        const cur = latestByProvider.get(q.provider);
        if (!cur || String(q.observed_at) > String(cur.observed_at)) latestByProvider.set(q.provider, q);
      }
      for (const [pid, q] of latestByProvider) {
        const e = base.providers.find((p) => p.id === pid);
        if (!e || typeof q.used_percent !== 'number') continue;
        e.primaryPercent = Math.max(0, Math.min(100, Math.round(q.used_percent)));
        e.source = q.source || 'quota_snapshot';
        e.freshness = q.freshness || 'fresh';
        e.health = 'healthy';
        e.live = true;
        e.provenance = { source: e.source, scope: q.scope || 'account', freshness: e.freshness, authority: 'provider_telemetry', sample: false };
      }
      // Codex honesty: one row per provider collapses the primary window
      // into the secondary row's percent (the later observed_at wins), so
      // codex rows are tracked per limit_id and age-gated per the connector
      // schedule — live only while recent, else stale with values retained,
      // unavailable when no rows exist at all.
      try {
        const e = base.providers.find((p) => p.id === 'codex');
        if (e) {
          const rows = [...latestCodexByLimit.values()].filter((q) => typeof q.used_percent === 'number');
          if (!latestCodexByLimit.size) {
            // No codex rows at all: quota provenance is unknown, so quota is
            // unavailable — without clearing a live state earned elsewhere.
            if (!e.live) {
              e.health = 'unavailable'; e.freshness = 'unknown';
              e.provenance = { source: e.source, scope: e.scope, freshness: 'unknown', authority: 'provider_telemetry', sample: false };
            }
          } else if (rows.length) {
            const byLimit = new Map(rows.map((q) => [q.limit_id, q]));
            const primary = byLimit.get('primary'), secondary = byLimit.get('secondary');
            const newest = rows.map((q) => String(q.observed_at)).sort().at(-1);
            const ageMs = Date.now() - new Date(newest).getTime();
            const ageS = Number.isFinite(ageMs) && ageMs >= 0 ? Math.round(ageMs / 1000) : null;
            const state = freshnessState('codex', ageS);
            const liveNow = state === 'live';
            // Binary honesty policy: live only while recent per the schedule;
            // otherwise stale with values retained. Freshness follows health
            // so the two never contradict.
            const freshness = liveNow ? 'live' : 'stale';
            if (primary) e.primaryPercent = Math.max(0, Math.min(100, Math.round(primary.used_percent)));
            if (secondary) e.secondaryPercent = Math.max(0, Math.min(100, Math.round(secondary.used_percent)));
            e.source = 'quota_snapshot';
            e.freshness = freshness;
            e.health = liveNow ? 'healthy' : 'stale';
            e.live = liveNow;
            e.observed_at = newest || null;
            if (ageS != null) e.age_seconds = ageS;
            e.provenance = { source: 'quota_snapshot', scope: 'account', freshness, authority: 'provider_telemetry', sample: false };
          }
        }
      } catch { /* codex honesty overlay is best-effort */ }
    } catch { /* quota overlay is best-effort */ }
  }
  // Additive V2 display snapshot for the Claude Code card only.
  try {
    const e = base.providers.find((p) => p.id === 'claude-code');
    if (e) e.v2 = claudeV2Snapshot();
  } catch { /* v2 overlay is best-effort; base snapshot stands */ }
  // Additive V2 display snapshot for the Codex card (mirrors the Claude V2 attach above).
  try {
    const e = base.providers.find((p) => p.id === 'codex');
    if (e) e.v2 = await codexV2Snapshot();
  } catch { /* v2 overlay is best-effort; base snapshot stands */ }
  // Additive V2 display snapshot for the Cursor card (Phase B3).
  try {
    const e = base.providers.find((p) => p.id === 'cursor');
    if (e) e.v2 = cursorV2Snapshot();
  } catch { /* v2 overlay is best-effort; base snapshot stands */ }
  // Additive V2 display snapshot for the Gemini CLI card (Phase B4).
  try {
    const e = base.providers.find((p) => p.id === 'gemini-cli');
    if (e) e.v2 = geminiV2Snapshot();
  } catch { /* v2 overlay is best-effort; base snapshot stands */ }
  base.detected = detected;
  base.live = live;
  base.live_overlay = true;
  // data_basis stays stable per mode for contract tests; detail in data_basis_detail.
  base.data_basis_detail = demoMode ? 'registry+per-day-deterministic+live-overlay' : 'registry+live-overlay';
  // Honest mode: sample_data true only when demo numbers present or a real
  // Claude spool exists. Honest-empty default reports sample_data:false.
  if (!demoMode) {
    const hasLiveSpool = (() => { try { return !!readClaudeSpool().live; } catch { return false; } })();
    const hasAnyLive = hasLiveSpool || !!(or && or.live) || !!(ol && ol.live) || !!(lm && lm.live)
      || base.providers.some((p) => p.live);
    base.sample_data = false;
    base.has_live_data = hasAnyLive;
  }
  return base;
}

// Real activity buckets from the immutable store (powers the showcase
// heatmap + trend). Query: ?from=ISO&to=ISO&metric=tokens|cost|requests&timezone=IANA.
// Buckets are LOCAL calendar days in `timezone` (UTC instants persist; the
// zone's midnights convert back to UTC for grouping — never UTC slicing).
// Empty store → empty buckets, never a generated pattern.
function activityBuckets(fromIso, toIso, metric = 'tokens', timezone = 'UTC') {
  let events = [];
  try { events = reconcileEvents(readEvents(5000)); } catch { events = []; }
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return { buckets: [], metric, error: 'invalid_range' };
  }
  const tz = timezone || 'UTC';
  try { localDate(tz, new Date(from).toISOString()); }
  catch { return { buckets: [], metric, error: 'unknown_timezone' }; }
  const sums = new Map();
  for (const e of events) {
    const t = new Date(e.observed_at).getTime();
    if (!Number.isFinite(t) || t < from || t >= to) continue;
    const day = localDate(tz, e.observed_at);
    let add = 0;
    if (metric === 'cost') add = Number(e.provider_cost) || 0;
    else if (metric === 'requests') add = Number(e.requests) || 0;
    else add = (Number(e.input_tokens) || 0) + (Number(e.output_tokens) || 0);
    sums.set(day, (sums.get(day) || 0) + add);
  }
  // One bucket per local calendar day intersecting [from, to). 12h steps
  // always land on every local day, including 23h DST days.
  const days = [];
  const seen = new Set();
  for (let cursor = from, i = 0; i < 130 && cursor < to && days.length < 62; i++) {
    const d = localDate(tz, new Date(cursor).toISOString());
    if (!seen.has(d)) { seen.add(d); days.push(d); }
    cursor += 12 * 3600_000;
  }
  const values = days.map((d) => sums.get(d) || 0);
  const max = Math.max(1, ...values);
  return {
    metric,
    timezone: tz,
    buckets: days.map((day, i) => ({
      day,
      value: values[i],
      level: values[i] <= 0 ? 0 : values[i] / max > 0.75 ? 4 : values[i] / max > 0.5 ? 3 : values[i] / max > 0.25 ? 2 : 1,
    })),
  };
}
function snapshot(url) {
  return snapshotLive(url);
}

// ---------------------------------------------------------------------------
// Canonical projection adapter (Phase 4, Gate 4).
//
// `/api/projection` and `/api/activity` serve the SAME ProjectionService the
// Tauri shell calls directly, via the `usagehalo_projection` CLI. This
// adapter is a thin serializer: it passes arguments through and relays the
// CLI's JSON verbatim. Failures (missing binary, timeout, nonzero exit)
// surface as explicit 5xx errors — never gaps, never fallback numbers.
// ---------------------------------------------------------------------------
function projectionBin() {
  const exe = process.platform === 'win32' ? 'usagehalo_projection.exe' : 'usagehalo_projection';
  const candidate = path.join(ROOT, 'target', 'debug', exe);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

function projectionDb() {
  return path.join(os.homedir(), '.usagehalo', 'usagehalo.db');
}

function runProjection(args) {
  const bin = projectionBin();
  if (!bin) {
    return { ok: false, status: 503, error: 'projection_unavailable', detail: 'usagehalo_projection binary not built; run: cargo build -p usage-halo-projection' };
  }
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 20_000 });
  if (r.error) {
    return { ok: false, status: 502, error: 'projection_timeout', detail: String(r.error.message || r.error).slice(0, 200) };
  }
  if (r.status !== 0) {
    return { ok: false, status: 502, error: 'projection_failed', detail: String(r.stderr || '').slice(0, 300) };
  }
  try {
    return { ok: true, payload: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, status: 502, error: 'projection_unparseable', detail: r.stdout.slice(0, 200) };
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'content-length':Buffer.byteLength(body), 'cache-control':'no-store' });
  res.end(body);
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function serveStaticFile(res, file, type) {
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
  return true;
}

function serveDemoStatic(req, res, u) {
  const relative = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, '');
  const file = path.normalize(path.join(DEMO, relative));
  if (!isInside(DEMO, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  return serveStaticFile(res, file, type);
}

function serveAssetsStatic(req, res, u) {
  // Only serve SVG/PNG from assets/providers/ — never the demo's other files.
  if (!u.pathname.startsWith('/assets/providers/')) return false;
  const relative = u.pathname.replace(/^\/assets\//, '');
  const file = path.normalize(path.join(ASSETS, relative));
  if (!isInside(ASSETS, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.svg' && ext !== '.png') return false;
  const type = ext === '.svg' ? 'image/svg+xml; charset=utf-8' : 'image/png';
  return serveStaticFile(res, file, type);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok:true, runtime:'prototype', port:PORT, providers: loadRegistry().length, platform: os.platform() });
  if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(res, 200, await snapshotWithLive(url));
  if (req.method === 'GET' && url.pathname === '/api/activity-buckets') {
    const now = Date.now();
    const to = url.searchParams.get('to') || new Date(now).toISOString();
    const from = url.searchParams.get('from') || new Date(now - 28 * 86400_000).toISOString();
    return json(res, 200, { generated_at: new Date().toISOString(), ...activityBuckets(from, to, url.searchParams.get('metric') || 'tokens', url.searchParams.get('timezone') || 'UTC') });
  }
  if (req.method === 'GET' && url.pathname === '/api/quotas') {
    // Latest quota window per limit_id for one provider (or all when
    // ?provider= is absent). Powers the per-provider detail view.
    const only = url.searchParams.get('provider');
    const latest = new Map();
    for (const q of readQuotaSnapshots()) {
      if (!q || !q.provider || !q.limit_id) continue;
      if (only && q.provider !== only) continue;
      const k = `${q.provider}|${q.limit_id}`;
      const cur = latest.get(k);
      if (!cur || String(q.observed_at) > String(cur.observed_at)) latest.set(k, q);
    }
    return json(res, 200, {
      generated_at: new Date().toISOString(),
      provider: only || null,
      windows: [...latest.values()].map((q) => ({
        provider: q.provider, limit_id: q.limit_id, label: q.label || q.limit_id,
        used_percent: q.used_percent ?? null, used_value: q.used_value ?? null,
        provider_cost: q.provider_cost ?? null, currency: q.currency || null,
        resets_at: q.resets_at || null, observed_at: q.observed_at || null,
        source: q.source || null, freshness: q.freshness || null,
      })),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/projection') {
    const tz = url.searchParams.get('timezone') || 'UTC';
    const r = runProjection(['overview', '--db', projectionDb(), '--timezone', tz]);
    if (!r.ok) return json(res, r.status, { error: r.error, detail: r.detail });
    return json(res, 200, r.payload);
  }
  if (req.method === 'GET' && url.pathname === '/api/activity') {
    const args = ['activity', '--db', projectionDb(),
      '--from', url.searchParams.get('from') || new Date(Date.now() - 86400_000).toISOString(),
      '--to', url.searchParams.get('to') || new Date().toISOString(),
      '--timezone', url.searchParams.get('timezone') || 'UTC',
      '--bucket', url.searchParams.get('bucket') || 'day',
      '--metric', url.searchParams.get('metric') || 'tokens',
      '--limit', url.searchParams.get('limit') || '500'];
    for (const p of url.searchParams.getAll('provider')) args.push('--provider', p);
    const r = runProjection(args);
    if (!r.ok) return json(res, r.status, { error: r.error, detail: r.detail });
    return json(res, 200, r.payload);
  }
  if (req.method === 'GET' && url.pathname === '/api/detected') {
    try { return json(res, 200, { platform: os.platform(), detected: detectProviders() }); }
    catch (e) { return json(res, 500, { error: 'detect_failed' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/registry') {
    const registry = loadRegistry().map(({ _asset, ...rest }) => rest);
    return json(res, 200, { providers: registry, count: registry.length });
  }
  if (req.method === 'POST' && url.pathname === '/api/ingest/claude') {
    let body='';
    for await (const chunk of req) body += chunk;
    try {
      const clean=sanitizeClaude(JSON.parse(body));
      fs.mkdirSync(path.dirname(SPOOL), { recursive:true, mode:0o700 });
      fs.appendFileSync(SPOOL, JSON.stringify(clean)+'\n', { mode:0o600 });
      return json(res, 202, { ok:true });
    } catch (error) {
      return json(res, 400, { ok:false, error:'invalid_json' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/ingest/event') {
    // Opt-in generic instrumentation: accepts ONLY telemetry fields
    // { provider, model, input_tokens, output_tokens, cost, request_id }.
    // Prompts/completions/message bodies are refused.
    let body='';
    for await (const chunk of req) { body += chunk; if (body.length > 32*1024) break; }
    try {
      const j = JSON.parse(body);
      if (j.prompt || j.completion || j.messages || j.content) return json(res, 400, { ok:false, error:'telemetry_fields_only' });
      // P0-11: missing dimensions stay null (source did not report them).
      // Zero means the source explicitly observed none.
      const numOrNull = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null));
      const clean = {
        observed_at: new Date().toISOString(),
        provider: String(j.provider || 'unknown').slice(0,64),
        model: String(j.model || 'unknown').slice(0,128),
        input_tokens: numOrNull(j.input_tokens ?? j.prompt_tokens),
        output_tokens: numOrNull(j.output_tokens ?? j.completion_tokens),
        cost: typeof j.cost === 'number' && j.cost >= 0 ? j.cost : null,
        request_id: typeof j.request_id === 'string' ? j.request_id.slice(0,128) : null,
        source: 'instrumented_response', scope: 'instrumented_traffic_only',
      };
      const dir = path.join(os.homedir(), '.usagehalo', 'inbox');
      fs.mkdirSync(dir, { recursive:true, mode:0o700 });
      fs.appendFileSync(path.join(dir, 'generic.jsonl'), JSON.stringify(clean)+'\n', { mode:0o600 });
      try { const { insertUsageEvent } = await import('../collectors/store.mjs'); insertUsageEvent({ ...clean, billing_owner: clean.provider, authority: 'instrumented_response' }); } catch {}
      return json(res, 202, { ok:true });
    } catch { return json(res, 400, { ok:false, error:'invalid_json' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/snapshot/legacy-import') {
    // One-shot copy of the legacy viusagever inbox into the new usagehalo
    // path. Idempotent: if the new file already exists, return
    // { migrated: false } without touching either file. If the legacy
    // file does not exist, return { migrated: false, reason: 'no_legacy' }.
    try {
      if (fs.existsSync(SPOOL)) {
        return json(res, 200, { migrated: false, reason: 'already_present' });
      }
      if (!fs.existsSync(SPOOL_LEGACY)) {
        return json(res, 200, { migrated: false, reason: 'no_legacy' });
      }
      const legacyContent = fs.readFileSync(SPOOL_LEGACY, 'utf8');
      // Validate every line is JSON before we copy; otherwise refuse.
      const lines = legacyContent.split(/\r?\n/).filter(l => l.trim());
      for (const line of lines) JSON.parse(line);
      fs.mkdirSync(path.dirname(SPOOL), { recursive: true, mode: 0o700 });
      fs.writeFileSync(SPOOL, legacyContent, { mode: 0o600 });
      return json(res, 200, { migrated: true, count: lines.length });
    } catch (error) {
      return json(res, 400, { ok: false, error: 'invalid_legacy_payload' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/rollups') {
    const tz = url.searchParams.get('timezone') || 'UTC';
    try {
      const events = reconcileEvents(readEvents(5000));
      return json(res, 200, { rollups: buildRollups(events, tz), timezone: tz, count: events.length, reconciled: true });
    } catch (e) {
      if (e instanceof RangeError) return json(res, 400, { error: 'unknown_timezone' });
      return json(res, 500, { error: 'rollup_failed' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/forecast') {
    const demoMode = isDemoRequest(url);
    if (!demoMode) {
      // P0-03: production forecasts require a persisted real time series with
      // a provider-supplied reset. That pipeline lands in Phase 3/4; until
      // then production honestly reports insufficient evidence instead of
      // mixing one real percent with hardcoded burn/reset/spend series.
      return json(res, 200, {
        quota_next_limit: { suppressed: true, reason: 'insufficient_evidence', detail: 'Need at least 5 non-stale quota observations spanning 15 minutes with a provider-supplied reset.' },
        spend_month: { suppressed: true, reason: 'insufficient_evidence', detail: 'No persisted real daily cost series yet.' },
        note: 'Forecast unavailable — collecting real pace data.',
      });
    }
    const snap = await snapshotWithLive(url);
    const claude = snap.providers.find((p) => p.id === 'claude-code');
    // Deterministic demo burn series; production feeds scheduler-observed hourly burn.
    const quota = forecastQuota({ usedPercent: claude?.primaryPercent ?? null, resetsAtIso: new Date(Date.now() + 51 * 60 * 1000).toISOString(), recentBurnPerHour: [8, 9, 11, 10, 12] });
    const spend = forecastSpend([2.1, 2.4, 1.9, 2.8, 2.5, 3.1, 2.2]);
    return json(res, 200, { quota_next_limit: quota, spend_month: spend, note: 'Projected values — visually distinct from provider observations.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/alerts') {
    const snap = await snapshotWithLive(url);
    const byId = Object.fromEntries(snap.providers.map((p) => [p.id, p]));
    const values = { 'claude-code:primaryPercent': byId['claude-code']?.primaryPercent ?? null, 'budget:percent': null };
    return json(res, 200, { fired: evaluateAll(DEFAULT_RULES, values), rules: DEFAULT_RULES.length, values, note: 'Budget percent is null until a real budget source is configured — never a hardcoded 62%.' });
  }
  if (req.method === 'GET' && url.pathname === '/api/widget') {
    // Mobile companion projection (Android widget / iOS Live Activity payload).
    const demoMode = isDemoRequest(url);
    const snap = await snapshotWithLive(url);
    const ranked = snap.providers.filter((p) => typeof p.primaryPercent === 'number');
    const top = [...ranked].sort((a, b) => b.primaryPercent - a.primaryPercent)[0] || null;
    if (!demoMode && !top) {
      return json(res, 200, {
        available: false, total_usage: null, total_cost: null, active: `0/${Math.min(6, snap.providers.length)}`,
        top_provider: null,
        providers: snap.providers.slice(0, 6).map((p) => ({ id: p.id, displayName: p.displayName, percent: p.primaryPercent, live: !!p.live })),
        resets_in: null, updated_at: new Date().toISOString(), note: 'No observed usage yet.',
      });
    }
    if (!demoMode) {
      const liveProviders = snap.providers.filter((p) => p.live);
      return json(res, 200, {
        available: true, total_usage: null, total_cost: null, active: `${liveProviders.length}/${snap.providers.length}`,
        top_provider: top ? { id: top.id, displayName: top.displayName, percent: top.primaryPercent, reset: top.primaryReset } : null,
        providers: snap.providers.slice(0, 6).map((p) => ({ id: p.id, displayName: p.displayName, percent: p.primaryPercent, live: !!p.live })),
        resets_in: top?.primaryReset || null, updated_at: new Date().toISOString(),
      });
    }
    return json(res, 200, {
      available: true, demo: true, total_usage: '58%', total_cost: '$12.47', active: `${Math.min(6, snap.providers.length)}/6`,
      top_provider: top ? { id: top.id, displayName: top.displayName, percent: top.primaryPercent, reset: top.primaryReset } : null,
      providers: snap.providers.slice(0, 6).map((p) => ({ id: p.id, displayName: p.displayName, percent: p.primaryPercent, live: !!p.live })),
      resets_in: '5d 12h', updated_at: new Date().toISOString(),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/codex/live') {
    // Official app-server protocol over stdio; never touches auth files.
    const r = await readCodexRateLimits(6000);
    if (r.live) {
      try {
        const { insertQuotaSnapshot } = await import('../collectors/store.mjs');
        for (const q of r.quotas) insertQuotaSnapshot({ ...q, observed_at: new Date().toISOString() });
      } catch {}
    }
    return json(res, 200, { live: r.live, reason: r.reason || null, quotas: r.quotas || [] });
  }
  if (req.method === 'POST' && (url.pathname === '/v1/metrics' || url.pathname === '/api/ingest/gemini')) {
    // Gemini CLI OTLP receiver: token metrics only, prompts never stored.
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 256 * 1024) break; }
    if (body.length > 256 * 1024) return json(res, 413, { ok: false, error: 'payload_too_large' });
    try {
      const parsed = ingestOtlpMetrics(JSON.parse(body));
      if (parsed.events.length) {
        const { insertUsageEvent } = await import('../collectors/store.mjs');
        let inserted = 0;
        for (const e of parsed.events) {
          const r = insertUsageEvent({
            provider: e.provider, billing_owner: e.billing_owner, model: e.model,
            input_tokens: e.input_tokens ?? null, output_tokens: e.output_tokens ?? null,
            observed_at: e.observed_at, authority: e.authority,
            reconciliation_key: null, request_id: null,
          });
          if (r.inserted) inserted++;
        }
        return json(res, 202, { ok: true, shape: parsed.shape, accepted: parsed.events.length, inserted });
      }
      return json(res, 202, { ok: true, shape: parsed.shape, accepted: 0, inserted: 0 });
    } catch { return json(res, 400, { ok: false, error: 'invalid_json' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/daemon') {
    try {
      const raw = fs.readFileSync(path.join(os.homedir(), '.usagehalo', 'store', 'daemon.json'), 'utf8');
      return json(res, 200, { daemon: JSON.parse(raw) });
    } catch { return json(res, 200, { daemon: null, note: 'daemon has not ticked yet; run node collectors/daemon.mjs --once' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/snapshot-cache') {
    // Converged file-store snapshot written by the daemon (max age 15 min).
    try {
      const file = path.join(os.homedir(), '.usagehalo', 'store', 'snapshot-cache.json');
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      const ageMs = Date.now() - new Date(payload.generated_at).getTime();
      if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
        return json(res, 200, { fresh: false, reason: 'stale_cache', generated_at: payload.generated_at || null });
      }
      return json(res, 200, { fresh: true, ...payload });
    } catch { return json(res, 200, { fresh: false, reason: 'no_cache' }); }
  }
  if (req.method === 'GET' && serveAssetsStatic(req, res, url)) return;
  if (req.method === 'GET' && serveDemoStatic(req, res, url)) return;
  json(res, 404, { error:'not_found' });
});

server.listen(PORT, '127.0.0.1', () => {
  const count = loadRegistry().length;
  console.log(`UsageHalo prototype: http://127.0.0.1:${PORT}`);
  console.log(`Snapshot API:        http://127.0.0.1:${PORT}/api/snapshot`);
  console.log(`Registry API:        http://127.0.0.1:${PORT}/api/registry`);
  console.log(`Providers loaded:    ${count}`);
});
