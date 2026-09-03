#!/usr/bin/env node
/**
 * Read-time reconciliation (mirrors crates/usage-halo-reconcile semantics).
 * - Explicit keys only: reconciliation_key || billing_owner:request_id.
 * - Authority order: provider_billing > provider_telemetry > instrumented_response > derived > imported > estimated.
 * - Winner keeps authoritative cost; loser fills missing token detail.
 */
const AUTHORITY_RANK = { estimated: 0, imported: 1, derived: 2, instrumented_response: 3, provider_telemetry: 4, provider_billing: 5 };
export function authorityRank(a) { return AUTHORITY_RANK[a] ?? -1; }
export function reconcileEvents(events) {
  const keyed = new Map(); const unkeyed = [];
  for (const e of events) {
    const key = e.reconciliation_key || (e.request_id ? `${e.billing_owner}:${e.request_id}` : null);
    if (!key) { unkeyed.push(e); continue; }
    const cur = keyed.get(key);
    if (!cur) { keyed.set(key, e); continue; }
    const rNew = authorityRank(e.authority || e.source_authority);
    const rCur = authorityRank(cur.authority || cur.source_authority);
    const winner = rNew > rCur || (rNew === rCur && (e.observed_at || '') > (cur.observed_at || '')) ? e : cur;
    const loser = winner === e ? cur : e;
    keyed.set(key, mergeDetail(loser, winner));
  }
  return [...keyed.values(), ...unkeyed];
}
function mergeDetail(loser, winner) {
  const out = { ...winner };
  for (const k of ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_read_tokens', 'cache_write_tokens', 'provider_cost', 'estimated_cost']) {
    if (out[k] == null && loser[k] != null) out[k] = loser[k];
  }
  return out;
}
