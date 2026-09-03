---
schema: planonce.plan/v1
change_id: rename-and-complete
workflow: BROWN-LARGE
plan_revision: 2
approval_status: APPROVED
approval:
  granted_by: human
  granted_at: 2026-09-03T10:40Z
  digest: sha256:caa4390668962b8e90ed2ec34eb209441a737c9847438ffe788a1883ff305598
  amendment_grants:
    - granted_at: 2026-09-03T10:55Z
      scope: rename crates/viusage-* and connectors/viusage-* to usage-halo-*; regenerate PROJECT_TREE.txt
  current_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
---
# Implementation Plan — Rename to UsageHalo + Realistic Data + Broken-Page Fixes

## Goal

Ship a single coherent change that (a) renames the product to UsageHalo across the entire repository, (b) replaces hash-fake snapshot data with realistic, per-day-deterministic, registry-driven numbers, (c) wires the Svelte app to live data via the prototype, and (d) fixes the broken pages the user identified (Svelte app's mock-only path and `tests/test_registry.py`'s stale assertion). Honors the design in `DESIGN.md` and respects the Brownfield guardrail (no drive-by refactors).

## Accepted requirements

- **R1.** Global product rename: every `ViUsagever` / `viusagever` / `ViUsagever` occurrence → `UsageHalo` / `usagehalo` / `usage-halo` consistent with the new identity.
- **R2.** Realistic per-provider data: deterministic generator keyed by `(provider_id, utc_date)`; respects `primaryMetric`, `freshness`, `scope`; non-negative; labeled `sample_data: true`.
- **R3.** Svelte app wired to a live data path; mock layer retained as a fallback gated by a `USE_LIVE` toggle.
- **R4.** Fix the broken pages the user identified (Svelte app live-data, `tests/test_registry.py` stale assertion, Tauri `setup` TODOs that can be closed without Rust).
- **R5.** Realistic-data generator respects registry shape; no per-provider hand data.
- **R6.** Realistic-data generator produces non-negative numbers; regression test catches signed-shift bugs.
- **R7.** `demo/app.js` "Next limit" and "Today's model activity" panels use the new realistic data; billing-owner invariant preserved.
- **R8.** Svelte live-data fetcher does not change the public Tauri command surface beyond adding the new `snapshot` command (which is source-only, not runnable here).
- **R9.** All existing tests still pass (currently `pytest -q` → 8 passed).
- **R10.** `python scripts/validate.py` still passes (privacy guardrail, registry, migration, fixtures).

## Non-goals

- **NG1.** No Rust compile or Tauri run on this machine.
- **NG2.** No new third-party dependencies.
- **NG3.** No schema changes to SQLite migrations.
- **NG4.** No live API calls to providers; realistic data is synthetic and labeled.
- **NG5.** No changes to the existing privacy guardrail in `scripts/validate.py:61`.
- **NG6.** No connector implementation work.

## Approach

Sequential phases with fresh evidence at each gate. Each phase is independently revertible. The change touches the demo + prototype + Svelte app + Tauri source + docs + tests; no connector crates, no SQLite schema, no Rust domain types.

The realistic-data generator is implemented once in `prototype/server.mjs` (where the snapshot already lives) and exposed via the existing `/api/snapshot` endpoint plus a new `/api/snapshot/legacy-import` one-shot endpoint. The Svelte app's live-data wiring is a small Vite proxy + a new `lib/api.ts` shim that detects the Tauri context and falls back to `fetch('/api/snapshot')` in browser mode.

The Claude bridge file is renamed from `viusage-claude-bridge.mjs` to `usage-halo-claude-bridge.mjs` and updated to write to `~/.usagehalo/inbox/claude-code.jsonl` with a one-time read of the old `~/.viusagever/inbox/claude-code.jsonl` if the new path is empty.

## Interfaces / files affected

