---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 5 (legacy-import endpoint)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 5 VERIFY — Legacy-import endpoint

## Approach

Added `POST /api/snapshot/legacy-import` to `prototype/server.mjs`. The endpoint one-shot copies `~/.viusagever/inbox/claude-code.jsonl` (legacy) to `~/.usagehalo/inbox/claude-code.jsonl` (new), with these guarantees:

- **Idempotent.** If the new file already exists, returns `{ migrated: false, reason: "already_present" }` without touching either file.
- **Safe.** Validates every JSON line in the legacy file before writing; refuses with `400 invalid_legacy_payload` if any line is malformed.
- **Idempotent on missing legacy.** If the legacy file does not exist, returns `{ migrated: false, reason: "no_legacy" }`.
- **Permissions preserved.** New directory created with `0o700`; new file written with `0o600`, matching the existing Claude-ingest path.

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Syntax | `node --check prototype/server.mjs` | silent ✅ |
| Tests | `python -m pytest -q` | `15 passed` ✅ |
| New test | `test_legacy_import_idempotent` | passes; seeds two records, asserts `migrated: true, count: 2`; hits endpoint again, asserts `migrated: false, reason: "already_present"`; cleans up after itself ✅ |

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R9 (no regression) | DONE | 15/15. |
| R10 (validator) | DONE | `UsageHalo validation: PASS`. |

## Planonce-review (lightweight)
- Drive-by refactors avoided: yes. Only the new endpoint was added.
- Contract changes: new endpoint only. Existing endpoints unchanged.

## Next action
Wave 6: Tauri snapshot command (source-only). Add a `snapshot` Tauri command in `apps/desktop-ui/src-tauri/src/lib.rs` that returns the same shape as `/api/snapshot`. Not compiled in this env.
