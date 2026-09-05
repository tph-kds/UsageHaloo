/**
 * UsageHalo live data source.
 *
 * In a Tauri context, this calls `invoke('snapshot')` against the Rust
 * shell. In a browser context (e.g. `npm run dev` against the Node
 * prototype), it fetches `/api/snapshot`, which the Vite dev server proxies
 * to http://127.0.0.1:4897.
 *
 * P0-02 truth rule: production NEVER falls back to mock/sample providers
 * when the real backend fails. A failed first load returns an explicit
 * error state with zero provider numbers; a failed refresh is reported so
 * the caller can retain its last-known real snapshot as STALE.
 *
 * Mock providers live in `./mock` and are reachable ONLY through
 * `fetchDemoSnapshot()`, which the UI may call solely in explicit demo mode
 * (every demo metric is then labeled SAMPLE).
 */
import type { ProviderView, SummaryMetric } from './types';
import { providers as mockProviders, summaries as mockSummaries } from './mock';

import { SCHEMA_VERSION } from './contracts';

export const USE_LIVE = true;

export type SnapshotSource = 'tauri' | 'browser' | 'demo' | 'error';

export interface SnapshotProvider {
  id: string;
  name?: string;
  displayName?: string;
  vendor?: string;
  monogram: string;
  accent: string;
  icon?: string;
  primaryLabel: string;
  primaryPercent: number | null;
  primaryReset?: string | null;
  secondaryLabel?: string;
  secondaryPercent?: number | null;
  secondaryReset?: string | null;
  tokensToday?: string | null;
  costToday?: string | null;
  /** Canonical numerics (Phase 1): null = unavailable. Display strings above are render-only. */
  tokens_today_value?: number | null;
  cost_today_value?: number | null;
  freshness: string;
  source: string;
  scope: string;
  health?: string;
  live?: boolean;
  installed?: boolean;
  configured?: boolean;
}

export interface LiveSnapshot {
  schema_version?: number;
  generated_at: string;
  day_utc: string;
  data_basis: string;
  sample_data: boolean;
  provider_count: number;
  providers: SnapshotProvider[];
  models: Array<{ surface: string; model_provider: string; billing_owner: string; model: string; tokens: number; cost: string }>;
  store?: { events: number; observed_tokens: number; provider_cost: number; requests: number };
}

interface TauriWindow { __TAURI__?: unknown }
function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as TauriWindow).__TAURI__);
}

function liveProviderToView(p: SnapshotProvider): ProviderView {
  return {
    id: p.id,
    name: p.displayName ?? p.name ?? p.id,
    displayName: p.displayName,
    vendor: p.vendor,
    monogram: p.monogram,
    accent: p.accent,
    icon: p.icon,
    primaryLabel: p.primaryLabel,
    primaryPercent: p.primaryPercent,
    primaryReset: p.primaryReset ?? null,
    secondaryLabel: p.secondaryLabel,
    secondaryPercent: p.secondaryPercent,
    secondaryReset: p.secondaryReset ?? null,
    tokensToday: p.tokensToday ?? null,
    costToday: p.costToday,
    tokens_today_value: p.tokens_today_value ?? null,
    cost_today_value: p.cost_today_value ?? null,
    freshness: p.freshness as ProviderView['freshness'],
    source: p.source,
    scope: p.scope,
    health: p.health,
    live: p.live,
    installed: p.installed,
    configured: p.configured,
    enabled: true,
    pinned: true
  };
}

export interface SnapshotResult {
  providers: ProviderView[];
  summaries: SummaryMetric[];
  models: LiveSnapshot['models'];
  sampleData: boolean;
  dayUtc: string | null;
  source: SnapshotSource;
  /** Present only when source === 'error': why the refresh failed. */
  error?: string;
}

export async function fetchSnapshot(): Promise<SnapshotResult> {
  if (!USE_LIVE) return fetchDemoSnapshot();
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const snap = (await invoke('snapshot')) as LiveSnapshot;
      return {
        providers: snap.providers.map(liveProviderToView),
        summaries: deriveSummaries(snap),
        models: snap.models ?? [],
        sampleData: snap.sample_data,
        dayUtc: snap.day_utc,
        source: 'tauri'
      };
    } catch (e) {
      // Honest failure: no numbers, caller retains last-known as stale.
      return emptyError(`Tauri snapshot failed: ${String(e).slice(0, 160)}`);
    }
  }
  try {
    const res = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!res.ok) return emptyError(`Snapshot HTTP ${res.status}`);
    const snap = (await res.json()) as LiveSnapshot;
    // Phase 1 version gate: reject incompatible wire schemas with a clear
    // error instead of silently misreading fields. (Tauri path migrates to
    // the canonical projection service in Phase 4.)
    if (snap.schema_version !== SCHEMA_VERSION) {
      return emptyError(`Snapshot schema v${String(snap.schema_version)} != v${SCHEMA_VERSION} — update UsageHalo`);
    }
    return {
      providers: snap.providers.map(liveProviderToView),
      summaries: deriveSummaries(snap),
      models: snap.models ?? [],
      sampleData: snap.sample_data,
      dayUtc: snap.day_utc,
      source: 'browser'
    };
  } catch (e) {
    return emptyError(`Snapshot fetch failed: ${String(e).slice(0, 160)}`);
  }
}

function emptyError(error: string): SnapshotResult {
  console.warn('UsageHalo:', error, '— showing no data, never mock data.');
  return { providers: [], summaries: [], models: [], sampleData: false, dayUtc: null, source: 'error', error };
}

/** Explicit demo mode ONLY. Every metric from here must render as SAMPLE. */
export function fetchDemoSnapshot(): SnapshotResult {
  return {
    providers: mockProviders,
    summaries: mockSummaries,
    models: [],
    sampleData: true,
    dayUtc: null,
    source: 'demo'
  };
}

function deriveSummaries(snap: LiveSnapshot): SummaryMetric[] {
  // Phase 1: totals come ONLY from canonical numeric fields. Display strings
  // (tokensToday/costToday) are render-only and never parsed back.
  let tokens = 0;
  let tokenSources = 0;
  for (const p of snap.providers) {
    if (typeof p.tokens_today_value === 'number' && Number.isFinite(p.tokens_today_value)) {
      tokens += p.tokens_today_value;
      tokenSources++;
    }
  }
  let cost = 0;
  let costSources = 0;
  for (const p of snap.providers) {
    if (typeof p.cost_today_value === 'number' && Number.isFinite(p.cost_today_value)) {
      cost += p.cost_today_value;
      costSources++;
    }
  }
  const liveProviders = snap.providers.filter((p) => p.live).length;
  const storeRequests = snap.store?.requests;
  return [
    { label: 'Observed tokens', value: tokenSources ? `${(tokens / 1_000_000).toFixed(2)}M` : '—', meta: tokenSources ? `sum of ${tokenSources} observed token counts` : 'no observed token counts yet' },
    { label: 'Provider cost', value: costSources ? `$${cost.toFixed(2)}` : '—', meta: costSources ? `sum of ${costSources} provider-reported cost${costSources === 1 ? '' : 's'}` : 'no provider-reported costs yet' },
    { label: 'Requests', value: typeof storeRequests === 'number' && storeRequests > 0 ? `${storeRequests}` : '—', meta: typeof storeRequests === 'number' && storeRequests > 0 ? 'observed store requests' : 'device-observed only' },
    { label: 'AI active time', value: '—', meta: 'device-observed only' },
    { label: 'Live providers', value: `${liveProviders}`, meta: liveProviders ? 'reporting live' : 'no live providers yet' }
  ];
}
