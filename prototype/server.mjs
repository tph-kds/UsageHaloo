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
import { buildRollups, CONNECTOR_SCHEDULE } from '../collectors/scheduler.mjs';
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
function snapshotLive(url) {
  const registry = loadRegistry();
  if (url && isDemoRequest(url)) return determinSnapshot(registry, latestSpoolRecord());
  const { record } = latestRealSpoolRecord();
  return honestSnapshot(registry, record || {});
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
  // freshness — it is never relabeled sample and never hidden.
  if (cl && 'observed_at' in cl) {
    const e = base.providers.find((p) => p.id === 'claude-code');
    if (e) {
      e.live = !!cl.live;
      e.provenance = { source: 'claude_code_statusline', scope: 'account', freshness: cl.freshness || 'unknown', authority: 'provider_telemetry', sample: false };
    }
  }
  base.detected = detected;
  base.live = live;
  base.live_overlay = true;
  // data_basis stays stable per mode for contract tests; detail in data_basis_detail.
  base.data_basis_detail = demoMode ? 'registry+per-day-deterministic+live-overlay' : 'registry+live-overlay';
  // Honest mode: sample_data true only when demo numbers present or a real
  // Claude spool exists. Honest-empty default reports sample_data:false.
  if (!demoMode) {
    const hasLiveSpool = (() => { try { return !!readClaudeSpool().live; } catch { return false; } })();
    const hasAnyLive = hasLiveSpool || !!(or && or.live) || !!(ol && ol.live) || !!(lm && lm.live);
    base.sample_data = false;
    base.has_live_data = hasAnyLive;
  }
  return base;
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
    try {
      const events = reconcileEvents(readEvents(5000));
      return json(res, 200, { rollups: buildRollups(events), count: events.length, reconciled: true });
    } catch { return json(res, 500, { error: 'rollup_failed' }); }
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
