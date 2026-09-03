"""Regression test for the showcase-all-providers change.

Boots the zero-dependency prototype server, hits /api/snapshot and
/api/registry, and asserts:

  1. /api/snapshot includes every provider registered in
     packages/brand-registry/providers.json.
  2. Each provider entry has the showcase shape (displayName, accent,
     monogram, primaryLabel, primaryPercent, icon, source, freshness,
     health, scope, connector).
  3. /api/snapshot's `models` array contains at least one row where
     `model_provider != billing_owner` for the generic-response,
     cloud-billing, and openrouter groups (billing-owner invariant).
  4. /api/registry reports the same provider count as the registry.
  5. /assets/providers/<dir>/<id>.svg returns 200 for the Claude icon
     (sanity check on the new static route).
  6. Posting the bundled Claude fixture to /api/ingest/claude is
     accepted, and the next /api/snapshot reflects the live Claude
     numbers (sanity check on the existing ingest path).
"""
from __future__ import annotations

import json
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "packages" / "brand-registry" / "providers.json"
PROTOTYPE = ROOT / "prototype" / "server.mjs"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _http(url: str, *, method: str = "GET", body: bytes | None = None, content_type: str | None = None, timeout: float = 5.0) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method)
    if content_type:
        req.add_header("content-type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.getcode(), resp.read()
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
    # Wait up to 5s for /api/health to come up.
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


def test_registry_and_snapshot_full(prototype_server: str) -> None:
    base = prototype_server
    registry = json.loads(REGISTRY.read_text())
    reg_ids = [p["id"] for p in registry]
    assert len(reg_ids) == len(set(reg_ids)), "duplicate provider ids in registry"

    code, body = _http(f"{base}/api/health")
    assert code == 200
    health = json.loads(body)
    assert health["providers"] == len(registry), "/api/health provider count must match registry"

    code, body = _http(f"{base}/api/snapshot")
    assert code == 200
    snapshot = json.loads(body)
    snap_ids = [p["id"] for p in snapshot["providers"]]
    missing = [i for i in reg_ids if i not in snap_ids]
    assert not missing, f"snapshot missing providers: {missing}"
    assert snapshot["provider_count"] == len(registry)

    # Showcase shape for every entry.
    required_fields = {
        "id", "displayName", "accent", "monogram", "connector",
        "sourceMode", "freshness", "scope", "primaryMetric",
        "primaryLabel", "primaryPercent", "icon", "source", "health",
    }
    for p in snapshot["providers"]:
        missing_fields = required_fields - set(p)
        assert not missing_fields, f"{p.get('id')} missing {missing_fields}"
        assert p["icon"].startswith("/assets/providers/"), f"{p['id']} icon must be served from /assets"

    # /api/registry must match.
    code, body = _http(f"{base}/api/registry")
    assert code == 200
    api_reg = json.loads(body)
    assert api_reg["count"] == len(registry)
    assert {p["id"] for p in api_reg["providers"]} == set(reg_ids)


def test_assets_route_serves_icons(prototype_server: str) -> None:
    base = prototype_server
    code, body = _http(f"{base}/assets/providers/claude-code/claude-code.svg")
    assert code == 200, "Claude icon must be served"
    assert body.startswith(b"<") or b"<svg" in body[:200], "icon response must look like SVG"

    # Path traversal protection: ../etc must be rejected.
    code, _ = _http(f"{base}/assets/providers/%2E%2E%2FREADME.md")
    assert code in (400, 404), "path traversal must be rejected"

    # Only SVG/PNG from /assets/providers/ — other assets paths are 404.
    code, _ = _http(f"{base}/assets/icon-manifest.json")
    assert code == 404


def test_billing_owner_invariant_in_models(prototype_server: str) -> None:
    base = prototype_server
    code, body = _http(f"{base}/api/snapshot")
    assert code == 200
    snapshot = json.loads(body)
    by_id = {p["id"]: p for p in snapshot["providers"]}

    inv = ["xai", "deepseek", "groq", "together", "fireworks", "cerebras", "aws-bedrock", "azure-openai", "vertex-ai", "openrouter"]
    matched = []
    for m in snapshot["models"]:
        owner = by_id.get(m["billing_owner"], {})
        if owner.get("connector") in {"generic-response", "cloud-billing", "openrouter"}:
            assert m["model_provider"] != m["billing_owner"], (
                f"billing-owner invariant violated for {m['billing_owner']}: "
                f"model_provider={m['model_provider']} must differ from billing_owner"
            )
            matched.append(m["billing_owner"])
    assert any(i in matched for i in inv), f"expected at least one of {inv} in models with separated owner/vendor; got {matched}"


def test_ingest_claude_round_trip(prototype_server: str) -> None:
    base = prototype_server
    fixture = (ROOT / "fixtures" / "claude-statusline.json").read_text().encode("utf-8")
    code, body = _http(f"{base}/api/ingest/claude", method="POST", body=fixture, content_type="application/json")
    assert code == 202, f"ingest should accept: {body!r}"

    # Allow the file to flush.
    time.sleep(0.2)
    code, body = _http(f"{base}/api/snapshot")
    assert code == 200
    snap = json.loads(body)
    claude = next(p for p in snap["providers"] if p["id"] == "claude-code")
    assert claude["primaryPercent"] == 73
    assert claude["secondaryPercent"] == 21
    assert claude["source"] == "claude_code_statusline"
    assert claude["health"] == "healthy"


def test_no_negative_dollar_amounts(prototype_server: str) -> None:
    """Regression: hashing into a uint32 and using `>>` (signed shift) was
    producing negative values for ~50% of providers. Costs and tokens must
    always be non-negative.
    """
    base = prototype_server
    code, body = _http(f"{base}/api/snapshot")
    assert code == 200
    snap = json.loads(body)
    for p in snap["providers"]:
        assert p["primaryPercent"] is None or p["primaryPercent"] >= 0, p
        assert p["secondaryPercent"] is None or p["secondaryPercent"] >= 0, p
    for m in snap["models"]:
        assert m["tokens"] >= 0, m
        cost = str(m["cost"])
        if cost.startswith("$") and cost[1:2].isdigit() or cost.startswith("$-"):
            assert not cost.startswith("$-"), f"negative cost emitted: {m}"
