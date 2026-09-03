---
schema: planonce.design/v1
change_id: rename-and-complete
workflow: BROWN-LARGE
design_revision: 1
approval_status: APPROVED
approval:
  granted_by: human
  granted_at: 2026-09-03T10:25Z
---
# Design — Rename to UsageHalo + Realistic Data + Broken-Page Fixes

## Problem / context

The user has reported three coupled issues:

1. **Branding mismatch.** The product is internally called `ViUsagever` (and the related identifiers `viusagever`, `viusagever_desktop_lib`, `dev.viusagever.app`) but the user wants it called **UsageHalo**. The rename must be applied consistently across code, config, docs, and brand surface.
2. **The prototype's data reads as fake.** Per-provider numbers are hash-derived constants and the rail shows the same numbers on every reload. The user wants numbers that "realistically display" — i.e. follow each provider's documented metric shape and change over time.
3. **Several pages are not working.** The Svelte app (the actual Tauri-bound UI) consumes only `lib/mock.ts`; it has no live data path. `tests/test_registry.py` has a stale assertion against a phrase that no longer exists in `docs/12_BRAND_ASSETS.md`. The Tauri shell has setup TODOs that cannot be exercised on this machine.

## Requirements and non-goals

See `CONTEXT.md` §Requirements and §Non-goals. The design respects them; the three material decisions confirmed by the human are:

- **Rename strategy:** hard rename + read-from-old (the bridge script and prototype also read from `~/.viusagever/inbox/` on first launch if `~/.usagehalo/inbox/` is empty).
- **Realistic data source:** registry-driven per-day deterministic generator, keyed by `(provider_id, utc_date)`.
- **Svelte live-data target:** prototype at `127.0.0.1:4897` via Vite dev-server proxy.

## Current architecture (Brownfield)

```
+-----------------------+      +-----------------------+
|  apps/desktop-ui      |      |  apps/desktop-ui      |
|  (Svelte 5 + Vite)    |      |  src-tauri/           |
|  - App.svelte         |  ->  |  (Rust + Tauri 2)     |
|  - lib/mock.ts <----- |      |  - lib.rs (2 cmds)    |
|  - 4 components       |      |  - bundle id:         |
+-----------------------+      |    dev.viusagever.app |
         ^                     +-----------------------+
         |                              ^
         | imports                      | crate dep
         |                              |
+-----------------------+      +-----------------------+
|  prototype/server.mjs |      |  crates/viusage-core  |
|  (Node, zero-dep)     |      |  UsageConnector trait |
|  - /api/snapshot      |      |  + domain types       |
|  - /api/registry      |      +-----------------------+
|  - /api/ingest/claude |
|  - /assets/providers/ |
+-----------------------+
         ^
         | reads ~/.viusagever/inbox/claude-code.jsonl
         |
+------------------------------------------------------+
| connectors/claude-code/scripts/                      |
|   viusage-claude-bridge.mjs                          |
+------------------------------------------------------+
```

- Two parallel UIs: the **demo** (browser, served by the prototype) and the **Svelte app** (intended for Tauri, currently 100% mock).
- One Rust crate path is the only one with a real Tauri command today (`runtime_info`, `demo_provider_snapshot`).
- The Claude status-line bridge is the only ingest path that produces real data.
- 24 providers in the registry, 16 unique connectors, 5 freshness classes (live/fresh/hourly/daily/poll/...).
- SQLite schema in `crates/viusage-storage/migrations/0001_init.sql` is not actually written by the prototype (the prototype is in-memory only). Out of scope.

## Target architecture

```
+-----------------------+      +-----------------------+
|  apps/desktop-ui      |      |  apps/desktop-ui      |
|  (Svelte 5 + Vite)    |      |  src-tauri/           |
|  - App.svelte         |  ->  |  (Rust + Tauri 2)     |
|  - lib/api.ts (NEW)   |      |  - lib.rs             |
|  - lib/mock.ts (kept) |      |  - bundle id:         |
|  - 4 components       |      |    dev.usagehalo.app  |
+-----------------------+      +-----------------------+
         |                              ^
         | /api/snapshot (Vite proxy)   | crate dep
         v                              |
+-----------------------+      +-----------------------+
|  prototype/server.mjs |      |  crates/viusage-core  |
|  (Node, zero-dep)     |      |  UsageConnector trait |
|  - /api/snapshot      |      |  + domain types       |
|    (realistic per-day)|      +-----------------------+
|  - /api/registry      |
|  - /api/ingest/claude |
|  - /assets/providers/ |
|  - /api/snapshot/old  | <- one-time import path
+-----------------------+
         ^
         | reads ~/.usagehalo/inbox/ (NEW primary)
         | falls back to ~/.viusagever/inbox/ on first launch
         |
+------------------------------------------------------+
| connectors/claude-code/scripts/                      |
|   usage-halo-claude-bridge.mjs (RENAMED file)        |
+------------------------------------------------------+
```

