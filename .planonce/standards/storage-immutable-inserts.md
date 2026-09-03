# Storage: Immutable Inserts + Schema Invariants

**Rule:** Raw observations are append-only via `INSERT OR IGNORE` keyed by event UUID. Schema migrations must keep `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;` and the canonical tables: `provider_accounts`, `usage_events`, `quota_snapshots`, `connector_health`, `daily_rollups`, `alert_rules`. No column may store raw prompts, transcripts, or credentials.

Why: Append-only preserves raw telemetry for debugging and lets reconciliation derive projections; WAL+foreign_keys keeps local DB safe under concurrent reads from Tauri commands; schema invariants let migrations be deterministic.

Where: `crates/viusage-storage/src/lib.rs:30` (`INSERT OR IGNORE INTO usage_events`); `crates/viusage-storage/migrations/0001_init.sql:1` (PRAGMA + tables); `crates/viusage-storage/src/lib.rs:19` (sqlx::migrate! entry).

Check: New migration file must end in `_<seq>_<name>.sql`; `python -c "import sqlite3; sqlite3.connect(':memory:').executescript(open('crates/viusage-storage/migrations/0001_init.sql').read())"` must include the expected tables — covered by `scripts/validate.py:52` and `tests/test_migration.py:7`.