- Interface/file: `prototype/server.mjs` — realistic-data generator, legacy-import endpoint, banner.
- Interface/file: `prototype/README.md` — banner + path updates.
- Interface/file: `demo/app.js` — adopt new `sample_data: true` flag; add "Sample data" badge.
- Interface/file: `demo/index.html` — title.
- Interface/file: `apps/desktop-ui/src/lib/api.ts` (NEW) — `fetchSnapshot()` shim.
- Interface/file: `apps/desktop-ui/src/App.svelte` — switch to `lib/api`; add "Sample data" badge.
- Interface/file: `apps/desktop-ui/vite.config.ts` — add dev-server proxy `/api/*` → `http://127.0.0.1:4897`.
- Interface/file: `apps/desktop-ui/src-tauri/src/lib.rs` — add `snapshot` command (source-only), update panic message.
- Interface/file: `apps/desktop-ui/src-tauri/src/main.rs` — update lib call.
- Interface/file: `apps/desktop-ui/src-tauri/Cargo.toml` — rename package, lib name, description.
- Interface/file: `apps/desktop-ui/src-tauri/tauri.conf.json` — productName, identifier, window title.
- Interface/file: `apps/desktop-ui/src-tauri/capabilities/default.json` — description.
- Interface/file: `apps/desktop-ui/package.json` — name.
- Interface/file: `apps/desktop-ui/index.html` — title.
- Interface/file: `connectors/claude-code/scripts/viusage-claude-bridge.mjs` → renamed to `usage-halo-claude-bridge.mjs`; new write path with one-time read of old.
- Interface/file: `Cargo.toml` — workspace.repository.
- Interface/file: `scripts/validate.py` — success message.
- Interface/file: `tests/test_showcase.py` — extend with three new tests.
- Interface/file: `tests/test_registry.py` — fix stale assertion.
- Interface/file: `docs/00..13*.md` — prose rename.
- Interface/file: `README.md` — title, prose.
- Interface/file: `packages/brand-registry/README.md` — prose.

## Execution waves

Phases 2–8 are implementation. Phases 9–10 are review and ship. Each phase ends with a fresh evidence record in the phase's `VERIFY.md` (one per phase) plus a top-level `VERIFY.md` for the change as a whole.

### Wave 1 — Text rename (Phase 2)

- Task: Replace all `ViUsagever` / `ViUsagever` / `viusagever` strings in **non-identifier** contexts: README, docs, demo titles, App.svelte H1, prototype banner, bridge header comment, validate.py success message.
- Depends on: design approval.
- Verification:
  - `node .planonce/work/tmp-scan.cjs` returns 0 matches in the affected scope (text occurrences only; identifiers excluded in this phase).
  - `pytest -q` and `python scripts/validate.py` both green.
  - Manual eye-check: `git grep -n 'ViUsagever\|viusagever'` shows only identifier-bearing files remaining.

### Wave 2 — Identifier rename (Phase 3)

- Task: Rename Tauri bundle id, crate name, lib name, package name, identifier-bearing strings. Rename the bridge file. Update the Claude bridge write path to `~/.usagehalo/inbox/`.
- Depends on: Wave 1.
- Verification:
  - `node .planonce/work/tmp-scan.cjs` returns 0 matches for `viusagever` and `dev.viusagever.app`.
  - `cat apps/desktop-ui/src-tauri/tauri.conf.json | jq -r .identifier` returns `dev.usagehalo.app` (when jq is available; otherwise a node one-liner).
  - Bridge file rename committed; old path is gone.
  - `pytest -q` and `python scripts/validate.py` both green.

### Wave 3 — Realistic data generator (Phase 4)

- Task: Replace the hash-fake generator in `prototype/server.mjs` with a per-day deterministic generator. Emit `sample_data: true`, `day_utc`, and `data_basis` in the response.
- Depends on: Wave 1 (banner renames happen together; safe to co-implement).
- Verification:
  - New pytest `test_realistic_data_per_day` asserts: same-day calls return identical numbers; two consecutive days return different numbers for at least one provider; `sample_data: true`; `day_utc` matches the current UTC date; all 24 providers report non-negative `primaryPercent`, `secondaryPercent`, `tokensToday`, `costToday`; the billing-owner invariant holds for the router group.
  - Manual eye-check: `curl /api/snapshot` shows the new fields and looks credible (no `$0.00` for Claude; reasonable spread; freshness badges match the registry).
  - `pytest -q` and `python scripts/validate.py` both green.

