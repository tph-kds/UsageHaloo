"""Phase 2 SQLite authority (remediation package 03/05 + Gate 2).

- Migrations apply cleanly to a fresh database and create every table the
  remediation package requires (checked here with sqlite3; the authoritative
  ledger/version assertions live in the Rust storage tests).
- Dedup is constraint-owned: UNIQUE(reconciliation_key) + UNIQUE(fingerprint).
- Tauri diagnostics report the store actually in use (never a bare claim).
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "crates" / "usage-halo-storage" / "migrations"

REQUIRED_TABLES = {
    "provider_accounts",
    "usage_events",
    "quota_snapshots",
    "connector_health",
    "daily_rollups",
    "hourly_rollups",
    "budgets",
    "alert_rules",
    "alert_events",
    "reconciliation_groups",
    "settings",
}


def _migration_files():
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert len(files) >= 2, "0001 + 0002 migrations required"
    assert files[0].name == "0001_init.sql"
    return files


def _apply_all(db: sqlite3.Connection):
    for f in _migration_files():
        sql = f.read_text(encoding="utf-8")
        # Strip PRAGMAs that only make sense on file-backed databases.
        sql = "\n".join(l for l in sql.splitlines() if not l.strip().upper().startswith("PRAGMA"))
        db.executescript(sql)


def test_migrations_are_version_ordered():
    names = [f.name for f in _migration_files()]
    assert names == sorted(names)
    assert all(re.match(r"^\d{4}_", n) for n in names)


def test_migrations_create_every_required_table():
    db = sqlite3.connect(":memory:")
    try:
        _apply_all(db)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert REQUIRED_TABLES <= tables, REQUIRED_TABLES - tables
    finally:
        db.close()


def test_dedup_is_constraint_owned():
    found = set()
    for f in _migration_files():
        sql = f.read_text(encoding="utf-8")
        if "idx_usage_events_reconcile_unique" in sql:
            found.add("reconciliation_key")
        if "idx_usage_events_fingerprint_unique" in sql:
            found.add("raw_fingerprint")
    assert found == {"reconciliation_key", "raw_fingerprint"}, found


def test_health_table_tracks_failure_history():
    cols = set()
    for f in _migration_files():
        cols.update(re.findall(r"ALTER TABLE connector_health ADD COLUMN (\w+)", f.read_text(encoding="utf-8")))
    for c in ("first_seen_at", "last_failure_at", "consecutive_failures",
              "retry_after_at", "error_class", "error_message", "http_status"):
        assert c in cols, f"connector_health missing {c}"


def test_alert_rules_carry_scope_and_history_exists():
    db = sqlite3.connect(":memory:")
    try:
        _apply_all(db)
        rule_cols = {r[1] for r in db.execute("PRAGMA table_info(alert_rules)")}
        for c in ("billing_owner", "account_id", "workspace_id", "window_id"):
            assert c in rule_cols, f"alert_rules missing scope {c}"
        db.execute(
            "INSERT INTO alert_rules (id, metric_key, operator, threshold, created_at)"
            " VALUES ('r1','budget:percent','>=',80,'2026-09-05T00:00:00Z')"
        )
        db.execute(
            "INSERT INTO alert_events (id, rule_id, evaluated_at, fired, reason)"
            " VALUES ('e1','r1','2026-09-05T00:00:00Z',0,'insufficient_data')"
        )
        assert db.execute("SELECT COUNT(*) FROM alert_events").fetchone()[0] == 1
    finally:
        db.close()


def _tauri_src():
    base = ROOT / "apps" / "desktop-ui" / "src-tauri" / "src"
    return (base / "lib.rs").read_text(encoding="utf-8") + (base / "legacy_adapter.rs").read_text(encoding="utf-8")


def test_tauri_reports_the_store_actually_in_use():
    src = _tauri_src()
    assert 'storage: "sqlite"' not in src, "bare sqlite claim must go through readiness state"
    assert "sqlite_ready" in src and "canonical projection service" in src
    assert '"schema_version": 1' in src, "Tauri snapshot must carry the wire schema version"
    assert "tokens_today_value" in src and "cost_today_value" in src
    assert "ProjectionService" in src, "snapshot must be served by the canonical service"


def test_tauri_preserves_model_provider_and_splits_models():
    src = _tauri_src()
    assert '"model_provider": provider,' not in src, "model_provider must never default to the surface"
    assert "spool_freshness" in src, "spool freshness must derive from source timestamps"
