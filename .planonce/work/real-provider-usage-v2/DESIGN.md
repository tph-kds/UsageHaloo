---
schema: planonce.design/v1
change_id: real-provider-usage-v2
workflow: BROWN-LARGE
design_revision: 1
approval_status: PENDING
---
# Design

## Problem / context

UsageHaloo has the right direction (one dashboard for many AI/coding providers) but the V2 brief requires a truth-model upgrade: every displayed value traceable to a real provider-owned or explicitly derived source, with account identity, provenance, fidelity, freshness, and honest unavailable states. Current scaffold already has domain contracts, supervised collection, projection ownership, alias-only secrets, and demo isolation, but lacks: ordered per-provider source strategies, account-first history, capability-driven headline metrics, persisted source/backoff state, provider settings + doctor surfaces, timezone-correct history filters on persisted observations, and Tier-1 vertical slices (Claude/Codex/Cursor/Gemini) plus secondary providers proven against real state.

## Requirements and non-goals

Requirements R1–R14 per CONTEXT.md (brief DONE 1–15). Non-goals NG1–NG4 per CONTEXT.md (brief §31, P2 deferrals, no drive-by refactors).

## Current architecture (Brownfield)

```text
provider CLIs/editors/runtimes
  -> connectors/*/src/lib.rs (UsageConnector) [only 6 Rust connectors]
  -> ConnectorHost (MANAGED_CONNECTORS, cadence, backoff, spool/file-store import)
  -> Storage (provider_accounts, usage_events, quota_snapshots, connector_health)
  -> ProjectionService (sole UI numbers owner)
  -> Tauri commands + prototype/server.mjs routes -> Svelte UI / demo
```

