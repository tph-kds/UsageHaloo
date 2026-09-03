---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 6 (Tauri snapshot command)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 6 VERIFY — Tauri snapshot command (source-only)

## Approach

Added a third Tauri command, `snapshot`, to `apps/desktop-ui/src-tauri/src/lib.rs`. It returns the **same response shape** as the prototype's `/api/snapshot` endpoint (so the Svelte `lib/api.ts` shim is source-compatible between browser-dev mode and Tauri mode) and currently returns a clearly-labeled `unavailable_reason` payload because the Rust runtime is not exercised in this environment.

The `chrono` crate is already a workspace dependency (verified in `Cargo.toml:24`), so the lazy import is source-correct.

The `setup` hook is unchanged in shape (intentionally minimal until the real storage + scheduler are wired in) but the comment is now explicit about the Svelte shim contract.

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Tests | `python -m pytest -q` | `15 passed` ✅ |
| Validator | `python scripts/validate.py` | `UsageHalo validation: PASS` ✅ |
| File inspection | `cat apps/desktop-ui/src-tauri/src/lib.rs` | `snapshot` command present; `invoke_handler` registers all 3 commands; `chrono` lazy import on the `use chrono::Utc` line ✅ |

## Note on compilation

This env has no `cargo`/`rustc`. The Rust file is **source-correct** (matches the existing `runtime_info` and `demo_provider_snapshot` patterns exactly; uses `serde_json::Value` for the return type, `serde_json::json!` for the body, and the same `#[tauri::command]` attribute). The user can run `cargo build` on a developer machine to confirm. The verification-gates standard records Rust gates as required-on-toolchain.

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R8 (Tauri command surface) | DONE | `snapshot` command added; Svelte shim already references it via `invoke('snapshot')` from Wave 4. |
| R9 (no regression) | DONE | 15/15. |
| R10 (validator) | DONE | `UsageHalo validation: PASS`. |

## Planonce-review (lightweight)
- Drive-by refactors avoided: yes. Only the new command was added; `runtime_info` and `demo_provider_snapshot` are unchanged.
- Contract changes: new command only. Existing commands unchanged.
- Security: no new trust boundary. The `snapshot` command returns a static JSON payload; no filesystem or network access.

## Next action
Wave 7: fix broken pages. `tests/test_registry.py` has a stale assertion against a phrase that no longer exists in `docs/12_BRAND_ASSETS.md`. Plus any TODO markers in changed files that can be closed.
