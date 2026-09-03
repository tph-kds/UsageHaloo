# Project

## Purpose
- Product/project goal: ViUsagever — ambient, local-first AI usage observability across coding agents, model providers, and subscriptions. Show the freshest trustworthy usage data each provider exposes (quota windows, tokens, cost, credits, context pressure, activity, forecasts) with full provenance, never hiding when a value is delayed or estimated.
- Greenfield or Brownfield: **Brownfield — scaffold alpha**. Rust workspace + Svelte/Tauri shell + connector stubs + SQLite migration + docs already present; connectors vary from implemented scaffold (Claude Code, Codex, Gemini CLI, OpenAI, OpenRouter) to planned (Cursor, Z.ai, Copilot, etc.) per `SOURCE_STATUS.md`.

## Stack
- Runtime/language: Rust 2021 edition (workspace resolver 2), Node 22, Python 3.11, TypeScript 5.8, Svelte 5
- Frameworks: Tokio (async), reqwest (rustls-tls), sqlx (SQLite + chrono/uuid/migrate), Tauri 2, Svelte + Vite 7, svelte-check 4
- Data stores: SQLite (WAL, foreign_keys ON) — see `crates/viusage-storage/migrations/0001_init.sql`; secrets never in DB (OS keychain alias only)
- Deployment: Tauri desktop (Windows 11 / macOS / Linux) via `apps/desktop-ui/src-tauri`; zero-dep web demo (`demo/`) and prototype server (`prototype/server.mjs`)

## Architecture boundaries
- Boundary: `crates/viusage-core` defines stable domain contracts (MetricKind, SourceAuthority/Scope/Freshness, TokenUsage, UsageEvent, QuotaWindow, connector traits). No business logic there. — `crates/viusage-core/src/lib.rs:1`
- Boundary: `crates/viusage-reconcile` authority-selects only on explicit reconciliation_key/request_id; never aggressively merges unkeyed events. Detail merge preserves local token dimensions + provider billing cost. — `crates/viusage-reconcile/src/lib.rs:4`
- Boundary: `crates/viusage-storage` owns SQLite schema and `INSERT OR IGNORE` persistence; migrations via `sqlx::migrate!`. No secrets, no transcript bodies. — `crates/viusage-storage/src/lib.rs:19`, `migrations/0001_init.sql:1`
- Boundary: `connectors/*` each isolated behind `UsageConnector` trait (`id`, `capabilities`, `snapshot`, `health`). Sanitization before persistence (Claude bridge drops transcript_path/cwd). — `docs/05_CONNECTOR_SPEC.md:5`, `connectors/claude-code/src/lib.rs:21`
- Boundary: `apps/desktop-ui` is Tauri frontend (Svelte 5 + `$state` runes, Vite on port 1420). UI reads reconciled projections only, never queries SQLite directly. — `apps/desktop-ui/src-tauri/tauri.conf.json:1`, `docs/03_ARCHITECTURE.md:92`
- Invariant: **Provider != billing owner** — a model routed through Cursor is Cursor-billed. `UsageEvent.billing_owner` and `model_provider` are independent. — `README.md:120`, `crates/viusage-core/src/lib.rs:115`
- Invariant: **Never normalize into fake percentage** — quotas, tokens, credits, cost, context pressure are distinct MetricKind values. — `README.md:121`
- Invariant: **Raw immutable; UI reads reconciled** — raw observations append-only; rollups/forecasts/alerts derive from reconciled projections. — `docs/03_ARCHITECTURE.md:62`
- Invariant: **No secret keys in SQLite** — persist `secret_alias` only; credentials via Credential Manager / Keychain / Secret Service. — `docs/09_SECURITY_PRIVACY.md:11`

