# Local Testing Guide — UsageHalo

Step-by-step instructions for running every UsageHalo surface locally during the
testing phase: web prototype, desktop UI, Tauri shell, collectors/daemon, and
the full verification suite. All commands assume the repository root
(`H:\SideProjects\UsageHaloo`) unless stated otherwise.

> Windows PowerShell note: execution policy may block `npm.ps1`/`npx.ps1`.
> Use `npm.cmd` (as in the examples below) or run
> `Set-ExecutionPolicy -Scope Process Bypass` first.

## 0. Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Node.js | 22 | `node --version` |
| Python | 3.11 + pytest | `python --version`, `python -m pytest --version` |
| Rust | 1.98.1 (`cargo`, `rustc`) | `cargo --version` (desktop shell only) |
| Tauri prerequisites | WebView2 (preinstalled on Win11) | `npm.cmd run tauri -- --version` in `apps/desktop-ui` |

No `npm install` has been run at the repo root — frontend dependencies live in
`apps/desktop-ui`. The prototype, demo, and collectors are **zero-dependency**
(plain Node + Python stdlib).

## 1. Web prototype + demo UI (fastest end-to-end)

Starts the Node sidecar (port `4897` by default, override with
`VIUSAGEVER_PORT`) and serves the demo webapp with live snapshot APIs.

```powershell
node prototype/server.mjs
# UsageHalo prototype: http://127.0.0.1:4897
```

Open `http://127.0.0.1:4897` in a browser. What to check:

- **Honest default:** providers with no live source show `—` / `No observed usage yet`
  with `Sample` provenance — never invented percentages.
- **Demo mode:** append `?demo=1` to snapshot-driven views (or set
  `SAMPLE_MODE=1`) for the deterministic sample rail.
- **Key API routes** (all should return HTTP 200):
  - `GET /api/health`, `/api/snapshot`, `/api/snapshot?demo=1`
  - `GET /api/detected`, `/api/registry`, `/api/rollups`
  - `GET /api/forecast`, `/api/alerts`, `/api/widget`
  - `GET /api/daemon`, `/api/snapshot-cache`, `/api/codex/live`

Static visual-only demo (no server at all):

```powershell
cd demo
python -m http.server 8080
# open http://localhost:8080
```

## 2. Desktop UI in a browser (Svelte dev server)

Runs the real Svelte app against the prototype sidecar (Vite proxies
`/api` → `127.0.0.1:4897`, dev port `1420`).

```powershell
cd apps/desktop-ui
npm.cmd install   # first time only
npm.cmd run dev   # open http://localhost:1420 (or the printed port)
```

Keep `node prototype/server.mjs` running in a second terminal so the UI gets
live snapshots (`source: browser`). Stop the sidecar to see the honest
empty/mock fallback states.

Typecheck and production bundle:

```powershell
cd apps/desktop-ui
npm.cmd run check   # svelte-check — expect 0 errors, 0 warnings
npm.cmd run build   # vite build — outputs to dist/
```

## 3. Tauri desktop shell (Windows)

### 3a. Dev window (hot-reload)

```powershell
cd apps/desktop-ui
npm.cmd run tauri dev
```

This opens the native window (main + edge rail). Tauri `invoke('snapshot')`
reads the local file store (`~/.usagehalo/store/`); with an empty store the UI
shows honest empty states.

### 3b. Production bundle (unsigned)

```powershell
cd apps/desktop-ui
npm.cmd run tauri build
```

Produces (verified 2026-09-04):

- `target\release\usage-halo-desktop.exe`
- `target\release\bundle\msi\UsageHalo_0.1.0_x64_en-US.msi`
- `target\release\bundle\nsis\UsageHalo_0.1.0_x64-setup.exe`

The final updater-signing step fails without `TAURI_SIGNING_PRIVATE_KEY` —
expected for local testing; signed releases need a public CA cert (see
`.github/workflows/release.yml`).

## 4. Live data wiring (opt-in, per provider)

Honest numbers appear only when a real source is connected. From the repo root:

```powershell
node collectors/local.mjs --json        # what is detected on this machine (no secrets read)
node collectors/daemon.mjs --once       # single poll cycle; honest { live:false } without keys
```

| Provider | Setup for live data |
|---|---|
| Claude Code | Chain the bridge into your statusLine: `node connectors/claude-code/scripts/usage-halo-claude-bridge.mjs` → spool `~/.usagehalo/inbox/claude-code.jsonl` |
| Codex | Sign in to Codex; `GET /api/codex/live` reads `account/rateLimits/read` over stdio |
| Gemini CLI | `GEMINI_CLI_OTEL_EXPORT_ENDPOINT=http://127.0.0.1:4317`, metrics arrive at `POST /v1/metrics` |
| OpenRouter | `OPENROUTER_API_KEY=<management key>` → `GET /api/v1/credits` |
| OpenAI API | `OPENAI_API_KEY=<admin key>` (org scope) |
| Ollama / LM Studio | Run `ollama serve` / LM Studio — zero config, localhost probes |
| Generic OpenAI-compatible | `POST /api/ingest/event` with `{ provider, model, input_tokens, output_tokens }` only — prompts/completions are refused with 400 |
| Cursor / Copilot / Mistral | Admin/org tokens per `collectors/README.md`; without keys the UI shows Unconfigured |

Verify: re-open `/api/snapshot` — connected providers flip to `live:true` with
`provenance.authority` (`provider_billing`, `provider_telemetry`, …).

## 5. Test & verification suite

```powershell
python -m pytest -q            # 41 tests: snapshot/registry/showcase/realistic-data/daemon/privacy/workflows
python scripts/validate.py     # structural gates — expect PASS
python scripts/privacy_audit.py  # scans store+spools for secrets/transcripts — expect clean
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace          # 25 Rust unit tests
```

Release-gate checklist (before any public release): see
`VERIFICATION.md` → “Required gates before a public release”
(fmt, clippy, cargo test, `npm run check`, `npm run build`,
per-OS `tauri build`, fixture contract tests, opt-in live smoke,
signed/notarized verification, per-platform keychain tests, prompt-privacy proof).

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm.ps1 cannot be loaded` | PowerShell execution policy — use `npm.cmd` |
| UI shows all `—` / “No live data yet” | Correct honest-empty behavior — connect a provider (§4) or use `?demo=1` |
| `/api/snapshot-cache` returns `no_cache` | Daemon hasn't ticked — run `node collectors/daemon.mjs --once` |
| Pollers report `no_key` / `needs_admin_api_key` | Expected without keys — never invented numbers |
| `tauri build` fails at signing | Set `TAURI_SIGNING_PRIVATE_KEY`, or ignore for local unsigned testing |
| `cargo` not found | Install the Rust toolchain; Node/Python gates still run without it |

## 7. Suggested test pass (≈15 minutes)

1. `node prototype/server.mjs` → open UI → confirm honest-empty states. [§1]
2. `POST /api/ingest/claude` with `fixtures/claude-statusline.json` → confirm Claude row goes live (73%/21%). [§1]
3. `node collectors/daemon.mjs --once` → confirm honest `live:false` reasons. [§4]
4. `npm.cmd run dev` in `apps/desktop-ui` → confirm Svelte rail matches prototype. [§2]
5. `npm.cmd run tauri dev` → confirm native window + rail. [§3a]
6. Run §5 suite → all green.
