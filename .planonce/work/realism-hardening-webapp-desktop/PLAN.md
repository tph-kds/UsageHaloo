---
schema: planonce.plan/v1
change_id: realism-hardening-webapp-desktop
workflow: BROWN-LARGE
plan_revision: 1
approval_status: PENDING
---
# Implementation Plan

## Goal
Make webapp (prototype + demo) and desktop (Windows Tauri + Svelte) report only real provider-reported / locally-observed / reconciled values with provenance, rendering everything else as explicit Unknown/Unconfigured/Sample — converging both shells on the honest `buildProviderRows` semantics already proven in `collectors/snapshot.mjs`.

## Accepted requirements
- R1: Only real/reconciled values with provenance shown as real; no hash percentages presented as truth.
- R2: Unconfigured/no-data → explicit Unknown/Unconfigured/Sample states honoring `sample_data`.
- R3: Tauri `snapshot` projects real rows; `connector_health` wired; demo stub out of prod path.
- R4: Un-hardcode budgets/alerts/models/200K/heatmap/widget/forecast numbers (store-derived or empty).
- R5: Deterministic generator kept only behind `?demo=1` / `SAMPLE_MODE=1`.
- R6: Windows-correct + fresh revision-bound verification.
- R7: Aligned with original aim; no drive-by refactors.

## Non-goals
- NG1: No new scraping/proxy/transcript ingestion.
- NG2: No macOS/Linux signing work.
- NG3: No unrelated restyle.
- NG4: No live paid-account billing proof.

## Approach
Reuse `collectors/snapshot.mjs buildProviderRows` as the semantic authority. Prototype imports it (or extracts shared helper); Tauri ports the same rule to Rust with nullable percent fields. UI layers switch from invented denominators to nullable-aware rendering + empty states. Tests updated to assert honest default separately from demo determinism.

## Interfaces / files affected
- Interface/file: `prototype/server.mjs` (snapshot/widget/forecast/alerts routes, demo-mode gate)
- Interface/file: `collectors/snapshot.mjs` (shared honest builder — minimal extension if needed)
- Interface/file: `apps/desktop-ui/src-tauri/src/lib.rs` (`snapshot`, `connector_health`, `demo_provider_snapshot` gating, `setup`)
- Interface/file: `apps/desktop-ui/src/lib/api.ts`, `src/App.svelte`, `src/lib/components/Heatmap.svelte`, `src/lib/mock.ts` (fallback only)
- Interface/file: `demo/app.js`, `demo/index.html`, `demo/widget.html`
- Interface/file: `tests/test_realistic_data.py`, `test_showcase.py`, `test_snapshot.py` + fixtures (assertions only, no fixture invention)
- Interface/file: `SOURCE_STATUS.md`, `VERIFICATION.md` (status docs)

## Execution waves
### Wave 1 — Prototype honest snapshot (Phase 1)
- Task: Default `/api/snapshot` honest (registry rows + live overlays only, nulls elsewhere); move deterministic gen to `?demo=1`/env gate; widget/forecast/alerts empty-safe with `available` flag.
- Depends on: approved plan (this file).
- Verification: `node prototype/server.mjs` smoke: default `sample_data` semantics + `?demo=1` determinism; `pytest -q -k "showcase or realistic or snapshot"` (updated assertions).

### Wave 2 — Tauri real projection (Phase 2)
- Task: `snapshot` returns real provider rows from registry + file-store + health + secret presence; wire `connector_health` read path; gate `demo_provider_snapshot` to debug; minimal `setup()` (migrate + health load).
- Depends on: Wave 1 semantics frozen.
- Verification: `cargo check -p usage-halo-desktop`, `cargo test --workspace` (where toolchain present), honest-empty UI with zero store + live overlay when spool present.

### Wave 3 — UI un-hardcode (Phase 3)
- Task: Svelte + demo replace hardcoded budgets/alerts/models/200K/heatmap/forecast with store-derived or empty/sample states; summaries nullable-aware; heatmap empty-grid + caption.
- Depends on: Waves 1–2.
- Verification: `npm run check` 0 errors, `vite build` succeeds, manual browser + `?demo=1` parity screenshots.

### Wave 4 — Tests, docs, full verification (Phase 4)
- Task: Update affected tests, `SOURCE_STATUS.md`/`VERIFICATION.md`; run full gates + privacy audit + daemon once + prototype smoke.
- Depends on: Waves 1–3.
- Verification: `pytest -q`, `validate.py PASS`, `svelte-check`, `vite build`, `cargo fmt/clippy/test` (or recorded toolchain-missing), `privacy_audit.py clean`, `planonce-security` + `planonce-review` READY.

## Verification matrix
| Requirement/risk | Check | Expected evidence |
|---|---|---|
| R1 honest values | prototype default snapshot with empty store | all non-live `primaryPercent:null`, `live:false`, `provenance.authority:estimated+sample:true` |
| R1 demo preserved | `GET /api/snapshot?demo=1` same-day determinism | FNV-1a % stable, `sample_data:true`, `data_basis:registry+per-day-deterministic` |
| R2 unknown states | Svelte + demo with empty store | "No data / Sample" empty states, no fake bars |
| R3 Tauri rows | `invoke snapshot` empty + seeded store | `providers[]` length matches registry-detected, nullable percents, `sample_data` flag correct |
| R3 health wired | UI health panel | `freshness` from scheduler caps, secret presence bools only |
| R4 un-hardcode | grep `$12.47/200K/burn arrays/MODEL_ROWS` in live path | absent outside demo-mode/empty-state fixtures |
| R5 demo gate | default vs `?demo=1` | default honest, demo deterministic |
| R6 Windows-correct | full gate suite | fresh VERIFY.md bound to revision + plan digest |
| No regression | `validate.py`, parity tests | PASS; reconcile/forecast JS-vs-Rust vectors match |
| Rollback | revert one commit per phase | smoke commands in DESIGN.md Rollback section pass |

## Risks / rollback
- Risk: `test_realistic_data.py` + `test_showcase.py` assert fake default; flip breaks them.
- Mitigation: update assertions in same wave; keep `?demo=1` parity so old expectations still tested in demo mode.
- Rollback: per-phase single-commit revert (prototype / Tauri / UI / tests-docs); no data migration involved.

## Amendment log
- 2026-09-04 (approved BLOCKED_AMEND): `.gitignore` line 17 `lib/` → `/lib/` — the generic Python build-dir pattern was ignoring all of `apps/desktop-ui/src/lib/` (`api.ts`, `mock.ts`, `types.ts`, `components/*`), so Wave 3 `api.ts` honesty fixes could not ship. One-line anchor fix; verification: `git check-ignore` no longer matches + `git status` shows `?? apps/desktop-ui/src/lib/`. No design/phase change.