JS mirror runtime (collectors/*.mjs) handles detection, polling, OTLP, Codex app-server, file store. Gaps: no ProviderSourceStrategy ordering, no provider_sources/snapshots/metric_observations/activity_events tables, no per-source enable/priority/backoff persistence, headline = registry primaryMetric string (not stable metric-id contract), history filters partly in-memory, no settings/doctor API surface, 13 of the brief's providers lack Rust connectors.

## Target architecture

- Components and responsibilities:
  - `usage-halo-core`: extend with SourceFidelity, SourceDescriptor, MetricObservation status set, UsageWindow semantics (authoritative usedFraction without used/limit), ProviderSnapshot + health states (live/stale/derived/needs-auth/rate-limited/unavailable/unsupported/error/disabled/demo), ProviderAdapter trait (detect/getCapabilities/getIdentity/collect/diagnose), ProviderDefinition registry (capabilities, sources, presentation headlineMetricId, collection cadences). Reuse existing MetricKind/SourceAuthority/Scope/FreshnessClass/ConnectorState; map, do not duplicate.
  - `usage-halo-collector`: add source-strategy runner (ordered eligible sources, account match gate, auth/429/schema/unavailable routing, last-known-good + persisted backoff_until, disable honors). Keep ConnectorHost as supervisor; new providers plug in as slots.
  - `usage-halo-storage`: map logical records onto existing SQLite (no second DB): extend provider_accounts (preferred_account_key), add provider_sources (priority/fidelity/last_attempt/last_success/error/backoff), provider_snapshots (payload_version + normalized payload), metric_observations (numeric/text/unit/status/fidelity/source/observed/fetched), activity_events (state machine). Deterministic observation keys + uniqueness for idempotency. Indexes on (provider,account,time) and (provider,metric,time).
  - `usage-halo-projection`: headline resolution by headlineMetricId (never windows[0]); capability-driven view models (QuotaWindowCard/BillingCard/TokenTelemetry/Activity/Runtime/Freshness/Source/Health); gauge-vs-counter-vs-spend-vs-activity history semantics.
  - Transport: SSE `provider.snapshot.updated` for server->browser; frontend consumes normalized data only. Polling per data class (quota active 60s/idle 5m, activity event-driven/2s measured, runtime 2-5s, billing 5-15m/manual), jitter, Retry-After honor, backoff 30s→60s→2m→5m→15m persisted.
  - Surfaces: Provider Settings (detect/enable/account/capabilities/source/freshness/health + source config + diagnostics link), Doctor (detection/enabled/account/match/capabilities/priority/selected/fallback/attempt/success/observed/fetched/age/backoff/sanitized error/parser version), dashboard cards per UI rules (§25: live/stale/unknown examples).
  - Demo isolation: APP_DATA_MODE=real default; RealProviderRepository vs DemoProviderRepository boundary; demo fixtures unimportable from production adapters; failure never yields demo.
- Interfaces/contracts:
  - Rust: ProviderAdapter trait, ProviderDefinition registry, ProviderSnapshot wire shape (core/contracts.rs + TS mirror contracts.ts).
  - API (adapted to current routes): GET /api/providers, GET /api/providers/:id, POST :id/enable|disable|refresh, GET :id/diagnostics, GET :id/history?from&to&metric, GET /api/provider-events (SSE). Keep existing /api/snapshot|projection|activity|detected|registry during migration with explicit deletion tasks.
  - Persistence: migrations 0004+ (new tables, account-split, backoff columns); forward-compatible, no secret columns.
- Data ownership/flow:
  - Raw acquisition -> schema validation -> semantic validation -> normalization -> ProviderSnapshot -> persistence (accounts/sources/snapshots/observations/activity) -> live event -> UI. Frontend never parses raw provider payloads.

## Failure handling / observability

Last-known-good -> STALE with age + reason, else UNKNOWN/NEEDS_AUTH/RATE_LIMITED/UNAVAILABLE/UNSUPPORTED/ERROR/DEMO/DISABLED per truth table; sanitized errors + diagnostics link; 429 respects Retry-After else exponential+jitter persisted across restart; idempotent retries via deterministic keys; UTC persist with observedAt+fetchedAt; local timezone boundaries converted to UTC for Today/Week/Month.

## Security / authorization

Borrow provider authorization; read minimum local session reference; prefer provider CLI/OS store; no raw tokens in DB/logs/cloud sync; user keys via OS keychain alias, redacted suffix, harmless validation, independent Remove vs Disable; disabling provider/source stops that collection/fallback; sanitized fixtures (strip tokens/cookies/emails/org IDs/paths).

## Threat model (required when security/trust boundaries change)

- Assets / sensitive data: provider session tokens, cookies, auth files, API/admin keys, account IDs, org IDs, local DB paths, usage payloads.
- Trust boundaries: provider-owned local state -> collector; collector -> SQLite; SQLite/projection -> UI/SSE; optional cloud sync (normalized only); user-entered keys -> OS keychain.
- Abuse/misuse cases: cross-account history merge; fallback bypassing user disable; secret exfiltration via logs/diagnostics/sync/fixtures; quota polling hammering provider; overly broad file reads (whole Codex history, Cursor WAL locking).
- Least-privilege controls: per-provider/per-source enable flags; account-match gate before persist; secret-alias-only storage; redaction in health/diagnostics; newest-relevant-session lookup (no full-history scans); scope-limited admin clients.
- Detection / audit evidence: scripts/privacy_audit.py + tests/test_privacy.py; health attempt error_class/message sanitization (collector sanitize_health_detail); diagnostics show source/fidelity without secrets; security review gate mandatory.

## Migration / rollout

Avoid flag day: 1) canonical model alongside current types with compat mapper (explicit deletion task), 2) one provider end-to-end (Claude), 3) Tier-1 (Codex, Cursor, Gemini), 4) history reconnect, 5) settings/doctor, 6) delete generic fake paths (WP16 last). DB migrations additive + idempotent inserts; existing provider_accounts rows migrated with preferred_account_key default.

## Rollback

Each phase independently verifiable and revertible: migrations have down path or additive-only (new tables nullable, old tables untouched until WP16); compat mapper keeps old snapshot routes until cutover; headline/registry changes behind provider-definition version; backoff/state rows deletable without data loss (re-derivable); fake-path deletion is the single irreversible step and ships only after real paths proven + human ship gate. Tested by: migrate-up -> restart -> history intact -> migrate-down (or feature-flag off) -> old routes serve.

## Costly / one-way decisions

| Decision | Reversibility | Evidence / mitigation | Human gate |
|---|---|---|---|
| SQLite schema addition (sources/snapshots/observations/activity) | Medium (additive, needs down/tested rollback) | migration test + restart history proof | Yes — plan approval + phase gate before WP3 |
| Headline metric IDs per provider | Low (UI semantics change) | explicit provider-definition change + stable-id test | Yes — design approval |
| Deleting generic fake production paths (WP16) | One-way (code removal) | failure-injection proof (stale/error, never demo) + human ship gate | Yes — ship gate |
| Local reads of Cursor SQLite / Codex rollouts / Claude cache | Medium (OS/version fragility) | version-gated parsers + sanitized fixtures + WAL/lock measurement | Yes — per-slice phase gate |
| SSE as live transport | Medium | prototype + Tauri parity proof; WebSocket only if bidirectional need proven | Yes — plan approval |

## Alternatives rejected

- Universal fetchUsage(provider): rejected — providers have different quota/billing semantics (ADR-01).
- Central backend collector for local-only sources: rejected — loses coverage, becomes credential vault; local-first (brief §2).
- WebSocket-first live: rejected unless bidirectional need; SSE preferred (§10).
- Second database for V2 tables: rejected — map onto existing SQLite (brief §8).
- Perplexity forced support: rejected — honest unsupported state if no verified source (§6).

## Phase boundaries

P0: recon baseline (Task 0 doc) -> canonical contract (WP1) -> real/demo split (WP2) -> persistence/history (WP3) -> scheduler (WP4) -> Claude slice (WP5) -> Codex (WP6) -> Cursor (WP7) -> Gemini (WP8) -> settings (WP12) -> doctor (WP13) -> history E2E (WP3 proof). P1: Copilot/OpenCode/Kimi/Grok/ZCode/DeepSeek (WP9), Ollama/LM Studio (WP11). P2 deferred: Perplexity truth pass ships honest state anytime (WP10); analytics/sync/mobile out of scope. Lanes A–D parallel only after WP1–WP4 interfaces freeze; single owner for shared schema/UI contracts.
