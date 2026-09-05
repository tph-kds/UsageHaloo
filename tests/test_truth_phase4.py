"""Phase 4 one-projection-service (remediation package 03/06 + Gate 4).

Gate 4: given one fixture database, the browser adapter (/api/projection,
served by the same ProjectionService via CLI) returns canonically identical
fields to a direct service run. The Tauri side is proven by the Rust mapping
tests (`usage-halo-desktop`: legacy rows derive from canonical only).
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "target" / "debug" / (
    "usagehalo_projection.exe" if os.name == "nt" else "usagehalo_projection")


def _ensure_binary():
    if BIN.exists():
        return
    p = subprocess.run(
        ["cargo", "build", "-p", "usage-halo-projection", "--bin", "usagehalo_projection"],
        cwd=str(ROOT), capture_output=True, text=True, timeout=600)
    if not BIN.exists():
        pytest.skip(f"projection binary unavailable: {p.stderr[-500:]}")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(url, *, timeout=10.0):
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


@pytest.fixture(scope="module")
def fixture_db(tmp_path_factory):
    _ensure_binary()
    home = tmp_path_factory.mktemp("projhome")
    db = home / ".usagehalo" / "usagehalo.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    today = _rfc3339(now)
    old = _rfc3339(now - timedelta(hours=36))

    subprocess.run([str(BIN), "migrate", "--db", str(db)], check=True,
                   capture_output=True, timeout=120)
    con = sqlite3.connect(db)
    try:
        con.execute(
            """INSERT INTO usage_events (id, provider, surface, billing_owner,
                model_provider, model, account_id, input_tokens, output_tokens,
                requests, provider_cost, currency, reconciliation_key,
                raw_fingerprint, source_kind, source_scope, source_authority,
                freshness_class, confidence, observed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("e-today", "openrouter", "opencode", "openrouter", "anthropic",
             "model-x", "acct", 1000, 200, 1, 0.40, "USD", "openrouter:req-t",
             "fp-today", "instrumented_response", "request",
             "instrumented_response", "live", 1.0, today))
        con.execute(
            """INSERT INTO usage_events (id, provider, surface, billing_owner,
                model_provider, model, account_id, input_tokens, output_tokens,
                requests, provider_cost, currency, reconciliation_key,
                raw_fingerprint, source_kind, source_scope, source_authority,
                freshness_class, confidence, observed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("e-old", "openrouter", "opencode", "openrouter", "anthropic",
             "model-x", "acct", 5000, 1000, 5, 2.00, "USD", "openrouter:req-o",
             "fp-old", "instrumented_response", "request",
             "instrumented_response", "live", 1.0, old))
        con.execute(
            """INSERT INTO quota_snapshots (id, provider, limit_id, label,
                metric_kind, used_percent, source_kind, source_scope,
                source_authority, freshness_class, confidence, observed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("q1", "openrouter", "key-limit", "Key limit used", "quota_percent",
             42.0, "official_api", "account", "provider_billing", "fresh",
             1.0, today))
        con.execute(
            """INSERT INTO connector_health (connector_id, state, last_success,
                last_attempt, consecutive_failures)
               VALUES (?,?,?,?,?)""",
            ("openrouter", "healthy", today, today, 0))
        con.commit()
    finally:
        con.close()
    return home, db, now


@pytest.fixture(scope="module")
def server(fixture_db):
    home, _, _ = fixture_db
    port = _free_port()
    env = {**os.environ, "USERPROFILE": str(home), "HOME": str(home),
           "VIUSAGEVER_PORT": str(port)}
    proc = subprocess.Popen(["node", str(ROOT / "prototype" / "server.mjs")],
                            cwd=str(ROOT), env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 8
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


def _cli_overview(db: Path, tz="UTC"):
    p = subprocess.run([str(BIN), "overview", "--db", str(db), "--timezone", tz],
                       capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def _by_id(proj):
    return {p["id"]: p for p in proj["providers"]}


def test_browser_adapter_matches_direct_service_run(server, fixture_db):
    """Gate 4 core: identical canonical fields from CLI and HTTP adapter."""
    _, db, _ = fixture_db
    direct = _cli_overview(db)
    code, http = _http(f"{server}/api/projection?timezone=UTC")
    assert code == 200, http
    assert http["schema_version"] == direct["schema_version"] == 1
    assert http["mode"] == direct["mode"] == "production"
    assert http["observed_tokens_today"] == direct["observed_tokens_today"]
    assert http["observed_requests_today"] == direct["observed_requests_today"]
    assert (http["provider_cost_today_by_currency"]
            == direct["provider_cost_today_by_currency"])
    assert http["data_health"] == direct["data_health"]
    assert _by_id(http)["openrouter"] == _by_id(direct)["openrouter"]


def test_today_window_excludes_prior_days(server, fixture_db):
    """P0-06: 'today' is a calendar-day interval, never a record tail."""
    code, proj = _http(f"{server}/api/projection?timezone=UTC")
    assert code == 200
    tokens = proj["observed_tokens_today"]
    assert tokens["value"] == 1200.0, tokens  # 1000+200; the 6000-token row is prior-day
    assert tokens["availability"] == "available"
    assert tokens["window"]["kind"] == "calendar_day"
    assert proj["observed_requests_today"]["value"] == 1.0


def test_quota_reaches_primary_metric_with_provenance(server):
    code, proj = _http(f"{server}/api/projection?timezone=UTC")
    assert code == 200
    primary = _by_id(proj)["openrouter"]["primary_metric"]["numeric"]
    assert primary["value"] == 42.0
    assert primary["unit"] == "percent"
    assert primary["provenance"]["authority"] == "provider_reported"
    assert primary["provenance"]["sample"] is False
    assert primary["window"]["reset_source"] in ("provider", "unknown")


def test_unobserved_provider_has_no_metric(server):
    code, proj = _http(f"{server}/api/projection?timezone=UTC")
    assert code == 200
    depended = _by_id(proj)["cursor"]
    assert depended["primary_metric"] is None
    assert depended["detected"] is False


def test_activity_endpoint_matches_cli(fixture_db, server):
    _, db, now = fixture_db
    frm = (now - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    p = subprocess.run(
        [str(BIN), "activity", "--db", str(db), "--from", frm, "--to", to,
         "--timezone", "UTC", "--bucket", "day", "--metric", "tokens"],
        capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    direct = json.loads(p.stdout)
    code, http = _http(
        f"{server}/api/activity?from={frm}&to={to}&timezone=UTC&bucket=day&metric=tokens")
    assert code == 200, http
    assert http["buckets"] == direct["buckets"]
    assert len(http["rows"]) == len(direct["rows"]) == 2
    assert http["buckets"][0]["sample"] == 0
