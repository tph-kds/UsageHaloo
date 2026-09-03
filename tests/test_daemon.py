"""Daemon + poller tests (sandboxed HOME so the real ~/.usagehalo is untouched)."""
from __future__ import annotations
import json, os, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _run_node(script_args, env_extra=None):
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(["node", *script_args], cwd=str(ROOT), capture_output=True, text=True, env=env)

def test_daemon_tick_once_sandboxed():
    with tempfile.TemporaryDirectory() as home:
        # USERPROFILE is what Node's os.homedir() reads on Windows.
        env = {"USERPROFILE": home, "HOMEDRIVE": "C:", "HOMEPATH": "\\nonexistent-fallback"}
        p = _run_node(["collectors/daemon.mjs", "--once"], env)
        assert p.returncode == 0, p.stderr
        d = json.loads(p.stdout)
        assert set(d) >= {"at", "results", "pruned", "alerts_fired"}
        # Event sources are never polled.
        assert d["results"]["openrouter"]["reason"] in ("no_key", "cadence", "timeout", "network", "auth", "permission", "rate_limited") or d["results"]["openrouter"].get("live") in (True, False)
        store = Path(home) / ".usagehalo" / "store"
        assert (store / "daemon.json").exists() and (store / "health.json").exists()
        # No secrets were persisted anywhere in the sandbox store.
        blob = " ".join(f.read_text(errors="ignore") for f in store.glob("*.json*"))
        assert "sk-" not in blob and "Bearer" not in blob

def test_pollers_honest_without_keys():
    js = """
import { pollOpenRouterKey, pollOpenAIUsage, pollCursor, pollCopilot, pollMistral } from "./collectors/pollers.mjs";
const out = [await pollOpenRouterKey(''), await pollOpenAIUsage(''), await pollCursor(), await pollCopilot(), await pollMistral()];
console.log(JSON.stringify(out.map(r => ({ provider: r.provider, live: r.live, reason: r.reason }))));
"""
    p = _run_node(["--input-type=module", "-e", js])
    assert p.returncode == 0, p.stderr
    rows = json.loads(p.stdout.strip().splitlines()[-1])
    assert all(r["live"] is False for r in rows), rows
    reasons = {r["provider"]: r["reason"] for r in rows}
    assert reasons["openrouter"] == "no_key" and reasons["openai-api"] == "no_key"

def test_daemon_persists_poll_results_to_quota_snapshots():
    """With a mock Cursor API configured, --once must persist a quota row."""
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            n = int(self.headers.get("content-length", 0)); self.rfile.read(n)
            body = json.dumps({"usageEvents": [
                {"tokenUsage": {"inputTokens": 2000, "outputTokens": 400}, "chargedCents": 300}]}).encode()
            self.send_response(200); self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body))); self.end_headers()
            self.wfile.write(body)

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory() as home:
            env = {"USERPROFILE": home,
                   "CURSOR_API_KEY": "k", "CURSOR_API_BASE": f"http://127.0.0.1:{srv.server_port}"}
            p = _run_node(["collectors/daemon.mjs", "--once"], env)
            assert p.returncode == 0, p.stderr
            assert json.loads(p.stdout)["results"]["cursor"]["persisted"] is True
            snap = Path(home) / ".usagehalo" / "store" / "quota_snapshots.jsonl"
            assert snap.exists()
            rows = [json.loads(l) for l in snap.read_text().splitlines() if l.strip()]
            cursor = [r for r in rows if r["provider"] == "cursor"]
            assert len(cursor) == 1 and cursor[0]["used_value"] == 2400, rows
            assert cursor[0]["provider_cost"] == 3.0
    finally:
        srv.shutdown()

def test_daemon_due_logic():
    js = """
import { CONNECTOR_SCHEDULE } from "./collectors/scheduler.mjs";
const due = (id, nowMs, last) => {
  const meta = CONNECTOR_SCHEDULE[id];
  if (!meta) return false;
  if (meta.mode === 'event') return id === 'codex' && !last[id];
  return nowMs - (last[id] || 0) >= (meta.nominal_seconds ?? 3600) * 1000;
};
console.log(JSON.stringify({
  codex_first: due('codex', 1000, {}),
  codex_again: due('codex', 2000, { codex: 1000 }),
  claude_never: due('claude-code', 1e12, {}),
  ollama_due: due('ollama', 61_000, { ollama: 0 }),
  ollama_fresh: due('ollama', 30_000, { ollama: 0 }),
}));
"""
    p = _run_node(["--input-type=module", "-e", js])
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout.strip().splitlines()[-1])
    assert d == {"codex_first": True, "codex_again": False, "claude_never": False, "ollama_due": True, "ollama_fresh": False}, d
