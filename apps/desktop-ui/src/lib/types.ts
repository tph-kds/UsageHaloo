export type Freshness = 'live' | 'fresh' | 'hourly' | 'daily' | 'manual' | 'stale' | 'unknown' | string;

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
  /** Canonical numerics (Phase 1): null = unavailable. Display strings are render-only. */
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
};

export type SummaryMetric = {
  label: string;
  value: string;
  meta: string;
};
