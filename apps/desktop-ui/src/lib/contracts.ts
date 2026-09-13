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

// ---- V2 canonical source contract (mirror of `source.rs`) ------------------

export type SourceFidelity =
  | 'official_public' | 'official_session' | 'first_party_local' | 'derived' | 'manual';
export type ObservationStatus =
  | 'live' | 'stale' | 'derived'
  | 'needs_auth' | 'rate_limited' | 'unavailable' | 'unsupported' | 'error' | 'disabled' | 'demo';
export type SourceKind =
  | 'api' | 'cli' | 'local_db' | 'local_cache' | 'local_log' | 'runtime_api' | 'language_server' | 'manual';

export interface SourceDescriptor {
  source_id: string;
  provider_id: string;
  kind: SourceKind;
  fidelity: SourceFidelity;
  label: string;
  requires_local_access: boolean;
}

export interface UsageWindow {
  id: string;
  label: string;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  used_fraction: number | null;
  starts_at: string | null;
  resets_at: string | null;
  duration_minutes: number | null;
  source_metric_id: string;
}

export interface ProviderSnapshotDisplay {
  provider_id: string;
  account_key: string | null;
  account_label: string | null;
  collected_at: string;
  last_successful_at: string | null;
  headline_metric_id: string | null;
  capabilities: string[];
  active_source_id: string | null;
  windows: UsageWindow[];
  activity_state: string | null;
  activity_observed_at: string | null;
  activity_source_id: string | null;
  health_state: ObservationStatus;
  health_message: string | null;
  retry_at: string | null;
}

/** True only for statuses that may back a user-visible number. */
export function isUserVisibleValue(s: ObservationStatus): boolean {
  return s === 'live' || s === 'stale' || s === 'derived';
}

/** Prefer the provider fraction; else used/limit. Never guesses or divides by zero/unknown. */
export function honestFraction(
  used: number | null | undefined,
  limit: number | null | undefined,
  authoritative: number | null | undefined,
): number | null {
  if (typeof authoritative === 'number') {
    if (Number.isFinite(authoritative) && authoritative >= 0 && authoritative <= 1) {
      return authoritative;
    }
    return null;
  }
  if (
    typeof used === 'number' && typeof limit === 'number' &&
    Number.isFinite(used) && Number.isFinite(limit) && limit > 0 && used >= 0
  ) {
    return used / limit;
  }
  return null;
}

/** Find the headline window by metric id. Never falls back to windows[0]. */
export function resolveHeadline(
  windows: UsageWindow[],
  headlineMetricId: string | null | undefined,
): UsageWindow | null {
  if (!headlineMetricId) return null;
  return windows.find((w) => w.source_metric_id === headlineMetricId) ?? null;
}