### Components and responsibilities

- **`prototype/server.mjs`** (in-scope). Add realistic-data generator; add `~/.viusagever/inbox/` one-time import on startup; keep the existing sanitization; emit a "sample data" header in `/api/snapshot`.
- **`apps/desktop-ui/src/lib/api.ts`** (NEW). One small TypeScript module exposing `fetchSnapshot(): Promise<Snapshot>`. Detects Tauri context (`window.__TAURI__`) and routes to `invoke('snapshot')` when present, otherwise `fetch('/api/snapshot')`. Browser-mode is the default that runs in this environment.
- **`apps/desktop-ui/src/App.svelte`** (in-scope). Replace the `from './lib/mock'` import with `from './lib/api'`. Show a "sample data" badge when the response has the new `sample_data: true` flag.
- **`apps/desktop-ui/vite.config.ts`** (in-scope). Add a dev-server proxy for `/api/*` → `http://127.0.0.1:4897` so the Svelte dev server can reach the prototype.
- **`apps/desktop-ui/src-tauri/src/lib.rs`** (in-scope, source-only). Add a `snapshot` Tauri command that returns the same shape as `/api/snapshot`. Source-correct; not compiled in this environment.
- **`apps/desktop-ui/src-tauri/tauri.conf.json`** (in-scope). Rename `productName`, `identifier`, window title.
- **`apps/desktop-ui/src-tauri/Cargo.toml`**, **`apps/desktop-ui/src-tauri/src/main.rs`**, **`apps/desktop-ui/src-tauri/capabilities/default.json`**, **`apps/desktop-ui/src-tauri/src/lib.rs`** — rename crate name, lib name, panic message, description.
- **`apps/desktop-ui/package.json`** — rename package name.
- **`apps/desktop-ui/index.html`** — title.
- **`apps/desktop-ui/src/App.svelte`** — H1, eyebrow.
- **`prototype/server.mjs`**, **`prototype/README.md`** — banner, log, prose.
- **`connectors/claude-code/scripts/viusage-claude-bridge.mjs`** — rename file, header, log prefix; **read from new `~/.usagehalo/` and fall back to `~/.viusagever/` on first launch.**
- **`demo/app.js`**, **`demo/index.html`**, **`scripts/validate.py`** — header comment, title, success message.
- **`docs/*.md`**, **`README.md`**, **`Cargo.toml`**, **`packages/brand-registry/README.md`** — all `ViUsagever` → `UsageHalo` references in prose.
- **`tests/test_registry.py`** — fix the stale `assert "neutral monogram placeholders" in text` against the new `docs/12_BRAND_ASSETS.md` phrasing (will become "UsageHalo-owned usage ring" / "monogram placeholders" / equivalent).
- **`tests/test_showcase.py`** — extend with: (a) one-time import test (start prototype, verify a seeded `~/.viusagever/inbox/claude-code.jsonl` is migrated to `~/.usagehalo/inbox/` on first request); (b) per-day determinism (calling `/api/snapshot` twice on the same day yields identical numbers; calling on different days yields different numbers); (c) Svelte proxy smoke (boot Vite dev server, hit `/api/snapshot`, expect 24 providers — only runnable when Svelte deps are installed, marked as a test for completeness, gracefully skipped when the dev server is unavailable).

### Interfaces / contracts

- **`/api/snapshot`** (prototype) — shape extended. New fields:
  - `sample_data: true` (boolean, always true; honest about provenance).
  - `day_utc: "2026-09-03"` (the date the snapshot was generated for; lets the UI show "as of …" and lets the test assert per-day determinism).
  - `data_basis: "registry+per-day-deterministic"` (a small human-readable label).
  - `providers[]` — same shape as today, but `primaryPercent`, `secondaryPercent`, `tokensToday`, `costToday` now derived from `(provider_id, day_utc)`.
  - `models[]` — same shape, billing-owner invariant preserved.
