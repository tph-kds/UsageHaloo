# Implementation roadmap

## Phase 0 — Truth engine

Goal: prove the data model before visual polish.

Deliverables:

- domain schema;
- connector contract;
- SQLite migration;
- provenance/freshness metadata;
- reconciliation rules;
- provider registry;
- fixture test harness;
- CLI debug output.

Exit gate: duplicate observations cannot silently double totals, stale data cannot render as zero, and every metric has scope/source metadata.

## Phase 1 — Desktop MVP

### Connectors

- Claude Code;
- Codex;
- Gemini CLI;
- OpenAI organization usage;
- OpenRouter;
- Anthropic API/admin connector where stable for target accounts.

### UI

- tray/menu-bar;
- side rail;
- hover cards;
- Overview;
- Activity heatmap;
- Models;
- Providers/settings;
- native notifications.

### Engineering

- keychain integration;
- auto-start;
- background scheduler;
- signed local database migrations;
- source/freshness badges.

Exit gate: run a full workday on each desktop OS without material CPU/network overhead while idle.

## Phase 2 — Provider expansion

Add in this order based on reliable official access:

1. Cursor;
2. Z.ai / ZCode beta;
3. Perplexity request instrumentation;
4. Mistral / Vibe;
5. GitHub Copilot;
6. Windsurf;
7. xAI;
8. generic OpenAI-compatible connector.

Exit gate for each provider: pass the provider acceptance checklist in `05_CONNECTOR_SPEC.md`.

## Phase 3 — Intelligence

- EWMA quota exhaustion forecast;
- daily/monthly spend forecast;
- anomaly detection;
- cache efficiency;
- under-utilized subscription hints;
- “which quota will I hit first?” summary;
- model/provider cost comparisons with scope caveats.

No LLM is required for these features initially.

## Phase 4 — Mobile companion

### Android

- widget;
- persistent notification;
- optional overlay;
- encrypted sync.

### iOS

- widgets;
- Live Activity;
- Dynamic Island integration where appropriate;
- encrypted sync.

Exit gate: mobile never needs access to desktop source-code directories or CLI credential stores.

## Phase 5 — Teams/enterprise

Optional cloud control plane:

- organization accounts;
- team dashboards;
- shared budgets;
- enterprise provider APIs;
- RBAC;
- policy alerts;
- E2EE/private deployment options.

## Suggested first 12 engineering milestones

1. Domain types and fixtures.
2. SQLite persistence + migration tests.
3. Claude Code parser/bridge.
4. Reconciliation test suite.
5. Rail visual prototype.
6. Codex app-server prototype.
7. Gemini OTLP receiver.
8. OpenAI/OpenRouter HTTP connectors.
9. Tauri tray + edge-window behavior.
10. Provider settings/keychain.
11. Activity rollups + heatmap.
12. signed alpha for Windows/macOS/Linux.
