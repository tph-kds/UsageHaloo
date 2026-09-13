---
schema: planonce.plan/v1
change_id: real-provider-usage-v2
workflow: BROWN-LARGE
plan_revision: 1
approval_status: PENDING
---
# Implementation Plan

## Goal

Deliver the V2 truth model from the brief. Every dashboard value traces to a real provider-owned or explicitly derived source with account identity, provenance, fidelity, freshness, and honest unavailable states. Demo exists only behind explicit mode. Proven slice by slice, with history, settings, diagnostics, hardening, and fake-path removal last.

## Accepted requirements

- R1: Real-mode values backed by persisted normalized observations with provenance and timestamps.
- R2: Provider Settings with discovery, enable/disable, account, capabilities, source, freshness, health.
- R3: Adapters for Claude Code, Codex, Cursor, Gemini/Antigravity proven against real local state.
- R4: Failures render STALE/UNKNOWN/NEEDS_AUTH/RATE_LIMITED/UNAVAILABLE/UNSUPPORTED/ERROR, never 0%.
- R5: Account identity gate. No cross-account silent overwrite.
- R6: Stable headline metric per provider.
- R7: Quota/billing/token/runtime/activity separated with per-class refresh.
- R8: Adaptive polling with persisted 429/backoff across restart.
- R9: Today/Week/Month from persisted observations with timezone boundaries, restart-safe.
- R10: Demo mode explicit and labeled. Real failure never yields demo.
- R11: Alias-only secrets. No raw tokens in DB/logs/sync.
- R12: Sanitized fixtures plus real-system verification per supported provider.
- R13: No regression in nav/themes/layout/icons/settings.
- R14: Obsolete fake production paths deleted after proof.

## Non-goals

- NG1–NG4 per CONTEXT.md. P2 analytics/sync/mobile deferred. No drive-by refactors.

## Approach

Foundation first, then one vertical slice to prove the architecture (Claude), then Tier-1 slices, then settings/doctor/history E2E, then P1 providers, then hardening and fake-path removal. Shared schema and UI contracts have one owner at a time. Parallel lanes open only after Phase A interfaces freeze. Each phase ends in runnable behavior with fresh evidence and a human gate.

## Interfaces / files affected