### Wave 4 — Svelte live-data wiring (Phase 5)

- Task: Add `lib/api.ts` shim; add Vite proxy in `vite.config.ts`; update `App.svelte` to use the shim. Add "Sample data" badge when `sample_data: true`.
- Depends on: Wave 3 (so the live data is realistic before wiring it up).
- Verification:
  - `node --check` on the bundled app if Vite can be invoked; otherwise a static-syntax check on the new `lib/api.ts` (Node `tsc --noEmit` is also blocked by toolchain limits; recorded as required-on-toolchain).
  - New pytest `test_svelte_proxy_smoke` (skipped when the dev server is unavailable; documents the test so it can run when the user has the toolchain).
  - `pytest -q` and `python scripts/validate.py` both green.

### Wave 5 — Legacy import endpoint (Phase 6)

- Task: Add `/api/snapshot/legacy-import` to the prototype. One-time copy of `~/.viusagever/inbox/claude-code.jsonl` → `~/.usagehalo/inbox/claude-code.jsonl` if the new path is empty. Idempotent.
- Depends on: Wave 2 (paths must be canonical).
- Verification:
  - New pytest `test_legacy_import_idempotent` seeds an old-path inbox, hits the endpoint, asserts the file was copied, hits the endpoint again, asserts no-op.
  - `pytest -q` and `python scripts/validate.py` both green.

### Wave 6 — Tauri snapshot command (Phase 7)

- Task: Add `snapshot` Tauri command in `apps/desktop-ui/src-tauri/src/lib.rs` that returns the same shape as `/api/snapshot` (read from a local JSON file, fallback to a labeled "unavailable" payload). Source-only; not compiled in this env. Close the `setup` TODOs that can be closed without Rust (i.e. by leaving a `setup` hook that wires the prototype URL into the command at runtime, with a clear comment).
- Depends on: Wave 4.
- Verification:
  - `cat apps/desktop-ui/src-tauri/src/lib.rs` shows the new `snapshot` command; the file is syntactically plausible (the `tauri::command` attribute is on a `fn` returning a `serde_json::Value`; no `?` after `Ok(())`; consistent with the existing `runtime_info` and `demo_provider_snapshot` shape).
  - `pytest -q` and `python scripts/validate.py` both green.
  - Tauri compile NOT run; recorded as required-on-toolchain.

### Wave 7 — Fix broken pages (Phase 8)

- Task: Fix `tests/test_registry.py` stale assertion. Surface and close any other TODO markers in the changed files (e.g. `apps/desktop-ui/src-tauri/src/lib.rs` `setup` hook comments).
- Depends on: Waves 2 and 6 (so the renamed Tauri source is the right one to comment).
- Verification:
  - `pytest -q` shows 11+ tests (8 existing + at least 3 new), all green.
  - `python scripts/validate.py` green.

### Wave 8 — Review and harden (Phase 9)

- Task: Run `planonce-review` (mandatory for Large) and `planonce-security` (mandatory for Large) on the final diff. Classify unrelated legacy findings as pre-existing backlog. Resolve or explicitly disposition validated Critical/High findings.
- Depends on: Waves 1–7.
- Verification:
  - `planonce-review` returns `READY` or `READY_WITH_BACKLOG` with human acceptance.
  - `planonce-security` returns no unresolved Critical/High findings related to this change.
  - Final `VERIFY.md` bound to revision, working_tree_digest, and `approved_plan_digest` (recorded after plan approval).

### Wave 9 — Ship (Phase 10)

- Task: Human ship gate. Verify `evidence check` PASS, `readiness` PASS, `verify-state` PASS. Mark `COMPLETE`.
- Depends on: Wave 8.
- Verification: human approval.

## Verification matrix

