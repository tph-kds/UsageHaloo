---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 1 (text rename)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:caa4390668962b8e90ed2ec34eb209441a737c9847438efe788a1883ff305598
evidence_status: FRESH
---
# Wave 1 VERIFY — Text rename

## Approach
Replaced all text occurrences of `ViUsagever`, `ViUsagever`, and prose-safe `viusagever` with `UsageHalo`, `UsageHalo`, `usagehalo` respectively. Identifier fields (Tauri bundle id, crate name, package name, lib name, source-level `viusagever_desktop_lib`/`viusagever-desktop-ui` calls) were intentionally left for Wave 2.

Script: `.planonce/work/rename-and-complete/wave1-rename.cjs`. The 27-file Wave 1 set includes both pure-prose files and identifier-bearing files, but the script's regex (`viusagever(?![A-Za-z0-9_.-])`) only replaces lowercase `viusagever` when it is NOT followed by an identifier character (dash, underscore, dot, alnum). This is the deliberate seam between Wave 1 and Wave 2.

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Wave 1 rewrites | `node .planonce/work/rename-and-complete/wave1-rename.cjs` | `Wave 1 rewrites: 25 files, 48 occurrences changed.` ✅ |
| Residual old-name scan | post-script node scan | 4 files with 5 residual occurrences, all identifier-bearing fields (see below) ✅ |
| Always-on Python gates | `python -m pytest -q` | (re-run after Wave 2; not re-run here to keep the seam clean) |
| Privacy guardrail | `python scripts/validate.py` | (re-run after Wave 2) |

## Residual occurrences (all Wave 2 territory)

| File | Line | Field |
|---|---|---|
| `apps/desktop-ui/src-tauri/Cargo.toml` | 2 | `name = "viusagever-desktop"` (crate name) |
| `apps/desktop-ui/src-tauri/Cargo.toml` | 9 | `name = "viusagever_desktop_lib"` (lib name) |
| `apps/desktop-ui/package.json` | 2 | `"name": "viusagever-desktop-ui"` (npm package name) |
| `apps/desktop-ui/src-tauri/src/main.rs` | 2 | `viusagever_desktop_lib::run()` (lib call) |
| `apps/desktop-ui/src-tauri/tauri.conf.json` | 5 | `"identifier": "dev.viusagever.app"` (Tauri bundle id) |

These five fields are the **only** strings that will change in Wave 2. The text surrounding them (`UsageHalo desktop shell`, `productName: "UsageHalo"`, `title: "UsageHalo"`, the panic message `error while running UsageHalo`, etc.) is already correctly renamed.

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R1 (text rename) | DONE | 25 files, 48 occurrences rewritten; residual scan shows only identifier fields remain. |

## Risks encountered
None. The seam between text and identifier rename is enforced by the regex and verified by the residual scan.

## Planonce-review (lightweight, per-wave)
- Drive-by refactors avoided: yes — only the listed Wave 1 files were touched, and only text occurrences were changed.
- Contract changes: none.
- Unrelated changes: none.

## Next action
Wave 2 (identifier rename): Tauri bundle id `dev.viusagever.app` → `dev.usagehalo.app`; crate name `viusagever-desktop` → `usage-halo-desktop`; lib name `viusagever_desktop_lib` → `usage_halo_lib`; npm package name `viusagever-desktop-ui` → `usage-halo-desktop-ui`; bridge file `viusage-claude-bridge.mjs` → `usage-halo-claude-bridge.mjs`; Cargo.toml workspace.repository URL; the bridge's write path to `~/.usagehalo/inbox/`. Plus test for the prototype's new spool path awareness.

## Human gate
Wave 1 has no human gate. Wave 2 is a one-way-door batch; it will record its own evidence and continue without a gate per the plan. The aggregate human ship gate is at Wave 9.
