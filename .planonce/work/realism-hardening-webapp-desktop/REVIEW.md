# PlanOnce Code / Production Review

- **Baseline:** c4b6a83e15ef62c27eaf38b07671b4c75c210c9c (`main`, clean tree at start)
- **Current revision:** c4b6a83e15ef62c27eaf38b07671b4c75c210c9c + uncommitted worktree (11 files; `git status` verified 2026-09-04)
- **Scope:** diff review of `realism-hardening-webapp-desktop` Waves 1–4 + one approved `.gitignore` amendment; second-pass clean-context read of plan, diff, VERIFY.md, SECURITY_REVIEW.md
- **Ship decision:** READY_WITH_BACKLOG

## Requirement coverage

R1–R7 all PASS against implementation + tests (see VERIFY.md matrix). R4 gap found during review (Svelte `Heatmap.svelte` still synthetic) was fixed in-scope before this decision: empty-state unless live/sample, `svelte-check` 0 + `vite build` ok. Non-goals NG1–NG4 preserved (no scraping/proxy/transcripts, no signing work, no restyle, no paid-account smoke).

## Verification evidence

Commands · exit codes · revision · scope. All FRESH 2026-09-04 on current worktree: `pytest` 41 passed; `validate.py` PASS; `svelte-check` 0/0; `vite build` ok (121 modules); `cargo fmt --check` clean; `cargo clippy -p usage-halo-desktop -D warnings` clean; `cargo test --workspace` 25 passed; `cargo check -p usage-halo-desktop` clean; prototype honest/demo smoke verified; `privacy_audit.py` clean (5 files/84 rows); `daemon --once` honest; `node --check` clean. Plan digest `sha256:a500d8d2…` matches STATE; VERIFY `evidence_status: FRESH` (worktree changed after first pass only by review-driven Heatmap/widget-esc fixes, both re-verified).

## Must fix

| ID | Priority | Origin | Confidence | Evidence | Required action |
|---|---|---|---|---|---|
| — | — | — | — | No P0/P1 findings. Svelte heatmap gap fixed pre-decision; widget self-XSS fixed pre-decision. | — |

## Backlog / accepted residual work

| ID | Priority | PRE-EXISTING / INTRODUCED / UNKNOWN | Evidence | Recommendation |
|---|---|---|---|---|
| SEC-02 updater placeholder | P3 | PRE-EXISTING | `tauri.conf.json:63-70` example.invalid feed | Configure real feed + pubkey before public release (existing VERIFICATION.md gate) |
| Untracked `src/lib/` needs `git add` | P2 | PRE-EXISTING (exposed by amendment) | `git status: ?? apps/desktop-ui/src/lib/` | Review + `git add apps/desktop-ui/src/lib .gitignore` + commit; left uncommitted deliberately |
| `tauri dev`/`tauri build` live launch | P3 | PRE-EXISTING | Not run in this session | Smoke `npm run tauri dev` + per-OS `tauri build` on release runner |
| Browser click-through UAT | P3 | UNKNOWN | Curl smoke only | Manual Demo vs Live toggle check |
| Demo sparklines still hash-pattern | P3 | PRE-EXISTING | `demo/app.js:98` `sparkline(hash32(...))` | Label as sample pattern or derive from rollups (follow-up) |
| `test_tokens weekly` Mon/Sun mapping | P3 | PRE-EXISTING (fixed drive-along) | js-dow fix in tests | Watch Sunday-boundary flake |

## Production readiness

Correctness: honest-empty default + `?demo=1` parity + live overlays verified by smoke + updated contract tests. Tests: 41 pytest + 25 cargo + typecheck/build all green. Security: current `planonce-security` review (SEC-01 fixed, SEC-02 backlog). Migration/rollback: no stored-data migration; per-phase single-commit revert documented. Operations: daemon honest without keys; updater inert until feed configured. Observability: freshness/provenance/sample flags end-to-end; alerts only on observed 80%+. Performance/cost: no perf-sensitive path; builds fast. Compatibility: snapshot shapes additive (nullable kept, `demo_mode`/`available` added).

### Production evidence (read-only when available)

- CI/deployment health: no CI access in this session — unverified (release.yml unrun, pre-existing).
- Error logs / traces: daemon `--once` output clean; no error logs reviewed beyond that.
- Alerts / SLOs: n/a (local-first, no SLOs).
- Recent incidents: none known.
- Migration/runtime state: no migrations in this change.
- Unavailable evidence: CI status, `tauri dev` runtime, browser UAT — listed above as backlog.

## Unverified / blocked evidence

None blocking. All required gates ran; items above are explicitly backlog, not stale evidence.

## Human ship decision

PENDING — recommend **ship after `git add` + commit** of the 11 files (including untracked `src/lib/`), with SEC-02 + UAT backlog accepted. Review recommends READY_WITH_BACKLOG; human confirms.
