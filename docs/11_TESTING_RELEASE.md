# Testing and release strategy

## Test layers

### 1. Domain tests

Pure tests for:

- metric serialization;
- time-window calculations;
- quota percentage rules;
- authority ranking;
- reconciliation;
- forecasting.

### 2. Connector fixture tests

Every provider parser must have recorded, sanitized fixtures for:

- normal response;
- missing optional fields;
- null values;
- auth failure;
- rate limit;
- malformed response;
- provider schema evolution where known.

Fixtures must never contain real keys or prompt content.

### 3. Contract tests

Run against live test accounts only when explicitly configured. Never make live third-party calls in default CI.

### 4. Storage tests

- migration up from fresh DB;
- upgrade from previous versions;
- timezone/DST rollups;
- duplicate event handling;
- concurrent read/write;
- retention cleanup.

### 5. UI tests

- provider overflow rail;
- hover keyboard accessibility;
- no-data vs zero;
- stale badges;
- long provider/model names;
- 100%/over-100% quota display;
- reduced motion;
- light/dark/high contrast.

### 6. Platform tests

Per OS:

- tray behavior;
- auto-start;
- edge placement on multi-monitor systems;
- full-screen app interaction;
- keychain storage;
- notification delivery;
- wake/sleep recovery;
- network offline/online transition.

## Performance budget

Targets are goals that require measurement, not promises:

- idle CPU: effectively near zero;
- idle network: zero except scheduled provider polls;
- no continuously animated GPU effects;
- startup: perceived sub-second where feasible;
- dashboard interaction: 60fps target;
- event-to-rail update: <250ms for local event connectors.

## Release channels

- nightly/dev;
- alpha;
- beta;
- stable.

Provider connectors can have independent stability labels.

## Release gate

Before stable:

```text
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm ci
npm run check
npm run build
```

Then build/sign on native runners for Windows, macOS and Linux.

## Telemetry correctness gate

A release is blocked if any of these occur:

- stale source appears as zero;
- account-wide label used for instrumented-only traffic;
- estimated cost shown as provider-billed cost;
- same request double-counted across known duplicate sources;
- secret appears in logs/DB;
- connector silently changes another tool's config without consent.
