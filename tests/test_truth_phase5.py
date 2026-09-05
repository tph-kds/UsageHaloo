"""Phase 5 connector runtime convergence (remediation package 03/04 + Gate 5).

Gate 5: a real observation from each enabled P0 connector flows
raw store -> reconciled projection -> overview/detail/activity with identical
source identity and timestamp lineage. OpenRouter/OpenAI need live keys, so
they prove the honest-skip path here (no key -> skipped, never failed);
their mapping lineage is covered by Rust unit tests.
"""
from __future__ import annotations

import json
import os
import subprocess
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


def _rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


@pytest.fixture(scope="module")
def collected(tmp_path_factory):
    _ensure_binary()
    home = tmp_path_factory.mktemp("collecthome")
    db = home / ".usagehalo" / "usagehalo.db"
    now = datetime.now(timezone.utc).replace(microsecond=0)
    stamp = _rfc3339(now)

    # Claude Code status-line spool (fresh).
    inbox = home / ".usagehalo" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / "claude-code.jsonl").write_text(json.dumps({
        "observed_at": stamp,
        "model": {"id": "sonnet-4.6", "display_name": "Sonnet 4.6"},
        "rate_limits": {"five_hour": {"used_percentage": 55.0,
                                      "resets_at": int((now + timedelta(hours=2)).timestamp())}},
    }) + "\n", encoding="utf-8")

    # Codex quota handoff + Gemini event handoff via the shared file store.
    store = home / ".usagehalo" / "store"
    store.mkdir(parents=True, exist_ok=True)
    (store / "quota_snapshots.jsonl").write_text(json.dumps({
        "provider": "codex", "limit_id": "codex:primary", "label": "Primary window",
        "used_percent": 28.0, "observed_at": stamp,
        "source": "codex_app_server", "scope": "account",
    }) + "\n", encoding="utf-8")
    (store / "usage_events.jsonl").write_text(json.dumps({
        "provider": "gemini-cli", "model": "gemini-1.5-pro",
        "input_tokens": 500, "output_tokens": 100,
        "observed_at": stamp, "source": "gemini_cli_otel",
    }) + "\n", encoding="utf-8")

    env = {k: v for k, v in os.environ.items()
           if k not in ("OPENROUTER_API_KEY", "OPENAI_API_KEY",
                        "USAGEHALO_SECRET_OPENROUTER_MANAGEMENT_KEY",
                        "USAGEHALO_SECRET_OPENAI_ADMIN_KEY")}
    p = subprocess.run(
        [str(BIN), "collect", "--db", str(db), "--home", str(home),
         "--connector", "all"],
        capture_output=True, text=True, timeout=180, env=env, cwd=str(ROOT))
    assert p.returncode == 0, p.stderr
    reports = {r["connector_id"]: r for r in json.loads(p.stdout)}

    p2 = subprocess.run(
        [str(BIN), "overview", "--db", str(db), "--timezone", "UTC"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT))
    assert p2.returncode == 0, p2.stderr
    return home, db, now, reports, json.loads(p2.stdout)


def _by_id(proj):
    return {p["id"]: p for p in proj["providers"]}


def test_all_five_connectors_report(collected):
    _, _, _, reports, _ = collected
    assert set(reports) == {"claude-code", "codex", "gemini-cli", "openrouter", "openai-api"}
    assert all(r["ok"] for r in reports.values()), reports


def test_keyless_api_connectors_skip_without_health_rows(collected):
    _, _, _, reports, proj = collected
    for cid in ("openrouter", "openai-api"):
        assert "no_key" in reports[cid]["detail"], reports[cid]
        p = _by_id(proj)[cid]
        assert p["primary_metric"] is None
        assert p["detected"] is False


def test_claude_quota_reaches_overview_with_source_timestamp(collected):
    _, _, now, _, proj = collected
    primary = _by_id(proj)["claude-code"]["primary_metric"]["numeric"]
    assert primary["value"] == 55.0
    assert primary["provenance"]["authority"] == "provider_reported"
    assert primary["provenance"]["sample"] is False
    # Lineage: projection timestamp equals the spool record, not collect time.
    assert primary["provenance"]["observed_at"].startswith(
        now.strftime("%Y-%m-%dT%H:%M")), primary["provenance"]


def test_codex_quota_reaches_provider_detail(collected):
    home, db, _, _, _ = collected
    p = subprocess.run(
        [str(BIN), "overview", "--db", str(db), "--timezone", "UTC"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT))
    proj = json.loads(p.stdout)
    codex = _by_id(proj)["codex"]
    assert codex["primary_metric"]["numeric"]["value"] == 28.0


def test_gemini_event_reaches_activity_with_lineage(collected):
    home, db, now, _, _ = collected
    frm = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    p = subprocess.run(
        [str(BIN), "activity", "--db", str(db), "--from", frm, "--to", to,
         "--timezone", "UTC", "--bucket", "day", "--metric", "tokens",
         "--provider", "gemini-cli"],
        capture_output=True, text=True, timeout=120, cwd=str(ROOT))
    assert p.returncode == 0, p.stderr
    act = json.loads(p.stdout)
    assert len(act["rows"]) == 1
    row = act["rows"][0]
    assert row["input_tokens"] == 500 and row["output_tokens"] == 100
    assert row["model_id"] == "gemini-1.5-pro"
    assert row["provenance"]["observed_at"].startswith(now.strftime("%Y-%m-%dT%H:%M"))
    assert act["buckets"][0]["value"] == 600.0


def test_replay_collapses_idempotently(collected):
    home, db, _, _, _ = collected
    env = {k: v for k, v in os.environ.items()
           if k not in ("OPENROUTER_API_KEY", "OPENAI_API_KEY")}
    p = subprocess.run(
        [str(BIN), "collect", "--db", str(db), "--home", str(home),
         "--connector", "all"],
        capture_output=True, text=True, timeout=180, env=env, cwd=str(ROOT))
    assert p.returncode == 0, p.stderr
    reports = {r["connector_id"]: r for r in json.loads(p.stdout)}
    assert reports["claude-code"]["quotas_inserted"] == 0
    assert reports["claude-code"]["quotas_skipped"] >= 1
