"""Next-workflow tests: Rust rename, scheduler/secrets crates, Codex stdio client, OTLP ingest."""
from __future__ import annotations
import json, subprocess, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def _http(url, method="GET", body=None, ctype=None, timeout=8.0):
    req = urllib.request.Request(url, data=body, method=method)
    if ctype: req.add_header("content-type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def test_no_legacy_crate_name_in_rust():
    offenders = []
    for p in ROOT.rglob("*.rs"):
        if ".git" in p.parts: continue
        if "viusage_core" in p.read_text(encoding="utf-8"):
            offenders.append(str(p.relative_to(ROOT)))
    assert not offenders, f"legacy crate name remains (blocks cargo): {offenders}"

def test_workspace_members_include_new_crates():
    text = (ROOT / "Cargo.toml").read_text()
    assert "crates/usage-halo-scheduler" in text
    assert "crates/usage-halo-secrets" in text
    assert (ROOT / "crates/usage-halo-scheduler/src/lib.rs").exists()
    assert (ROOT / "crates/usage-halo-secrets/src/lib.rs").exists()

def test_tauri_shell_uses_real_crates():
    lib = (ROOT / "apps/desktop-ui/src-tauri/src/lib.rs").read_text()
    assert "usage_halo_scheduler" in lib and "usage_halo_secrets" in lib
    assert "connector_health" in lib
    manifest = (ROOT / "apps/desktop-ui/src-tauri/Cargo.toml").read_text()
    assert "usage-halo-scheduler" in manifest and "usage-halo-secrets" in manifest

def test_scheduler_freshness_rules():
    js = """
import { freshnessState } from "./collectors/scheduler.mjs";
console.log(JSON.stringify([
  freshnessState("github-copilot", 3600),
  freshnessState("github-copilot", 3*86400),
  freshnessState("codex", null),
  freshnessState("nope", 10),
]));
"""
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout.strip().splitlines()[-1]) == ["fresh", "stale", "unknown", "unknown"]

def test_otlp_fixture_strips_prompts():
    js = """
import { readFileSync } from "node:fs";
import { ingestOtlpMetrics } from "./collectors/gemini-otlp.mjs";
const body = JSON.parse(readFileSync("./fixtures/gemini-otlp-metrics.json", "utf8"));
const out = ingestOtlpMetrics(body);
console.log(JSON.stringify({ n: out.events.length, shape: out.shape, dump: JSON.stringify(out.events) }));
"""
    p = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout.strip().splitlines()[-1])
    assert d["n"] == 2 and d["shape"] == "otlp-json"
    assert "SECRET-PROMPT-MUST-BE-DROPPED" not in d["dump"]

def test_codex_client_against_fake_server_and_otlp_roundtrip():
    import os, socket
    fake = ROOT / ".tmp-fake-codex.mjs"
    fake.write_text(
        "process.stdin.on('data', () => {\n"
        "  process.stdout.write(JSON.stringify({ id: 1, result: { rateLimits: { primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1900500000 } } } }) + '\\n');\n"
        "});\n"
    )
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]
    env = {**os.environ, "VIUSAGEVER_PORT": str(port), "CODEX_APP_SERVER_CMD": f"node {fake}"}
    proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")], cwd=str(ROOT), env=env,
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
        code, body = _http(f"{base}/api/codex/live", timeout=10.0)
        assert code == 200, body
        d = json.loads(body)
        assert d["live"] is True and len(d["quotas"]) == 2
        assert d["quotas"][0]["used_percent"] == 28
        # OTLP compact shape round-trip
        code, body = _http(f"{base}/v1/metrics", method="POST",
                           body=json.dumps({"metrics": [{"model": "gemini-1.5-pro", "type": "input", "value": 500}]}).encode(),
                           ctype="application/json")
        assert code == 202, body
        assert json.loads(body)["accepted"] == 1
        # OTLP/JSON fixture shape round-trip (prompt attr must not be stored)
        fixture = json.loads((ROOT / "fixtures/gemini-otlp-metrics.json").read_text())
        code, body = _http(f"{base}/v1/metrics", method="POST", body=json.dumps(fixture).encode(), ctype="application/json")
        assert code == 202, body
        assert json.loads(body)["accepted"] == 2
    finally:
        proc.terminate()
        try: proc.wait(timeout=3)
        except Exception: proc.kill()
        try: fake.unlink()
        except Exception: pass