## Verification commands
- Targeted tests: `python -m pytest -q -k test_migration`  — migration smoke (no cargo needed)
- Full tests: `python scripts/validate.py`  — required-files + registry (now reads `assets/providers/icon-manifest.json` for the id→(dir, stem) map and checks default + light + dark SVGs per provider) + fixtures + migration + privacy guardrails. **Now passing** in this environment.
- Full tests: `python -m pytest -q`  — runs `tests/test_migration.py` + `tests/test_registry.py`
- Full tests (Rust, requires toolchain): `cargo test --workspace`  — domain + reconcile + connector unit tests
- Lint/format: `cargo fmt --check`  (requires Rust)
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`  (requires Rust)
- Typecheck: `npm run check`  — `svelte-check` in `apps/desktop-ui` (`apps/desktop-ui/package.json:9`)
- Build: `npm run build`  — Vite build in `apps/desktop-ui` (`apps/desktop-ui/package.json:8`)
- Build: `npm run tauri build`  — per-OS desktop bundle (requires Rust + Tauri prerequisites)
- Syntax gate: `node --check demo/app.js && node --check connectors/claude-code/scripts/viusage-claude-bridge.mjs && node --check prototype/server.mjs`
- Prototype smoke: `node prototype/server.mjs` then `curl http://127.0.0.1:4897/api/health` + `/api/snapshot` (see `VERIFICATION.md:14`)

> Note: This environment has Python 3.11.7 + pytest 9.0.3 + Node 22.17.1 verified; `cargo`/`rustc` not on PATH and PowerShell execution policy blocks `npm.ps1`/`npx.ps1` — use `npm.cmd` or `node` directly, or `Set-ExecutionPolicy -Scope Process Bypass`.

## Definition of Done
- [ ] Required behavior verified (provenance + billing_owner distinction preserved; no secret persistence)
- [ ] No unintended contract break (UsageConnector trait, viusage-core types, SQLite schema forward-compatible)
- [ ] Required deterministic checks pass (`scripts/validate.py` + `pytest -q`; `cargo test`/`clippy`/`fmt` when toolchain present; `npm run check` for UI)
- [ ] Privacy guard preserved (bridge/connector still drops transcript_path/cwd/prompts by default; `validate.py:61` assertion holds)
- [ ] Evidence recorded (test/migration output, fixture parse, demo/bridge syntax check)
- [ ] Human ship approval

## Known unknowns / pre-existing repo gaps
- ~~`assets/providers/*.svg` are absent~~ — corrected: assets are present in a nested layout `assets/providers/<dir>/<base_stem>.svg` plus `-light`/`-dark` variants, declared in `assets/providers/icon-manifest.json`. The earlier "missing icon" failure in `scripts/validate.py:44` was a validator bug (it looked for the flat path), not a missing asset. Fixed by reading the manifest and mapping registry id → `(dir, base_stem)` (e.g. registry `openai-api` → dir `openai`, stem `openai-api`; registry `aws-bedrock` → dir `aws`, stem `aws-bedrock`).
- `cargo` / `rustc` are not on PATH in this environment; Rust gates (fmt/clippy/test/tauri build) are recorded as required-on-toolchain.
- PowerShell execution policy blocks `npm.ps1` / `npx.ps1`; use `npm.cmd` or call `node` directly for the Svelte gates.
- `apps/desktop-ui` currently consumes `lib/mock.ts`; no live Tauri command wiring yet — leave as a planned gap, not a standard.
- Neither `demo/app.js` nor the Svelte `mock.ts` currently reference `assets/providers/*`; the validator is the only consumer of the asset layout, so the fix is contained.

## Provider capabilities
- Ask human: available (question tool / chat) — used for standards confirmation
- Read/write: available (file tools, .planonce created)
- Run command: partial — `python`, `node`, `pytest` verified; `cargo` unavailable; `npm`/`npx` blocked by ExecutionPolicy (fallback: `npm.cmd`, `node --check`)
- Fresh worker (optional): not assumed — executed sequentially; use `STATE.md` handoff if future provider adds isolation
- Isolated workspace (optional): not available — stay in current worktree, keep diffs bounded, never weaken verification
- Fallback notes: Follow `references/PROVIDER_GUIDANCE.md` fallback rules — no slash commands; sequential waves; conversational approvals; no weakening of gates due to missing cargo/npm isolation
