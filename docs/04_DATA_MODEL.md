# Canonical data model

## Design goal

The schema must represent provider-native truth without forcing different products into a fake common percentage.

## Core identities

### Provider account

Represents a configured credential/subscription/workspace scope.

Fields:

- internal account ID;
- provider ID;
- account label;
- account/workspace/org external IDs when safe to store;
- scope;
- enabled state;
- connector ID/version;
- secret alias only, never the secret itself.

### Usage event

One observed unit of consumption.

Recommended fields:

```text
id
provider
surface
billing_owner
model_provider
model
account_id
workspace_id
device_id
session_id
request_id

input_tokens
output_tokens
reasoning_tokens
cache_read_tokens
cache_write_tokens
tool_tokens

requests
tool_calls
active_ms
lines_added
lines_removed

provider_cost
estimated_cost
currency

source_kind
source_scope
source_authority
freshness_class
confidence
observed_at
provider_timestamp
reconciliation_key
raw_fingerprint
```

### Quota snapshot

```text
id
provider/account
limit_id
label
metric_kind
used_value
limit_value
used_percent
remaining_value
window_duration_seconds
window_started_at
resets_at
source metadata
observed_at
```

A quota may have percentage only, credits only, or both.

### Model usage rollup

Aggregate by provider/surface/billing owner/model/time bucket.

### Connector health

```text
connector_id
state          # healthy/degraded/auth_error/stale/unsupported
last_success
last_attempt
last_error_code
last_error_summary
expected_refresh_seconds
```

## Source metadata

### Authority

Suggested order:

1. `provider_billing` — billing/authoritative account result;
2. `provider_telemetry` — official provider telemetry;
3. `instrumented_response` — exact local request observation;
4. `derived` — calculated from trusted inputs;
5. `imported` — CSV/manual source;
6. `estimated` — heuristic.

Authority does not mean “newer”; reconciliation must also respect scope and aggregation level.

### Scope

- request;
- session;
- device;
- account;
- workspace;
- organization;
- instrumented-traffic-only.

### Freshness

- live/event-driven;
- seconds/minutes;
- hourly;
- daily;
- manual;
- stale.

## Pricing versions

Never hardcode cost as `tokens * current_price` without date/version context.

Store pricing records with:

- provider/model;
- effective start/end;
- input rate;
- output rate;
- cache read/write rates;
- reasoning/tool rates if distinct;
- currency;
- source URL/version.

Provider-reported cost always remains separate from UsageHalo-estimated cost.

## Time handling

- persist timestamps in UTC;
- preserve provider reset timestamps exactly;
- user-facing day/week rollups use selected local timezone;
- DST changes must be tested;
- never infer a reset timezone when provider gives an epoch timestamp.

## Retention

Default suggestion:

- raw telemetry: 90 days configurable;
- hourly rollups: 1 year;
- daily rollups: long-term;
- secrets: never in DB;
- prompts/responses: never by default.
