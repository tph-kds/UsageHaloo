# UsageHalo

**Ambient, local-first AI usage observability across coding agents, model providers, and AI subscriptions.**

UsageHalo turns the side-rail / notch concept into a full telemetry system that surfaces the freshest trustworthy usage data each provider exposes — quota windows, tokens, model activity, cost, credits, context pressure, request counts, activity heatmaps, and forecasts — without ever inventing numbers or hiding their provenance.

> *The visual rail gets attention. The connector + provenance + reconciliation engine is the product.*

---

## Table of Contents

1. [Overview](#overview)
2. [What is in this Repository](#what-is-in-this-repository)
3. [Product Promise](#product-promise)
4. [Recommended First Release](#recommended-first-release)
5. [Recommended Stack](#recommended-stack)
6. [Quick Demo](#quick-demo)
7. [Intended Production Development Flow](#intended-production-development-flow)
8. [Important Design Rules](#important-design-rules)
9. [Documentation Map](#documentation-map)
10. [Project Status](#project-status)
11. [Contributing](#contributing)
12. [License](#license)

---

## Overview

UsageHalo is a **local-first observability layer for AI usage**. It is designed for developers, power users, and teams who rely on multiple coding agents (Claude Code, Codex, Gemini CLI, Cursor, etc.) and AI subscriptions (OpenAI, Anthropic, OpenRouter, Mistral, Perplexity, GitHub Copilot, xAI, and more), and who need a single, trustworthy window into how those services are actually being consumed.

### Why UsageHalo exists

Modern AI workflows span many providers, billing surfaces, and rate-limit windows. A developer might simultaneously:

- Drive **Claude Code** for long-running agentic tasks,
- Use **Codex** or **Gemini CLI** as a second opinion,
- Subscribe to **Cursor** or **Windsurf** for IDE-integrated AI,
- Pay-as-you-go through **OpenRouter**, **DeepSeek**, **Groq**, or **Together**,
- Maintain direct **OpenAI** / **Anthropic** API orgs on top of all of the above.

Each surface reports usage differently — some expose quotas, some expose tokens, some expose credits, some expose nothing at all without instrumentation. UsageHalo unifies these into a single ambient, glanceable, **honest** view, with full provenance for every number.

### What "honest" means here

Every visible metric in UsageHalo must be able to answer six questions:

1. **Where did this number come from?** — Connector, endpoint, or local source.
2. **When was it measured?** — Timestamp, capture window, and clock source.
3. **Which account / workspace / device does it represent?** — Scoping identity.
4. **Is it provider-reported, locally observed, reconciled, or estimated?** — Source class.
5. **How fresh is it?** — Latency, staleness flag, and last-update indicator.
6. **Could it overlap another source?** — Reconciliation / de-duplication note.

UsageHalo is deliberately **not** a vendor dashboard clone. It does not promise realtime coverage where a provider does not expose realtime data, and it never collapses heterogeneous metrics into a single misleading "percentage used" bar.

### Who it is for

- **AI-heavy developers** who want a glanceable ambient view of usage across many tools.
- **Engineering teams** that need a trustworthy internal accounting of AI spend and quotas.
- **Provider / connector authors** who want a clean contract for contributing new data sources.
- **Privacy-conscious users** who prefer local-first tooling over cloud dashboards.

---

## What is in this Repository

This repository is a **production-minded architecture and source-code scaffold**, not a claim that every third-party provider connector is already production-ready. It includes:

- **Planning & specification** — detailed product, architecture, connector, realtime, security, cross-platform, UI/UX, and rollout plans under `docs/`.
- **Desktop application scaffold** — a Tauri 2 + Rust + Svelte 5 architecture under `apps/`, `crates/`, and `packages/`.
- **Zero-dependency browser demo** — a working visual prototype of the side rail, hover cards, overview, heatmap, and settings under `demo/` and `prototype/`.
- **Rust domain core** — domain types, connector contracts, reconciliation logic, and SQLite schema.
- **Working Claude Code status-line parser/sanitizer** — a real scaffold, not a stub.
- **Initial API / app-server connectors** — implementations or prototypes for Codex, OpenAI, OpenRouter, Gemini CLI, and Anthropic.
- **Provider registry entries** — strategies for Cursor, Z.ai / ZCode, Perplexity, Mistral, GitHub Copilot, Windsurf, xAI, and additional providers.
- **Tests & validation scripts** — under `tests/` and `scripts/`, with results captured in `VERIFICATION.md`.

---

## Product Promise

UsageHalo does **not** promise that every provider is realtime. Instead:

> **Show the freshest authoritative information a provider makes available, expose its scope and source, and never hide when a value is delayed or estimated.**

This is the project's north star. If a contributor is unsure whether a feature belongs, the answer is almost always the one that **increases transparency** — more provenance metadata, more explicit staleness indicators, more honest reconciliation notes — over one that smooths reality into a prettier chart.

---

## Recommended First Release

### Desktop targets

- **Windows 11**
- **macOS**
- **Linux**

### First-class MVP connectors

- **Claude Code** (status-line + session telemetry)
- **Codex** (app-server / API)
- **Gemini CLI** (telemetry + API)
- **OpenAI API organization usage**
- **Anthropic API / admin usage** (where available)
- **OpenRouter**

### Next wave

- **Cursor**
- **Z.ai / ZCode**
- **Perplexity**
- **Mistral / Vibe**
- **GitHub Copilot**
- **Windsurf**
- **xAI**
- **OpenAI-compatible APIs** — DeepSeek, Groq, Together, Fireworks, etc. — via opt-in request instrumentation

---

## Recommended Stack

| Layer | Recommendation |
|---|---|
| Cross-platform shell | **Tauri 2** |
| Core / runtime | **Rust** |
| Async | **Tokio** |
| HTTP | **reqwest** |
| Local DB | **SQLite + sqlx** |
| Frontend | **Svelte 5 + TypeScript** |
| Build | **Vite** |
| Charts | **SVG / uPlot** first; **ECharts** only when needed |
| Telemetry intake | **OpenTelemetry / OTLP** |
| Secrets | **Native OS keychain / credential vault** |
| Desktop IPC | **Tauri IPC** + local file / socket bridge |

---

## Quick Demo

For an immediately runnable end-to-end local prototype (demo UI + local snapshot API):

```bash
node prototype/server.mjs
```

Then open `http://127.0.0.1:4897`.

For a static visual-only demo with no dependencies:

```bash
cd demo
python -m http.server 8080
```

Then open `http://localhost:8080`.

You can also open `demo/index.html` directly in most browsers.

---

## Intended Production Development Flow

```bash
cd apps/desktop-ui
npm install
npm run dev
```

For the Tauri desktop shell, install the Rust + Tauri prerequisites for your platform, then:

```bash
npm run tauri dev
```

> **Note:** The current execution environment used to package this scaffold did not include a Rust toolchain, so the Rust workspace is structurally validated but was not compiled here. See [`VERIFICATION.md`](./VERIFICATION.md) for exactly what was and was not verified.

---

## Important Design Rules

These rules are non-negotiable for any contribution. They exist to keep UsageHalo trustworthy.

- **Provider ≠ billing owner.** A Claude model used inside Cursor is normally Cursor-billed usage, not direct Anthropic-account usage.
- **Never normalize all usage into a fake token percentage.** Quotas, token counts, credits, context pressure, requests, and spend are separate metric types and must stay that way in the UI.
- **No secret keys in SQLite.** Use the native OS secure storage / keychain.
- **No forced traffic proxy.** Request instrumentation is strictly opt-in.
- **No transcript collection by default.** Collect telemetry fields only — never prompts, completions, or message bodies.
- **No browser-cookie scraping as a core strategy.** Prefer official APIs, documented CLI telemetry, and provider-supported integrations.
- **Raw observations are immutable; the UI reads reconciled projections.** Reconciliation is a read-time concern, never a write-time mutation of source data.
- **Stale data must be visible.** Every metric carries a freshness indicator; never silently "refresh" a cached value without showing the user what happened.

---

## Documentation Map

The `docs/` folder is the canonical specification. Read in order if you are new to the project:

1. [`docs/00_EXECUTIVE_RECOMMENDATION.md`](./docs/00_EXECUTIVE_RECOMMENDATION.md) — the one-page pitch and recommended path.
2. [`docs/01_PRODUCT_SPEC.md`](./docs/01_PRODUCT_SPEC.md) — product surface and user journeys.
3. [`docs/02_PROVIDER_RESEARCH.md`](./docs/02_PROVIDER_RESEARCH.md) — per-provider capabilities and limits.
4. [`docs/03_ARCHITECTURE.md`](./docs/03_ARCHITECTURE.md) — system architecture and module boundaries.
5. [`docs/04_DATA_MODEL.md`](./docs/04_DATA_MODEL.md) — SQLite schema, domain types, and reconciliation model.
6. [`docs/05_CONNECTOR_SPEC.md`](./docs/05_CONNECTOR_SPEC.md) — the connector contract for contributors.
7. [`docs/06_REALTIME_AND_RECONCILIATION.md`](./docs/06_REALTIME_AND_RECONCILIATION.md) — freshness, polling, and conflict resolution.
8. [`docs/07_UI_UX_SYSTEM.md`](./docs/07_UI_UX_SYSTEM.md) — the rail / notch / overview design system.
9. [`docs/08_CROSS_PLATFORM.md`](./docs/08_CROSS_PLATFORM.md) — Windows, macOS, and Linux packaging notes.
10. [`docs/09_SECURITY_PRIVACY.md`](./docs/09_SECURITY_PRIVACY.md) — secrets, telemetry scope, and threat model.
11. [`docs/10_IMPLEMENTATION_ROADMAP.md`](./docs/10_IMPLEMENTATION_ROADMAP.md) — phased delivery plan.
12. [`docs/11_TESTING_RELEASE.md`](./docs/11_TESTING_RELEASE.md) — test matrix and release gates.
13. [`docs/12_BRAND_ASSETS.md`](./docs/12_BRAND_ASSETS.md) — naming, logos, and third-party trademarks.
14. [`docs/13_OPERATIONAL_MODEL.md`](./docs/13_OPERATIONAL_MODEL.md) — support, updates, and sustainability.

---

## Project Status

**Architecture / scaffold alpha.** The recommended priority is to make Claude Code, Codex, and Gemini CLI *evidence-quality first* before expanding breadth. See [`VERIFICATION.md`](./VERIFICATION.md) and [`SOURCE_STATUS.md`](./SOURCE_STATUS.md) for the current state of each module.

---

## Contributing

Contributions are welcome and encouraged — especially new connectors, reconciliation improvements, and honest provenance metadata. UsageHalo is intentionally small in scope but rigorous about what it claims, so please read this section before opening a pull request.

### Contribution workflow

1. **Read the spec first.** Start with [`docs/05_CONNECTOR_SPEC.md`](./docs/05_CONNECTOR_SPEC.md) and [`docs/06_REALTIME_AND_RECONCILIATION.md`](./docs/06_REALTIME_AND_RECONCILIATION.md). Most design questions are answered there.
2. **Open an issue before opening a PR** — describe the provider, the data source (API, CLI telemetry, log file, etc.), and any auth requirements. Small changes (typos, doc fixes) can skip this step.
3. **Fork the repository** and create a feature branch:
   ```bash
   git checkout -b feat/<provider-or-area>/<short-description>
   ```
4. **Follow the project conventions** — Rust edition, Svelte 5 runes, naming, and the connector trait layout defined in `crates/`. Match the style of neighboring code.
5. **Add or update tests** — unit tests for parsers/reconcilers, and at least one integration test for any new connector. Reference fixtures live in `fixtures/`.
6. **Run the verification scripts** listed in `VERIFICATION.md` before requesting review. Note any environment limitations honestly in the PR description.
7. **Open a pull request** — fill in the PR template, link the issue, and list exactly what was and was not tested.

### Tips for a great contribution

- **Provenance over prettiness.** When in doubt, expose more metadata about where a number came from rather than smoothing it into the UI.
- **Never invent numbers.** If a provider does not expose a value, surface that explicitly — do not estimate silently.
- **Keep secrets out of the tree.** Use the OS keychain. If a connector requires a token for development, document it in `.env.example` and reference it from the docs.
- **Respect provider rate limits and terms.** If you are unsure whether a scraping or instrumentation approach is permitted, prefer the official API or ask in the issue first.
- **One connector per PR.** Bundling multiple unrelated changes makes review harder and slows everyone down.
- **Write tests with real-shaped fixtures.** Synthetic "always works" data hides bugs. Capture anonymized samples in `fixtures/` whenever the upstream format allows it.
- **Update `SOURCE_STATUS.md`** if you change the maturity of a connector or module. Future contributors rely on it to avoid duplicate work.
- **Be kind and precise in review.** Disagree on substance, not style. Cite the spec.

### Reporting security issues

Please **do not** open a public issue for suspected vulnerabilities. Follow the disclosure process in [`docs/09_SECURITY_PRIVACY.md`](./docs/09_SECURITY_PRIVACY.md) instead.

### Code of conduct

By participating, you agree to keep the project welcoming and professional. Harassment, discrimination, or bad-faith behavior toward other contributors is not tolerated.

---

## License

**MIT** for this scaffold. Provider names, trademarks, and logos remain the property of their respective owners — see [`docs/12_BRAND_ASSETS.md`](./docs/12_BRAND_ASSETS.md) for attribution guidance.

---

<p align="center"><em>Built for honest, local-first AI usage observability. Thanks for stopping by — have a great day exploring the project, and may your quotas stay comfortable and your reconciliations stay clean.</em></p>