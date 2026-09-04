---
schema: planonce.context/v1
change_id: realism-hardening-webapp-desktop
workflow: BROWN-LARGE
baseline_revision: c4b6a83e15ef62c27eaf38b07671b4c75c210c9c
created_at: 2026-09-04
---
# Change Context

- Change: realism-hardening-webapp-desktop — make webapp (demo + prototype server) and desktop (Windows Tauri + Svelte) showcase accurate, realistic, provenance-honest results; eliminate fake/mock numbers presented as real.
- Workflow: BROWN-LARGE
- Status: DISCOVERY

## Repository evidence
- Existing/current behavior:
  - Browser/dev path `prototype/server.mjs:215-321 determinSnapshot` generates per-provider `primaryPercent` via `hash32(id:dayUtc)%61` + `realisticPrimary/Cost/Tokens`, always `sample_data:true` (`:316`), only 4 honest overlays (openrouter/ollama/lm-studio/claude-spool in `snapshotWithLive:328-399`). All 24 registry providers render regardless.
  - Tauri path `apps/desktop-ui/src-tauri/src/lib.rs:142-196 snapshot` reads real `~/.usagehalo/store/usage_events.jsonl` but returns `providers:[]` hardcoded; UI then shows empty + mock fallback via `apps/desktop-ui/src/lib/api.ts:69-107`.
  - Svelte `App.svelte:110` forecast `~N min` linear guess; `:143` budgets `$12.47/$20.00 62%` hardcoded; `:145` alerts static; models page static; `Heatmap.svelte:3-8` synthetic `sin/hash` grid; `api.ts:128-131` summaries fabricate `requests=len*4`, `~$0.00 estimated`, `—` active time; `mock.ts:3-16` 5-provider fixture.
  - Demo `demo/app.js:54-56,72-76` invents `200K tokens` denominator, `Aug 20-27` dates; `:90-98` totals `58%/1.24M/2.15M/$12.47/1429`; `:104-124` hash heatmap + static budget bars; `:125-141` `MODEL_ROWS` + `ALERTS` static; `:540-543 server.mjs /api/widget` hardcoded `58%/$12.47/5d12h`; `:525-526` forecast burn/spend arrays hardcoded.
  - Collectors normalizers + bridges are real where wired: `collectors/local.mjs`, `pollers.mjs` (openrouter/openai/cursor/copilot/mistral), `providers.mjs`, `codex-app-server.mjs`, `gemini-otlp.mjs`, `daemon.mjs tickOnce`, `snapshot.mjs buildProviderRows` (overlay only if `live==true`), `store/reconcile/forecast/alerts`. Rust core/reconcile/storage/scheduler/secrets/forecast honest-by-design (no invented %; see subagent map).
  - Gaps with no live source: anthropic (no poller, instrumented-only), zai/windsurf/litellm/bedrock/azure/vertex (pure stubs), xAI/deepseek/groq/together/fireworks/cerebras (ingest-only), cursor/copilot/mistral/openai without admin keys, codex/gemini/claude when bridge/app-server/OTLP absent (fixture fallback `fixtures/claude-statusline.json 73%/21%` via `server.mjs:70-82`).
  - Tauri `connector_health:201-236` real but unwired; `runtime_info/demo_provider_snapshot` unwired demo stub (`73%`); `setup:269-280` no-op; updater endpoint `https://example.invalid/...` (`tauri.conf.json:63-70`); CSP allows `127.0.0.1:4897`.
- Relevant files/symbols/tests:
  - `prototype/server.mjs`, `collectors/*.mjs`, `demo/app.js`, `demo/index.html`, `demo/widget.html`
  - `apps/desktop-ui/src/App.svelte`, `src/lib/api.ts`, `src/lib/mock.ts`, `src/lib/components/*`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `vite.config.ts`
  - `crates/*`, `connectors/*/src/lib.rs`, `packages/brand-registry/providers.json`, `assets/providers/icon-manifest.json`
  - `tests/test_realistic_data.py`, `test_showcase.py`, `test_snapshot.py`, `test_daemon.py`, `test_next.py`, `scripts/validate.py`, `VERIFICATION.md`, `SOURCE_STATUS.md`
