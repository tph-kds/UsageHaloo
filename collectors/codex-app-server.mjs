#!/usr/bin/env node
/**
 * Codex app-server live client (official protocol, stdio JSON-RPC).
 * Speaks `account/rateLimits/read` over the app-server's stdin/stdout and
 * returns quota windows via collectors/providers.mjs normalization.
 *
 * Privacy: never reads auth material from internal files. The child process
 * inherits the user's own login session (same as running Codex yourself).
 * Override for tests: CODEX_APP_SERVER_CMD="node /path/to/fake.mjs".
 */
import { spawn } from 'node:child_process';
import { normalizeCodexRateLimits } from './providers.mjs';

const DEFAULT_CMD = process.platform === 'win32' ? 'codex.exe' : 'codex';

export function codexCommand() {
  const override = (process.env.CODEX_APP_SERVER_CMD || '').trim();
  if (override) return { cmd: override.split(/\s+/)[0], args: override.split(/\s+/).slice(1) };
  return { cmd: process.env.CODEX_BIN || DEFAULT_CMD, args: ['app-server'] };
}

/** Read rate limits with a hard timeout. Always resolves; never throws. */
export function readCodexRateLimits(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const { cmd, args } = codexCommand();
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], timeout: timeoutMs });
    } catch (e) {
      resolve({ live: false, reason: 'spawn_failed' });
      return;
    }
    let buf = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; try { child.kill(); } catch {} resolve(r); } };
    const timer = setTimeout(() => finish({ live: false, reason: 'timeout' }), timeoutMs);
    child.on('error', () => { clearTimeout(timer); finish({ live: false, reason: 'spawn_failed' }); });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.length > 256 * 1024) { clearTimeout(timer); finish({ live: false, reason: 'oversize' }); return; }
      // JSON-RPC responses are newline-delimited; scan each complete line.
      const lines = buf.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('{')) continue;
        try {
          const msg = JSON.parse(t);
          const payload = msg.result ?? msg.params ?? msg;
          const quotas = normalizeCodexRateLimits(payload);
          if (quotas.length) { clearTimeout(timer); finish({ live: true, quotas, raw_id: msg.id ?? null }); return; }
          if (msg.id === 1 && msg.result && !quotas.length) { clearTimeout(timer); finish({ live: false, reason: 'no_windows' }); return; }
        } catch { /* keep buffering */ }
      }
    });
    child.on('close', () => { clearTimeout(timer); finish({ live: false, reason: 'closed_without_windows' }); });
    try {
      child.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 1, params: {} }) + '\n');
    } catch { clearTimeout(timer); finish({ live: false, reason: 'stdin_failed' }); }
  });
}

if (process.argv.includes('--check')) {
  readCodexRateLimits(3000).then((r) => {
    console.log(JSON.stringify({ live: r.live, reason: r.reason || null, windows: (r.quotas || []).length }));
  });
}

/** Stay attached and stream `account/rateLimits/updated` notifications.
 *  Emits an initial read first (docs: notifications + initial read), then
 *  calls onEvent({ kind: 'snapshot'|'updated', quotas }) per payload.
 *  Returns { close, done } — close() terminates the child. Never throws. */
export function subscribeCodexRateLimits(onEvent, { timeoutMs = 8000 } = {}) {
  const { cmd, args } = codexCommand();
  const handle = { closed: false, close: () => { handle.closed = true; try { child?.kill(); } catch {} }, done: null };
  let child;
  try {
    child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  } catch {
    handle.done = Promise.resolve({ live: false, reason: 'spawn_failed' });
    return handle;
  }
  let buf = '';
  let settled = false;
  handle.done = new Promise((resolve) => {
    const timer = setTimeout(() => { if (!settled) { settled = true; handle.close(); resolve({ live: false, reason: 'timeout' }); } }, timeoutMs);
    const emit = (kind, payload) => {
      const quotas = normalizeCodexRateLimits(payload);
      if (quotas.length && !handle.closed) {
        try { onEvent({ kind, quotas }); } catch {}
      }
      if (kind === 'snapshot' && !settled) {
        settled = true; clearTimeout(timer);
        resolve({ live: quotas.length > 0, reason: quotas.length ? null : 'no_windows' });
      }
    };
    child.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ live: false, reason: 'spawn_failed' }); } });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (buf.length > 1024 * 1024) { buf = buf.slice(-65536); }
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.method === 'account/rateLimits/updated') emit('updated', msg.params ?? msg.result ?? {});
        else if (msg.id === 1 || msg.result) emit('snapshot', msg.result ?? msg.params ?? {});
      }
    });
    child.on('close', () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ live: false, reason: 'closed_without_windows' }); } });
    try {
      child.stdin.write(JSON.stringify({ method: 'account/rateLimits/read', id: 1, params: {} }) + '\n');
    } catch {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ live: false, reason: 'stdin_failed' }); }
    }
    handle.close = () => { handle.closed = true; clearTimeout(timer); try { child?.kill(); } catch {} };
  });
  return handle;
}