- Interface/file: crates/usage-halo-core/src/lib.rs + contracts.rs (+ TS mirror apps/desktop-ui/src/lib/contracts.ts) — fidelity/descriptor/observation/window/snapshot/adapter/definition types.
- Interface/file: crates/usage-halo-storage migrations 0004+ + src/lib.rs — provider_sources, provider_snapshots, metric_observations, activity_events; account split; backoff columns; indexes.
- Interface/file: crates/usage-halo-collector/src/lib.rs — source-strategy runner, account gate, disable honors, persisted backoff.
- Interface/file: crates/usage-halo-projection/src/lib.rs + registry.rs — headline by id, capability view models, history queries.
- Interface/file: prototype/server.mjs + collectors/*.mjs — V2 routes, SSE event, strategy mirrors, normalizers.
- Interface/file: apps/desktop-ui/src App.svelte, lib/api.ts, lifecycle.ts, catalog.ts, range.ts, components/* — truth states, settings, doctor, capability cards.
- Interface/file: fixtures/* sanitized shapes; tests/* per-phase gates; docs/REAL_USAGE_V2_BASELINE.md (done).

## Execution waves

### Phase A — Truth foundation (sequential, one owner)

- Task: A1 canonical contract (WP1). Extend core types + TS mirror + one provider card migrated. Depends on: DESIGN approval (done). Verification: null renders em dash, stale differs from live, unsupported unrendered, headline stable test.
- Task: A2 real/demo separation (WP2). RealProviderRepository vs Demo boundary, APP_DATA_MODE=real default, failure-injection proof. Depends on: A1. Verification: break real source, observe STALE/ERROR, assert no demo values in production path.
- Task: A3 persistence + history base (WP3). Migrations 0004, account/source/snapshot/observation/activity writes, Today/Week/Month queries with UTC + timezone boundaries, restart proof. Depends on: A1. Verification: history survives restart, boundary test.
- Task: A4 scheduler/backoff (WP4). Per-class cadences, jitter, Retry-After, persisted backoff_until, disable cancels, manual refresh rate limit. Depends on: A3. Verification: quota not at activity frequency, 429/backoff survives restart.
- Gate: human phase gate with fresh evidence + rollback readiness before any provider slice.

### Phase B — Tier-1 vertical slices (lanes open after Phase A freeze)

- Task: B1 Claude Code slice (WP5) with identity, source selection, validation, normalization, persistence, live UI, diagnostics + negative cases. Depends on: Phase A gate. Verification: per-provider evidence template + negatives.
- Task: B2 Codex slice (WP6) with live source + rollout fallback, stable UI semantics. Depends on: Phase A gate (parallel with B1, disjoint files). Verification: source-switch proof + negatives.
- Task: B3 Cursor slice (WP7) with account detection, WAL/concurrency measurement, authoritative semantics, activity separation. Depends on: Phase A gate (parallel, disjoint). Verification: WAL freshness proof + negatives.
- Task: B4 Gemini/Antigravity slice (WP8), verified capabilities only, request-count fallback stays DERIVED. Depends on: Phase A gate (parallel, disjoint). Verification: evidence template.
- Gate: human phase gate per slice (or grouped) with real-system evidence.

### Phase C — Surfaces + history E2E

- Task: C1 Provider Settings (WP12). Discovery, toggle, account, sources, capabilities, freshness, credentials, diagnostics link. Depends on: B1 (proven slice). Verification: enable/disable stops/starts collection, source disable blocks fallback.
- Task: C2 Doctor (WP13). Full diagnostic fields + why-this-number answers. Depends on: C1. Verification: inspect each field live.
- Task: C3 history E2E (WP3 proof + WP14 capability UI). Today/Week/Month end-to-end + QuotaWindowCard/BillingCard/TokenTelemetry/Activity/Runtime/Freshness/Source/Health. Depends on: C1. Verification: restart + timezone tests, gauge-vs-counter semantics.
- Gate: human phase gate.

### Phase D — Secondary providers (parallel lanes, disjoint adapters)

- Task: D1 Copilot + OpenCode (WP9 part). Depends on: Phase C gate. Verification: fixture + real-system evidence each.
- Task: D2 Kimi + Grok (WP9 part). Depends on: Phase C gate. Verification: same.
- Task: D3 ZCode/GLM + DeepSeek (WP9 part). Depends on: Phase C gate. Verification: same.
- Task: D4 Ollama + LM Studio runtime (WP11). Runtime state, never cloud quota. Depends on: Phase C gate. Verification: runtime evidence.
- Task: D5 Perplexity truth pass (WP10). Verified source or honest unsupported state. Depends on: Phase C gate. Verification: either evidence or unsupported UI proof.
- Gate: human phase gate.

### Phase E — Hardening + removal + ship

- Task: E1 failure hardening matrix (WP15). Logged out, malformed, timeout, 429, wrong account, stale cache, missing executable, DB lock/WAL, network loss, restart-during-backoff, source disabled. Depends on: Phase D gate. Verification: matrix with expected/observed per case.
- Task: E2 remove obsolete fake paths (WP16) only after every claimed provider is real-verified or explicitly unsupported. Depends on: E1. Verification: grep + test proving no production fake path; build/lint/types clean.
- Task: E3 planonce-security (mandatory) + planonce-review to READY + ship gate. Depends on: E2. Verification: VERIFY.md FRESH bound to revision/worktree/plan digest, readiness PASS, human ship.

## Verification matrix

| Requirement/risk | Check | Expected evidence |
|---|---|---|
| R1 no fabrication | failure injection per slice | STALE/ERROR UI, DB-backed values only |
| R2 settings | enable/disable/source config | collection starts/stops, diagnostics link works |
| R3 Tier-1 real | per-provider template §27 | account, source, timestamps, UI states, restart |
| R4 honest states | negative matrix WP15 | each state renders correctly, never 0% |
| R5 account gate | cross-account test | second account cannot overwrite first history |
| R6 headline | headline-stability test | missing headline renders unavailable, no silent switch |
| R7/R8 refresh | cadence + 429 tests | quota/activity/runtime/billing intervals honored, backoff persisted |
| R9 history | timezone + restart tests | Today/Week/Month correct, gauge not summed |
| R10 demo isolation | prod import + failure tests | demo unimportable in prod, failure never demo |
| R11 secrets | privacy audit + review | no raw tokens in DB/logs/sync |
| R12 fixtures | parser + real-system runs | sanitized fixtures pass, live runs recorded |
| R13 no regression | full gates + UI pass | nav/themes/layout/settings intact |
| R14 removal | E2 audit | fake paths deleted, gates green |
| rollback | migrate-up/restart/migrate-down per phase | history intact, old routes serve when flagged off |

## Risks / rollback

- Risk: SQLite migration strands history. Mitigation: additive migrations, idempotent inserts, account-split without merge. Rollback: down migration or flag off, old tables intact until WP16.
- Risk: Local source fragility (Cursor WAL, Codex logs, Claude cache versions). Mitigation: version-gated parsers, fixtures, measured locking. Rollback: per-adapter disable flag.
- Risk: Scope creep into P2. Mitigation: phase gates enforce P0/P1 order. Rollback: n/a.
- Risk: Parallel lane conflicts on shared contracts. Mitigation: single owner for schema/UI contracts, disjoint adapter files, sequential Phase A. Rollback: lane revert isolated.

## Amendment log

_No amendments at approval time._
