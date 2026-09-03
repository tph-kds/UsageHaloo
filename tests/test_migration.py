import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_migration_applies():
    conn = sqlite3.connect(":memory:")
    conn.executescript((ROOT / "crates/usage-halo-storage/migrations/0001_init.sql").read_text())
    names = {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
    assert "usage_events" in names
    assert "quota_snapshots" in names
