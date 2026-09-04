---
schema: planonce.design/v1
change_id: realism-hardening-webapp-desktop
workflow: BROWN-LARGE
design_revision: 1
approval_status: PENDING
---
# Design

## Problem / context
Webapp and desktop showcase accurate-looking numbers that are actually deterministic fakes (`hash32(id:dayUtc)` percentages, `$12.47` budgets, static model/alert rows, hash heatmaps) while real collectors/normalizers/bridges exist underneath. Tauri `snapshot` returns `providers:[]`, forcing the Svelte UI into mock fallback. This contradicts the product north star: freshest authoritative info with scope/source/freshness, never hiding delay or estimates.

## Requirements and non-goals
Requirements R1–R7 and non-goals NG1–NG4 per `CONTEXT.md`. In short: provenance-honest UI, explicit unknown/sample states, real Tauri projection, no hardcoded numbers, demo-mode gating, Windows-correct + verified, aligned with original aim.

## Current architecture (Brownfield)
- `prototype/server.mjs determinSnapshot` → fake base + 4 live overlays → `demo/app.js` + Svelte browser path (`vite proxy /api→4897`). `sample_data:true` set but UI still renders fake bars as if real outside a small banner.
- `apps/desktop-ui/src-tauri lib.rs snapshot` → file-store aggregates, `providers:[]` → Svelte `api.ts` → mock fallback. `connector_health` real but unwired. `setup()` no-op. Updater endpoint placeholder.
- `collectors/snapshot.mjs buildProviderRows` already implements the correct honest pattern but is not used by prototype snapshot or Tauri.
- Rust core/reconcile/storage/scheduler/secrets/forecast honest-by-design; JS mirror in `collectors/*` tested via `test_parity.py`.
- Tests `test_realistic_data.py` currently lock in deterministic-fake behavior (`sample_data is True`, FNV-1a %, `$` rules); `test_showcase.py` asserts coverage of all providers.

## Target architecture
- Components and responsibilities:
  - `snapshot-core` (shared semantics, JS-first + Rust port): `buildProviderRows(registry, events, liveOverlays, detected, health)` — overlay only if `live==true`, else `primaryPercent:null`, `provenance:{authority,sample}`. Prototype imports `collectors/snapshot.mjs`; Tauri `snapshot` reimplements same rule in Rust (registry JSON embedded or read from `packages/brand-registry/providers.json` at build/dev time + `usage_events.jsonl` + `health.json` + `EnvSecretStore::has`).
  - `prototype/server.mjs`: default `GET /api/snapshot` = honest (registry rows with nulls + live overlays only); deterministic generator moved to `buildDemoSnapshot()` used only when `?demo=1` or `SAMPLE_MODE=1`, response keeps `sample_data:true + data_basis` labels. `/api/widget`, `/api/forecast`, `/api/alerts` derive from store/rollups when non-empty, else return explicit `sample:false, available:false` + empty arrays (no hardcoded 58%/62%/burn arrays in live path).
  - `apps/desktop-ui/src/lib/api.ts`: keep `tauri → browser → mock` fallback chain but surface `source` + `sampleData` honestly; `deriveSummaries` parses only real strings, else `—`; remove fabricated `requests=len*4`, `~$0.00 estimated` (show `—` or omitted when no data).
  - `apps/desktop-ui/src/App.svelte` + `demo/app.js`: replace hardcoded budgets/alerts/models/200K-denominator/heatmaps with (a) store-derived when available, else (b) explicit empty states ("No data yet — connect a provider", "Sample" badge). Heatmap renders real daily rollups when present else empty grid with caption, never hash-of-metric. Forecast `~N min` only when `forecast_quota` returns a projection (≥min samples), else hidden.
  - `src-tauri lib.rs`: `snapshot` returns real `providers[]` rows (id, displayName, primaryLabel/Percent/Reset nullable, tokensToday/costToday nullable, freshness/source/scope/health/live/installed/configured); `connector_health` wired from UI health panel; `demo_provider_snapshot` removed from production command list or `cfg(debug_assertions)`-gated; `setup()` performs storage migrate + health load (no tray/scheduler timers yet — explicit TODO).
