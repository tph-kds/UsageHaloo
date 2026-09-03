"""Live-smoke harness: without keys everything skips and nothing leaks."""
from __future__ import annotations
import json, os, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def test_live_smoke_skips_honestly_without_keys():
    env = {k: v for k, v in os.environ.items()
           if k not in {"OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"}}
    p = subprocess.run(["node", str(ROOT / "scripts" / "live_smoke.mjs")],
                       cwd=str(ROOT), capture_output=True, text=True, env=env)
    assert p.returncode == 0, p.stderr
    d = json.loads(p.stdout)
    assert d["openrouter"].get("skipped") is True
    assert d["openai"].get("skipped") is True
    blob = json.dumps(d)
    assert "sk-" not in blob and "Bearer" not in blob
    # Localhost probes are device-scoped by construction — never account-wide.
    for key in ("ollama", "lm_studio"):
        scope = d[key].get("scope")
        assert scope in (None, "device", "instrumented_traffic_only"), (key, scope)
