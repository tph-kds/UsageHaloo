"""Phase 0 truthfulness kill-switches (remediation package 02 + 08).

Release-blocking invariants: production must never fabricate usage data.
Each test fails if a fake-data path regresses. Demo mode (?demo=1) is the
only place synthetic values may appear, and only when labeled SAMPLE.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(url, *, method="GET", body=None, timeout=5.0):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"content-type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _node(args, env_extra=None):
    env = {**os.environ, **(env_extra or {})}
    return subprocess.run(["node", *args], cwd=str(ROOT), capture_output=True, text=True, env=env)


@pytest.fixture(scope="module")
def isolated_home(tmp_path_factory):
    """A temp HOME so spool/store/legacy files never touch real user data."""
    home = tmp_path_factory.mktemp("fakehome")
    env = {**os.environ, "USERPROFILE": str(home), "HOMEDRIVE": "C:",
           "HOMEPATH": str(home), "HOME": str(home)}
    return home, env


@pytest.fixture(scope="module")
def server(isolated_home):
    _, env = isolated_home
    port = _free_port()
    env = {**env, "VIUSAGEVER_PORT": str(port)}
    proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")],
                            cwd=str(ROOT), env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 6
        while time.time() < deadline:
            try:
                code, _ = _http(f"{base}/api/health", timeout=1.0)
                if code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError("prototype never came up")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()


# TRUTH-001 — No data is not zero -------------------------------------------
def test_production_snapshot_missing_is_null_never_zero(server):
    code, body = _http(f"{server}/api/snapshot")
    assert code == 200
    snap = json.loads(body)
    assert snap["demo_mode"] is False
    assert snap["sample_data"] is False
    for p in snap["providers"]:
        if p.get("live"):
            continue
        assert p["primaryPercent"] is None, f"{p['id']} invents a percent"
        assert p["primaryPercent"] != 0 or p["primaryPercent"] is None


# TRUTH-002 — errors stay errors; demo stays explicit ------------------------
def test_demo_mode_is_explicit_and_labeled(server):
    code, body = _http(f"{server}/api/snapshot?demo=1")
    assert code == 200
    demo = json.loads(body)
    assert demo["demo_mode"] is True and demo["sample_data"] is True
    code, body = _http(f"{server}/api/snapshot")
    assert json.loads(body)["sample_data"] is False


# TRUTH-012 — Forecast requires evidence ------------------------------------
def test_production_forecast_reports_insufficient_evidence(server):
    code, body = _http(f"{server}/api/forecast")
    assert code == 200
    fc = json.loads(body)
    for key in ("quota_next_limit", "spend_month"):
        assert fc[key].get("suppressed") is True, f"{key} must be suppressed without a real series"
        assert fc[key].get("reason") == "insufficient_evidence", fc[key]
    payload = json.dumps(fc)
    # No fabricated reset countdown or hardcoded burn/spend arrays.
    assert "51" not in payload or "minutes" not in payload


def test_demo_forecast_still_available(server):
    code, body = _http(f"{server}/api/forecast?demo=1")
    assert code == 200
    fc = json.loads(body)
    assert fc["quota_next_limit"].get("suppressed") is False, fc


# TRUTH-013/014 — Alerts need real scoped metrics ----------------------------
def test_budget_rule_cannot_fire_without_real_budget(server):
    code, body = _http(f"{server}/api/alerts")
    assert code == 200
    out = json.loads(body)
    assert out["values"]["budget:percent"] is None
    assert not any(f["rule"] == "budget-month-80" for f in out["fired"])


def test_daemon_has_no_hardcoded_alert_value():
    src = (ROOT / "collectors" / "daemon.mjs").read_text()
    assert "'budget:percent': 62" not in src and '"budget:percent": 62' not in src


def test_daemon_tick_fires_no_budget_alert(isolated_home):
    _, env = isolated_home
    p = _node(["collectors/daemon.mjs", "--once"], env)
    assert p.returncode == 0, p.stderr
    assert json.loads(p.stdout)["alerts_fired"] == 0


# TRUTH-005 — Stale spool remains stale --------------------------------------
def test_stale_spool_is_stale_and_preserves_timestamp(isolated_home):
    home, env = isolated_home
    inbox = home / ".usagehalo" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    old = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    (inbox / "claude-code.jsonl").write_text(
        json.dumps({"observed_at": old, "rate_limits": {"five_hour": {"used_percentage": 71}}}) + "\n")
    js = "import { readClaudeSpool } from './collectors/local.mjs'; console.log(JSON.stringify(readClaudeSpool()));"
    p = _node(["--input-type=module", "-e", js], env)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    assert r["live"] is False, r
    assert r["freshness"] in ("delayed", "stale"), r
    assert r["observed_at"] == old, "re-reading must not refresh the source timestamp"
    assert r["primaryPercent"] == 71


def test_fresh_spool_is_live(isolated_home):
    home, env = isolated_home
    inbox = home / ".usagehalo" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    (inbox / "claude-code.jsonl").write_text(
        json.dumps({"observed_at": now, "rate_limits": {"five_hour": {"used_percentage": 33}}}) + "\n")
    js = "import { readClaudeSpool } from './collectors/local.mjs'; console.log(JSON.stringify(readClaudeSpool()));"
    p = _node(["--input-type=module", "-e", js], env)
    assert p.returncode == 0, p.stderr
    r = json.loads(p.stdout.strip().splitlines()[-1])
    assert r["live"] is True and r["freshness"] == "live", r
    assert r["observed_at"] == now


# TRUTH-010 — Missing fields stay null ---------------------------------------
def test_ingest_event_preserves_null_tokens(server, isolated_home):
    home, _ = isolated_home
    code, body = _http(f"{server}/api/ingest/event", method="POST",
                       body={"provider": "openrouter", "model": "m"})
    assert code == 202, body
    rows = (home / ".usagehalo" / "inbox" / "generic.jsonl").read_text().strip().splitlines()
    last = json.loads(rows[-1])
    assert last["input_tokens"] is None, last
    assert last["output_tokens"] is None, last


# P0-02 — No mock fallback reachable from production adapter ------------------
def test_production_adapter_has_no_mock_fallback():
    src = (ROOT / "apps" / "desktop-ui" / "src" / "lib" / "api.ts").read_text()
    assert "falling back to mock" not in src
    assert "fetchDemoSnapshot" in src, "demo data must live behind an explicit entry point"
    prod = src.split("fetchDemoSnapshot")[0]
    assert "mockProviders" not in prod, "production path must not reference mock providers"


# P0-01 — No synthetic heatmap in production ----------------------------------
def test_heatmap_only_renders_real_or_sample():
    src = (ROOT / "apps" / "desktop-ui" / "src" / "lib" / "components" / "Heatmap.svelte").read_text()
    assert "No historical activity collected yet" in src
    assert "sample" in src.lower()
    demo = (ROOT / "demo" / "app.js").read_text(encoding="utf-8")
    assert "No historical activity collected yet" in demo
