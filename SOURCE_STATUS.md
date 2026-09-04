# Source implementation status

This repository intentionally separates **implemented scaffold paths** from **planned connectors** so the codebase does not pretend unsupported scraping is production-ready.

| Area | Status | Notes |
|---|---|---|
| Domain types / connector contract | Implemented scaffold | Typed metrics, provenance, scope, freshness, connector states |
| Reconciliation | Implemented core | Explicit-key authority selection + detail merge |
| SQLite schema | Implemented | Provider accounts, raw events, quotas, health, rollups, alerts |
| Claude Code | Implemented parser + bridge | Sanitized status-line ingest, quota parsing, context snapshot; repeated context snapshots are not sumable token events |
| Codex | Implemented parser/protocol request scaffold | App-server rate-limit parsing; production process handshake/version handling remains runtime work |
| Gemini CLI | Implemented normalization scaffold | OTLP normalized metric -> canonical event; protobuf OTLP receiver remains to implement |
| OpenRouter | Implemented HTTP credits connector scaffold | Official credits endpoint; production keychain/polling runtime remains |
| OpenAI API | Implemented admin HTTP client scaffold | Organization usage/cost retrieval; full pagination/normalization remains |
| Anthropic API | Implemented request-level normalizer | Explicitly instrumented-traffic-only; account/admin connector must use stable authorized API for target plan |
| Cursor | Planned P1 | Official Admin/Analytics/OTel only |
| Z.ai / ZCode | Planned P1 beta | Do not scrape cookies; wait/use stable machine-readable usage source |
| Perplexity | Planned P1 | Response usage instrumentation |
| Mistral / Vibe | Planned P1 | Admin usage for eligible plans |
| GitHub Copilot | Planned P1 | Daily/aggregated usage metrics |
| Windsurf | Planned P2 | Enterprise API according to available plan/cadence |
| xAI / DeepSeek / Groq / Together / Fireworks | Planned P2 | Response instrumentation first |
| Tauri shell | Workspace member, `cargo check` passes | Edge-rail + main windows, tray config; `snapshot` (per-provider store breakdown) + `connector_health` via real crates; capabilities trimmed to wired core permissions; generated icon set |
| Windows packaging | Installed + launched, unsigned | NSIS silent install → app survives 12s with WebView2 → silent uninstall clean; `npm run tauri build` → exe + MSI + NSIS; Authenticode proven with throwaway self-signed cert (release needs public CA); `release.yml` per-OS |
| Release CI | Implemented, unrun | `release.yml` builds Windows/macOS/Linux on tags, drafts GitHub release; needs secrets + runner time |
| OS keychain | Implemented + proven on Windows | `os-keychain` feature (per-target backends); round-trip test passes against real Credential Manager; default build stays SDK-free |
| Privacy audit | Implemented, clean | `scripts/privacy_audit.py` scans store+spools for secrets/transcripts/bodies; end-to-end ingest test proves sanitization at rest |
| Desktop UI | Verified build, honest data | `svelte-check` 0 errors, `vite build` succeeds; Tauri `snapshot` projects real provider rows (nulls + live overlays, never invented); summaries/models/budgets/alerts/heatmap render Unknown/Sample/empty states |
| Daemon + pollers | Implemented, tested | `collectors/daemon.mjs` cadence loop (`--once`/`--loop`), OpenRouter-key/OpenAI/ollama pollers, enterprise stubs honest until configured |
| OS autostart | Implemented | Windows Task Scheduler task + installer, macOS launchd plist, Linux systemd unit |
| Svelte UI | Implemented scaffold | Rail, popover, heatmap, dashboard/settings source |
| Static browser demo | Runnable | Zero-dependency |
| Local prototype server | Runnable, honest default | Zero-dependency Node server + Claude snapshot endpoint; default snapshot honest-empty with live overlays, deterministic sample behind `?demo=1` |
| Local collectors (`collectors/local.mjs`) | Implemented | Cross-platform detect (Win/macOS/Linux) + live Ollama/LM Studio/Claude-spool/OpenRouter-credits overlay; secrets never read |
| Workflow engines (`store/reconcile/scheduler/forecast/alerts`) | Implemented | Immutable file store w/ dedupe+retention, read-time reconcile, per-connector cadence, EWMA forecasts, cooldown alerts — all fixture-tested |
| Provider normalizers (`collectors/providers.mjs`) | Implemented | Perplexity, OpenAI-compatible (xAI/DeepSeek/Groq/Together/Fireworks), Ollama, Cursor (chargedCents billing truth), Copilot daily, Codex windows (flat + `rateLimits` + `rateLimitsByLimitId`), Gemini OTLP |
| Rust workspace | Compile-blocker fixed | Legacy `viusage_core`crate name replaced by `usage_halo_core` in 8 files; new `usage-halo-scheduler` (cadence + honesty-capped freshness) and `usage-halo-secrets` (alias-only, keychain-ready) crates; Tauri shell projects file store + `connector_health` via real crates |
| Live bridges | Implemented (Node, tested) | Codex app-server stdio client (`account/rateLimits/read`, timeout-guarded, fake-server tested) + `GET /api/codex/live`; Gemini OTLP receiver (`POST /v1/metrics`, compact + OTLP/JSON, prompt attrs stripped) |
| Mobile companion | Implemented (web) | `demo/widget.html` + `GET /api/widget` payload for Android widget/notification, iOS widgets/Live Activity |
| Webapp UI (`demo/`) | Implemented, honest data | Example-UI 01–06 parity: rail + hover cards, tray card, overview, providers, models, activity, budgets, alerts, settings (light/dark, glass/solid/minimal/mono, edge placement), responsive mobile; live paths show Unknown/Sample/empty states, demo numbers sample-gated |
