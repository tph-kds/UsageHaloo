---
schema: planonce.context/v1
change_id: rename-and-complete
workflow: BROWN-LARGE
baseline_revision: unavailable
created_at: 2026-09-03T10:00Z
---
# Change Context — Rename to UsageHalo + Realistic Data + Broken-Page Fixes

- Change: Global product rename `ViUsagever` → `UsageHalo` (and `viusagever` → `usagehalo` / `usage-halo`), make prototype snapshot data realistic per provider, and fix every "not working" surface in the demo and the Svelte app.
- Workflow: BROWN — LARGE
- Status: NOT_STARTED

## Repository evidence

### Current state of the rename surface (27 files, 60+ occurrences)
- Brand strings in code/config: `ViUsagever` in `README.md`, `Cargo.toml` (workspace.repository), `apps/desktop-ui/src-tauri/Cargo.toml` (crate + lib name), `apps/desktop-ui/src-tauri/tauri.conf.json` (productName, window title, **bundle identifier `dev.viusagever.app`**), `apps/desktop-ui/src-tauri/capabilities/default.json` (description), `apps/desktop-ui/src-tauri/src/main.rs` (lib call) + `src/lib.rs` (panic message), `apps/desktop-ui/package.json` (name), `apps/desktop-ui/src/App.svelte` (H1 + eyebrow), `apps/desktop-ui/index.html` (title).
- Prototype + demo: `prototype/server.mjs` (banner, log line), `prototype/README.md`, `demo/index.html` (title, H1), `demo/app.js` (header comment), `scripts/validate.py` (success message).
- Claude bridge: `connectors/claude-code/scripts/viusage-claude-bridge.mjs` (filename itself, log prefix, header comment).
- Documentation: 11 docs in `docs/` reference `ViUsagever` in prose.

### "Not working" surfaces (verified)
1. **Svelte app consumes only `lib/mock.ts`.** `apps/desktop-ui/src/App.svelte:1` imports `from './lib/mock'`; none of the four components (`EdgeRail`, `ProviderPopover`, `Heatmap`, `UsageRing`) call `fetch(` or `@tauri-apps/api/core::invoke`. The Svelte app has no live data path.
2. **`tests/test_registry.py` has a placeholder docstring intent** — the test that asserts `assert "neutral monogram placeholders" in text` reads against a now-obsolete phrase in `docs/12_BRAND_ASSETS.md`. The brand spec was updated; the test was not.
3. **Tauri shell cannot run on this machine** (no Rust toolchain, no MSVC linker, no Tauri CLI) — see `.planonce/PROJECT.md`. Out of scope for "fix it" but the Svelte app must be wired to data we *can* serve in this environment.
4. **Prototype snapshot uses hashed fake data** (`primaryPercent` 20–80% from `hash32(id)`, `costToday` `hash32(id)>>>4 % 1200 / 100`). The user explicitly asked for "realistic displayment instead of only fake data". The fixture-driven Claude path is the only "real" value.
5. **Brand manifest ids** in `packages/brand-registry/providers.json` use `viusagever-style` casing only in one place (`viusagever` in repository URLs and Tauri identifier). All provider ids are short and unaffected.
6. **No test for the Svelte app at all.** The repo only has Rust unit tests + Python tests.

### Analogous code
- The prototype already has a working registry-driven snapshot generator and `/assets/*` static route (added in the prior `showcase-all-providers` change, now `COMPLETE` candidate). The realistic-data model can extend that generator rather than rewrite it.
- The Svelte app's `lib/mock.ts` already encodes the *shape* expected by the components (ProviderView type, SummaryMetric). The realistic-data target is the *same shape* — only the source changes.
- `crates/viusage-core/src/lib.rs:205` `UsageConnector` trait and the prototype's existing Claude fixture are the only "real" data sources today; realistic-but-synthetic data must be clearly labeled as such (per `.planonce/standards/freshness-and-polling.md`).

### Compatibility constraints observed
- Tauri bundle identifier is a **public** identifier on macOS/Windows/Linux; renaming it forces a re-install (acceptable for this scaffold; not a published product yet).
- Spool path `~/.viusagever/inbox/...` is a local filesystem path; existing users (none in CI, none published) would lose history. Acceptable to rename in this scaffold; should be aliased for one release as a courtesy.
- The Tauri command `runtime_info` returns `version: env!("CARGO_PKG_VERSION")` and `architecture: "local-first"` — purely cosmetic but referenced by the Svelte app's data model.
- The `apps/desktop-ui/src-tauri/src/lib.rs` has only two commands: `runtime_info` and `demo_provider_snapshot`. The Svelte app does not currently invoke either, so the live-data wiring is greenfield on the Svelte side.

## Selected standards

- `.planonce/standards/provenance-and-metrics.md` — every visible number must carry provenance + MetricKind.
- `.planonce/standards/billing-owner-invariant.md` — model_provider != billing_owner for all router providers.
- `.planonce/standards/freshness-and-polling.md` — freshness badge must reflect registry `freshness`; "0 usage" must be visually distinct from "no data".
- `.planonce/standards/connector-contract.md` — every connector must implement `UsageConnector` (already enforced in Rust; Svelte app must not bypass it).
- `.planonce/standards/security-and-privacy.md` — no secret values, no transcript/response bodies in any UI path. Applies to fixture content too.
- `.planonce/standards/verification-gates.md` — always-on Python gates are the canonical evidence; cargo/npm gates are recorded as required-on-toolchain.
- `.planonce/standards/ui-mock-vs-live.md` — Svelte UI must read reconciled projections, mock layer must be marked as such.
- `.planonce/standards/storage-immutable-inserts.md` — the prototype's snapshot may NOT bypass `INSERT OR IGNORE` semantics; but the prototype is not SQLite-backed today (it serves a synthetic snapshot), so the schema rule is forward-looking.

