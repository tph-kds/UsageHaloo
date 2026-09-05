#!/usr/bin/env python3
"""Wave 2: commit Phases 0-6 as 7 reviewable commits with full test battery per step.

Planone-gated: requires `approved_plan_digest` in STATE.md to be a real
sha256 (not PENDING_HUMAN_APPROVAL). Reads STATE.md; refuses to run
without approval.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / ".planonce/work/usagehalo-truth-remediation/STATE.md"


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, **kw)


def gate():
    if not STATE.exists():
        sys.exit("STATE.md missing; cannot run Wave 2.")
    text = STATE.read_text(encoding="utf-8")
    if "approved_plan_digest: PENDING_HUMAN_APPROVAL" in text:
        sys.exit("plan not approved yet (approved_plan_digest = PENDING).")
    if "PENDING" in text.split("## Gates", 1)[1].split("## Completed", 1)[0]:
        sys.exit("a gate in STATE.md is still PENDING; cannot run Wave 2.")


def phase0():
    return [
        "Cargo.lock", "Cargo.toml", "README.md",
        "apps/desktop-ui/src-tauri/Cargo.toml",
        "apps/desktop-ui/src/App.svelte",
        "apps/desktop-ui/src/lib/api.ts",
        "apps/desktop-ui/src/lib/components/Heatmap.svelte",
        "apps/desktop-ui/src/lib/types.ts",
        "apps/desktop-ui/src/lib/contracts.ts",
        "collectors/daemon.mjs",
        "collectors/local.mjs",
        "collectors/scheduler.mjs",
        "prototype/server.mjs",
        "demo/app.js",
        "demo/index.html",
        "tests/test_realistic_data.py",
        "tests/test_truth_phase0.py",
        "crates/usage-halo-core/src/contracts.rs",
        "crates/usage-halo-core/src/time.rs",
        "crates/usage-halo-reconcile/src/policy.rs",
    ]


def phase1():
    return [
        "crates/usage-halo-core/Cargo.toml",
        "crates/usage-halo-core/src/lib.rs",
    ]


def phase2():
    return [
        "crates/usage-halo-storage/Cargo.toml",
        "crates/usage-halo-storage/migrations/0001_init.sql",
        "crates/usage-halo-storage/src/lib.rs",
    ]


def phase3():
    # The 0001 migration file is the only sqlite migration change in this
    # commit; the SQLite authority was established in Phase 2. The 0001
    # tweak (removing in-migration PRAGMA, adding WAL via connection opts)
    # is structurally part of Phase 2's "authoritative SQLite" promise and
    # already covered by Phase 2's tests. We split it out as a separate
    # commit here so the diff matches the audit's phase labels exactly.
    return [
    "crates/usage-halo-storage/migrations/0001_init.sql",
    "crates/usage-halo-reconcile/Cargo.toml",
    "crates/usage-halo-reconcile/src/lib.rs",
    "connectors/claude-code/src/lib.rs",
    "connectors/codex/src/lib.rs",
    "connectors/gemini-cli/src/lib.rs",
    "connectors/openrouter/src/lib.rs",
    "connectors/openai/Cargo.toml",
    "connectors/openai/src/lib.rs",
    ]


def phase4():
    return [
        "apps/desktop-ui/src-tauri/src/legacy_adapter.rs",
        "tests/test_truth_phase1.py",
        "tests/test_truth_phase2.py",
        "tests/test_truth_phase3.py",
        "tests/test_truth_phase4.py",
    ]


def phase5():
    return [
        "crates/usage-halo-collector",
    ]


def phase6():
    return [
        "tests/test_truth_phase5.py",
        "tests/test_truth_phase6.py",
        "docs/.plans/UsageHalo_Remediation_Package/PHASE5_COMPLETE.md",
        "docs/.plans/UsageHalo_Remediation_Package/PHASE6_L5_VERIFICATION.md",
    ]


PHASES = [
    ("phase0: truth killswitches", phase0,
     "remediation(phase0): remove fake data paths; typed state; source-time freshness"),
    ("phase1: canonical contracts", phase1,
     "remediation(phase1): typed contracts, timezone-aware windows, no live/sample collapse"),
    ("phase2: SQLite authority", phase2,
     "remediation(phase2): SQLite authoritative, constraint-owned dedup, health-preserve upsert"),
    ("phase3: reconciliation + time", phase3,
     "remediation(phase3): scope-safe reconciliation, IANA calendar windows, DST-verified"),
    ("phase4: projection service", phase4,
     "remediation(phase4): one ProjectionService owns every user-visible number; legacy_adapter formats only"),
    ("phase5: connector runtime", phase5,
     "remediation(phase5): supervised ConnectorHost, class-specific retry, OS-keychain secrets"),
    ("phase6: L5 evidence", phase6,
     "remediation(phase6): L5 evidence matrix; honest verified state per connector"),
]


def battery(label):
    print(f"\n=== battery: {label} ===")
    steps = [
        ("pytest", ["python", "-m", "pytest", "tests/", "-q"]),
        ("fmt", ["cargo", "fmt", "--check"]),
        ("clippy (non-desktop)", [
            "cargo", "clippy",
            "-p", "usage-halo-core",
            "-p", "usage-halo-storage",
            "-p", "usage-halo-reconcile",
            "-p", "usage-halo-projection",
            "-p", "usage-halo-collector",
            "--all-targets", "--", "-D", "warnings",
        ]),
        ("clippy (desktop)", ["cargo", "clippy", "-p", "usage-halo-desktop", "--no-deps"]),
        ("cargo test core", ["cargo", "test", "-p", "usage-halo-core", "--quiet"]),
        ("cargo test reconcile", ["cargo", "test", "-p", "usage-halo-reconcile", "--quiet"]),
        ("cargo test storage", ["cargo", "test", "-p", "usage-halo-storage", "--quiet"]),
        ("cargo test projection", ["cargo", "test", "-p", "usage-halo-projection", "--quiet"]),
        ("cargo test collector", ["cargo", "test", "-p", "usage-halo-collector", "--quiet"]),
        ("validate", ["python", "scripts/validate.py"]),
        ("privacy", ["python", "scripts/privacy_audit.py"]),
    ]
    fail = []
    for name, cmd in steps:
        r = run(cmd, timeout=600)
        ok = r.returncode == 0
        print(f"  [{'OK' if ok else 'FAIL'}] {name}")
        if not ok:
            fail.append((name, r.stderr[-400:]))
    return fail


def main():
    gate()
    # Confirm pre-state
    r = run(["git", "status", "--porcelain"])
    pre = set(r.stdout.splitlines())
    print(f"pre-Wave-2: {len(pre)} files in working tree")

    for label, picker, subject in PHASES:
        paths = [p for p in picker() if not p.endswith("/")]
        # Resolve directory paths (e.g. crates/usage-halo-collector) to all
        # files under them that are currently in the working tree.
        files = []
        for p in paths:
            full = ROOT / p
            if full.is_dir():
                files.extend(str(f.relative_to(ROOT)).replace("\\", "/")
                              for f in full.rglob("*") if f.is_file()
                              and (f.is_relative_to(ROOT)))
            else:
                files.append(p)
        # Filter to paths that are still in the working tree (not already
        # committed in a prior step).
        live = [f for f in files
                if any(line.endswith(" " + f) for line in pre)
                or any(line.endswith(" " + f.replace("/", "\\")) for line in pre)]
        if not live:
            print(f"\n=== {label}: nothing to commit (already in a prior phase or pre-state has changed) ===")
            continue
        run(["git", "add", "--"] + live)
        # Conventional Commits: <type>(<scope>): <subject>
        msg = f"{subject}\n\nRefs: docs/.plans/UsageHalo_Remediation_Package/"
        # Add a one-line per-phase note in the body
        msg += {
            "phase0": "02_P0_DATA_TRUTH_AND_REALISM_FIXES.md",
            "phase1": "14_CANONICAL_DATA_CONTRACTS.md",
            "phase2": "05_STORAGE_RECONCILIATION_TIME_FORECAST_ALERTS.md",
            "phase3": "05_STORAGE_RECONCILIATION_TIME_FORECAST_ALERTS.md",
            "phase4": "06_FRONTEND_ARCHITECTURE_AND_STATE_MODEL.md",
            "phase5": "03_BACKEND_AND_RUNTIME_REMEDIATION.md",
            "phase6": "08_TESTING_TRUTHFULNESS_AND_RELEASE_GATES.md",
        }[label.split(":")[0]]
        r = run(["git", "commit", "-m", msg])
        print(f"\n--- {label}: commit {'OK' if r.returncode == 0 else 'FAIL'} ---")
        if r.returncode != 0:
            print(r.stdout)
            print(r.stderr)
            sys.exit(1)
        # Print the new commit SHA
        r = run(["git", "rev-parse", "--short", "HEAD"])
        print(f"commit: {r.stdout.strip()}")
        # Run the full battery
        fails = battery(label)
        if fails:
            print(f"\n!!! {label}: battery FAILED on:")
            for name, err in fails:
                print(f"  - {name}: {err}")
            sys.exit(1)

    # Final state
    r = run(["git", "log", "--oneline", "34360b0..HEAD"])
    print(f"\nfinal log (34360b0..HEAD):\n{r.stdout}")
    r = run(["git", "status", "--porcelain"])
    print(f"\nworking tree: {len(r.stdout.splitlines())} files remain")
    print("Wave 2 complete.")


if __name__ == "__main__":
    main()
