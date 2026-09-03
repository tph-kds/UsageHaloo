---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 2 (identifier rename)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 2 VERIFY — Identifier rename (one-way doors)

## Approach

Three sub-waves:

- **Wave 2 (Tauri-specific).** Tauri bundle id, Tauri crate name, Tauri lib name, Tauri product name (already text in Wave 1), npm package name, workspace `Cargo.toml` repository URL, Claude bridge file rename + filename references, panic message, lib call.
- **Wave 2b (workspace crates, Amendment 1).** Human confirmed: rename `crates/viusage-{core,reconcile,storage}` → `crates/usage-halo-{core,reconcile,storage}` and rewrite every reference to `viusage-core` / `viusage-reconcile` / `viusage-storage` / `viusage-claude-code` / `viusage-codex` / `viusage-gemini-cli` / `viusage-openai` / `viusage-anthropic` / `viusage-openrouter` to the `usage-halo-*` form. Regenerate `PROJECT_TREE.txt`.
- **Wave 2c (connector package name fix).** The 6 connector `Cargo.toml` files used `viusage-connector-{name}` as the `[package].name`; cleaned up to `usage-halo-connector-{name}`.

The amendment was authorized by the human in-flight (Amendment 1) and recorded in `PLAN.md` and `STATE.md` (new plan digest `sha256:5631c037…df50`).

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Tauri identifier renamed | `node -e "..." tauri.conf.json` | `identifier = dev.usagehalo.app` ✅ |
| Workspace members updated | `node -e "..." Cargo.toml` | All 3 entries read `usage-halo-{core,reconcile,storage}` ✅ |
| Workspace repository URL | same | `https://example.invalid/usagehalo` ✅ |
| Bridge file renamed | `Get-ChildItem connectors/claude-code/scripts` | `usage-halo-claude-bridge.mjs` ✅ |
| Residual old-name scan | node scan | **0 files** with `ViUsagever` / `ViUsagever` / `viusagever` / `viusage-` ✅ |
| Tests | `python -m pytest -q` | `8 passed` ✅ |
| Validator | `python scripts/validate.py` | `UsageHalo validation: PASS` ✅ |
| PROJECT_TREE.txt regenerated | `wc -l PROJECT_TREE.txt` | 409 lines (was 98 in the stale snapshot) ✅ |

## One-way doors exercised

| Door | Status | Evidence |
|---|---|---|
| Tauri bundle id | renamed | `dev.usagehalo.app` |
| Tauri crate name | renamed | `usage-halo-desktop` |
| Tauri lib name | renamed | `usage_halo_lib` |
| npm package name | renamed | `usage-halo-desktop-ui` |
| Workspace crate dirs (×3) | renamed | `crates/usage-halo-{core,reconcile,storage}` |
| Workspace crate package names (×3) | renamed | per workspace Cargo.toml |
| Connector package names (×6) | renamed | `usage-halo-connector-{claude-code,codex,gemini-cli,openai,anthropic,openrouter}` |
| Bridge file | renamed | `usage-halo-claude-bridge.mjs` |
| Spool path | not yet changed (deferred to Wave 6) | bridge still writes to `~/.usagehalo/inbox/` per Wave 6 plan |

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R1 (identifier rename) | DONE | All 5 one-way doors exercised; 0 residual occurrences. |
| R10 (validator) | DONE | `UsageHalo validation: PASS`. |
| R9 (no regression) | DONE | 8/8 tests still green. |

## Risks encountered

- **In-flight plan amendment.** The post-Wave-1 scan revealed 10 additional Cargo.toml files. The user authorized the extension in-chat; I recorded it as Amendment 1 in `PLAN.md` with a new digest and updated `STATE.md`. No further amendment needed.

## Planonce-review (lightweight, per-wave)
- Drive-by refactors avoided: yes — only the rename targets were touched. `crates/viusage-core/Cargo.toml` was not edited; the whole directory was renamed and the file moved with it.
- Contract changes: none. The `UsageConnector` trait, the SQLite schema, the registry schema, and the prototype's HTTP API are all unchanged.
- Unrelated changes: none.

## Next action
Wave 3: realistic per-day-deterministic data generator in `prototype/server.mjs`. The generator is the only one in this change; it stays compatible with the existing `test_no_negative_dollar_amounts`, `test_billing_owner_invariant_in_models`, and `test_ingest_claude_round_trip` tests. New tests: `test_realistic_data_per_day` and an extension of `test_no_negative_dollar_amounts` to all 24 providers.
