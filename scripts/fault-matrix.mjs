#!/usr/bin/env node
// WP15 failure-hardening probe (PLAN Phase E, task E1). Spawns the prototype
// server per case with HOME/USERPROFILE/APPDATA redirected into a temp dir so
// the real ~/.usagehalo, ~/.codex and %APPDATA%/Cursor are never touched.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'prototype', 'server.mjs');
const FIX_STALE = path.join(ROOT, 'fixtures', 'claude', 'usage-stale.json');
const FIX_LIVE = path.join(ROOT, 'fixtures', 'claude', 'usage-live.json');
// server.mjs reads Number(process.env.VIUSAGEVER_PORT || 4897); PORT alone is ignored.
const PORT = 14897;
const HOST = '127.0.0.1';
const CASE_BUDGET_MS = 10_000;

// Already proven by unit tests, referenced here so the matrix does not re-prove
// them: 429/backoff persistence across collector restart, wrong-account gate,
// malformed rollout fallback, DB WAL locking, out-of-range percent clamping.

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'uh-fault-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHome(tag) {
  const home = path.join(tmpBase, tag);
  const appdata = path.join(tmpBase, `${tag}-appdata`);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(appdata, { recursive: true });
  return { home, appdata };
}

function childEnv(home, appdata) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: appdata,
    CODEX_HOME: path.join(home, '.codex'),
    VIUSAGEVER_PORT: String(PORT),
    PORT: String(PORT),
  };
  // Keep live-network/API and demo overlays out of the matrix.
  for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SAMPLE_MODE']) delete env[k];
  return env;
}

