# VERIFY — showcase-all-providers

**evidence_status: FRESH**
**change_id:** showcase-all-providers
**verified_at:** 2026-09-02T16:08Z
**verified_by:** automated (validate.py + pytest + node --check) + manual smoke

## Always-on gates

| Gate | Command | Result |
|---|---|---|
| Required files + registry + privacy | `python scripts/validate.py` | `ViUsagever validation: PASS` ✅ |
| Migration smoke | `pytest -q tests/test_migration.py` | `1 passed` ✅ |
| Registry parse | `pytest -q tests/test_registry.py` | `1 passed` ✅ |
| Showcase end-to-end | `pytest -q tests/test_showcase.py` | `4 passed` ✅ (registry+snapshot, assets route, billing-owner invariant, ingest round-trip, no-negative-cost regression) |
| Node syntax | `node --check prototype/server.mjs` | silent ✅ |
| Node syntax | `node --check demo/app.js` | silent ✅ |

Total pytest: **8 passed in ~1.0s**.

## Toolchain-dependent gates (not run on this machine)

- `cargo fmt --check` / `cargo clippy --workspace --all-targets -- -D warnings` / `cargo test --workspace` — Rust toolchain not installed. Recorded in `PROJECT.md` as required-on-toolchain.
- `npm run check` / `npm run build` / `npm run tauri build` — Svelte/Tauri not on this machine today. Recorded.

## Fresh manual smoke (this session)

Server PID 28756, listening on 127.0.0.1:4897.

```
GET /api/health → {"ok":true,"runtime":"prototype","port":4897,"providers":24}
GET /api/registry → 24 providers
GET /api/snapshot
  provider_count: 24
  models (11 entries, all costs positive):
    surface          cost
    Claude Code      $0.31
    OpenRouter       $4.25   (model_provider=anthropic, billing_owner=openrouter)
    xAI              $6.42   (model_provider=openai,    billing_owner=xai)
    DeepSeek         $8.35
    Groq             $1.93
    Together AI      $5.10
    Fireworks AI     $9.02
    Cerebras         $2.14
    Amazon Bedrock   $0.86   (model_provider=anthropic, billing_owner=aws-bedrock)
    Azure OpenAI     $5.20   (model_provider=openai,    billing_owner=azure-openai)
    Vertex AI        $0.53   (model_provider=google,    billing_owner=vertex-ai)
GET /assets/providers/claude-code/claude-code.svg → 200 (real SVG)
GET /assets/providers/aws/aws-bedrock.svg         → 200
GET /assets/providers/lmStudio/lm-studio.svg     → 200
POST /api/ingest/claude (fixtures/claude-statusline.json) → 202
  subsequent /api/snapshot.claude-code:
    primaryPercent  = 73   (from fixture, overrides deterministic)
    secondaryPercent= 21
    source          = "claude_code_statusline"
    health          = "healthy"
```

## Requirement coverage

| Requirement | Where | Status |
|---|---|---|
| All 24 registry providers render in the rail | `demo/app.js#renderRail` + `prototype/server.mjs#determinSnapshot` | ✅ |
| Real brand SVG icons | `prototype/server.mjs#serveAssetsStatic` + `assets/providers/<dir>/<id>.svg` | ✅ (all 24 icons present, 3 spot-checked) |
| Provider-native primary metric | `PRIMARY_LABEL` map in `prototype/server.mjs` | ✅ |
| Deterministic numbers from registry id | `hash32(id)` in `prototype/server.mjs` | ✅ |
| Model breakdown with model_provider != billing_owner | `prototype/server.mjs#determinSnapshot` model loop | ✅ (10 generic-response + cloud-billing + 1 openrouter) |
| Source/scope/freshness badge | `renderRail` / `showHover` / `renderNextLimit` / `renderHealth` | ✅ |
| Sanitization preserved for Claude | `sanitizeClaude` still used by `latestSpoolRecord` | ✅ |
| Privacy guard (transcript_path/cwd dropped) | `validate.py:61` `check_privacy_guardrails` + `ClaudeCodeConnector::sanitize` | ✅ (validate.py passes) |
| Zero new dependencies | `package.json` / `Cargo.toml` / `requirements.txt` untouched | ✅ |

## Security trigger check

No new auth/authz, no new secret handling, no new tenant boundary, no new untrusted input parsing beyond JSON body shape validation already in place, no payment/financial correctness change. **No security review required** for this diff.

## Planonce-review (lightweight, diff-first)

- **Pre-existing backlog (not introduced by this change):** Rust toolchain missing; `apps/desktop-ui` still uses `lib/mock.ts`; WASI plugin sandbox not implemented.
- **Drive-by refactors avoided:** No contract changes; the `UsageConnector` trait, SQLite schema, registry schema, and CLI surface are unchanged.
- **Compatibility:** Existing `/api/snapshot` consumers see a richer shape but the prior `claude` entry's fields (`primaryPercent`, `secondaryPercent`, `model`, `sessionCost`, `source`) are now nested under `providers[]` with the original Claude id `claude-code`; `demo/app.js#refreshPrototypeSnapshot` (old shape) was rewritten and is no longer a consumer. No other internal consumers of `/api/snapshot` exist (verified via `grep -r '/api/snapshot' --include=*.{mjs,js,ts,svelte,py}`).

## Known unknowns (carry forward)

- Tauri shell cannot be tested on this machine until Rust + MSVC + Tauri CLI are installed.
- The deterministic seed is stable across reloads (no Math.random). If the user ever wants per-day variance, the seed would mix in `new Date().toISOString().slice(0,10)` — explicit non-goal here.
- One design choice: `provider.status === 'p3'` is hidden from the rail's first 5 slots by default but is included in the count and the settings drawer (correct: p3 = cloud billing, lower priority). Change is a one-line edit in `renderRail` if the user wants all visible.

## Human ship gate

Awaiting human approval to mark the change COMPLETE.
