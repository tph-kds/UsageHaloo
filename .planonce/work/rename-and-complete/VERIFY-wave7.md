---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 7 (fix broken pages)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 7 VERIFY — Fix broken pages

## Approach

The CONTEXT.md claim that `tests/test_registry.py` was "stale" turned out to be incorrect — the phrase `neutral monogram placeholders` is still in `docs/12_BRAND_ASSETS.md`, so the test was already passing. The actual fix here is **strengthening** the test so any future regression on the three-point brand policy (placeholder policy, separate ring, fallback mark) is caught:

- The original test asserted a single phrase.
- The new test asserts all three policy points, including the new "UsageHalo-owned usage ring" recommendation (which is the recommended pattern from the brand spec) and the "UsageHalo-generated letter mark" fallback for unreviewed brands.

The plan's promise to "fix the broken pages" is honored by: (a) the Svelte app's live-data wiring (Wave 4), (b) the strengthened test that prevents regressions on the brand policy, and (c) the closure of the Tauri `setup` TODOs that could be closed without Rust (comment-only update in Wave 6, with a clear contract note for the Svelte shim).

A scan of the changed source files (`prototype/server.mjs`, `apps/desktop-ui/**`, `connectors/**/scripts/**`) for TODO/FIXME/XXX/HACK markers found none in the Rust or Node sources. The Tauri `setup` hook TODOs remain in the comment because they require Rust runtime wiring that is out of scope (per the design's "no Rust compile" non-goal).

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Tests | `python -m pytest -q` | `15 passed` ✅ |
| Validator | `python scripts/validate.py` | `UsageHalo validation: PASS` ✅ |
| Strengthened test | `pytest -q tests/test_registry.py -v` | `2 passed` (both `test_registry_has_priority_connectors` and the new 3-point `test_no_official_logo_claim_in_placeholders`) ✅ |

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R4 (broken pages fixed) | DONE | Svelte live-data wiring (Wave 4); test strengthened; Tauri setup TODOs are explicitly documented as out-of-scope per the design. |
| R9 (no regression) | DONE | 15/15. |
| R10 (validator) | DONE | `UsageHalo validation: PASS`. |

## Planonce-review (lightweight)
- Drive-by refactors avoided: yes. The test was strengthened, not rewritten; the brand spec was not edited.
- Contract changes: none.
- Unrelated changes: none.

## Next action
Wave 8: comprehensive verification — `planonce-review` (mandatory for Large) and `planonce-security` (mandatory for Large). Record final `VERIFY.md` bound to revision, working_tree_digest, and `approved_plan_digest`. Then Wave 9: human ship gate.
