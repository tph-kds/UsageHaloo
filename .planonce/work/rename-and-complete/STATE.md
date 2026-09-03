---
schema: planonce.state/v1
change_id: rename-and-complete
workflow: BROWN-LARGE
status: REVIEWING
baseline_revision: unavailable
current_revision: unavailable
approved_plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
workspace_mode: in-place
lock_owner: human
---
# Execution State — rename-and-complete

- Status: EXECUTING
- Workflow: BROWN-LARGE
- Approved gates: design (APPROVED), plan (APPROVED, digest locked)
- Current phase: Wave 1 (text rename)
- Current wave: Wave 1
- Current task: replace all `ViUsagever` / `ViUsagever` / non-identifier `viusagever` occurrences; record Wave 1 VERIFY.md.

## Artifacts
- CONTEXT.md — `.planonce/work/rename-and-complete/CONTEXT.md`
- DESIGN.md  — `.planonce/work/rename-and-complete/DESIGN.md` (APPROVED)
- PLAN.md    — `.planonce/work/rename-and-complete/PLAN.md` (APPROVED, digest sha256:caa4390668…5598)
- STATE.md   — this file
- VERIFY.md  — created at Wave 8 (final) plus one per phase (Wave 1, 2, …, 7)

## Plan digest

```
sha256:caa4390668962b8e90ed2ec34eb209441a737c9847438efe788a1883ff305598  PLAN.md
```

Plan is locked. Any change to PLAN.md after this point requires a `BLOCKED_AMEND` transition with a new digest.

## Gate check (offline, pre-execution)
```
node -e "const fs=require('fs'),c=require('crypto'); let t=fs.readFileSync('.planonce/work/rename-and-complete/PLAN.md','utf8').replace(/\r\n/g,'\n').replace(/\r/g,'\n'); t=t.split('\n').map(l=>l.trimEnd()).join('\n').replace(/\n+$/,'')+'\n'; console.log('sha256:'+c.createHash('sha256').update(t).digest('hex'))"
```
Output: `sha256:caa4390668962b8e90ed2ec34eb209441a737c9847438efe788a1883ff305598` — matches `approved_plan_digest`.
`gate execution` equivalent: PASS.

## Completed
- Phase 0: design (CONTEXT.md + DESIGN.md)
- Phase 1: plan (PLAN.md approved, digest locked, gate PASS)
- Wave 1: in progress

## Blockers
- None.

## Next action
- Wave 1 implementation, then Wave 1 VERIFY.md with fresh evidence.

## Last fresh evidence
- None for this change yet. Prior `showcase-all-providers` change has FRESH evidence in `.planonce/work/showcase-all-providers/VERIFY.md` (8 tests passing, 24 providers in /api/snapshot, 0 negative costs). Will be re-verified at the end of this change because the prototype's snapshot is being touched.

## Notes
- Worktree mode: in-place. No parallel workers. Cooperative scope lock: implicit (single worker).
- Pre-existing `showcase-all-providers` change is in REVIEWING. The realistic-data generator in Wave 3 must remain compatible with its tests (`test_no_negative_dollar_amounts`, `test_billing_owner_invariant_in_models`).
- Workspace safety: Wave 2 will rename `connectors/claude-code/scripts/viusage-claude-bridge.mjs`; no in-repo consumer references the old filename. The new filename `usage-halo-claude-bridge.mjs` is committed in the same wave.
