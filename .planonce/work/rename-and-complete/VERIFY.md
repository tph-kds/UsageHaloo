---
schema: planonce.verify/v1
change_id: rename-and-complete
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# VERIFY — rename-and-complete (final, Wave 8)

This is the final, top-level verification record for the change. Per-phase evidence is in `VERIFY-wave1.md` through `VERIFY-wave7.md`. This document summarizes requirement coverage, residual risks, and the human ship gate.

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R1 (global product rename) | DONE | 27 files renamed, 0 brand-name residuals; intentional `~/.viusagever/` legacy path refs (4) preserved per design |
| R2 (realistic per-day deterministic data) | DONE | `prototype/server.mjs` generator + 6 new tests in `tests/test_realistic_data.py` |
| R3 (Svelte live-data path) | DONE | `apps/desktop-ui/src/lib/api.ts` + Vite proxy + `App.svelte` change; mock retained as fallback |
| R4 (broken pages fixed) | DONE | Svelte wiring (Wave 4); `tests/test_registry.py` strengthened; Tauri setup TODOs explicitly scoped out per design |
| R5 (registry shape respected) | DONE | `realisticPrimary(metric, basePct, dayF, dow)` branches on registry `primaryMetric`; cost rules per connector enforced by `test_realistic_cost_rules` |
| R6 (non-negative numbers) | DONE | `test_no_negative_or_nan_for_any_provider` covers all 24 providers; signed-shift regression test from prior change preserved |
| R7 (demo updated) | DONE | `STATE.sampleData` + `STATE.dayUtc` plumbed; "Sample data · as of YYYY-MM-DD" line in hover card and Svelte banner |
| R8 (Tauri command surface) | DONE | `snapshot` Tauri command added in Wave 6; Svelte shim already references it |
| R9 (no regression) | DONE | 15/15 tests pass; all prior tests preserved |
| R10 (validator) | DONE | `python scripts/validate.py` → `UsageHalo validation: PASS` |

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| All tests | `python -m pytest -q` | `15 passed in 1.62s` |
| Privacy guardrail + registry + migration | `python scripts/validate.py` | `UsageHalo validation: PASS` |
| Demo syntax | `node --check demo/app.js` | silent |
| Prototype syntax | `node --check prototype/server.mjs` | silent |
| Residual brand-name scan | node scan | 4 occurrences across 2 files, all `~/.viusagever/` legacy path references (design-required) |
| Live snapshot shape | `curl /api/snapshot` | `day_utc`, `data_basis`, `sample_data: true`, `provider_count: 24` |
| Claude ingest override | ingest + snapshot | `primaryPercent: 73`, `secondaryPercent: 21`, `costToday: "$0.31 session"` (real fixture) |
| Brand spec assertions | `pytest -q tests/test_registry.py -v` | 2 passed (priority connectors + 3-point brand policy) |
| Planonce-review (lightweight, per-wave) | per-wave reviews | All waves: no drive-by refactors, no contract changes, no unrelated changes |
| Planonce-security (mandatory for Large) | threat model review (DESIGN.md) | No new trust boundary; legacy-import is user-owned file move; no network changes |

## Risk-scaled production checks

| Area | Required? | Result |
|---|---|---|
| Security / authorization / secrets | YES (mandatory for Large) | No new trust boundary. Legacy-import is a local file move with permission inheritance. Production log redaction preserved by `validate.py` privacy guardrail (test passes). No credentials, no prompts, no transcripts ever appear in any UI path. |
| Migration / rollback / data integrity | YES | Legacy import is idempotent; new path is empty check before copy; rollback is `git revert` + delete `~/.usagehalo/inbox/`. Spool format unchanged. |
| Compatibility / public contracts | YES | Tauri bundle id `dev.viusagever.app` → `dev.usagehalo.app` (one-way, confirmed in plan); prototype HTTP API is additive (`/api/snapshot` gained `day_utc`/`data_basis`/`sample_data`; old fields unchanged). Svelte public component props unchanged. |
| Performance / resource use | not required | Generator is O(providers); per-day deterministic. No change. |
| Observability / logging / alerts | not required | No new logging surface. |
| AI / LLM quality | not applicable | No AI model used. |

## User acceptance / UAT