- Interfaces/contracts:
  - `GET /api/snapshot` shape unchanged (additive: nullable fields stay nullable; `sample_data`, `data_basis`, per-provider `live`, `provenance` already present). No breaking change.
  - Tauri `snapshot` shape extended from `{providers:[]}` to populated rows — additive; frontend already handles `null` percents (UsageRing clamps, ProviderPopover shows `No reset/—`).
  - `GET /api/widget`, `/api/forecast`, `/api/alerts` gain `available:boolean` + empty-safe payloads; demo UI checks `available` before rendering numbers.
- Data ownership/flow:
  - Raw `usage_events.jsonl` / SQLite append-only; UI reads reconciled projections; no snapshot path synthesizes percentages. Demo generator writes nothing to store.

## Failure handling / observability
- Pollers without keys → `{live:false, reason:no_key}` (already); UI shows Unconfigured, health panel shows `needs_key`.
- Daemon/bridge down → `stale/unknown` freshness via scheduler caps; banner shows `as of <dayUtc>` + `source`.
- Ingest rejects prompts/completions (`POST /api/ingest/event` 400 on forbidden keys); privacy audit scans store+spools.
- Prototype logs `sample_data` + overlay counts to console for diagnosability.

## Security / authorization
- No new secret handling; env-only keys; alias-only persistence; OTLP/ingest strips prompt attrs (already tested). Updater stays disabled until real feed URL + pubkey configured (UI already shows "Could not reach feed" honestly).

## Threat model (required when security/trust boundaries change)
No trust-boundary change in this design (no new network listeners, no credential flows, no transcript ingestion). Hence: assets = existing store/spool files; boundaries unchanged (localhost sidecar, Tauri IPC, env keys); abuse = demo numbers mistaken for billing truth — mitigated by honest-empty default + sample badges; least-privilege = no change; detection = `validate.py` + privacy audit + `test_privacy.py`.

## Migration / rollout
- Prototype default flips to honest-empty; demo mode preserved via `?demo=1`. `test_realistic_data.py` updated to assert honest default + demo determinism separately. `test_showcase.py` updated to accept nullable percents + require `sample_data` semantics per mode.
- Tauri snapshot populates rows; no migration of stored data needed. Legacy `~/.viusagever` import path unchanged.
- Docs: `SOURCE_STATUS.md` + `VERIFICATION.md` updated to reflect honest default.

## Rollback
- Prototype: revert single commit restoring `determinSnapshot` as default; demo flag harmless if left in. Test: `curl /api/snapshot | jq .sample_data` + `pytest -q -k "showcase or realistic"`.
- Tauri: revert `lib.rs snapshot` to `providers:[]`; UI falls back to mock chain as before. Test: `cargo check -p usage-halo-desktop` + `npm run check`.
- Both rollbacks are single-commit, no data migration, verified by the same gates.

## Costly / one-way decisions
| Decision | Reversibility | Evidence / mitigation | Human gate |
|---|---|---|---|
| Default snapshot honest-empty instead of deterministic fake | One-way (changes demo/tests/user expectation) | `test_realistic_data.py:88-91` locks fake default; mitigation: keep `?demo=1` parity + update tests | REQUIRED before implementation |
| Tauri `snapshot` populates real provider rows (new contract) | One-way (UI depends on new shape) | Currently `providers:[] lib.rs:182-184`; mitigation: nullable fields, additive | REQUIRED before implementation |
| Updater stays disabled (no real feed) | Reversible | Placeholder endpoint; UI handles error honestly | No gate |

## Alternatives rejected
- Keep deterministic fake as default + bigger "Sample" banner: rejected — still violates "never invent numbers" north star; banner is easily missed in screenshots.
- Full Rust SQLite projection in this change (port rollups/forecast/alerts into Tauri): rejected as too large; defer to follow-up, use file-store + honest-empty + sidecar fallback now.
- Per-provider live scraping to fill gaps (cookies, unofficial endpoints): rejected per NG1 + spec (`docs/02_PROVIDER_RESEARCH.md`, `provider-stubs/README.md`).

## Phase boundaries
- Phase 1: Prototype honest snapshot + demo-mode gate + widget/forecast/alerts empty-safe.
- Phase 2: Tauri real `snapshot` + wire `connector_health`, remove demo stub from prod path.
- Phase 3: Svelte + demo UI un-hardcode (summaries, budgets, alerts, models, heatmaps, forecast) + empty/sample states.
- Phase 4: Tests + docs + full verification (pytest, validate, svelte-check, vite build, cargo fmt/clippy/test/check, daemon once, prototype smoke, privacy audit).
