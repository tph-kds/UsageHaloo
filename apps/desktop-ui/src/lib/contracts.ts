/**
 * Canonical data contracts — TypeScript mirror of
 * `crates/usage-halo-core/src/contracts.rs` (remediation Phase 1).
 *
 * Wire format is snake_case, matching the snapshot APIs. UI code consumes
 * these typed numeric values and formats them ONLY through
 * formatQuantity()/formatMoney() at render time. Business logic must never
 * parse display strings like "1.42M", "$3.12" or "71%".
 */

/** Snapshot/projection wire schema version. Must equal Rust SCHEMA_VERSION. */
export const SCHEMA_VERSION = 1;

export type MetricUnit = 'percent' | 'tokens' | 'requests' | 'credits' | 'seconds' | 'bytes' | 'currency';
export type DataKind = 'provider_reported' | 'locally_observed' | 'reconciled' | 'estimated' | 'sample';
export type FreshnessState = 'live' | 'fresh' | 'delayed' | 'stale' | 'unknown';
export type ConnectionState =
  | 'unconfigured' | 'configured' | 'connecting' | 'connected'
  | 'auth_error' | 'rate_limited' | 'unavailable' | 'disabled';
export type AvailabilityState =
  | 'available' | 'no_data_yet' | 'unsupported'
  | 'insufficient_scope' | 'insufficient_evidence' | 'error';
export type AppMode = 'production' | 'demo' | 'test';

export interface MetricProvenance {
  source_connector: string;
  authority: DataKind;
  observed_at: string | null;
  received_at: string | null;
  ingested_at: string | null;
  freshness: FreshnessState;
  age_seconds: number | null;
  account_id: string | null;
  workspace_id: string | null;
  scope_label: string | null;
  sample: boolean;
}

/** Release-blocking invariant: sample === true iff authority is sample. */
export function isSample(p: MetricProvenance): boolean {
  return p.sample === (p.authority === 'sample');
}

export function freshnessLabel(f: FreshnessState): string {
  switch (f) {
    case 'live': return 'Live';
    case 'fresh': return 'Fresh';
    case 'delayed': return 'Delayed';
    case 'stale': return 'Stale';
    default: return 'Unknown';
  }
}

export function provenanceChip(p: MetricProvenance): 'Provider' | 'Observed' | 'Estimated' | 'Sample' {
  if (p.authority === 'sample' || p.sample) return 'Sample';
  if (p.authority === 'provider_reported') return 'Provider';
  if (p.authority === 'estimated') return 'Estimated';
  return 'Observed';
}

// ---- formatting boundary (the ONLY place display strings are made) --------

export function formatQuantity(value: number, unit: MetricUnit): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === 'percent') return `${value}%`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount == null) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const symbol = currency === 'USD' ? '$' : currency ? `${currency} ` : '';
  return `${symbol}${n.toFixed(2)}`;
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const ageS = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (ageS < 10) return 'just now';
  if (ageS < 60) return `${ageS}s ago`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m ago`;
  return `${Math.floor(ageS / 3600)}h ago`;
}
