# Realtime semantics, freshness and reconciliation

## Why this matters

The phrase “realtime usage” is misleading if applied uniformly. Providers publish different signals at different cadences. UsageHalo should model time explicitly instead of hiding it.

## Freshness model

Each connector declares:

- nominal refresh mode: event/poll/report/import;
- expected refresh interval;
- maximum healthy age;
- provider aggregation delay if known.

Derived UI states:

```text
Live       event received within expected live window
Fresh      latest successful poll is within SLA
Delayed    provider intentionally aggregates data
Stale      age exceeded connector freshness SLA
Unknown    connector has no successful observation
```

## Polling policy examples

- Claude Code: event-driven status-line updates;
- Codex: event-driven app-server notifications + initial read;
- Gemini CLI: OTLP events;
- OpenAI Admin usage: scheduled API poll;
- Cursor filtered usage events: no more frequently than documented recommendation;
- Copilot: consume daily report cadence;
- Windsurf/other enterprise analytics: match documented backend update cadence.

## Reconciliation problem

A single request can appear through several sources:

```text
request response telemetry
         +
router/provider event
         +
account aggregate
```

Naive summation creates over-counting.

## Reconciliation keys

Prefer exact IDs in this order:

1. provider request/generation ID;
2. provider event ID;
3. session + sequence ID;
4. deterministic fingerprint with conservative time/model/account bounds.

Never aggressively merge events without a trustworthy key.

## Authority selection

When two records are known to describe the same consumption:

- provider billing/account data wins for billed cost;
- official request response wins for per-request token detail if billing source is aggregate only;
- local estimates are retained for history but superseded in reconciled totals once authoritative data arrives.

This often means combining **different dimensions from different sources**, not deleting one entire record.

Example:

```text
local request:
  model = X
  input = 5,000
  output = 800
  estimated_cost = 0.021

later billing record:
  request_id = same
  provider_cost = 0.0198

reconciled:
  model = X
  input = 5,000
  output = 800
  provider_cost = 0.0198
  estimated_cost = 0.021 (retained as estimate history)
```

## Aggregate reconciliation

Account APIs may return hourly/day buckets without request IDs. Do not attempt to map every event one-to-one if impossible.

Instead maintain source-specific totals and use authoritative aggregate totals for dashboard cost/usage while still showing local detailed attribution as a subordinate breakdown with a reconciliation note.

## UI provenance

Expanded metrics should expose:

- source label;
- account/device scope;
- freshness;
- provider/UsageHalo estimate distinction;
- last update time.

Suggested badges:

- `Provider reported`;
- `Local telemetry`;
- `Instrumented requests`;
- `Estimated`;
- `Reconciled`.

## Forecasting

Forecasts must be visually different from observations.

Never render a predicted quota value as if it came from a provider. Use labels like:

- “Projected at reset: 86%”;
- “Likely to hit limit in ~42 min”.

Suppress forecasting if data is stale or sample count is below configured minimum.
