"""Snapshot builder contract + real pollers against mock servers + Codex subscribe."""
from __future__ import annotations
import base64, json, os, socket, subprocess, tempfile, threading, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {'id', 'displayName', 'accent', 'monogram', 'connector', 'sourceMode',
            'freshness', 'scope', 'primaryMetric', 'primaryLabel', 'primaryPercent',
            'icon', 'source', 'health'}

def _node(args, env_extra=None):
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(["node", *args], cwd=str(ROOT), capture_output=True, text=True, env=env)

def _http(url, method="GET", body=None, ctype=None, headers=None, timeout=8.0):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    if ctype: req.add_header("content-type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

class MockState:
    seen = {}

class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        n = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/teams/filtered-usage-events":
            MockState.seen["cursor_auth"] = self.headers.get("Authorization", "")
            assert body.get("pageSize") == 100
            return self._send({"usageEvents": [
                {"tokenUsage": {"inputTokens": 1000, "outputTokens": 200}, "chargedCents": 150},
                {"tokenUsage": {"inputTokens": 500, "outputTokens": 100}, "chargedCents": 50}]})
        return self._send({"error": "nope"}, 404)
    def do_GET(self):
        if self.path.startswith("/v1/admin/usage"):
            MockState.seen["mistral_key"] = self.headers.get("x-api-key", "")
            return self._send({"currency": "USD", "usage": {"completion": 4.5, "ocr": 1.5}, "total_cost": 6.0})
        if self.path.endswith("/latest"):
            MockState.seen["copilot_auth"] = self.headers.get("Authorization", "")
            port = self.server.server_port
            return self._send({"download_links": [f"http://127.0.0.1:{port}/report-1"]})
        if self.path == "/report-1":
            return self._send([{"date": "2026-09-01", "total_requests": 10,
                                "total_prompt_tokens": 1000, "total_completion_tokens": 500}])
        return self._send({"error": "nope"}, 404)

def _mock_server():
    srv = HTTPServer(("127.0.0.1", 0), MockHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def test_snapshot_builder_contract():
    js = """
import { readFileSync } from "node:fs";
import { buildProviderRows, validateRows } from "./collectors/snapshot.mjs";
const registry = JSON.parse(readFileSync("./packages/brand-registry/providers.json", "utf8"))
  .map(p => ({ ...p, primaryLabel: p.primaryMetric }));
const manifest = JSON.parse(readFileSync("./assets/providers/icon-manifest.json", "utf8"));
const assetMap = {};
for (const e of manifest.providers || []) assetMap[e.base_stem] = { dir: e.id, stem: e.base_stem };
const rows = buildProviderRows({
  registry,
  events: [{ provider: 'openrouter', billing_owner: 'openrouter', model: 'm', input_tokens: 100, output_tokens: 50, provider_cost: 0.02, requests: 1, observed_at: '2026-09-03T00:00:00Z' }],
  assetMap, live: { openrouter: { live: true, primaryPercent: 42, source: 'official_api', freshness: 'fresh' } },
  detected: [{ id: 'openrouter', installed: true, configured: true }],
});
console.log(JSON.stringify({ problems: validateRows(rows), n: rows.length,
  or: rows.find(r => r.id === 'openrouter') }));
"""
    p = _node(["--input-type=module", "-e", js])
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout.strip().splitlines()[-1])
    assert d["problems"] == [], d["problems"]
    assert d["n"] == len(json.loads((ROOT / "packages/brand-registry/providers.json").read_text()))
    ore = d["or"]
    assert ore["primaryPercent"] == 42 and ore["live"] is True
    assert ore["tokensToday"] == "150" and ore["installed"] is True

def test_cursor_copilot_mistral_against_mock():
    srv = _mock_server()
    base = f"http://127.0.0.1:{srv.server_port}"
    js = f"""
import {{ pollCursor, pollCopilot, pollMistral }} from "./collectors/pollers.mjs";
const c = await pollCursor({{ apiKey: 'key123', baseUrl: {json.dumps(base)} }});
const g = await pollCopilot({{ token: 'tok', org: 'acme', baseUrl: {json.dumps(base)} }});
const m = await pollMistral({{ apiKey: 'adm', baseUrl: {json.dumps(base)} }});
console.log(JSON.stringify({{ c, g, m }}));
"""
    try:
        p = _node(["--input-type=module", "-e", js])
        assert p.returncode == 0, p.stderr
        d = json.loads(p.stdout.strip().splitlines()[-1])
        assert d["c"]["live"] and d["c"]["input_tokens_24h"] == 1500 and d["c"]["cost_24h"] == 2.0, d["c"]
        assert d["g"]["live"] and d["g"]["requests_window"] == 10 and d["g"]["freshness"] == "daily", d["g"]
        assert d["m"]["live"] and d["m"]["cost_month"] == 6.0 and d["m"]["currency"] == "USD", d["m"]
        assert MockState.seen["cursor_auth"] == "Basic " + base64.b64encode(b"key123:").decode()
        assert MockState.seen["mistral_key"] == "adm"
        assert MockState.seen["copilot_auth"] == "Bearer tok"
    finally:
        srv.shutdown()

def test_codex_subscribe_receives_updated():
    fake = ROOT / ".tmp-fake-codex-sub.mjs"
    fake.write_text(
        "let n = 0;\n"
        "process.stdin.on('data', () => {\n"
        "  process.stdout.write(JSON.stringify({ id: 1, result: { rateLimits: { primary: { usedPercent: 28, windowDurationMins: 300 } } } }) + '\\n');\n"
        "  setTimeout(() => process.stdout.write(JSON.stringify({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 74, windowDurationMins: 300 }, secondary: { usedPercent: 16, windowDurationMins: 10080 } } } }) + '\\n'), 200);\n"
        "});\n"
    )
    js = """
import { subscribeCodexRateLimits } from "./collectors/codex-app-server.mjs";
const got = [];
const h = subscribeCodexRateLimits((e) => got.push(e), { timeoutMs: 5000 });
const first = await h.done;
await new Promise(r => setTimeout(r, 800));
h.close();
console.log(JSON.stringify({ first_live: first.live, kinds: got.map(g => g.kind),
  updated_pct: (got.find(g => g.kind === 'updated')?.quotas || []).map(q => q.used_percent) }));
"""
    try:
        p = _node(["--input-type=module", "-e", js],
                  {"CODEX_APP_SERVER_CMD": f"node {fake}"})
        assert p.returncode == 0, p.stderr
        d = json.loads(p.stdout.strip().splitlines()[-1])
        assert d["first_live"] is True and "updated" in d["kinds"], d
        assert sorted(d["updated_pct"]) == [16, 74], d
    finally:
        try: fake.unlink()
        except Exception: pass

def test_daemon_cache_and_endpoint():
    with tempfile.TemporaryDirectory() as home:
        env = {"USERPROFILE": home}
        p = _node(["collectors/daemon.mjs", "--once"], env)
        assert p.returncode == 0, p.stderr
        assert json.loads(p.stdout)["cacheWritten"] is True
        cache = Path(home) / ".usagehalo" / "store" / "snapshot-cache.json"
        assert cache.exists()
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
        server_env = {**os.environ, "USERPROFILE": home, "VIUSAGEVER_PORT": str(port)}
        proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")],
                                 cwd=str(ROOT), env=server_env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            base = f"http://127.0.0.1:{port}"
            deadline = time.time() + 6
            while time.time() < deadline:
                try:
                    code, _ = _http(f"{base}/api/health", timeout=1.0)
                    if code == 200: break
                except Exception: pass
                time.sleep(0.1)
            code, body = _http(f"{base}/api/snapshot-cache")
            assert code == 200, body
            d = json.loads(body)
            assert d["fresh"] is True and d["provider_count"] > 20, d
            code, body = _http(f"{base}/api/daemon")
            assert code == 200 and "daemon" in json.loads(body)
        finally:
            proc.terminate()
            try: proc.wait(timeout=3)
            except Exception: proc.kill()