function startServer(env) {
  return spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function fetchJson(port, route, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: route, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error(`unparseable ${route}: ${String(e.message)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('fetch timeout')));
    req.on('error', reject);
  });
}

async function waitReady(port, child, timeoutMs = CASE_BUDGET_MS) {
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try {
      const r = await fetchJson(port, '/api/health', 1000);
      if (r.status === 200) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('server not ready in budget');
    await sleep(150);
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill(); } catch { /* already gone */ }
  const t0 = Date.now();
  while (child.exitCode === null && Date.now() - t0 < 3000) await sleep(100);
  if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  await sleep(400); // let the fixed port release before the next serial case
}

const byId = (snap, id) => (snap?.providers || []).find((p) => p.id === id);
const results = [];
function report(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

async function withServer(home, appdata, fn) {
  const child = startServer(childEnv(home, appdata));
  const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, CASE_BUDGET_MS);
  try {
    await waitReady(PORT, child);
    return await fn(child);
  } finally {
    clearTimeout(killer);
    await stopServer(child);
  }
}

async function case1EmptyHome() {
  const { home, appdata } = makeHome('empty');
  await withServer(home, appdata, async () => {
    const { status, body } = await fetchJson(PORT, '/api/snapshot');
    const ids = ['claude-code', 'codex', 'cursor', 'gemini-cli'];
    const states = ids.map((id) => `${id}:${byId(body, id)?.v2?.health_state}/${byId(body, id)?.v2?.windows?.length}`);
    const ok = status === 200 && ids.every((id) => {
      const v2 = byId(body, id)?.v2;
      return v2 && (v2.health_state === 'unavailable' || v2.health_state === 'unsupported') && v2.windows.length === 0;
    });
    report('1-empty-home', ok, `http=${status} ${states.join(' ')}`);
  }).catch((e) => report('1-empty-home', false, `throw=${e.message}`));
}

async function case2MalformedSpool() {
  const { home, appdata } = makeHome('malformed');
  const inbox = path.join(home, '.usagehalo', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, 'claude-code.jsonl'), 'this is not json\n{"rate_limits": {"five_hour": {\n');
  await withServer(home, appdata, async () => {
    const { status, body } = await fetchJson(PORT, '/api/snapshot');
    const v2 = byId(body, 'claude-code')?.v2;
    // Newest-line parse throws -> caught -> unavailable with zero windows; never a 5xx.
    const ok = status === 200 && v2 && (v2.health_state === 'unavailable' || v2.health_state === 'error');
    report('2-malformed-spool', ok, `http=${status} claude:${v2?.health_state}/${v2?.windows?.length}`);
  }).catch((e) => report('2-malformed-spool', false, `throw=${e.message}`));
}

async function case3StaleSpool() {
  const { home, appdata } = makeHome('stale');
  const inbox = path.join(home, '.usagehalo', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const rec = JSON.parse(fs.readFileSync(FIX_STALE, 'utf8'));
  fs.writeFileSync(path.join(inbox, 'claude-code.jsonl'), JSON.stringify(rec) + '\n');
  await withServer(home, appdata, async () => {
    const { status, body } = await fetchJson(PORT, '/api/snapshot');
    const v2 = byId(body, 'claude-code')?.v2;
    const ok = status === 200 && v2?.health_state === 'stale' && v2?.windows?.length === 0;
    report('3-stale-spool', ok, `http=${status} claude:${v2?.health_state}/${v2?.windows?.length} observed=${v2?.observed_at}`);
  }).catch((e) => report('3-stale-spool', false, `throw=${e.message}`));
}

async function case4LiveSpool() {
  const { home, appdata } = makeHome('live');
  const inbox = path.join(home, '.usagehalo', 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const rec = JSON.parse(fs.readFileSync(FIX_LIVE, 'utf8'));
  rec.observed_at = new Date().toISOString();
  fs.writeFileSync(path.join(inbox, 'claude-code.jsonl'), JSON.stringify(rec) + '\n');
  await withServer(home, appdata, async () => {
    const { status, body } = await fetchJson(PORT, '/api/snapshot');
    const v2 = byId(body, 'claude-code')?.v2;
    const ok = status === 200 && v2?.health_state === 'live' && v2?.windows?.length === 2 && v2?.headline_metric_id === 'five_hour';
    report('4-live-spool', ok, `http=${status} claude:${v2?.health_state}/${v2?.windows?.length} headline=${v2?.headline_metric_id}`);
  }).catch((e) => report('4-live-spool', false, `throw=${e.message}`));
}

async function case5KilledServer() {
  const { home, appdata } = makeHome('killed');
  const child = startServer(childEnv(home, appdata));
  try {
    await waitReady(PORT, child);
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    await sleep(600);
    // Transport has no fallback: a dead server must surface as refused, not empty data.
    try {
      await fetchJson(PORT, '/api/snapshot', 3000);
      report('5-killed-server', false, 'fetch unexpectedly succeeded');
    } catch (e) {
      const refused = /ECONNREFUSED/i.test(`${e.code || ''} ${e.message || ''}`);
      report('5-killed-server', refused, `fetch failed code=${e.code || '?'} msg=${(e.message || '').slice(0, 80)}`);
    }
  } catch (e) {
    report('5-killed-server', false, `setup throw=${e.message}`);
  } finally {
    await stopServer(child);
  }
}

async function case6DisabledSemantics() {
  // localStorage/connection-level disable is UI state with no server signal, so
  // the probe asserts its observable consequence: a never-connected provider
  // carries no snapshot numbers (perplexity: null percents, not live).
  const { home, appdata } = makeHome('disabled');
  await withServer(home, appdata, async () => {
    const { status, body } = await fetchJson(PORT, '/api/snapshot');
    const p = byId(body, 'perplexity');
    const ok = status === 200 && p && p.primaryPercent === null && p.secondaryPercent === null && p.live !== true;
    report('6-disabled-semantics', ok, `http=${status} perplexity:primary=${p?.primaryPercent} secondary=${p?.secondaryPercent} live=${p?.live}`);
  }).catch((e) => report('6-disabled-semantics', false, `throw=${e.message}`));
}

try {
  for (const fn of [case1EmptyHome, case2MalformedSpool, case3StaleSpool, case4LiveSpool, case5KilledServer, case6DisabledSemantics]) {
    await fn();
  }
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true }); // wash probe homes, never user state
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `MATRIX FAIL ${results.length - failed.length}/${results.length} passed` : `MATRIX PASS ${results.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
