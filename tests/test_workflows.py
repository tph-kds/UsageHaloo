"""Workflow tests: store dedupe, reconcile, forecast, alerts, provider normalizers, new APIs."""
from __future__ import annotations
import json, socket, subprocess, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _free_port():
    import socket as s
    with s.socket(s.AF_INET, s.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]

def _http(url, method="GET", body=None, ctype=None, timeout=5.0):
    req = urllib.request.Request(url, data=body, method=method)
    if ctype: req.add_header("content-type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def _node_eval(esm_expr):
    code = f"import m from {json.dumps(str(ROOT / 'collectors' / 'reconcile.mjs'))};"
    # generic runner: use --input-type=module -e
    return None

def test_reconcile_dedupe_and_authority():
    runner = ROOT / "collectors" / "reconcile.mjs"
    js = """
import { reconcileEvents } from %s;
const ev = (auth, cost, input, key) => ({ provider:'openrouter', billing_owner:'openrouter', model:'m', request_id:'r1', reconciliation_key:key, provider_cost:cost, input_tokens:input, authority:auth, observed_at:new Date().toISOString() });
const out = reconcileEvents([ev('instrumented_response', null, 5000, 'k1'), ev('provider_billing', 0.0198, null, 'k1')]);
console.log(JSON.stringify({ n: out.length, cost: out[0].provider_cost, input: out[0].input_tokens }));
""" % json.dumps("./collectors/reconcile.mjs")
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout.strip().splitlines()[-1])
    assert d["n"] == 1 and d["cost"] == 0.0198 and d["input"] == 5000

def test_forecast_deterministic_and_suppressed():
    js = """
import { forecastQuota, forecastSpend } from "./collectors/forecast.mjs";
const a = forecastQuota({ usedPercent: 73, resetsAtIso: new Date(Date.now()+3600e3).toISOString(), recentBurnPerHour: [8,9,11,10,12] });
const b = forecastQuota({ usedPercent: 73, resetsAtIso: new Date(Date.now()+3600e3).toISOString(), recentBurnPerHour: [8] });
const c = forecastSpend([2.1,2.4,1.9,2.8]);
console.log(JSON.stringify({ a_sup: a.suppressed, b_sup: b.suppressed, c_sup: c.suppressed, label: a.label }));
"""
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout.strip().splitlines()[-1])
    assert d["a_sup"] is False and d["b_sup"] is True and d["c_sup"] is False
    assert "Projected" in d["label"] or "Likely" in d["label"]

def test_alerts_cooldown():
    js = """
import { evaluateRule } from "./collectors/alerts.mjs";
const r = { id:'x', operator:'>=', threshold:80, cooldown_seconds:3600, enabled:true };
console.log(JSON.stringify([evaluateRule(r, 85, 10_000_000, 0), evaluateRule(r, 85, 10_000_100, 10_000_000), evaluateRule(r, 10, 20_000_000, 0)]));
"""
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    a, b, c = json.loads(p.stdout.strip().splitlines()[-1])
    assert a["fire"] is True and b["fire"] is False and c["fire"] is False

def test_provider_normalizers_selftest():
    p = subprocess.run(["node", "collectors/providers.mjs", "--selftest"], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    cases = json.loads(p.stdout)
    assert cases[0]["provider"] == "perplexity" and cases[0]["total_tokens"] == 150
    assert cases[1]["provider"] == "deepseek" and cases[1]["authority"] == "instrumented_response"
    assert cases[2]["provider"] == "ollama" and cases[2]["scope"] == "device"
    assert cases[3][0]["provider"] == "codex" and cases[3][0]["used_percent"] == 74
    assert cases[4]["provider"] == "gemini-cli"

def test_ingest_refuses_prompts_and_accepts_telemetry():
    import os
    port = _free_port()
    env = {**__import__("os").environ, "VIUSAGEVER_PORT": str(port)}
    proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")], cwd=str(ROOT), env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                code, _ = _http(f"{base}/api/health", timeout=1.0)
                if code == 200: break
            except Exception: pass
            time.sleep(0.1)
        code, _ = _http(f"{base}/api/ingest/event", method="POST",
                        body=json.dumps({"provider": "x", "prompt": "hello"}).encode(), ctype="application/json")
        assert code == 400
        code, body = _http(f"{base}/api/ingest/event", method="POST",
                           body=json.dumps({"provider": "deepseek", "model": "m", "input_tokens": 10, "output_tokens": 5, "request_id": "t-wf-1"}).encode(),
                           ctype="application/json")
        assert code == 202
        for ep in ("/api/rollups", "/api/forecast", "/api/alerts", "/api/widget"):
            code, body = _http(f"{base}{ep}")
            assert code == 200, ep
            d = json.loads(body)
            if ep == "/api/widget":
                assert "top_provider" in d and "providers" in d and len(d["providers"]) <= 6
            if ep == "/api/forecast":
                assert "quota_next_limit" in d and "spend_month" in d
    finally:
        proc.terminate()
        try: proc.wait(timeout=3)
        except Exception: proc.kill()
