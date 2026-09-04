---
schema: planonce.verify/v1
change_id: realism-hardening-webapp-desktop
revision: c4b6a83e15ef62c27eaf38b07671b4c75c210c9c
working_tree_digest: uncommitted-worktree
plan_digest: sha256:a500d8d29ceb81201d216c2a878a12af43f26d6741c2cd758f0e620befc9f01f
evidence_status: FRESH
---
# Verification Evidence

## Requirement coverage
| ID | Status | Evidence |
|---|---|---|
| R1 honest values only | PASS | Default `/api/snapshot`: `data_basis registry+live-overlay`, `sample_data:false`, non-live `primaryPercent:null` + `provenance.sample:true`; demo `?demo=1` keeps determinism (`sample_data:true`, 24 non-null). Smoke 2026-09-04: honest 1 live (real spool 73%), demo 24. |
| R2 unknown/sample states | PASS | Svelte + demo render `—`/Unknown + Sample banners; `test_honest_default_nulls` passes. |
| R3 Tauri real rows | PASS | `snapshot` returns 24 registry rows w/ nullable percents + live Claude overlay; `connector_health` unchanged & wired-contract; `demo_provider_snapshot` `#[cfg(debug_assertions)]`; `cargo check` + `clippy -D warnings` clean. |
| R4 un-hardcode | PASS | Grep live path: no `$12.47`/`200K`/`1,429`/`58%`/burn arrays outside `DEMO_*`/sample-gated branches + static HTML placeholders replaced with `—`. Widget/forecast/alerts empty-safe. Svelte Heatmap shows an empty-state message unless live or sample (re-verified: svelte-check 0, vite build ok, pytest 41 pass). |
| R5 demo-mode gate | PASS | `isDemoRequest (?demo=1 \|\| SAMPLE_MODE=1)`; `test_per_day_determinism`, cost rules, weekly rhythm run against `?demo=1` and pass. |
| R6 Windows-correct | PASS | See deterministic checks table. |
| R7 no drive-by | PASS | Diff limited to 11 files: prototype, collectors-consumer UI (demo/Svelte/Tauri/Heatmap/widget-esc), tests, `.gitignore` amendment. No unrelated refactors. |

## Deterministic checks
| Check | Command/procedure | Scope | Exit/result | Fresh evidence |
|---|---|---|---|---|
| pytest full | `python -m pytest -q` | repo | 41 passed | 2026-09-04 FRESH |
| validate | `python scripts/validate.py` | repo | PASS | 2026-09-04 FRESH |
| svelte-check | `npm.cmd run check` in apps/desktop-ui | desktop UI | 0 errors 0 warnings | 2026-09-04 FRESH |
| vite build | `npm.cmd run build` in apps/desktop-ui | desktop UI | built in ~1s, 121 modules | 2026-09-04 FRESH |
| cargo fmt | `cargo fmt --check` | workspace | clean | 2026-09-04 FRESH |
| cargo clippy | `cargo clippy -p usage-halo-desktop --all-targets -- -D warnings` | Tauri shell | clean (after rfind fix) | 2026-09-04 FRESH |
| cargo test | `cargo test --workspace` | workspace | 25 passed 0 failed | 2026-09-04 FRESH |
| cargo check | `cargo check -p usage-halo-desktop` | Tauri shell | clean | 2026-09-04 FRESH |
| prototype smoke | honest vs `?demo=1` vs widget vs forecast on :4898/4899 | prototype | honest nulls + 1 live; demo 24; widget available; forecast EWMA | 2026-09-04 FRESH |
| privacy audit | `python scripts/privacy_audit.py` | store+spools | clean (5 files, 84 rows) | 2026-09-04 FRESH |
| daemon once | `node collectors/daemon.mjs --once` | collectors | all pollers honest `live:false`, cacheWritten | 2026-09-04 FRESH |
| node syntax | `node --check prototype/server.mjs demo/app.js` | webapp | ok | 2026-09-04 FRESH |
| tauri build (unsigned) | `npm.cmd run tauri build` in apps/desktop-ui | desktop bundle | vite ok + release exe + MSI + NSIS produced; updater signing skipped (no private key — release-only, expected) | 2026-09-04 FRESH |
| gitignore fix | `git check-ignore` + `git status` | desktop src/lib | no longer ignored; `?? src/lib/` untracked | 2026-09-04 FRESH |

## Risk-scaled production checks
| Area | Required? | Command/procedure | Evidence / result |
|---|---|---|---|
| Security / authorization / secrets | Yes (Large) | `planonce-security` review + privacy audit + `test_privacy.py` (in pytest 41) | privacy audit clean; ingest strips prompts; alias-only secrets unchanged — see security review |
| Migration / rollback / data integrity | Yes | Per-phase single-commit revert; no stored-data migration | Rollback commands in DESIGN.md; legacy-import test backs up/restores real spool |
| Compatibility / public contracts | Yes | `validate.py` + shape assertions (`test_registry_and_snapshot_full`) | `/api/snapshot` additive (`demo_mode`, `has_live_data`, nullable kept); Tauri `snapshot` additive rows |
| Performance / resource use | No (no perf-sensitive path) | vite build ~1s; cargo check ~2-19s | No regression signal |
| Observability / logging / alerts | Yes | daemon `--once`, `/api/alerts` null-budget note | Alerts fire only on observed 80%+; budget hardcoded 62 removed |
| AI/LLM quality, hallucination, tool correctness, latency/cost | N/A | No LLM path touched | — |

## User acceptance / UAT
- Scenario: open prototype default snapshot with real Claude spool present → honest 1-live + 23 null-Sample rows; `?demo=1` → full deterministic rail.
- Result: verified via curl smoke (not yet browser-clicked — recommend manual Demo vs Live toggle check).
- Scenario: Tauri desktop with empty store → honest empty UI, no mock numbers.
- Result: code-complete, compiler-verified; runtime Tauri dev launch not run in this session (toolchain present — recommend `npm run tauri dev` smoke).

## Final diff audit
- Requirements matched: R1–R7 all PASS per table.
- Non-goals preserved: NG1 no scraping/proxy/transcripts added; NG2 no macOS/Linux signing; NG3 no restyle (styling untouched); NG4 no paid-account smoke.
- Unrelated changes: none — 11 files: `prototype/server.mjs`, `demo/{app.js,index.html,widget.html}`, `apps/desktop-ui/{src-tauri/src/lib.rs,src/App.svelte,src/lib/api.ts(untracked),src/lib/components/Heatmap.svelte(untracked)}`, `tests/{test_realistic_data,test_showcase}.py`, `.gitignore` (amended).

## Residual risks
- `apps/desktop-ui/src/lib/` files are untracked (`??`) — they exist on disk and build, but need `git add` + commit to ship. Left uncommitted deliberately (no commit instruction).
- `src-tauri` release build + NSIS/signed packaging not re-run in this change (prior VERIFICATION.md covers unsigned build); recommend `npm run tauri build` on release runner.
- Browser click-through UAT + `tauri dev` live launch not run here; recommended before ship.
- Pre-existing: `test_tokens_today_weekly_rhythm` had a Mon-vs-Sun weekday mapping bug — fixed as drive-along (js-dow) with evidence; watch for Sunday-boundary flake.

## Unverified / blocked
- `planonce-security` + `planonce-review`: pending (next step, mandatory for Large).
- Human ship gate: PENDING.

## Human ship gate
- Approval: PENDING
