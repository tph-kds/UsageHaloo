#!/usr/bin/env node
/**
 * C3 history end-to-end (plain node, no dependencies).
 *
 * Seeds a TEMP store dir (isolated via USAGEHALO_STORE_DIR, respected by
 * collectors/store.mjs) with persisted UTC observations, then asserts:
 *  1. day-bucket attribution across an Asia/Ho_Chi_Minh midnight boundary
 *     puts the two events on different local days;
 *  2. a quota-gauge query returns snapshots-as-line — used_percent values
 *     are never summed;
 *  3. restart safety: a FRESH node process re-reading the same temp dir
 *     returns identical buckets.
 *
 * Exits nonzero on failure with clear messages.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'usagehalo-history-'));
process.env.USAGEHALO_STORE_DIR = TMP;

const { insertUsageEvent, insertQuotaSnapshot, readEvents } = await import('./store.mjs');
const { buildRollups, localDate } = await import('./scheduler.mjs');
const { reconcileEvents } = await import('./reconcile.mjs');

const failures = [];
function check(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else { failures.push(msg); console.error(`FAIL: ${msg}`); }
}

// Two UTC instants straddling a Ho Chi Minh City midnight:
// 2026-09-05T16:30Z = 23:30 local Sep 5; 2026-09-05T18:30Z = 01:30 local Sep 6.
const E1 = {
  observed_at: '2026-09-05T16:30:00.000Z', provider: 'openrouter', billing_owner: 'openrouter',
  model: 'claude-3.5-sonnet', input_tokens: 1000, output_tokens: 500,
  authority: 'instrumented_response', reconciliation_key: 'hist-e1',
};
const E2 = {
  observed_at: '2026-09-05T18:30:00.000Z', provider: 'openrouter', billing_owner: 'openrouter',
  model: 'claude-3.5-sonnet', input_tokens: 2000, output_tokens: 250,
  authority: 'instrumented_response', reconciliation_key: 'hist-e2',
};

const r1 = insertUsageEvent(E1);
const r2 = insertUsageEvent(E2);
check(r1.inserted && r2.inserted, 'both straddling events inserted');

// Isolation: rows landed in the temp dir, not the real store.
check(fs.existsSync(path.join(TMP, 'usage_events.jsonl')), `events persisted under temp dir (${TMP})`);

// Persist UTC: stored observed_at round-trips byte-identical, never rewritten to local wall time.
const stored = readEvents(5000).filter((e) => e.reconciliation_key === 'hist-e1' || e.reconciliation_key === 'hist-e2');
check(stored.length === 2, 'both seeded events re-read from the temp store');
for (const e of stored) {
  const want = e.reconciliation_key === 'hist-e1' ? E1.observed_at : E2.observed_at;
  check(e.observed_at === want, `UTC instant persisted verbatim for ${e.reconciliation_key} (${e.observed_at})`);
}

// UTC slicing would merge both events onto 2026-09-05 — documenting why the
// timezone conversion below is required instead of .slice(0, 10).
check(E1.observed_at.slice(0, 10) === E2.observed_at.slice(0, 10), 'precondition: UTC date-slicing merges the pair');
check(localDate('Asia/Ho_Chi_Minh', E1.observed_at) === '2026-09-05', 'E1 is Sep 5 in Asia/Ho_Chi_Minh');
check(localDate('Asia/Ho_Chi_Minh', E2.observed_at) === '2026-09-06', 'E2 is Sep 6 in Asia/Ho_Chi_Minh');

const rollups = buildRollups(reconcileEvents(readEvents(5000)), 'Asia/Ho_Chi_Minh')
  .filter((r) => r.model === 'claude-3.5-sonnet');
const byDay = new Map(rollups.map((r) => [r.local_date, r]));
check(byDay.size === 2 && byDay.has('2026-09-05') && byDay.has('2026-09-06'),
  `day-bucket attribution splits the pair across local days (got [${[...byDay.keys()]}])`);
check((byDay.get('2026-09-05')?.input_tokens ?? -1) === 1000, 'Sep 5 bucket holds only E1 tokens');
check(((byDay.get('2026-09-06')?.input_tokens ?? -1) + (byDay.get('2026-09-06')?.output_tokens ?? -1)) === 2250,
  'Sep 6 bucket holds only E2 tokens');

// Quota gauge: two snapshots for one limit; the query must return the latest
// snapshot as a line, never a sum of percents.
insertQuotaSnapshot({ provider: 'codex', limit_id: 'primary', label: 'Primary window', used_percent: 30, observed_at: '2026-09-05T10:00:00.000Z', source: 'quota_snapshot' });
insertQuotaSnapshot({ provider: 'codex', limit_id: 'primary', label: 'Primary window', used_percent: 50, observed_at: '2026-09-05T11:00:00.000Z', source: 'quota_snapshot' });
function latestQuotaPerLimit(rows) {
  // Mirrors prototype/server.mjs /api/quotas: latest observed_at wins per provider|limit.
  const latest = new Map();
  for (const q of rows) {
    if (!q || !q.provider || !q.limit_id) continue;
    const k = `${q.provider}|${q.limit_id}`;
    const cur = latest.get(k);
    if (!cur || String(q.observed_at) > String(cur.observed_at)) latest.set(k, q);
  }
  return latest;
}
const quotaRows = fs.readFileSync(path.join(TMP, 'quota_snapshots.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
check(JSON.stringify(quotaRows.map((q) => q.used_percent)) === '[30,50]', 'gauge snapshots persisted as lines, percents untouched');
const gauge = latestQuotaPerLimit(quotaRows).get('codex|primary');
check(gauge?.used_percent === 50 && gauge?.observed_at === '2026-09-05T11:00:00.000Z',
  `gauge query returns latest snapshot as a line (used_percent=${gauge?.used_percent})`);
check(gauge?.used_percent !== 80, 'gauge percents never summed (30 + 50 must not appear)');

// Static guard: the rollup/overlay path must never add used_percent values.
for (const rel of ['prototype/server.mjs', 'collectors/scheduler.mjs', 'collectors/store.mjs', 'collectors/forecast.mjs', 'collectors/daemon.mjs']) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const bad = src.split('\n').filter((line) => line.includes('used_percent') && /\+=|\.reduce\(|\bsum\s*\(/i.test(line));
  check(bad.length === 0, `${rel} never sums used_percent${bad.length ? ` (${bad[0].trim()})` : ''}`);
}

// Restart safety: a FRESH node process re-reads the same temp dir.
const childCode = [
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  "const root = process.env.USAGEHALO_HISTORY_ROOT;",
  "const { readEvents } = await import(pathToFileURL(path.join(root, 'collectors', 'store.mjs')).href);",
  "const { buildRollups } = await import(pathToFileURL(path.join(root, 'collectors', 'scheduler.mjs')).href);",
  "const { reconcileEvents } = await import(pathToFileURL(path.join(root, 'collectors', 'reconcile.mjs')).href);",
  "const rollups = buildRollups(reconcileEvents(readEvents(5000)), 'Asia/Ho_Chi_Minh');",
  "console.log(JSON.stringify(rollups));",
].join('\n');
let fresh = null;
try {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', childCode], {
    env: { ...process.env, USAGEHALO_STORE_DIR: TMP, USAGEHALO_HISTORY_ROOT: ROOT },
    encoding: 'utf8', timeout: 30000,
  });
  fresh = JSON.parse(out.trim());
} catch (e) {
  check(false, `fresh process re-read crashed: ${String(e.message || e).slice(0, 200)}`);
}
if (fresh) {
  const expected = buildRollups(reconcileEvents(readEvents(5000)), 'Asia/Ho_Chi_Minh');
  check(JSON.stringify(fresh) === JSON.stringify(expected), 'restart-safe: fresh process returns identical buckets');
}

if (failures.length) {
  console.error(`\nhistory end-to-end: ${failures.length} failure(s), temp dir kept at ${TMP}`);
  process.exit(1);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\nhistory end-to-end: all checks passed');
