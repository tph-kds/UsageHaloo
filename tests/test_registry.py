import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_registry_has_priority_connectors():
    providers = json.loads((ROOT / "packages/brand-registry/providers.json").read_text())
    ids = {p["id"] for p in providers}
    assert {"claude-code", "codex", "gemini-cli", "openai-api", "openrouter", "cursor", "zai"} <= ids


def test_no_official_logo_claim_in_placeholders():
    text = (ROOT / "docs/12_BRAND_ASSETS.md").read_text().lower()
    # The brand spec must declare the placeholder policy in three ways:
    #   1. Ship only neutral monogram placeholders in the scaffold.
    #   2. Separate the official mark from the usage-state ring.
    #   3. Use a UsageHalo-generated fallback for unreviewed brands.
    assert "neutral monogram placeholders" in text
    assert "usage halo-owned usage ring" in text or "usagehalo-owned usage ring" in text
    assert "usage halo-generated letter mark" in text or "usagehalo-generated letter mark" in text
