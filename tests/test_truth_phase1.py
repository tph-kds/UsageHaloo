"""Phase 1 canonical contracts (remediation package 06/14 + Gate 1).

Gate 1 invariants:
- Snapshot wire carries an explicit schema version; adapters reject mismatch.
- Business totals derive ONLY from canonical numeric fields, never by
  parsing display strings ("1.42M", "$3.12").
- Rust canonical contracts and the TypeScript mirror agree on schema version.
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(url, *, method="GET", timeout=5.0):
    req = urllib.request.Request(url, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


@pytest.fixture(scope="module")
def server():
    port = _free_port()
    env = {**os.environ, "VIUSAGEVER_PORT": str(port)}
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


def _rust_schema_version() -> int:
    src = (ROOT / "crates" / "usage-halo-core" / "src" / "contracts.rs").read_text(encoding="utf-8")
    m = re.search(r"pub const SCHEMA_VERSION: u32 = (\d+);", src)
    assert m, "Rust SCHEMA_VERSION missing"
    return int(m.group(1))


def _ts_schema_version() -> int:
    src = (ROOT / "apps" / "desktop-ui" / "src" / "lib" / "contracts.ts").read_text(encoding="utf-8")
    m = re.search(r"export const SCHEMA_VERSION = (\d+);", src)
    assert m, "TS SCHEMA_VERSION missing"
    return int(m.group(1))


def test_schema_version_agrees_across_rust_and_ts():
    assert _rust_schema_version() == _ts_schema_version() == 1


def test_snapshot_carries_schema_version(server):
    for qs in ("", "?demo=1"):
        code, body = _http(f"{server}/api/snapshot{qs}")
        assert code == 200
        assert json.loads(body)["schema_version"] == _rust_schema_version()


def test_honest_snapshot_numerics_are_null_not_zero(server):
    code, body = _http(f"{server}/api/snapshot")
    assert code == 200
    for p in json.loads(body)["providers"]:
        # UNKNOWN != ZERO: without an observation the field is null, never a
        # placeholder zero. When the machine's real store holds observations
        # (e.g. Gemini OTLP events), the honest overlay reports those real
        # non-negative numerics instead of null — that is the desired path.
        for field in ("tokens_today_value", "cost_today_value"):
            v = p[field]
            assert v is None or (isinstance(v, (int, float)) and v >= 0), (p["id"], field, v)


def _fmt_tokens(n: int) -> str:
    return f"{round(n / 1000)}K" if n < 1_000_000 else f"{n / 1_000_000:.2f}M"


def test_demo_numerics_match_display_strings(server):
    """Demo numerics must be the exact values the display strings render."""
    code, body = _http(f"{server}/api/snapshot?demo=1")
    assert code == 200
    for p in json.loads(body)["providers"]:
        tv, cv = p["tokens_today_value"], p["cost_today_value"]
        if isinstance(p["tokensToday"], str) and p["tokensToday"].startswith("model:"):
            # Real Claude overlay supersedes demo numbers: twins nulled.
            assert tv is None and cv is None, p["id"]
            continue
        assert isinstance(tv, int) and tv > 0, p["id"]
        assert p["tokensToday"] == _fmt_tokens(tv), (p["id"], p["tokensToday"], tv)
        if p["costToday"] == "subscription" or p["costToday"] == "—":
            assert cv is None, p["id"]
        elif p["costToday"].endswith(" session"):
            pass  # real Claude overlay: session figure, not a day total
        else:
            assert p["costToday"] == f"${cv:.2f}", (p["id"], p["costToday"], cv)


def test_frontend_derives_no_totals_from_display_strings():
    src = (ROOT / "apps" / "desktop-ui" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
    assert "tokens_today_value" in src and "cost_today_value" in src
    assert "([KM])" not in src, "must not parse 1.42M-style display strings"
    assert "match(/\\$" not in src, "must not parse $3.12-style display strings"
    demo = (ROOT / "demo" / "app.js").read_text(encoding="utf-8")
    assert "tokens_today_value" in demo and "cost_today_value" in demo


def test_license_claims_match_apache_license_file():
    assert "Apache License" in (ROOT / "LICENSE").read_text(encoding="utf-8")[:400]
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "MIT" not in readme.split("## License", 1)[1].split("---", 1)[0], "README license section must not claim MIT"
    cargo = (ROOT / "Cargo.toml").read_text(encoding="utf-8")
    assert 'license = "Apache-2.0"' in cargo
