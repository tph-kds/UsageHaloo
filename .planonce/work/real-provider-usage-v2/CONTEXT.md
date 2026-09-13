---
schema: planonce.context/v1
change_id: real-provider-usage-v2
workflow: BROWN-LARGE
baseline_revision: 9e5be2fc2d3420a508701f63a659a1be04efee74
created_at: 2026-09-14T05:52:40+07:00
---
# Change Context

- Change: real-provider-usage-v2 (UsageHaloo Real Provider Usage Acquisition V2, brief: docs/.plans/UsageHaloo_Real_Provider_Usage_PStack_Implementation_Plan.md)
- Workflow: BROWN-LARGE
- Status: DISCOVERY

## Repository evidence
- Existing/current behavior:
  - Rust workspace (core, collector, projection, reconcile, storage, scheduler, secrets, forecast) + 6 connectors (claude-code, codex, gemini-cli, openai, anthropic, openrouter) + Tauri desktop Svelte UI + prototype Node server + collectors JS runtime. Baseline `python scripts/validate.py` = PASS at 9e5be2f.
  - Domain contracts exist: `crates/usage-halo-core/src/lib.rs:14-217` (MetricKind, SourceAuthority/Scope, FreshnessClass, ConnectorState, UsageEvent, QuotaWindow, UsageConnector trait). Analogous adapter pattern to extend, not replace.
  - Collection exists: `crates/usage-halo-collector/src/lib.rs:29-36` MANAGED_CONNECTORS=[claude-code,codex,gemini-cli,openrouter,openai-api], class-specific backoff, spool/file-store import, missing-key honest skip. Scheduler: `crates/usage-halo-scheduler/src/lib.rs` + `collectors/scheduler.mjs`.
  - Projection owns UI numbers: `crates/usage-halo-projection/src/lib.rs` + `registry.rs` (include_str providers.json). Legacy adapter formats only.
  - Storage: `crates/usage-halo-storage/migrations/0001_init.sql` (provider_accounts, usage_events, quota_snapshots, connector_health, daily_rollups), plus 0002_canonical + 0003_session_states. Secrets alias-only: `crates/usage-halo-secrets/src/lib.rs`.
  - Frontend: `apps/desktop-ui/src/App.svelte` (15s refresh), `lib/api.ts` (USE_LIVE, no mock fallback), `lib/mock.ts` demo-gated, `lib/contracts.ts`, `lib/lifecycle.ts`, `lib/catalog.ts`, `lib/range.ts`. Tauri commands in `apps/desktop-ui/src-tauri/src/lib.rs`.
  - Prototype API: `prototype/server.mjs` routes /api/health|snapshot|projection|activity|detected|registry|ingest|daemon|codex/live etc. Demo `?demo=1` isolated with sample_data/demo_mode flags.
  - Provider catalog: `packages/brand-registry/providers.json` (24 entries, p0/p1/p2/p3 + sourceMode/scope). Missing from plan scope: cursor/copilot/opencode/kimi/grok/zai/deepseek/ollama/lm-studio/perplexity have no Rust connector crates yet (only JS normalizers in collectors/providers.mjs).
  - Fake/demo generators: `apps/desktop-ui/src/lib/mock.ts`, `prototype/server.mjs:100-107 hash32 demo percents` (demo-gated). No evidence of production fallback-to-mock; must prove with failure test per WP2.
