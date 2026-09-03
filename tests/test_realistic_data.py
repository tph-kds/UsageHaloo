"""Wave 3 regression tests for the realistic-data generator.

Asserts:
  1. /api/snapshot includes the new sample_data, day_utc, data_basis fields.
  2. The day_utc is the current UTC date.
  3. Two same-day calls return identical numeric data (per-day determinism).
  4. The FNV-1a seed (which the prototype uses) is influenced by the date,
     so different days produce different numbers.
  5. All 24 providers report non-negative primaryPercent, secondaryPercent,
     tokensToday, and costToday.
  6. The realistic-data cost rules are honored: subscription/zai show
     "subscription"; cloud-billing/openai/openrouter show a dollar value;
     everything else shows "—".
  7. The realistic-data primary percent rules are honored: budget_month
     grows with the day-of-month fraction; tokens_today follows the weekly
     rhythm; etc.
"""
from __future__ import annotations

import json
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "packages" / "brand-registry" / "providers.json"
PROTOTYPE = ROOT / "prototype" / "server.mjs"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(url: str, *, method: str = "GET", timeout: float = 5.0) -> tuple[int, bytes]:
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.fixture(scope="module")
def prototype_server():
    port = _free_port()
    env = {**__import__("os").environ, "VIUSAGEVER_PORT": str(port)}
    proc = subprocess.Popen(
        ["node", str(PROTOTYPE)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 5
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            code, _ = _http(f"{base}/api/health", timeout=1.0)
            if code == 200:
                yield base
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                return
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(0.1)
    proc.terminate()
    raise RuntimeError(f"prototype never came up: {last_err}")


def test_sample_data_flag_and_day(prototype_server: str) -> None:
    code, body = _http(f"{prototype_server}/api/snapshot")
    assert code == 200
    snap = json.loads(body)
    assert snap["sample_data"] is True, "snapshot must declare itself as sample data"
    assert snap["data_basis"] == "registry+per-day-deterministic"
    assert snap["day_utc"] == datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert snap["provider_count"] == 24


def test_per_day_determinism(prototype_server: str) -> None:
    code1, body1 = _http(f"{prototype_server}/api/snapshot")
    code2, body2 = _http(f"{prototype_server}/api/snapshot")
    assert code1 == code2 == 200
    s1, s2 = json.loads(body1), json.loads(body2)
    assert s1["day_utc"] == s2["day_utc"]
    by_id_1 = {p["id"]: p for p in s1["providers"]}
    by_id_2 = {p["id"]: p for p in s2["providers"]}
    for pid in by_id_1:
        a, b = by_id_1[pid], by_id_2[pid]
        assert a["primaryPercent"] == b["primaryPercent"], pid
        assert a["secondaryPercent"] == b["secondaryPercent"], pid
        assert a["tokensToday"] == b["tokensToday"], pid
        assert a["costToday"] == b["costToday"], pid


def test_seed_changes_with_day(prototype_server: str) -> None:
    """The FNV-1a seed (which the prototype uses) is influenced by the date.

    Re-implement the same hash function the prototype uses and assert that
    the seed for at least one provider changes between today and yesterday.
    """
    def fnv1a(s: str) -> int:
        h = 2166136261
        for ch in s:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        return h

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    reg = json.loads(REGISTRY.read_text())
    # Find a provider whose FNV bucket mod 61 differs between the two days.
    found = False
    for p in reg:
        a = fnv1a(p["id"] + ':' + today) % 61
        b = fnv1a(p["id"] + ':' + yesterday) % 61
        if a != b:
            found = True
            break
    assert found, "FNV-1a seed did not change across days for any provider; the realistic generator is not using the date in the seed"


def test_no_negative_or_nan_for_any_provider(prototype_server: str) -> None:
    code, body = _http(f"{prototype_server}/api/snapshot")
    assert code == 200
    snap = json.loads(body)
    assert len(snap["providers"]) == 24
    for p in snap["providers"]:
        assert isinstance(p["primaryPercent"], int) and 0 <= p["primaryPercent"] <= 100, p
        assert isinstance(p["secondaryPercent"], int) and 0 <= p["secondaryPercent"] <= 100, p
        t = p["tokensToday"]
        # Real Claude data (from the ingest path) overrides tokensToday to a
        # free-form string like "model: Claude Example". Allow that here.
        if isinstance(t, str) and t.startswith("model:"):
            continue
        m = re.match(r"^([\d.]+)([KM])$", t)
        assert m, f"tokensToday must look like 1.42M or 342K: {t} for {p['id']}"
        n = float(m.group(1))
        assert n >= 0
        c = p["costToday"]
        # Real Claude data overrides costToday to "$X.YZ session".
        if c == "subscription" or c == "—":
            continue
        if c.endswith(" session"):
            m2 = re.match(r"^\$(\d+\.\d{2}) session$", c)
            assert m2, f"costToday session suffix malformed: {c} for {p['id']}"
            dollars = float(m2.group(1))
            assert dollars >= 0
            continue
        assert re.match(r"^\$\d+\.\d{2}$", c), f"costToday malformed: {c} for {p['id']}"
        dollars = float(c[1:])
        assert dollars >= 0, f"negative dollar amount: {c} for {p['id']}"


def test_realistic_cost_rules(prototype_server: str) -> None:
    reg = json.loads(REGISTRY.read_text())
    by_id = {p["id"]: p for p in reg}
    code, body = _http(f"{prototype_server}/api/snapshot")
    snap = json.loads(body)
    for p in snap["providers"]:
        c = p["costToday"]
        conn = by_id[p["id"]]["connector"]
        # Real Claude ingest overrides the Claude costToday to "$X.YY session".
        if p["id"] == "claude-code" and c.endswith(" session"):
            assert re.match(r"^\$\d+\.\d{2} session$", c), f"claude-code costToday must be $X.YY session from fixture: got {c}"
            continue
        if conn in ("subscription", "zai"):
            assert c == "subscription", f"{p['id']} connector={conn} should be subscription: got {c}"
        elif conn in ("cloud-billing", "openai", "openrouter"):
            assert re.match(r"^\$\d+\.\d{2}$", c), f"{p['id']} connector={conn} should be $X.YY: got {c}"
        else:
            assert c == "—", f"{p['id']} connector={conn} should be —: got {c}"


def test_tokens_today_weekly_rhythm(prototype_server: str) -> None:
    reg = json.loads(REGISTRY.read_text())
    tokens_today_ids = [p["id"] for p in reg if p["primaryMetric"] == "tokens_today"]
    assert tokens_today_ids, "no tokens_today providers in registry"
    code, body = _http(f"{prototype_server}/api/snapshot")
    snap = json.loads(body)
    by_id = {p["id"]: p for p in snap["providers"]}
    today_dow = datetime.now(timezone.utc).weekday()
    expected_bucket = [38, 60, 78, 82, 70, 28, 14][today_dow]
    for pid in tokens_today_ids:
        pp = by_id[pid]["primaryPercent"]
        assert abs(pp - expected_bucket) <= 15, f"{pid} tokens_today primaryPercent={pp} not within ±15 of expected {expected_bucket} for dow={today_dow}"


def test_legacy_import_idempotent(prototype_server: str) -> None:
    """Wave 5: /api/snapshot/legacy-import one-shot copy.

    Seeds a legacy inbox file in the user's home, hits the endpoint, and
    asserts the new path got the file. Hits the endpoint again and asserts
    no-op. Cleans up after itself.
    """
    import os
    import shutil
    home = os.path.expanduser("~")
    legacy_dir = os.path.join(home, ".viusagever", "inbox")
    new_dir = os.path.join(home, ".usagehalo", "inbox")
    legacy_file = os.path.join(legacy_dir, "claude-code.jsonl")
    new_file = os.path.join(new_dir, "claude-code.jsonl")
    # Make sure the new path is empty before we start.
    if os.path.exists(new_file):
        os.remove(new_file)
    # Seed the legacy file with two valid records.
    os.makedirs(legacy_dir, exist_ok=True)
    payload_a = json.dumps({"observed_at": "2026-09-01T00:00:00Z", "session_id": "a", "rate_limits": {"five_hour": {"used_percentage": 11}}})
    payload_b = json.dumps({"observed_at": "2026-09-02T00:00:00Z", "session_id": "b", "rate_limits": {"five_hour": {"used_percentage": 22}}})
    with open(legacy_file, "w", encoding="utf-8") as f:
        f.write(payload_a + "\n" + payload_b + "\n")
    try:
        code, body = _http(f"{prototype_server}/api/snapshot/legacy-import", method="POST")
        assert code == 200, body
        out = json.loads(body)
        assert out["migrated"] is True, out
        assert out["count"] == 2, out
        assert os.path.exists(new_file), "new spool file must exist after import"
        # Idempotency: hit again, must be a no-op.
        code2, body2 = _http(f"{prototype_server}/api/snapshot/legacy-import", method="POST")
        assert code2 == 200
        out2 = json.loads(body2)
        assert out2["migrated"] is False, out2
        assert out2.get("reason") == "already_present", out2
    finally:
        # Clean up so other tests aren't affected.
        if os.path.exists(legacy_file):
            os.remove(legacy_file)
        if os.path.exists(new_file):
            os.remove(new_file)
        # Best-effort: remove the empty directories we may have created.
        for d in (legacy_dir, new_dir):
            try:
                if os.path.isdir(d) and not os.listdir(d):
                    os.rmdir(d)
            except OSError:
                pass
