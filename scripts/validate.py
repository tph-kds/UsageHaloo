from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "README.md",
    "VERIFICATION.md",
    "docs/00_EXECUTIVE_RECOMMENDATION.md",
    "docs/02_PROVIDER_RESEARCH.md",
    "docs/03_ARCHITECTURE.md",
    "docs/07_UI_UX_SYSTEM.md",
    "packages/brand-registry/providers.json",
    "crates/usage-halo-core/src/lib.rs",
    "crates/usage-halo-forecast/src/lib.rs",
    "crates/usage-halo-storage/migrations/0001_init.sql",
    "connectors/claude-code/src/lib.rs",
    "connectors/codex/src/lib.rs",
    "connectors/gemini-cli/src/lib.rs",
    "connectors/openrouter/src/lib.rs",
    "apps/desktop-ui/src/App.svelte",
    "apps/desktop-ui/src-tauri/tauri.conf.json",
    "demo/index.html",
    "demo/app.js",
    "demo/manifest.webmanifest",
    "apps/desktop-ui/src-tauri/icons/32x32.png",
    "apps/desktop-ui/src-tauri/icons/icon.ico",
    "apps/desktop-ui/src-tauri/icons/icon.icns",
    "prototype/server.mjs",
    "collectors/local.mjs",
    "collectors/store.mjs",
    "collectors/reconcile.mjs",
    "collectors/scheduler.mjs",
    "collectors/forecast.mjs",
    "collectors/alerts.mjs",
    "collectors/providers.mjs",
    "collectors/codex-app-server.mjs",
    "collectors/gemini-otlp.mjs",
    "collectors/daemon.mjs",
    "collectors/pollers.mjs",
    "platform/windows/UsageHalo.xml",
    "platform/windows/install-task.ps1",
    "platform/macos/dev.usagehalo.app.plist",
    "platform/linux/usagehalo.service",
    "crates/usage-halo-scheduler/src/lib.rs",
    "crates/usage-halo-secrets/src/lib.rs",
    "fixtures/gemini-otlp-metrics.json",
    "demo/widget.html",
    "scripts/run_checks.ps1",
    "scripts/privacy_audit.py",
    "scripts/live_smoke.mjs",
    "scripts/generate_icons.py",
    ".github/workflows/ci.yml",
]


def check_required() -> None:
    missing = [item for item in REQUIRED if not (ROOT / item).exists()]
    assert not missing, f"Missing required files: {missing}"


def check_registry() -> None:
    providers = json.loads((ROOT / "packages/brand-registry/providers.json").read_text())
    assert len(providers) >= 20, "Expected broad provider registry"
    ids = [p["id"] for p in providers]
    assert len(ids) == len(set(ids)), "Duplicate provider ids"

    # Asset layout: assets/providers/<dir>/<base_stem>{,-light,-dark}.{svg,png}
    # The manifest is keyed by directory name (its "id") and the base_stem is
    # the registry id (e.g. registry "aws-bedrock" -> dir "aws", stem "aws-bedrock";
    # registry "openai-api" -> dir "openai", stem "openai-api").
    manifest_path = ROOT / "assets/providers/icon-manifest.json"
    asset_map: dict[str, dict[str, str]] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for entry in manifest.get("providers", []):
            asset_map[entry["base_stem"]] = {
                "dir": entry["id"],
                "stem": entry["base_stem"],
            }
    for p in providers:
        asset_map.setdefault(p["id"], {"dir": p["id"], "stem": p["id"]})

    for p in providers:
        for field in ("id", "displayName", "connector", "status", "sourceMode", "freshness", "scope"):
            assert p.get(field), f"Provider {p.get('id')} missing {field}"
        mapping = asset_map.get(p["id"]) or {"dir": p["id"], "stem": p["id"]}
        asset_dir = ROOT / "assets/providers" / mapping["dir"]
        assert asset_dir.is_dir(), f"Missing asset directory for {p['id']}: {asset_dir}"
        required = [f"{mapping['stem']}.svg", f"{mapping['stem']}-light.svg", f"{mapping['stem']}-dark.svg"]
        for name in required:
            assert (asset_dir / name).exists(), f"Missing {name} for {p['id']} in {asset_dir}"


def check_fixtures() -> None:
    for path in (ROOT / "fixtures").glob("*.json"):
        json.loads(path.read_text())


def check_migration() -> None:
    sql = (ROOT / "crates/usage-halo-storage/migrations/0001_init.sql").read_text()
    conn = sqlite3.connect(":memory:")
    conn.executescript(sql)
    tables = {row[0] for row in conn.execute("select name from sqlite_master where type='table'")}
    expected = {"provider_accounts", "usage_events", "quota_snapshots", "connector_health", "daily_rollups", "alert_rules"}
    assert expected <= tables, f"Missing tables: {expected - tables}"


def check_privacy_guardrails() -> None:
    bridge = (ROOT / "connectors/claude-code/scripts/usage-halo-claude-bridge.mjs").read_text()
    assert "transcript_path" in bridge  # documented drop behavior
    assert "workspace.current_dir" not in bridge
    # Sanitized output object must not contain a transcript_path field assignment.
    clean_section = bridge.split("const clean =", 1)[1].split("const inbox", 1)[0]
    assert "transcript_path:" not in clean_section


def main() -> None:
    check_required()
    check_registry()
    check_fixtures()
    check_migration()
    check_privacy_guardrails()
    print("UsageHalo validation: PASS")


if __name__ == "__main__":
    main()
