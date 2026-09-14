# Phase B gate record — Tier-1 slices (2026-09-14, branch feat/real-provider-usage-v2)

## Fresh evidence

- cargo test --workspace: all suites ok, 0 failed (core 27, storage 18, claude 11, codex 11, cursor 9, gemini 9, scheduler 7, collector 6).
- python -m pytest -q: 89 passed. scripts/validate.py: PASS. svelte-check: 0 errors, 0 warnings.
- Live server curls: claude-code stale/zero-windows, codex primary 28 + secondary 61 stale, cursor unsupported, gemini-cli unsupported, 4 providers carrying v2.

## Provider support matrix (verified, not planned)

| Provider | Capabilities claimed | Verified source | Fallback | Real-system status |
|---|---|---|---|---|
| Claude Code | quota_windows | statusline spool (official-session) | stats-cache telemetry (never quota) | PARTIAL (spool 11d old → STALE correct; no live session; account fields unobserved) |
| Codex | quota_windows | app-server live (initialize handshake, 3 windows) | newest rollout tail scan | VERIFIED live path; PARTIAL identity (no account id observable) |
| Cursor | detection | local state.vscdb identity (read-only) | none (admin API unconfigured) | PARTIAL (live-WAL-while-running INCONCLUSIVE, not running) |
| Gemini/Antigravity | detection, token-telemetry | local state dirs + active account id | OTLP DERIVED only | PARTIAL (CLI quota INCONCLUSIVE, no CLI installed) |

## Per-provider evidence (§27 shape, condensed)

- Claude: detected=true, account none, source statusline-spool, health STALE windows 0, fixture suite 8 negatives green. Real defect fixed pre-commit: observed-time aging.
- Codex: live --check 3 windows (primary 0% 5h, secondary 31% weekly, plan plus). Pipeline defect fixed: secondary 61% misattributed to primary + false live; now per-row attribution with age-honest health. Rollout fallback retains current windows as STALE, drops expired.
- Cursor: detected=true, signed-in present (value never logged), Unsupported zero windows, read-only discipline with WAL-visibility test on synthetic DB.
- Gemini: detected=true, account present (value never logged), Unsupported zero windows, oauth never opened (canary test).

## Rollback readiness

- Every commit is single-purpose and revertible in order: bf84ee6, 550dbaf, 58842f1, 1cd16cf, ed2960f, 5ca3c4e, 5149d87, c2c525f.
- Migration 0004 additive only; old tables untouched. No fake-path deletions yet (WP16 in Phase E).
- Working-tree note: A4 collector wiring lives in untracked crates/usage-halo-collector/ (prior-session scaffold, tests green); commit deferred to Phase E ship decision.

## Residual risks

- Claude/Cursor/Gemini account identifiers are partial (email/active-id present, org unobserved).
- Cursor live-WAL behavior and Gemini CLI quota are INCONCLUSIVE on this machine.
- Persisted codex rows carry odd 2030 resets (prior-session seed data); surfaced as-is, stale-gated.
