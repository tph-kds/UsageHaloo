"""Phase 3 reconciliation + time correctness (remediation package 05 + Gate 3).

- "Today"/daily grouping uses IANA timezone boundaries, never UTC slicing.
- Rust policy tests (aggregate vs detail, billing owner, DST) run under
  `cargo test`; these Python tests pin the live JS rollup path to the same
  truth, since it serves the current :4897 snapshot.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _node(script: str) -> str:
    p = subprocess.run(["node", "--input-type=module", "-e", script],
                       cwd=str(ROOT), capture_output=True, text=True, env={**os.environ})
    assert p.returncode == 0, p.stderr
    return p.stdout.strip().splitlines()[-1]


def test_rollups_use_iana_day_boundaries():
    out = _node("""
import { buildRollups } from './collectors/scheduler.mjs';
const events = [
  // 2026-09-05 18:30 UTC == 2026-09-06 01:30 in Ho Chi Minh City.
  { provider: 'openrouter', billing_owner: 'openrouter', model: 'm', observed_at: '2026-09-05T18:30:00Z', input_tokens: 100, requests: 1 },
  // 2026-09-04 18:00 UTC == 2026-09-05 01:00 local.
  { provider: 'openrouter', billing_owner: 'openrouter', model: 'm', observed_at: '2026-09-04T18:00:00Z', input_tokens: 50, requests: 1 },
];
console.log(JSON.stringify(buildRollups(events, 'Asia/Ho_Chi_Minh')));
""")
    rows = json.loads(out)
    by_day = {r["local_date"]: r for r in rows}
    assert set(by_day) == {"2026-09-06", "2026-09-05"}, by_day
    assert by_day["2026-09-06"]["input_tokens"] == 100
    assert by_day["2026-09-05"]["input_tokens"] == 50
    assert all(r["timezone"] == "Asia/Ho_Chi_Minh" for r in rows)


def test_rollups_respect_dst_spring_forward():
    out = _node("""
import { buildRollups } from './collectors/scheduler.mjs';
const events = [
  { provider: 'x', billing_owner: 'x', model: '', observed_at: '2026-03-08T06:30:00Z', input_tokens: 7, requests: 1 },
];
console.log(JSON.stringify(buildRollups(events, 'America/New_York')));
""")
    rows = json.loads(out)
    # 06:30 UTC == 01:30 EST, still March 8 local (clocks jump 02:00 -> 03:00).
    assert rows[0]["local_date"] == "2026-03-08", rows


def test_rollups_reject_unknown_timezone():
    p = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import { buildRollups } from './collectors/scheduler.mjs';"
         " try { buildRollups([], 'Mars/Olympus'); console.log('NO_THROW'); }"
         " catch (e) { console.log('THREW:' + e.constructor.name); }"],
        cwd=str(ROOT), capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "THREW:RangeError" in p.stdout, p.stdout


def test_no_utc_slicing_in_rollups():
    src = (ROOT / "collectors" / "scheduler.mjs").read_text(encoding="utf-8")
    assert ".slice(0, 10)" not in src, "UTC date slicing must not define local days"


def test_rollups_disclose_coverage_and_preserve_nulls():
    out = _node("""
import { buildRollups } from './collectors/scheduler.mjs';
const events = [
  { provider: 'openrouter', billing_owner: 'openrouter', model: 'm', observed_at: '2026-09-05T10:00:00Z', input_tokens: 100, requests: 1 },
  { provider: 'openrouter', billing_owner: 'openrouter', model: 'm', observed_at: '2026-09-05T11:00:00Z', requests: 1 },
];
console.log(JSON.stringify(buildRollups(events, 'UTC')));
""")
    rows = json.loads(out)
    assert len(rows) == 1
    r = rows[0]
    assert r["input_tokens"] == 100, "missing tokens must not contribute"
    assert r["observation_count"] == 2
    assert r["input_tokens_present"] == 1
    # Billing activity stays grouped by billing owner, not model vendor.
    assert r["billing_owner"] == "openrouter"