| Requirement / risk | Check | Expected evidence |
|---|---|---|
| R1 (rename text) | `node .planonce/work/tmp-scan.cjs` shows 0 in-scope text matches | Scan output saved to phase VERIFY.md |
| R1 (rename identifiers) | Same scan, plus `tauri.conf.json` identifier assertion | Scan + jq/grep evidence |
| R2 (realistic data per-day) | `pytest -q tests/test_showcase.py::test_realistic_data_per_day` | Test passes |
| R2 (sample_data flag) | Same test, `assert "sample_data" in snap` | Test passes |
| R3 (Svelte live wiring) | `pytest -q tests/test_showcase.py::test_svelte_proxy_smoke` (skipped if no dev server) | Test passes or skipped with reason |
| R4 (broken pages fixed) | `pytest -q` shows 11+ tests, all green | Test output |
| R5 (registry shape respected) | `test_realistic_data_per_day` checks `primaryMetric` mapping | Test passes |
| R6 (non-negative numbers) | `test_no_negative_dollar_amounts` extended to all 24 providers | Test passes |
| R7 (billing-owner invariant) | `test_billing_owner_invariant_in_models` still green | Test passes |
| R8 (Tauri command surface) | `cat src-tauri/src/lib.rs` shows `snapshot` command with correct signature | Source review in phase VERIFY.md |
| R9 (no regression) | `pytest -q` shows ≥ 11 tests, all green | Test output |
| R10 (privacy guardrail) | `python scripts/validate.py` | `ViUsagever validation: PASS` becomes `UsageHalo validation: PASS` |
| One-way: bundle id | `tauri.conf.json` shows `dev.usagehalo.app` | `jq` or node one-liner evidence |
| One-way: crate name | `src-tauri/Cargo.toml` shows `usage-halo-desktop` | `grep` evidence |
| One-way: spool path | `usage-halo-claude-bridge.mjs` writes to `~/.usagehalo/inbox/`; prototype reads from `~/.usagehalo/inbox/` and falls back to `~/.viusagever/inbox/` | `grep` evidence + `test_legacy_import_idempotent` |
| Drive-by refactor avoidance | `git diff` of changed files matches the file list above; no other files modified | `git status` + `git diff --stat` |
| Security (no new trust boundary) | `planonce-security` review confirms | Review output in `VERIFY.md` |
| Planonce-review | `planonce-review` returns `READY` or accepted `READY_WITH_BACKLOG` | Review output in `VERIFY.md` |

## Risks / rollback

- **Risk:** the Tauri bundle id rename breaks any existing user installation. **Mitigation:** user confirmed zero published users; the change is source-only in this env. **Rollback:** revert the commit; the user re-installs.
- **Risk:** legacy import overwrites a user's new-path data. **Mitigation:** the import only runs when the new path is empty; idempotent. **Rollback:** delete `~/.usagehalo/inbox/` and the import can be re-run.
- **Risk:** realistic-data generator regresses (e.g. negative numbers). **Mitigation:** extended non-negative test; per-day determinism test; manual eye-check. **Rollback:** revert the prototype's snapshot generator.
- **Risk:** Svelte live-data wiring fails on the user's machine (different Vite proxy behavior). **Mitigation:** mock layer retained as fallback; `USE_LIVE` toggle; smoke test skipped when dev server unavailable. **Rollback:** set `USE_LIVE = false` in `lib/api.ts`.
- **Risk:** drive-by refactors creep in (touching unrelated code). **Mitigation:** explicit file list above; `git diff --stat` review at the end of each phase; if any file outside the list is modified, the phase is blocked and we route to `BLOCKED_AMEND`.
- **Risk:** a Rust syntax error in the new Tauri command. **Mitigation:** the file is not compiled in this env; user will see the error on their first `cargo build` after the change. The command shape mirrors the existing `runtime_info` and `demo_provider_snapshot` exactly. **Rollback:** revert the file.

## Amendment log

- **2026-09-03T10:55Z — Amendment 1 (in-flight, human-confirmed).** Post-Wave-1 residual scan revealed 10 additional Cargo.toml files in `crates/viusage-{core,reconcile,storage}` and `connectors/viusage-*` (6 connectors) whose crate-directory path is part of the public Rust workspace surface. The user confirmed: rename these directories to `crates/usage-halo-{core,reconcile,storage}` and `connectors/usage-halo-*`, and update all path references in `Cargo.toml` (workspace members), `scripts/validate.py`, `tests/test_migration.py`, `docs/03_ARCHITECTURE.md`, and `PROJECT_TREE.txt` (regenerate). Plan digest updated below; new approved_plan_digest recorded in STATE.md.

