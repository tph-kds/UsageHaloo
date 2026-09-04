/**
 * UsageHalo live data shim.
 *
 * In a Tauri context, this would call `invoke('snapshot')` against the Rust
 * shell. In a browser context (e.g. `npm run dev` against the Node
 * prototype), it falls back to `fetch('/api/snapshot')`, which the Vite
 * dev server proxies to http://127.0.0.1:4897.
 *
 * The Tauri detection is intentionally lightweight: we look for the global
 * `__TAURI__` object that Tauri 2 injects. If present, we use the
 * `@tauri-apps/api/core` `invoke` (a dynamic import to keep the file
 * type-checked even when `@tauri-apps/api` is not installed for the
 * browser).
 *
 * The mock layer is retained as a fallback when the live fetch fails.
 * Toggle `USE_LIVE` to disable live data and force the mock.
 */
import type { ProviderView, SummaryMetric } from './types';
import { providers as mockProviders, summaries as mockSummaries } from './mock';

export const USE_LIVE = true;

export interface LiveSnapshot {
  generated_at: string;
  day_utc: string;
  data_basis: string;
  sample_data: boolean;
  provider_count: number;
  providers: ProviderView[];
  models: Array<{ surface: string; model_provider: string; billing_owner: string; model: string; tokens: number; cost: string }>;
  store?: { events: number; observed_tokens: number; provider_cost: number; requests: number };
}

interface TauriWindow { __TAURI__?: unknown }
function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as TauriWindow).__TAURI__);
}

function liveProviderToView(p: LiveSnapshot['providers'][number]): ProviderView {
  return {
    id: p.id,
    name: (p as unknown as { displayName?: string }).displayName ?? p.name,
    displayName: (p as unknown as { displayName?: string }).displayName,
    vendor: (p as unknown as { vendor?: string }).vendor,
    monogram: p.monogram,
    accent: p.accent,
    icon: (p as unknown as { icon?: string }).icon,
    primaryLabel: p.primaryLabel,
    primaryPercent: p.primaryPercent,
    primaryReset: p.primaryReset ?? null,
    secondaryLabel: p.secondaryLabel,
    secondaryPercent: p.secondaryPercent,
    secondaryReset: p.secondaryReset ?? null,
    tokensToday: p.tokensToday ?? null,
    costToday: p.costToday,
    freshness: p.freshness as ProviderView['freshness'],
    source: p.source,
    scope: p.scope,
    health: (p as unknown as { health?: string }).health,
    live: (p as unknown as { live?: boolean }).live,
    installed: (p as unknown as { installed?: boolean }).installed,
    configured: (p as unknown as { configured?: boolean }).configured,
    enabled: true,
    pinned: true
  };
}

export async function fetchSnapshot(): Promise<{ providers: ProviderView[]; summaries: SummaryMetric[]; models: LiveSnapshot['models']; sampleData: boolean; dayUtc: string | null; source: 'tauri' | 'browser' | 'mock' }> {
  if (USE_LIVE) {
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
        console.warn('UsageHalo: Tauri invoke failed, falling back to mock', e);
      }
    } else {
      try {
        const res = await fetch('/api/snapshot', { cache: 'no-store' });
        if (res.ok) {
          const snap = (await res.json()) as LiveSnapshot;
          return {
            providers: snap.providers.map(liveProviderToView),
            summaries: deriveSummaries(snap),
            models: snap.models ?? [],
            sampleData: snap.sample_data,
            dayUtc: snap.day_utc,
            source: 'browser'
          };
        }
      } catch (e) {
        console.warn('UsageHalo: fetch failed, falling back to mock', e);
      }
    }
  }
  return {
    providers: mockProviders,
    summaries: mockSummaries,
    models: [],
    sampleData: true,
    dayUtc: null,
    source: 'mock'
  };
}

function deriveSummaries(snap: LiveSnapshot): SummaryMetric[] {
  let tokens = 0;
  for (const p of snap.providers) {
    const t = p.tokensToday;
    if (typeof t !== 'string') continue;
    const m = t.match(/^([\d.]+)([KM])$/);
    if (!m) continue;
    const n = parseFloat(m[1]);
    tokens += m[2] === 'M' ? n * 1_000_000 : n * 1000;
  }
  let cost = 0;
  let costSources = 0;
  for (const p of snap.providers) {
    const c = p.costToday;
    if (typeof c !== 'string') continue;
    const m = c.match(/\$([\d.]+)/);
    if (m) { cost += parseFloat(m[1]); costSources++; }
  }
  const liveProviders = snap.providers.filter((p) => p.live).length;
  const storeRequests = snap.store?.requests;
  return [
    { label: 'Observed tokens', value: tokens ? `${(tokens / 1_000_000).toFixed(2)}M` : '—', meta: `${snap.providers.length} providers tracked` },
    { label: 'Provider cost', value: costSources ? `$${cost.toFixed(2)}` : '—', meta: costSources ? `sum of ${costSources} provider-reported cost${costSources === 1 ? '' : 's'}` : 'no provider-reported costs yet' },
    { label: 'Requests', value: typeof storeRequests === 'number' && storeRequests > 0 ? `${storeRequests}` : '—', meta: typeof storeRequests === 'number' && storeRequests > 0 ? 'observed store requests' : 'device-observed only' },
    { label: 'AI active time', value: '—', meta: 'device-observed only' },
    { label: 'Live providers', value: `${liveProviders}`, meta: liveProviders ? 'reporting live' : 'no live providers yet' }
  ];
}