- Analogous implementation:
  - `collectors/snapshot.mjs:15-69 buildProviderRows` — correct pattern: registry + events + live + detected, overlay only when `live==true`, else `primaryPercent=null`. Prototype `server.mjs` and Tauri `lib.rs snapshot` should converge to this.
  - `collectors/scheduler.mjs:21-33` honesty cap + `usage-halo-scheduler freshness_state` — reuse for all freshness labels instead of hardcoded `live/fresh`.
  - `connectors/openrouter credits_quota None%` + `claude-code no token events` + `forecast suppressed` — anti-fake guards to replicate in UI layer.

## Selected standards
- Standard: Honest-metrics invariant (README: provider!=billing owner; never normalize to fake %; raw immutable; stale visible; no secrets in SQLite; opt-in instrumentation; no cookie scrape; telemetry-only ingest)
- Standard: Connector contract `docs/05_CONNECTOR_SPEC.md` + freshness/reconciliation `docs/06_REALTIME_AND_RECONCILIATION.md` + product surface `docs/01_PRODUCT_SPEC.md`
- Standard: Rust fmt/clippy/test, `svelte-check` 0 errors, `vite build`, `pytest` + `validate.py` PASS, privacy audit clean

## Requirements
- R1: Webapp + desktop showcase only provider-reported / locally-observed / reconciled values with provenance (source, scope, freshness, authority); never present deterministic-hash percentages as real.
- R2: Unconfigured / no-data providers render as explicit Unknown/Unconfigured/Sample states, not fake bars; `sample_data` flag honored end-to-end.
- R3: Tauri `snapshot` projects real provider rows (registry + file-store + health + secret presence), not `providers:[]`; wire `connector_health` into UI; remove unwired demo stub from production path.
- R4: Remove hardcoded UI numbers (budgets $12.47, alerts, MODEL_ROWS, 200K denominator, heatmap hash, widget 58%, forecast burn arrays) or rebind them to real store/rollups with suppressed-when-sparse behavior.
- R5: Prototype deterministic generator kept only behind explicit demo/sample mode (e.g. `?demo=1` or `sample_data:true` banner), default snapshot = honest empty + live overlays.
- R6: Windows desktop runs correctly (`npm run check`, `vite build`, `cargo check/test`, daemon `--once`, prototype smoke, Tauri dev/build where toolchain present); verification evidence fresh and revision-bound.
- R7: Direction alignment with original aim (local-first, ambient rail, freshness + reconciliation + privacy) documented; no drive-by refactors.

## Non-goals
- NG1: No new provider account integrations beyond existing pollers/bridges (no cookie scraping, no forced proxy, no transcript collection).
- NG2: No macOS/Linux packaging/signing in this change (Windows-first; CI release.yml stays unrun).
- NG3: No broad legacy rewrite; unrelated UI restyle out of scope.
- NG4: No live billing proof against paid accounts (opt-in smoke only, keys never committed).

## Constraints / assumptions
- Constraint: Clean tree baseline `c4b6a83` on `main`; preserve user changes; bounded diffs.
- Constraint: `cargo`/`npm` availability varies; record honestly what ran vs toolchain-missing.
- Constraint: Secrets via env/keychain alias only; fixtures stay anonymized.
- Assumption requiring confirmation: User wants default snapshot honest-empty (with explicit sample/demo toggle) rather than keeping deterministic fake as default. Default proposed: honest-empty.
- Assumption requiring confirmation: Desktop may depend on prototype sidecar (`127.0.0.1:4897`) short-term vs full Rust projection port. Proposed: port `buildProviderRows` semantics into Tauri `snapshot` (registry + store + health), keep sidecar as dev fallback.

## Risk flags
- Security/authorization: pollers use env keys; keychain alias-only; ingest strips prompts; updater endpoint placeholder must not ship as real.
- Public contract: `UsageConnector` trait, SQLite schema, `/api/snapshot` shape, Tauri `snapshot`/`connector_health` commands — forward-compatible only.
- Data migration/data loss: file-store `INSERT OR IGNORE` + prune; `~/.viusagever` legacy import idempotent; no raw mutation.
- One-way door: changing default snapshot from deterministic-fake to honest-empty alters demo/tests (`test_realistic_data.py` asserts determinism). Requires human gate + test updates. Also Tauri `providers:[]` → real rows changes UI contract. Both flagged as one-way.
