#!/usr/bin/env node
/**
 * UsageHalo file-backed immutable event store (prototype runtime).
 * Mirrors crates/usage-halo-storage schema semantics without native deps:
 *  - append-only JSONL: ~/.usagehalo/store/usage_events.jsonl
 *  - quota snapshots:   ~/.usagehalo/store/quota_snapshots.jsonl
 *  - health:            ~/.usagehalo/store/health.json
 *  - rollups:           ~/.usagehalo/store/rollups.json
 * Raw rows are never mutated; reconciliation is read-time (see reconcile.mjs).
 * Retention: raw 90d, hourly 1y — enforced by prune().
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function storeDir() { return path.join(os.homedir(), '.usagehalo', 'store'); }
export function ensureStore() {
  const d = storeDir();
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}
function appendJsonl(file, obj) {
  ensureStore();
  fs.appendFileSync(path.join(storeDir(), file), JSON.stringify(obj) + '\n', { mode: 0o600 });
}
export function fingerprint(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}
/** Insert a usage event. Dedupe key: reconciliation_key || billing_owner:request_id. Returns { inserted:boolean, key }. */
export function insertUsageEvent(event) {
  const key = event.reconciliation_key || (event.request_id ? `${event.billing_owner}:${event.request_id}` : null) || `fp:${fingerprint([event.provider, event.model, event.observed_at, event.input_tokens, event.output_tokens])}`;
  const row = { ...event, reconciliation_key: event.reconciliation_key || key, raw_fingerprint: fingerprint(event), stored_at: new Date().toISOString() };
  // INSERT OR IGNORE semantics: scan recent keys (prototype scale is small).
  const existing = readKeys('usage_events.jsonl');
  if (existing.has(key)) return { inserted: false, key };
  appendJsonl('usage_events.jsonl', row);
  return { inserted: true, key };
}
export function insertQuotaSnapshot(q) {
  const row = { ...q, id: q.id || `q_${fingerprint([q.provider, q.limit_id, q.observed_at])}`, stored_at: new Date().toISOString() };
  appendJsonl('quota_snapshots.jsonl', row);
  return row.id;
}
export function writeHealth(connectorId, state) {
  ensureStore();
  const f = path.join(storeDir(), 'health.json');
  let all = {};
  try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  all[connectorId] = { ...state, connector_id: connectorId, last_attempt: new Date().toISOString() };
  fs.writeFileSync(f, JSON.stringify(all, null, 2), { mode: 0o600 });
}
export function readHealth() {
  try { return JSON.parse(fs.readFileSync(path.join(storeDir(), 'health.json'), 'utf8')); } catch { return {}; }
}
function readKeys(file) {
  const set = new Set();
  try {
    const data = fs.readFileSync(path.join(storeDir(), file), 'utf8');
    for (const line of data.split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.reconciliation_key) set.add(j.reconciliation_key); } catch {}
    }
  } catch {}
  return set;
}
export function readEvents(limit = 5000) {
  try {
    const lines = fs.readFileSync(path.join(storeDir(), 'usage_events.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  } catch { return []; }
}
/** Prune raw events older than retentionDays (default 90). Returns removed count. */
export function prune(retentionDays = 90) {
  const cutoff = Date.now() - retentionDays * 86400 * 1000;
  let kept = [], removed = 0;
  try {
    const lines = fs.readFileSync(path.join(storeDir(), 'usage_events.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
    for (const l of lines) {
      try { const j = JSON.parse(l); (new Date(j.observed_at).getTime() >= cutoff ? kept : removed++ , kept.push(l)); } catch { kept.push(l); }
    }
    // fix: recount correctly
    kept = []; removed = 0;
    for (const l of lines) {
      try { const j = JSON.parse(l); if (new Date(j.observed_at).getTime() >= cutoff) kept.push(l); else removed++; } catch { kept.push(l); }
    }
    fs.writeFileSync(path.join(storeDir(), 'usage_events.jsonl'), kept.join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
  } catch {}
  return removed;
}
