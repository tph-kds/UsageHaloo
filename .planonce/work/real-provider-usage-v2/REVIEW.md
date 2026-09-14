---
schema: planonce.review/v1
change_id: real-provider-usage-v2
revision: b55f56b8f8c225c08f86e99bd50533973c688b49
baseline_revision: 9e5be2fc2d3420a508701f63a659a1be04efee74
plan_digest: sha256:b645447069b2334acdf69a2127e90b5cdf526e22b248d3c3701f1cb725d24121
ship_decision: READY_WITH_BACKLOG
---
# Review — real-provider-usage-v2

## Scope

Diff main...HEAD (21 commits). Requirements R1–R14, non-goals NG1–NG4 per
CONTEXT.md. Security review current (SECURITY_REVIEW.md, no findings).

## Requirement coverage (against implementation + tests)

- R1 no fabrication: proven (fault matrix 6/6, 24-provider percent audit clean).
- R2 settings: delivered (modal section; enable/disable pre-existing).
- R3 Tier-1 adapters: 4/4 with real-system probes (1 verified live, 3 partial).
- R4 honest states: proven (stale/error/unavailable/unsupported/demo paths).
- R5 account gate: implemented + tested in all 4 adapters.
- R6 headline: id-based resolution + stability tests.
- R7/R8 refresh/backoff: scheduler policy + persisted backoff + restart test.
- R9 history: timezone boundaries + restart reread proven (20 checks).
- R10 demo isolation: default real, labeled, failure never demo.
- R11 secrets: alias-only preserved; audit clean.
- R12 fixtures + real verification: sanitized fixtures per slice + live probes.
- R13 no regression: full suites green (cargo 0-fail, pytest 89, validate PASS).
- R14 fake-path removal: audit finds no production-reachable fake path;
  explicit demo mode retained per brief section 13 (not a fake production path).

## Findings

- P0/P1: none.
- P2 (accepted): modal visuals unverified in browser (no driver); Cursor
  live-WAL and Gemini CLI quota INCONCLUSIVE on this machine.
- P3 backlog: spool whole-file read size cap; persisted codex 2030-reset seed
  rows (prior-session data, surfaced as-is); untracked scaffold crates
  (collector/projection) pending a tracked-home decision with human.

## Verification freshness

cargo test --workspace 0 failures, pytest 89, validate PASS, svelte-check 0,
node suites green — all run 2026-09-14 on revision b55f56b. Committed gates:
Phase A/B/C/D records + approvals in chat.

## Ship decision

READY_WITH_BACKLOG. No blockers. Residual items are documented, accepted,
and do not affect data truth. Ship remains a human decision.
