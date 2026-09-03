# Connector specification

## Connector contract

A provider connector should conceptually implement:

```rust
#[async_trait]
pub trait UsageConnector: Send + Sync {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> ConnectorCapabilities;
    async fn snapshot(&self) -> Result<UsageSnapshot>;
    async fn quota_windows(&self) -> Result<Vec<QuotaWindow>>;
    async fn health(&self) -> ConnectorHealth;
}
```

Event-capable connectors can additionally expose a watch/stream interface through the runtime.

## Capability flags

- live usage;
- account usage;
- model breakdown;
- token breakdown;
- cost;
- credits/balance;
- quota windows;
- context pressure;
- tools;
- activity;
- organization/workspace scope;
- event stream;
- historical backfill.

## Adapter lifecycle

1. discover availability;
2. validate authentication/configuration;
3. advertise capabilities;
4. collect snapshot or subscribe;
5. sanitize source payload;
6. normalize;
7. persist raw observation;
8. reconcile;
9. update health;
10. emit UI invalidation event.

## Security contract

Every connector declares:

- exact domains accessed;
- exact files read;
- credential aliases required;
- whether prompt/response payloads could appear in source telemetry;
- sanitizer behavior;
- minimum poll cadence;
- account scope.

The settings UI should show this declaration before enablement.

## Claude status-line connector

### Input

Claude Code status-line JSON on stdin.

### Retain

- model ID/name;
- session ID (hashed if desired);
- context token values;
- current usage token components;
- quota percentages and reset timestamps;
- session cost/duration if enabled;
- prompt-cache summary if desired.

### Drop immediately

- transcript path;
- working directory;
- repository owner/name;
- PR URL;
- session title if privacy mode says not to retain it;
- all unknown fields by default.

### Existing status-line coexistence

Installer should detect a pre-existing `statusLine` command. Offer:

- wrap existing command;
- UsageHalo only;
- cancel.

Never overwrite without explicit consent.

## Codex connector

Use app-server protocol, not internal credential extraction.

Runtime should:

- launch/connect to app-server;
- perform required initialization handshake for the installed Codex version;
- request `account/rateLimits/read`;
- consume `account/rateLimits/updated`;
- parse primary/secondary/multi-bucket snapshots;
- surface protocol incompatibility as degraded, not as zero usage.

Contract fixtures must be versioned by Codex release/schema version.

## Gemini CLI connector

Preferred production mode: OTLP receiver.

Retention policy should ignore prompt/message payload attributes and keep only approved metrics, model IDs, tool counts and anonymous session correlation.

## Official HTTP API connectors

HTTP connectors must include:

- conditional backoff;
- 429 handling;
- pagination cursor persistence;
- rate-limit-aware polling;
- ETag/If-Modified-Since where provider supports it;
- last-success cursor;
- structured error classification.

## Generic response instrumentation

An optional local gateway or SDK middleware can normalize usage from OpenAI-compatible responses.

It must be opt-in and labeled `instrumented_traffic_only`.

Do not claim account-wide totals unless a provider account API confirms them.

## Connector health states

- `healthy`;
- `degraded`;
- `auth_required`;
- `permission_denied`;
- `rate_limited`;
- `stale`;
- `unsupported_version`;
- `offline`.

UI must distinguish “0 usage” from “no current data.”