## Requirements

- **R1.** Global product rename to **UsageHalo**: every file, identifier, log line, doc prose, and brand string in this repository must read `UsageHalo` / `usagehalo` / `usage-halo` consistently.
- **R2.** Realistic per-provider data in `/api/snapshot`: numbers must follow each provider's documented metric shape, follow a per-day deterministic-but-credible generator keyed by `(provider_id, utc_date)`, and be **labeled as illustrative** in the UI (e.g. a small "Sample data" badge) so the user is not misled.
- **R3.** The Svelte app (`apps/desktop-ui`) must be wired to a live data path, with the mock layer retained only behind a clear "use mock" toggle. The wire target must work **in this environment** (no Rust required): the prototype server at `127.0.0.1:4897` is the canonical source. The Svelte dev server proxy / Vite config must point at it.
- **R4.** Fix the "not working" pages the user identified: Svelte app live data wiring; `tests/test_registry.py` placeholder assertion; any TODO markers in `apps/desktop-ui/src-tauri/src/lib.rs` that can be closed without Rust (e.g. by leaving a clear `setup` comment with the documented Tauri 2 hook for future work).
- **R5.** The realistic-data generator must respect the registry's `primaryMetric`, `freshness`, and `scope` per provider and must not invent per-provider hand data; one uniform deterministic generator covers all 24 entries.
- **R6.** The realistic-data generator must produce non-negative costs and tokens, and the test must catch any signed-shift regression (regression test already exists in `tests/test_showcase.py::test_no_negative_dollar_amounts`).
- **R7.** The "Next limit" panel and the "Today's model activity" table in `demo/app.js` must use the new realistic data and must keep the `model_provider != billing_owner` separation visible (billing-owner invariant).
- **R8.** The Svelte app's live-data fetcher must not change the public Tauri command surface; the new Tauri commands (if any) must follow `.planonce/standards/connector-contract.md`.
- **R9.** All existing tests (`python -m pytest -q` → currently 8 passed) must still pass after the change.
- **R10.** All always-on Python gates (`python scripts/validate.py`) must pass after the change.

## Non-goals

- **NG1.** No actual Tauri build or run on this machine. The Rust toolchain is missing; this change is a source-only edit. The Tauri app will not be runnable here, but the wiring must be source-correct.
- **NG2.** No new third-party dependencies. The prototype stays zero-dep Node. The Svelte app uses `@tauri-apps/api` only for the contract surface; the browser-mode wiring uses native `fetch`.
- **NG3.** No schema changes to `crates/viusage-storage/migrations/0001_init.sql`. Storage is forward-only; this change does not introduce persistence.
- **NG4.** No actual provider API calls. The realistic data is synthetic and labeled; we are not making live network requests to OpenAI/Anthropic/etc.
- **NG5.** No changes to the existing `validate.py` test that asserts privacy guardrails (`transcript_path:` not in clean section) — that test stays.
- **NG6.** No connector implementation work. `connectors/*` stay scaffolded; this change is not a connector-port project.

## Constraints / assumptions

- **Constraint:** PowerShell blocks `npm.ps1`/`npx.ps1`; Rust/MSVC/Tauri CLI are missing. Anything that needs a `cargo build` or `npm run tauri dev` cannot be executed here. The Svelte app's `npm run check` and `npm run build` will also be unrunnable; recorded as required-on-toolchain.
- **Constraint:** All edits to `apps/desktop-ui/src-tauri/src/lib.rs` must be source-correct, not compile-verified.
- **Assumption requiring confirmation:** the user wants the **Svelte app** to be the primary "running" surface, with the **demo** as a parallel browser surface. If the user only wants the **demo** to be live, the Svelte app's live-data wiring is unnecessary.
- **Assumption requiring confirmation:** legacy alias for the Tauri bundle id and the spool path. Options: (a) hard-rename everywhere, (b) keep `dev.viusagever.app` as an alias for one release, (c) keep both ids and read from either path.
- **Assumption requiring confirmation:** "realistic" means "looks credible and follows each provider's metric shape", not "matches the Claude fixture exactly". The Claude fixture is the highest-fidelity source; everything else is synthesized from registry + date.
- **Assumption requiring confirmation:** the Svelte app's `lib/mock.ts` may be **kept as a fallback** when the live fetch fails, with a clear "mock" badge.

## Risk flags

- **Security/authorization:** none. The change does not touch auth, secrets, network policy, or untrusted input boundaries.
- **Public contract:** the Tauri **bundle identifier** changes (`dev.viusagever.app` → something new). This is a public identifier on macOS (Info.plist `CFBundleIdentifier`), Windows (AppUserModelID), and Linux (.desktop file). Re-install required. **One-way door.**
- **Public contract:** the Tauri `productName` changes. Visible in the OS taskbar / window title. **One-way door.**
- **Public contract:** the local data spool path `~/.viusagever/inbox/...` changes. Existing users (zero today) lose history. **One-way door with alias option.**
- **Data migration / data loss:** none for the demo/prototype (regenerable); potential for end-user Tauri shell data (one directory rename; alias recommended).
- **One-way door:** the bundle identifier rename and the spool-path rename are individually small but combined with the global text rename they form a one-way door for the user-facing identity. The rollback strategy is "revert the commit and re-install".
- **Drive-by refactor risk:** high — the change touches 27 files. The Brownfield guardrail forbids unrelated legacy cleanup; the diff must be scoped to the rename + realistic data + the listed broken pages.

## Micro-plan (Small only)

Not applicable — this is BROWN-LARGE. The micro-plan is replaced by `DESIGN.md` + `PLAN.md`.
