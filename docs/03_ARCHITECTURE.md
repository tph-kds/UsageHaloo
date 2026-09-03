# System architecture

## Topology

```text
Providers / local tools
        │
        ▼
Connector adapters
        │
        ├─ event streams
        ├─ official APIs
        ├─ OpenTelemetry
        └─ optional request instrumentation
        │
        ▼
Normalization
        │
        ▼
Immutable raw observations
        │
        ▼
Reconciliation / authority selection
        │
        ▼
SQLite projections + rollups
        │
        ├─ forecast engine
        ├─ alert engine
        └─ connector health
        │
        ▼
Local query/application service
        │
        ├─ edge rail
        ├─ tray/menu bar
        ├─ dashboard
        └─ mobile sync bridge (later)
```

## Runtime components

### `usage-halo-core`

Defines stable domain contracts:

- metric types;
- usage events;
- quota windows;
- connector capabilities;
- freshness/source semantics;
- provider/account/model identifiers.

### Connector runtime

Each connector is isolated behind the same contract. Connectors should never directly mutate UI state.

### Normalizer

Maps provider-specific fields into typed domain values while preserving original source metadata.

### Raw store

Append-only or effectively immutable telemetry observations. Raw rows are retained to support debugging and reconciliation.

### Reconciler

Selects authoritative observations when multiple sources represent the same event or interval.
Implemented in `crates/usage-halo-reconcile` (explicit keys only; detail
merge preserves local token dimensions alongside provider billed cost) and
mirrored in `collectors/reconcile.mjs`. Shared vectors in
`fixtures/reconcile-vectors.json` are consumed by both implementations so
they cannot drift apart.

Example:

```text
local response observation: 7,800 tokens
provider aggregate later:   7,800 tokens
                     ↓
reconciled total:            7,800 tokens
```

Never add both blindly.

### Rollup engine

Precomputes day/hour/provider/model aggregates for fast UI queries and heatmaps.

### Forecast engine

Consumes rollups and quota snapshots. It must remain deterministic and explainable for v1.
Implemented in `crates/usage-halo-forecast` (EWMA burn rate, suppression on
stale data or too few samples, labels visually distinct from observations)
and mirrored in `collectors/forecast.mjs`; shared vectors in
`fixtures/forecast-vectors.json` pin both implementations to identical numbers.

### Scheduler

Per-connector cadence metadata lives in `crates/usage-halo-scheduler` (event
vs poll, nominal interval, max healthy age, honesty-capped freshness) and is
mirrored in `collectors/scheduler.mjs`; `tests/test_parity.py` fails the build
if the two tables disagree.

### Secrets

Secret aliases in the database, values in the OS keychain — never in SQLite.
`crates/usage-halo-secrets` owns the alias vocabulary and the env fallback;
the `os-keychain` feature enables per-platform vault backends.

### Alert engine

Evaluates user rules, applies cooldown/deduplication and emits native notifications.

### Application service

Tauri commands expose read-oriented view models to Svelte. UI should not query SQLite directly.

## Process strategy

### Default desktop mode

Prefer a single desktop process plus short-lived helper bridges.

Avoid:

- mandatory daemon farm;
- Docker;
- Redis/Postgres;
- browser extension requirement;
- per-provider background process where an event hook can be used.

### Background behavior

Use provider-native events whenever possible:

- Claude status-line -> event;
- Codex app-server -> event;
- Gemini OTLP -> event;
- instrumented API response -> event.

Poll only sources that require it. Poll cadence belongs to connector metadata, not one global timer.

## Cross-platform boundaries

Create a clean platform layer for:

- secure secret storage;
- auto-start;
- tray/menu bar;
- always-on-top window behavior;
- edge positioning;
- native notifications;
- global shortcut (optional);
- mobile widgets/live activity (later).

Do not contaminate core telemetry code with platform-specific UI assumptions.

## Mobile architecture

Mobile is primarily a **companion projection** for desktop-local telemetry.

```text
Desktop collectors
      │
      ▼
local DB
      │
      ▼
optional E2EE sync
      │
      ├─ iOS app/widgets/live activity
      └─ Android app/widget/notification
```

Account-level provider APIs can be queried from mobile where appropriate, but local CLI usage cannot be reconstructed from an iPhone.

## Extension architecture

Start with compiled, audited connectors.

Later, third-party connectors can be isolated using a constrained WASI component or subprocess protocol with declared:

- network domains;
- file permissions;
- secret aliases;
- polling interval;
- emitted metric types.

Never load arbitrary provider JavaScript with unrestricted filesystem/keychain access in the main process.