- **`/api/snapshot/legacy-import`** (prototype) — new one-shot endpoint. On first call, if `~/.viusagever/inbox/claude-code.jsonl` exists and `~/.usagehalo/inbox/` is empty, copy the file, then return `{migrated: true, count: N}`. Idempotent. Idempotency is the rollback safety.
- **Tauri `snapshot` command** — same shape as `/api/snapshot`. Forwards the prototype's body when the prototype is reachable, or returns a clearly-labeled "unavailable" payload otherwise. (This is a source-correct stub — not runnable here.)
- **`apps/desktop-ui/src/lib/api.ts`** — exports `Snapshot` type and `fetchSnapshot()`. TypeScript types are derived from the prototype's response shape (we will generate them with a small comment block, no codegen).
- **No changes to** `crates/viusage-core` types, `crates/viusage-reconcile`, `crates/viusage-storage` schema, `crates/viusage-storage/migrations/0001_init.sql`, or the `UsageConnector` trait. Backward compatible at the Rust domain level.

### Data ownership / flow

- The **prototype server** owns the realistic data. The Svelte app and the Tauri shell both consume it.
- The Claude bridge is the only producer; the prototype is the only consumer of the bridge output for the snapshot.
- The Svelte mock layer is retained as a fallback when the live fetch fails. The fallback is gated by a `lib/api.ts` boolean (`USE_LIVE`).

## Failure handling / observability

- The prototype already logs to stdout. Add: a "snapshot generated for UTC day X" line per `/api/snapshot` call (rate-limited to one per minute to avoid log spam).
- The Svelte app's `lib/api.ts` logs to `console.warn` on fetch failure and falls back to the mock layer with a visible "mock" badge in the rail.
- The Claude bridge logs to stderr on parse failure (today) and we keep that.
- No new alerting; the project does not have a metrics surface yet (out of scope).

## Security / authorization

- The change does not touch authentication, authorization, secrets, tenant isolation, or untrusted input parsing. **No security trigger.**
- The legacy-import endpoint reads a file the user controls (`~/.viusagever/inbox/`) and writes to a new file (`~/.usagehalo/inbox/`) with mode `0o700` for the directory and `0o600` for the file. Same permission model as today.
- The new Tauri command `snapshot` returns the prototype's body. The Tauri capability set is unchanged (`core:default`).

## Threat model (required when security/trust boundaries change)

This change does **not** introduce a new trust boundary. The Tauri shell and the browser demo continue to trust the prototype server. The legacy-import endpoint moves a file from one user-owned directory to another; it does not touch the network.

- **Assets / sensitive data:** local files in `~/.viusagever/` (status-line telemetry, sanitized). Same sensitivity in the new path.
- **Trust boundaries:** unchanged. The Claude bridge → prototype → Svelte flow remains.
- **Abuse / misuse cases:** none new. A user with write access to `~/.viusagever/inbox/` already has write access to `~/.usagehalo/inbox/`.
- **Least-privilege controls:** unchanged. The bridge still drops `transcript_path` and `workspace.current_dir`. The privacy guardrail test in `scripts/validate.py:61` still passes.
- **Detection / audit evidence:** the prototype logs a one-time "migrated N records from legacy inbox" line on legacy import. No new audit trail.

## Migration / rollout

This is a single-developer scaffold, not a published product. Migration is by **commit and re-install** on the user's machine. There is no gradual rollout.

- Phase 0: design approval (this document).
- Phase 1: plan approval (`PLAN.md`).
- Phase 2: rename text strings (low-risk, one-way, easily verifiable with a regex search).
- Phase 3: rename identifiers (Tauri bundle id, crate name, package name — these are one-way doors).
- Phase 4: realistic data generator (deterministic, labeled, regression-tested).
- Phase 5: Svelte live-data wiring (Vite proxy + `lib/api.ts` + App.svelte change).
- Phase 6: legacy-import endpoint (one-shot, idempotent).
- Phase 7: Tauri `snapshot` command (source-only).
- Phase 8: fix the broken pages (`tests/test_registry.py` and any others surfaced during execution).
- Phase 9: comprehensive verification (`planonce-review`).
- Phase 10: human ship gate.

## Rollback

