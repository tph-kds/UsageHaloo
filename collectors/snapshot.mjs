#!/usr/bin/env node
/**
 * Converged snapshot builder (prototype + file-store + Tauri convergence path).
 * Pure function: registry + reconciled store events + live overlays + detection
 * → provider rows in the exact `/api/snapshot` shape. The daemon writes this
 * to `store/snapshot-cache.json` each tick; `GET /api/snapshot-cache` serves
 * it when fresh. Contract-tested in tests/test_snapshot.py.
 */
export const REQUIRED_PROVIDER_FIELDS = [
  'id', 'displayName', 'accent', 'monogram', 'connector', 'sourceMode',
  'freshness', 'scope', 'primaryMetric', 'primaryLabel', 'primaryPercent',
  'icon', 'source', 'health',
];

export function buildProviderRows({ registry, events = [], live = {}, detected = [], dayUtc = null, assetMap = {} }) {
  const byEvent = new Map();
  for (const e of events) {
    const k = e.provider || e.billing_owner;
    if (!k) continue;
    const cur = byEvent.get(k) || { tokens: 0, cost: 0, requests: 0, models: [] };
    cur.tokens += (e.input_tokens || 0) + (e.output_tokens || 0);
    cur.cost += e.provider_cost || 0;
    cur.requests += e.requests || 0;
    if (e.model && !cur.models.includes(e.model) && cur.models.length < 6) cur.models.push(e.model);
    byEvent.set(k, cur);
  }
  const detById = new Map(detected.map((d) => [d.id, d]));
  return registry.map((p) => {
    const overlay = live[p.id];
    const det = detById.get(p.id);
    const agg = byEvent.get(p.id);
    const asset = assetMap[p.id] || { dir: p.id, stem: p.id };
    const row = {
      id: p.id,
      displayName: p.displayName,
      vendor: p.vendor || null,
      monogram: p.monogram,
      accent: p.accent,
      connector: p.connector,
      status: p.status,
      sourceMode: p.sourceMode,
      freshness: p.freshness,
      scope: p.scope,
      primaryMetric: p.primaryMetric,
      primaryLabel: p.primaryLabel || p.primaryMetric,
      primaryPercent: null,
      primaryReset: null,
      secondaryLabel: null,
      secondaryPercent: null,
      secondaryReset: null,
      tokensToday: agg && agg.tokens ? String(agg.tokens) : null,
      costToday: agg && agg.cost ? `$${agg.cost.toFixed(2)}` : null,
      source: p.sourceMode,
      health: 'fresh',
      live: false,
      installed: !!det?.installed,
      configured: !!det?.configured,
      day_utc: dayUtc,
      icon: `/assets/providers/${asset.dir}/${asset.stem}.svg`,
    };
    if (overlay && overlay.live) {
      row.live = true;
      if (overlay.primaryPercent != null) row.primaryPercent = overlay.primaryPercent;
      if (overlay.source) { row.source = overlay.source; }
      if (overlay.freshness) { row.freshness = overlay.freshness; row.health = 'healthy'; }
    }
    return row;
  });
}

export function validateRows(rows) {
  const problems = [];
  rows.forEach((p, i) => {
    for (const f of REQUIRED_PROVIDER_FIELDS) {
      if (!(f in p)) problems.push(`row ${i} (${p.id}): missing ${f}`);
    }
  });
  return problems;
}
