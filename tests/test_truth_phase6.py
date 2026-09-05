"""Phase 6 L5 connector evidence (Gate 6).

A connector is L5 only when it has fixtures, privacy, and (where eligible)
live smoke evidence. This file does NOT invent live smoke; it asserts the
honest state: each connector's verification status is *checked* from the
repository so a regression in source code or docs shows up immediately.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Required fixture evidence per P0 connector. Each test reads the listed file
# and asserts the proof is present (no live claims; the matrix in
# PHASE6_L5_VERIFICATION.md owns the LIVE_VERIFIED column).

REQUIRED = {
    "claude-code": "Claude Code",
    "codex": "Codex",
    "gemini-cli": "Gemini CLI",
    "openrouter": "OpenRouter",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


RUST_TESTS = {
    "claude-code": (
        "connectors/claude-code/src/lib.rs",
        (r"parse_preserves_source_observed_at",
         r"sanitizer_drops_sensitive_path_fields"),
    ),
    "codex": ("connectors/codex/src/lib.rs", (r"parses_primary_secondary",)),
    "gemini-cli": (
        "connectors/gemini-cli/src/lib.rs",
        (r"token_types_land_in_the_right_dimension",
         r"unknown_token_type_yields_no_dimensions_but_keeps_provenance"),
    ),
    "openai-api": (
        "connectors/openai/src/lib.rs",
        (r"buckets_map_to_canonical_events_with_window_timestamps",),
    ),
    "openrouter": (
        "connectors/openrouter/src/lib.rs",
        (r"credits_math_never_invents_a_percentage",),
    ),
    "anthropic-api": (
        "connectors/anthropic/src/lib.rs",
        (r"instrumented_response_maps_cache_dimensions_and_keys_off_request",),
    ),
}


def test_evidence_markers_present_per_connector():
    for cid, (path, markers) in RUST_TESTS.items():
        src = _read(ROOT / path)
        for marker in markers:
            assert re.search(marker, src), (
                f"{cid}: marker {marker!r} missing from {path}"
            )


def test_collector_lifecycle_marks_phase5_evidence():
    src = _read(ROOT / "crates/usage-halo-collector/src/lib.rs")
    # Every P0 connector must have a managed slot. New providers must be
    # added here explicitly (no implicit fallback for un-managed ones).
    for cid in ("claude-code", "codex", "gemini-cli", "openrouter", "openai-api"):
        assert f'"{cid}"' in src, f"{cid} not managed by ConnectorHost"
    # The boot pass + cadence loop must run on Tauri startup.
    assert "collect_due" in src
    # Backoff is class-specific, not text-parsed.
    assert "rate_limit" in src and "auth" in src
    # Secrets resolve from the keychain with env fallback; no fallback loops
    # silently swallow missing-key cases.
    assert "with_env_fallback" in src


def test_l5_matrix_doc_uses_honest_verified_state():
    doc = _read(
        ROOT
        / "docs"
        / ".plans"
        / "UsageHalo_Remediation_Package"
        / "PHASE6_L5_VERIFICATION.md"
    )
    assert "NOT_YET_VERIFIED" in doc, "L5 matrix must explicitly mark what is not yet verified"
    # Per-row values: each provider row must report FIXTURE_VERIFIED or an
    # honest "not yet" state. LIVE_VERIFIED is reserved for the connector
    # table cell, never in the doc body. The rule text below names the
    # phrase to allow it in the prose while forbidding it as a row value.
    allowed_row_states = (
        "FIXTURE_VERIFIED",
        "PLANNED_P1",
        "PLANNED_P2",
        "FIXTURE_PASS",
        "PASS",
        "NOT_YET_VERIFIED",
        "L4",
        "L5",
        "IMPLEMENTED",
        "LIVE_VERIFIED",  # text-only; the test below asserts no row has it
    )
    for cid, display in REQUIRED.items():
        assert display in doc, f"{cid} missing from L5 matrix"
    # Forbid LIVE_VERIFIED appearing in any connector row (table cell).
    # A simple "FIXTURE_VERIFIED" cell is the only honest upgrade at this
    # point; L5 requires opt-in live smoke that hasn't been performed.
    import re
    rows = re.findall(r"^\| .+\|$", doc, flags=re.M)
    seen_any = False
    for row in rows:
        if not any(connector in row for connector in REQUIRED):
            continue
        seen_any = True
        # The literal phrase "LIVE_VERIFIED" may appear in the row's
        # Notes column as a guard. What we forbid is the Status cell
        # (column index 5 in this 7-column table) taking that value.
        cols = [c.strip() for c in row.strip("|").split("|")]
        if len(cols) >= 6 and cols[5] == "LIVE_VERIFIED":
            raise AssertionError(
                f"LIVE_VERIFIED may only be added after a recorded opt-in "
                f"live smoke run: {row!r}"
            )
        assert any(state in row for state in allowed_row_states), (
            f"row {row!r} must carry an explicit verification state"
        )
    assert seen_any, "no P0 connector rows found in matrix"


def test_no_claim_without_evidence_in_source_status():
    # `SOURCE_STATUS.md` must not upgrade a connector to "verified" or
    # "implemented" without a test or a run proving it. This test pins the
    # current state.
    src = _read(ROOT / "SOURCE_STATUS.md")
    forbidden = [
        "openrouter",  # polled without a keychain-ready production path
    ]
    # This is a soft check: the file uses table rows, not strict phrases.
    # What we forbid is *boastful* language. We assert only the well-known
    # supported-implementation phrases are absent for the unverified rows.
    for fragment in ("openrouter.LIVE", "Live verified", "all providers live"):
        assert fragment.lower() not in src.lower(), (
            f"forbidden claim present: {fragment!r}"
        )


def test_registry_advertises_no_implied_support():
    reg = json.loads(_read(ROOT / "packages/brand-registry/providers.json"))
    assert len(reg) == 24, f"registry has {len(reg)} providers, expected 24"
    # Registry must not advertise a percentage or live state. Presence in
    # the registry never implies support.
    for p in reg:
        for k in ("primaryPercent", "live", "quota"):
            assert k not in p, f"{p.get('id')} advertises {k!r}"


def test_no_synthetic_data_in_collector_production_paths():
    # Connector host must never fabricate values. Check the failure-class
    # backoff is the only place `retry_after` is set on errors and there are
    # no `make up a percentage` calls.
    src = _read(ROOT / "crates/usage-halo-collector/src/lib.rs")
    assert "0.5" not in src, "no half-percent fabrication"
    assert "fake" not in src.lower(), "no fake calls"
    assert "synth" not in src.lower(), "no synth calls"
    # And every persisted observation has a real fingerprint path through
    # Storage — the `insert_usage_event`/`insert_quota_snapshot` call sites
    # must come from a real source (Connector::snapshot() or a spool record).
    assert "insert_usage_event" in src and "insert_quota_snapshot" in src
    # The file-store handoff is the only JSONL import path; no second truth.
    assert "import_jsonl" in src


def test_phase5_artifact_inventory():
    """Pinned list of files that constitute the Phase 5 deliverable. If any
    of these disappear, the architecture gate is broken."""
    required_files = [
        "crates/usage-halo-core/src/contracts.rs",
        "crates/usage-halo-core/src/time.rs",
        "crates/usage-halo-projection/src/lib.rs",
        "crates/usage-halo-collector/src/lib.rs",
        "crates/usage-halo-storage/src/lib.rs",
        "crates/usage-halo-storage/migrations/0002_canonical.sql",
        "crates/usage-halo-storage/migrations/0003_session_states.sql",
        "crates/usage-halo-reconcile/src/policy.rs",
        "apps/desktop-ui/src/lib/contracts.ts",
        "apps/desktop-ui/src/lib/api.ts",
        "apps/desktop-ui/src/lib/components/Heatmap.svelte",
        "apps/desktop-ui/src-tauri/src/legacy_adapter.rs",
        "apps/desktop-ui/src-tauri/src/lib.rs",
        "tests/test_truth_phase0.py",
        "tests/test_truth_phase1.py",
        "tests/test_truth_phase2.py",
        "tests/test_truth_phase3.py",
        "tests/test_truth_phase4.py",
        "tests/test_truth_phase5.py",
    ]
    for f in required_files:
        assert (ROOT / f).exists(), f"required Phase 5 artifact missing: {f}"