- Relevant files/symbols/tests:
  - Core: crates/usage-halo-core/src/lib.rs, contracts.rs, time.rs
  - Collector: crates/usage-halo-collector/src/lib.rs (ConnectorHost)
  - Projection: crates/usage-halo-projection/src/lib.rs, registry.rs
  - Storage: crates/usage-halo-storage/src/lib.rs, migrations/0001_init.sql, 0002_canonical.sql, 0003_session_states.sql
  - Secrets: crates/usage-halo-secrets/src/lib.rs
  - UI: apps/desktop-ui/src/App.svelte, lib/api.ts, lib/types.ts, lib/lifecycle.ts, lib/contracts.ts, lib/catalog.ts, components/ProviderCard.svelte
  - Server: prototype/server.mjs, collectors/*.mjs (local, store, scheduler, daemon, pollers, providers, codex-app-server, gemini-otlp, snapshot)
  - Tests: tests/test_truth_phase*.py, test_snapshot.py, test_parity.py, test_registry.py, test_showcase.py, scripts/validate.py, scripts/privacy_audit.py
- Analogous implementation:
  - UsageConnector trait + per-connector crates = template for new provider adapters (cursor, copilot, ollama, lm-studio, etc.).
  - ConnectorHost supervised poll + MANAGED list + health/backoff = template for enable/disable + source priority + persisted backoff.
  - ProjectionService sole-numbers-owner = template for headline-metric stability + capability-driven UI.
  - SecretStore alias-only + EnvSecretStore fallback = template for credential architecture.

## Selected standards
- Standard: .planonce/standards/connector-contract.md (UsageConnector trait boundary)
- Standard: .planonce/standards/provenance-and-metrics.md (no fake percent, authority ordering)
- Standard: .planonce/standards/reconciliation.md (explicit key only)
- Standard: .planonce/standards/freshness-and-polling.md (per-class cadence)
- Standard: .planonce/standards/storage-immutable-inserts.md (INSERT OR IGNORE, idempotent)
- Standard: .planonce/standards/security-and-privacy.md (alias-only secrets)
- Standard: .planonce/standards/billing-owner-invariant.md (billing_owner != model_provider)
- Standard: .planonce/standards/ui-mock-vs-live.md (demo-gated, SAMPLE-labeled)
- Standard: .planonce/standards/verification-gates.md + PROJECT.md verification commands

## Requirements
- R1: No fabricated quota/billing/token/reset/plan/activity in real mode; every value backed by persisted normalized observation with provenance + timestamps (plan DONE 1).
- R2: Provider Settings discovers/enables/disables/diagnoses supported providers with account, capabilities, source, freshness, health (DONE 2, 11).
- R3: Dedicated adapters for Claude Code, Codex, Cursor, Gemini/Antigravity exercised against real local state (DONE 3).
- R4: Source failure renders STALE/UNKNOWN/NEEDS_AUTH/RATE_LIMITED/UNAVAILABLE/UNSUPPORTED/ERROR, never 0% (DONE 4).
- R5: Account identity correctness; no cross-account silent overwrite (DONE 5).
- R6: Stable headline metric per provider (DONE 6).
- R7: Separate quota/billing/token/runtime/activity concepts + refresh policies (DONE 7, 8).
- R8: Adaptive polling, 429/Retry-After/backoff persisted across restart (DONE 8).
- R9: Today/Week/Month from persisted observations with timezone boundaries, restart-safe (DONE 9).
- R10: Demo only behind explicit mode + labeled; real failure never falls back to demo (DONE 10).
- R11: Secrets provider-owned wherever possible; no raw tokens in DB/logs/cloud sync (DONE 12).
- R12: Sanitized fixtures for parsers; completion verified on running app with real state (DONE 13).
- R13: No regression in nav/themes/layout/icons/settings (DONE 14).
- R14: Delete obsolete generic fake production paths after proof (DONE 15).

## Non-goals
- NG1: AI recommendations, cost forecasting before trustworthy billing, auto-purchasing, generic vault (plan §31).
- NG2: Browser scraping as default acquisition; 1s cloud-quota polling; design-system rewrite; mobile collectors; dozens of guessed providers (plan §31).
- NG3: P2 analytics/multi-device sync/mobile viewer before source truth reliable (plan §29).
- NG4: Drive-by refactors of unrelated legacy code (brownfield guardrail).

## Constraints / assumptions
- Constraint: smallest complete change; understand-before-change; explicit domain models; boundary validation; idempotent retries; no unrelated abstractions; parallel isolation; verifiable units; behavior tests; delete obsolete paths (plan CONSTRAINTS).
- Constraint: never invent limits/tiers; missing != zero; no false realtime claims; no auth bypass; reuse enabled provider sessions only; no secret upload; local-first for local data; no UI scraping when structured state exists; visible private deps; independently disableable adapters.
- Constraint: cargo/rustc not on PATH in this env; npm.ps1 blocked (use npm.cmd/node); Rust gates recorded as required-on-toolchain.
- Assumption requiring confirmation: change_id `real-provider-usage-v2`, branch `feat/real-provider-usage-v2` (plan recommends; not yet created — awaiting design approval before branching).
- Assumption requiring confirmation: plan brief `docs/.plans/UsageHaloo_Real_Provider_Usage_PStack_Implementation_Plan.md` is the single requirements authority; DESIGN.md + exactly one PLAN.md derive from it.

## Risk flags
- Security/authorization: credential reuse across CLI/editor sessions; SQLite secret-alias discipline; sanitized diagnostics; per-provider disable stops access. Triggers planonce-security (mandatory for Large).
- Public contract: API routes (/api/providers*), snapshot/projection shapes, provider registry; headline semantics stability.
- Data migration/data loss: new tables (provider_sources/snapshots/metric_observations/activity_events or mapped equivalents) on existing SQLite; account-split histories; idempotent observation keys; backoff persistence.
- One-way door: SQLite schema migration; headline metric definitions; removal of fake production paths (WP16 irreversible without revert); new local file reads (Cursor SQLite WAL, Codex rollout logs, Claude cache).