- The change is one commit. Rollback = `git revert`. The user's working tree is the only state at risk.
- The legacy-import endpoint is the only stateful change. Rollback: do not run it again, or delete `~/.usagehalo/inbox/`.
- The Tauri bundle identifier rename cannot be silently rolled back on a user machine; the user must reinstall. The user confirmed: zero published users; this is acceptable.
- A regression test (per-day determinism) and the existing privacy guardrail test (sanitization) are the trip-wires that catch a faulty implementation before the human ship gate.

## Costly / one-way decisions

| Decision | Reversibility | Evidence / mitigation | Human gate |
|---|---|---|---|
| Rename Tauri bundle id `dev.viusagever.app` → `dev.usagehalo.app` | One-way on a user machine (re-install required) | Identifiers in 4 files; CI not configured to publish; user confirmed zero published users. | **Yes — design gate** |
| Rename crate `viusagever-desktop` → `usage-halo-desktop` | Reversible (rename ref + revert commit) | Single Cargo.toml; workspace does not publish; no downstream consumers. | Yes — design gate |
| Rename data spool `~/.viusagever/` → `~/.usagehalo/` | One-way for end-user data; mitigated by one-time import | New path is canonical; old path is read on first launch; import is idempotent; safe to remove `~/.viusagever/` after one release. | Yes — design gate |
| Replace mock layer with live fetch in the Svelte app | Reversible (toggle `USE_LIVE = true/false` in `lib/api.ts`) | Mock is retained as a fallback; toggle is a single line; test exercises both. | Yes — design gate |
| Add realistic-data generator in the prototype | Reversible (revert commit) | Generator is deterministic and labeled `sample_data: true`; regression test catches negative numbers; existing Claude fixture path is unchanged. | Yes — design gate |

## Alternatives rejected

- **Keep `viusagever` identifiers, only rename visible strings.** Rejected by the user ("MUST HAVE CHANGE ViUsagever into UsageHalo"). Also leaves the bundle id and the spool path as historical debt.
- **Hand-craft per-provider fixtures.** Rejected as too much maintenance. The per-day deterministic generator covers all 24 with one shape.
- **Wire Svelte app directly to Tauri commands (skip the prototype).** Rejected: requires the Rust toolchain, which is missing on this machine. The Vite proxy to the prototype gives the same user experience in this environment and stays source-correct for Tauri later.
- **Move realistic data into the Rust crate.** Rejected: out of scope, requires Rust to compile and test. The prototype is the right home for it.

## Phase boundaries

Phases are designed so each one has a fresh evidence gate, can be reverted in isolation, and does not depend on later phases.

- **Phase 0 — Design.** *(this document)* Human approval required.
- **Phase 1 — Plan.** `PLAN.md` with execution waves. Human approval required.
- **Phase 2 — Text rename.** Visible strings, log lines, doc prose, file header comments. No identifier changes. Verifier: `node .planonce/work/tmp-scan.cjs` returns `0` matches; `pytest -q` still green.
- **Phase 3 — Identifier rename.** Tauri bundle id, crate/package names, `apps/desktop-ui/src-tauri/tauri.conf.json`. Verifier: same scan, plus Tauri config schema validation (when toolchain available).
- **Phase 4 — Realistic data generator.** `/api/snapshot` emits per-day deterministic numbers. Verifier: new pytest `test_per_day_determinism_and_labeling` + extension of `test_no_negative_dollar_amounts` to all 24 providers.
- **Phase 5 — Svelte live-data wiring.** Vite proxy, `lib/api.ts`, `App.svelte`. Verifier: new pytest `test_svelte_proxy_optional` (skips when Vite dev server not available) + manual eye-check on the Svelte dev server (skipped in this env).
- **Phase 6 — Legacy import endpoint.** One-time migration of `~/.viusagever/inbox/claude-code.jsonl` → `~/.usagehalo/inbox/`. Verifier: new pytest `test_legacy_import_idempotent`.
- **Phase 7 — Tauri snapshot command.** Source-only stub in `src-tauri/src/lib.rs`. Verifier: source review; not compile-verified in this env.
- **Phase 8 — Fix broken pages.** `tests/test_registry.py`, plus any TODO markers that can be closed. Verifier: `pytest -q` and `python scripts/validate.py` both green.
- **Phase 9 — Review and harden.** `planonce-review` and `planonce-security` (mandatory for Large) on the final diff.
- **Phase 10 — Ship.** Human ship gate.

## Human gate

**This is the design gate.** Stop here. Wait for explicit human approval before writing `PLAN.md`.
