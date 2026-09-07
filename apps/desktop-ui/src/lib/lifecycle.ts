import type { CollectorHealth, LifecycleStage, ProviderConnection, ProviderView } from './types';

// Freshness threshold: observations older than this are stale and must
// never be counted in today's usage or treated as a live quota (§7).
export const FRESHNESS_THRESHOLD_MS = 15 * 60 * 1000;

export function ageMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Date.now() - t;
}

export function ageLabel(iso: string | null | undefined): string {
  const age = ageMs(iso);
  if (age == null) return 'never observed';
  if (age < 10_000) return 'just now';
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return `${Math.floor(age / 86_400_000)}d ago`;
}

export function isFresh(iso: string | null | undefined): boolean {
  const age = ageMs(iso);
  return age != null && age < FRESHNESS_THRESHOLD_MS;
}

// Resolve lifecycle stage from connection + detection + observation (§2).
export function resolveStage(
  connection: ProviderConnection | undefined,
  detected: boolean,
  hasRecentObservation: boolean,
): LifecycleStage {
  if (connection && connection.enabled && hasRecentObservation) return 'collecting';
  if (connection) return 'connected';
  if (detected) return 'detected';
  return 'available';
}

export function healthLabel(h: CollectorHealth | string | undefined): string {
  switch (h) {
    case 'healthy': return 'Healthy';
    case 'stale': return 'Stale';
    case 'auth_required': return 'Authentication required';
    case 'rate_limited': return 'Rate limited';
    case 'unsupported': return 'Unsupported for this account';
    case 'offline': return 'Offline';
    default: return 'Unknown';
  }
}

// UNKNOWN != ZERO (§13). Cost renders "Cost unavailable" unless
// zero is authoritative (explicit zero from provider billing).
export function costDisplay(costToday: string | null | undefined, costValue: number | null | undefined): string {
  if (typeof costValue === 'number' && Number.isFinite(costValue)) {
    if (costValue === 0) return '$0.00';
    return `$${costValue.toFixed(2)}`;
  }
  if (costToday == null) return 'Cost unavailable';
  const t = costToday.trim();
  if (t === '' || t === '—' || t === '--' || t.toLowerCase() === 'subscription') return 'Cost unavailable';
  if (/^\$0\.00(\s|session)?$/.test(t)) return t; // authoritative zero passes through
  if (t.endsWith('session')) return t; // session figure, labeled as such
  return t;
}

export function quotaDisplay(p: ProviderView): string {
  if (p.primaryPercent == null) return 'No observations yet';
  return `${p.primaryPercent}% · ${p.primaryLabel}`;
}

// Cursor using Claude model: billing owner = Cursor, model vendor = Anthropic.
// Never counted as direct Anthropic usage (§6, TEST 10).
export function billingLine(m: { billing_owner: string; model_provider: string; model: string }): string {
  if (m.model_provider && m.model_provider !== m.billing_owner) {
    return `${m.model} · billed to ${m.billing_owner} · model by ${m.model_provider}`;
  }
  return `${m.model} · billed to ${m.billing_owner}`;
}

export function planDisplay(plan: string, source: string): string {
  const src = source === 'provider_reported' ? 'provider reported'
    : source === 'user_declared' ? 'user declared' : 'unknown';
  return `${plan} · ${src}`;
}

const CONN_KEY = 'usagehalo.connections.v1';
const BUDGET_KEY = 'usagehalo.budgets.v1';
const ALERT_KEY = 'usagehalo.alertrules.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export const connectionStore = {
  all(): ProviderConnection[] { return read<ProviderConnection[]>(CONN_KEY, []); },
  save(list: ProviderConnection[]) { write(CONN_KEY, list); },
};

export const budgetStore = {
  all(): import('./types').Budget[] { return read<import('./types').Budget[]>(BUDGET_KEY, []); },
  save(list: import('./types').Budget[]) { write(BUDGET_KEY, list); },
};

export const alertStore = {
  all(): import('./types').AlertRule[] {
    const existing = read<import('./types').AlertRule[]>(ALERT_KEY, []);
    if (existing.length) return existing;
    return [
      { id: 'a1', label: 'Notify at 80% of OpenRouter monthly budget', kind: 'budget', threshold: 80, target: 'openrouter', enabled: true },
      { id: 'a2', label: 'Notify when Codex connector is stale over 10 min', kind: 'stale', threshold: 10, target: 'codex', enabled: true },
      { id: 'a3', label: 'Notify at 90% of Gemini quota', kind: 'quota', threshold: 90, target: 'gemini-cli', enabled: false },
    ];
  },
  save(list: import('./types').AlertRule[]) { write(ALERT_KEY, list); },
};