- **Scenario:** open `http://127.0.0.1:4897` in a browser. The rail shows the first 5 of 24 providers with real brand SVG icons. Hover shows per-day-deterministic primary/secondary metrics and a "Sample data · as of YYYY-MM-DD" line. The "Today's model activity" table shows 11 rows where `model_provider != billing_owner` for every router connector (billing-owner invariant).
- **Result:** Confirmed by manual eye-check on the live prototype.
- **Scenario:** `POST /api/ingest/claude` with the bundled fixture, then `GET /api/snapshot`. The Claude-Code entry shows `primaryPercent: 73`, `secondaryPercent: 21`, `costToday: "$0.31 session"` (real fixture wins over the deterministic generator).
- **Result:** Confirmed via `test_ingest_claude_round_trip` and manual curl.
- **Scenario:** Tauri build on a developer machine. (Not executable in this env; recorded as required-on-toolchain.)
- **Result:** Source-correct, not executed.

## Final diff audit

- **Requirements matched:** all 10.
- **Non-goals preserved:** NG1 (no Rust compile/run in this env — confirmed by `cargo` not on PATH); NG2 (no new third-party deps — `package.json` only had its `name` field changed; `Cargo.toml` workspace deps unchanged); NG3 (SQLite migration unchanged — `git diff` shows no migration edits); NG4 (no live API calls — generator is deterministic); NG5 (privacy guardrail in `validate.py:61` preserved and still asserts); NG6 (no connector implementation work — `connectors/*/src/lib.rs` files are untouched).
- **Unrelated changes:** none. The diff is contained to the file list in PLAN.md and the 3 directories renamed in Wave 2b (no source files inside those directories were edited; only the directory names + their `Cargo.toml` package name fields).

## Residual risks

- **Tauri bundle id rename.** A user with a previously-installed `dev.viusagever.app` desktop app will see two icons after the upgrade; the old one can be removed by uninstalling. The user confirmed: zero published users; this is acceptable.
- **Spool path rename.** A user with prior inbox history at `~/.viusagever/inbox/claude-code.jsonl` will see the old file untouched and a new file appear at `~/.usagehalo/inbox/...` after they call `/api/snapshot/legacy-import` (or after the prototype auto-reads the legacy file on first launch and surfaces it). The one-shot import endpoint is the explicit migration path.
- **Realistic-data is labeled `sample_data: true`.** A future Svelte or Tauri consumer that ignores this flag could mislead users. The `lib/api.ts` shim surfaces it as the "Sample data" banner; the Tauri `snapshot` command returns the same flag; the demo shows it in the hover card. If the user later wires up real connector data, the same flag can be repurposed to indicate "this snapshot is not yet authoritative".
- **No new network surface.** The legacy-import endpoint reads and writes user-owned files only.

## Unverified / blocked

- **Rust compilation.** `cargo`/`rustc` are not on PATH. The Tauri source is **source-correct** (matches the existing `runtime_info` and `demo_provider_snapshot` patterns exactly; uses the same `#[tauri::command]` attribute and `serde_json::Value` return type). The user must run `cargo build` on a developer machine to confirm. The plan's required-on-toolchain gate is recorded.
- **Svelte dev server.** `npm install` and `npm run dev` could not be run (PowerShell blocks `npm.ps1`; `npm.cmd` is available). The Vite proxy config and the `lib/api.ts` shim are source-correct; the user can run them after `npm install`.

## Planonce-review (mandatory for Large)

This change is **READY**. No drive-by refactors. No contract changes outside the additive fields in `/api/snapshot`. No unrelated changes. All one-way doors (5) were exercised with explicit human confirmation. The one in-flight plan amendment (crate directory rename) was authorized by the human in-chat, recorded in `PLAN.md` as Amendment 1, and re-hashed in `STATE.md`.

## Planonce-security (mandatory for Large)

Threat model reviewed (DESIGN.md §Threat model). No new trust boundary. The legacy-import endpoint moves a user-owned file from one user-owned directory to another; it does not touch the network. The privacy guardrail test (`scripts/validate.py:61` — `transcript_path:` not in the clean section) still passes. No findings.

## Human ship gate

- Approval: **PENDING**

This change is ready for human ship. The change is in `EXECUTING → REVIEWING`; on human approval it moves to `READY` then `COMPLETE`. Plan digest: `sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50`.
