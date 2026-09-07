export type Freshness = 'live' | 'fresh' | 'hourly' | 'daily' | 'manual' | 'stale' | 'unknown' | string;

// ---- vNext lifecycle (§2, §6) ----
// Detection is only a suggestion. Detection must never mean
// connected, enabled, live, or actively used.
export type LifecycleStage =
  | 'available'
  | 'detected'
  | 'configuring'
  | 'connected'
  | 'collecting';

export type CollectorHealth =
  | 'healthy'
  | 'stale'
  | 'auth_required'
  | 'rate_limited'
  | 'unsupported'
  | 'offline'
  | 'unknown';

export type ConnectionMethod =
  | 'cli_bridge'
  | 'otlp'
  | 'api_key'
  | 'oauth'
  | 'local_protocol'
  | 'admin_api';

export type PlanSource = 'provider_reported' | 'user_declared' | 'unknown';

export interface ConnectionMethodDef {
  id: ConnectionMethod;
  label: string;
  detail: string;
  capabilities: string[];
  quotaNote?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  vendor: string;
  monogram: string;
  accent: string;
  icon?: string;
  group: 'Coding tools' | 'API providers' | 'Local';
  methods: ConnectionMethodDef[];
  maturity: string;
  docs: string;
}

export interface ProviderConnection {
  id: string;
  provider_id: string;
  display_name: string;
  connection_method: ConnectionMethod;
  enabled: boolean;
  pinned: boolean;
  plan: 'Free' | 'Paid' | 'Enterprise' | 'Unknown';
  plan_source: PlanSource;
  poll_interval: 'automatic' | '5m' | '15m' | '1h' | 'manual';
  credential_alias: string | null;
  created_at: string;
  last_validated_at: string | null;
}

export type ProviderView = {
  id: string;
  name: string;
  displayName?: string;
  vendor?: string;
  monogram: string;
  accent: string;
  icon?: string;
  primaryLabel: string;
  primaryPercent: number | null;
  primaryReset: string | null;
  secondaryLabel?: string;
  secondaryPercent?: number | null;
  secondaryReset?: string | null;
  tokensToday?: string | null;
  costToday?: string | null;
  /** Canonical numerics: null = unavailable. Display strings are render-only. */
  tokens_today_value?: number | null;
  cost_today_value?: number | null;
  freshness: Freshness;
  source: string;
  scope: string;
  health?: string;
  live?: boolean;
  installed?: boolean;
  configured?: boolean;
  enabled: boolean;
  pinned: boolean;
  /** vNext lifecycle (UI-resolved, §2). */
  stage?: LifecycleStage;
  collectorHealth?: CollectorHealth;
  lastSeenAt?: string | null;
  connectionId?: string | null;
};

export type SummaryMetric = {
  label: string;
  value: string;
  meta: string;
};

export type DatePreset =
  | 'today'
  | 'last7'
  | 'week'
  | 'last30'
  | 'month'
  | 'billing'
  | 'custom';

export interface DateRange {
  start: string;
  end: string;
  timezone: string;
  preset: DatePreset;
}

export interface Budget {
  id: string;
  label: string;
  limit: number;
  currency: string;
  period: 'monthly' | 'weekly';
  scope: string;
}

export interface AlertRule {
  id: string;
  label: string;
  kind: 'budget' | 'stale' | 'quota';
  threshold: number;
  target: string;
  enabled: boolean;
}
