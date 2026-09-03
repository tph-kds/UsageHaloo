# STATE — showcase-all-providers

- change_id: showcase-all-providers
- phase: REVIEWING (awaiting human ship gate)
- approved_plan_digest: NOT_APPLICABLE  (Small)
- revision: (working tree not yet committed; recorded at ship)
- working_tree_digest: (recorded at ship)
- evidence_status: FRESH
- plan_digest: NOT_APPLICABLE  (Small)
- evidence: .planonce/work/showcase-all-providers/VERIFY.md
- review: lightweight (diff-first, no drive-by refactors, no security trigger)
- approval:
  granted_by: human
  granted_at: 2026-09-02T15:55Z
  micro_plan: .planonce/work/showcase-all-providers/CONTEXT.md
- next_required_action: human ship approval
- blocker: none
- notes: |
  Confirmed runtime environment on Windows: `cargo`/`rustc` missing, PowerShell
  execution policy blocks `npm.ps1`/`npx.ps1`, but `node 22.17.1` + `npm 11.12.0`
  + `python 3.11.7` + `pytest 9.0.3` are present. Prototype server runs and
  serves the new registry-driven snapshot. New scope is the demo + prototype only.

