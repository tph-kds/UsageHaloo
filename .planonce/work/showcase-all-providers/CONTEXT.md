# CONTEXT — Showcase all 24 providers in the demo rail

**Change ID:** `showcase-all-providers`
**Scope:** Brownfield small (interactive). Single self-contained diff in `demo/`, `prototype/`, and a tiny validator/test addition. No contract changes. No Rust, no Svelte, no Tauri touched.

## Root-cause evidence

- Current demo rail renders 7 hard-coded providers in `demo/app.js:1`. The repository registry `packages/brand-registry/providers.json` contains 24 providers; the rail shows ~29% of them, with the rest discoverable only in the settings drawer.
- Confirmed at runtime today: `node prototype/server.mjs` exposes only Claude (`/api/snapshot` returns a single provider) — `prototype/server.mjs:64`.
- 24/24 registry entries have SVG icons in `assets/providers/<dir>/<id>.svg` (verified with the manifest mapping; `aws-bedrock`→`aws/`, `openai-api`→`openai/`, `anthropic-api`→`anthropic/`, `azure-openai`→`azure/`, `lm-studio`→`lmStudio/`).
- The demo uses monogram letters today, not the actual brand SVGs — showcase value is low.

## Intended behavior

1. The demo rail renders **every** entry in `packages/brand-registry/providers.json`, using the real SVG icon (default = same as light), the registry's `accent` color, the registry's `monogram` (kept as accessible fallback), the registry's `primaryMetric` label, and a **provider-native primary percent** derived from the registry `status`/`sourceMode`/`freshness` so we can see provider type at a glance.
2. The "Next limit" panel and "Today's model activity" table use the same registry-driven shape (no per-provider hand-rolled data).
3. `/api/snapshot` returns a snapshot that the rail can consume: one entry per provider with the same shape, plus a "model breakdown" sub-array that distinguishes `model_provider` from `billing_owner` (exercising the billing-owner invariant from `.planonce/standards/billing-owner-invariant.md`).
4. Hover card shows: primary metric, secondary metric, source, freshness, scope, and a 3-row "model activity" sub-table when the provider's connector is `generic-response` / `cloud-billing` / `official_api` (so the `model_provider` vs `billing_owner` separation is visible).
5. The settings drawer renders all 24 with the same shape.

## Non-goals

- No Rust/Tauri changes. No Svelte changes. The desktop app is out of scope for this change.
- No new fixture files. Snapshots are generated deterministically from the registry, not hand-authored per provider.
- No new dependencies (zero-dependency constraint in `prototype/README.md:1` preserved).
- No changes to `crates/*`, `connectors/*`, `apps/desktop-ui/*`, `fixtures/*`, or migration files.

## Files

- `prototype/server.mjs` — replace hard-coded Claude-only snapshot with a registry-driven snapshot generator; reuse the existing Claude fixture as a "live" override for the `claude-code` provider; expose `/api/registry` (already implicit) as a JSON document of the full provider list for the client. **Add a new static route `/assets/*` that serves the `assets/providers/<dir>/<id>.svg` icons** (user-confirmed: real SVGs over inline symbols or monograms). Keep zero dependencies.
- `demo/app.js` — replace the hard-coded `providers` constant with a fetch-from-`/api/snapshot` pipeline; render the rail, settings drawer, next-limit panel, model activity table, and health list from that single source. **All per-provider numbers are registry-driven and deterministic** (user-confirmed: hash-based seed from registry id); no hand-crafted values per provider. Keep zero dependencies.
- `demo/index.html` — no structural change; current markup already supports the new shape.
- `demo/styles.css` — add two small rules: a `.bubble-icon img` rule for the SVG, and a `.health-state.degraded/.stale/.manual` color set driven by `data-state`.
- `tests/test_showcase.py` — new tiny pytest: parses `packages/brand-registry/providers.json`, asserts every entry produces a `bubble` DOM via the prototype's `/api/snapshot` over a real fetch on `127.0.0.1:4897`, and asserts the snapshot contains a `models` field where `model_provider != billing_owner` for at least the `generic-response` group.

## Regression coverage

- `python scripts/validate.py` (always-on) — must still pass; the registry and asset path logic is unchanged.
- `python -m pytest -q` — must include the new test and stay green.
- `node --check demo/app.js` and `node prototype/server.mjs` smoke (start, hit `/api/health` and `/api/snapshot`, then stop) — recorded in `VERIFY.md`.
- Manual eye-check: open `http://127.0.0.1:4897`, every registry provider must show in the rail or in the `+N` overflow button.

## Verification (preliminary)

- Always-on gates re-run; expect `python -m pytest -q` reports ≥4 passed (3 existing + 1 new).
- Fresh prototype boot + `/api/snapshot` curl: must list all 24 providers.
- A new section in `VERIFY.md` records the snapshot JSON and the rail DOM count.

## Risks / known unknowns

- Some connectors (e.g. `cursor`, `windsurf`) intentionally have delayed/enterprise data; we will reflect this with a `stale` or `delayed` health badge rather than a fake zero — keeps the "0 usage ≠ no data" boundary from `.planonce/standards/freshness-and-polling.md`.
- SVG icons live in `assets/providers/<dir>/<id>.svg`; the demo must request them with a path the prototype can serve. The simplest fix is for the prototype to also serve `/assets/*` from the `assets/` directory, since the demo is already served as static from `demo/`. Confirm with the user before adding a new static route.
- `provider.primaryMetric` values like `quota_5h`, `credit_usage`, `tokens_today` need a tiny label map. If we cannot agree on labels, fall back to humanized `primaryMetric` strings.

## Human gate

Stop at this micro-plan. Wait for explicit approval before coding.
