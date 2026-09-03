# Executive recommendation

## Thesis

Build UsageHalo as a **local-first AI usage observability platform with an ambient edge/notch interface**, not as a decorative Mac-only quota widget.

The defensible engineering value is the telemetry system underneath the UI:

- heterogeneous provider connectors;
- truthful realtime/freshness semantics;
- quota-window modeling;
- per-model token/cost accounting;
- provenance and source scope;
- reconciliation to avoid double counting;
- forecasting and anomaly detection;
- secure cross-device sync later.

The side rail from the original concept should remain the default interaction because it provides persistent, low-friction awareness. On macOS it may visually align to the notch/menu bar; on Windows/Linux it should behave as an edge dock; on Android as a widget/notification/optional overlay; on iOS as widgets, Live Activity and Dynamic Island where appropriate.

## Product positioning

> **UsageHalo — your ambient AI usage monitor.** Track quotas, tokens, costs, credits, model activity and usage health across the AI tools you actually use, from one lightweight, privacy-first interface.

A stronger long-term category is **Personal AI FinOps + Agent Observability**.

## Non-negotiable product truths

### 1. There is no universal “AI usage percent”

Different providers expose different resource types. Preserve the native meaning:

- quota percentage;
- tokens;
- credits;
- cost;
- requests;
- context-window pressure;
- sessions;
- active time;
- tool calls;
- lines changed/accepted;
- prepaid balance.

The small ring can show a user-selected primary metric. Expanded views show the rest.

### 2. Provider, surface and billing owner are separate

Example: Claude used through Cursor should be represented roughly as:

- surface: Cursor;
- billing owner: Cursor;
- model provider: Anthropic;
- model: Claude ...

Do not silently attribute this to direct Anthropic-account usage.

### 3. “Realtime” must be honest

Some sources are event-driven, some hourly, some daily. UsageHalo should show freshness badges such as:

- Live;
- 28s ago;
- Hourly;
- Daily;
- Estimated;
- Manual;
- Stale.

The promise is: **freshest authoritative data available, with visible provenance**.

### 4. Local-first should be the default

A user should be able to run the desktop product with:

- no UsageHalo account;
- no mandatory cloud;
- no Docker;
- no always-on remote backend;
- no prompt or response upload.

Cloud sync should be optional and end-to-end encrypted when mobile companion support is added.

## Recommended MVP

Focus on evidence quality rather than connector count.

### Desktop first

- Windows;
- macOS;
- Linux.

### MVP connectors

1. Claude Code status-line telemetry;
2. Codex app-server rate-limit telemetry;
3. Gemini CLI OpenTelemetry;
4. OpenAI Organization Usage/Costs APIs;
5. Anthropic API/admin usage where stable and authorized;
6. OpenRouter credits plus request-level usage instrumentation.

### Core UX

- always-available rail/tray;
- circular provider logo + usage ring;
- hover popover;
- detail dashboard;
- per-model breakdown;
- activity heatmap;
- quota reset timers;
- freshness/source badges;
- alert rules;
- provider settings and pin/reorder;
- light/dark/system/OLED/glass/solid/minimal modes.

## Recommended stack

Use **Tauri 2 + Rust + Svelte 5 + TypeScript**.

Why:

- desktop process and CLI integration are first-class requirements;
- Tauri 2 spans Windows, macOS, Linux, Android and iOS;
- Rust gives low-idle overhead and strong domain modeling;
- Svelte is a good fit for compact reactive UI, rings and micro-charts;
- native plugins can handle platform-specific overlays/widgets later.

Avoid Electron unless Chromium-specific ecosystem needs outweigh memory footprint. Flutter remains a credible alternative if the product becomes mobile-first, but the first problem is desktop telemetry, not mobile rendering.

## Core engineering principle

Every number shown in the UI must carry enough metadata to answer:

- source;
- scope;
- authority;
- observed time;
- provider time;
- freshness class;
- confidence;
- dedupe/reconciliation identity.

That single design principle prevents most misleading dashboards.
