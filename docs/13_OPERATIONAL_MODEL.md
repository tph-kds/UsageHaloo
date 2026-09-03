# Operational model and lightweight runtime

## Runtime goals

UsageHalo should feel like a system utility, not another heavyweight AI desktop app.

Engineering goals:

- event-driven collection whenever a provider exposes events;
- no network activity while idle except scheduled provider polls;
- bounded SQLite writes with batching/debouncing;
- no permanent animation loop in the rail;
- no bundled database server;
- no Docker requirement;
- graceful offline behavior;
- transparent connector health and backoff.

## Scheduler

Each connector owns a `RefreshPolicy` rather than sharing a global timer.

Conceptual model:

```text
EventDriven
Polling {
  nominal_interval,
  minimum_interval,
  jitter,
  stale_after,
  backoff
}
DailyReport
ManualImport
```

The scheduler should coalesce wakeups to avoid many tiny background timers.

### Suggested behavior

- local event source: update immediately, debounce UI invalidation only;
- HTTP API source: poll at a provider-appropriate cadence;
- 429: exponential backoff with server `Retry-After` priority;
- network offline: suspend remote polling and retry after network recovery;
- laptop sleep: do not replay every missed interval, perform one freshness check on wake;
- auth failure: stop aggressive retries and request user action.

## SQLite write policy

Use WAL mode and one small write queue.

Suggested pipeline:

```text
connector -> normalize -> in-memory queue -> short batch -> transaction
```

Quota snapshots can be de-duplicated when unchanged, while preserving meaningful change history.

## Rollups

Do not recompute a year of heatmap data every render.

Maintain daily/hourly projections incrementally. Rebuild projections only after:

- migration;
- reconciliation rule change;
- timezone setting change;
- explicit repair command.

## Connector state

Persist cursors and latest successful sync metadata so restarts do not cause full-history re-fetches.

Per connector:

- last attempt;
- last success;
- pagination cursor;
- provider version/schema fingerprint;
- backoff until;
- stale threshold;
- last structured error.

## Diagnostics

Provide a built-in diagnostics page with:

- connector state;
- source scope;
- last refresh;
- next eligible refresh;
- provider endpoint/domain list;
- sanitized last-response shape, never auth headers;
- database size;
- event/rollup counts;
- app version;
- operating system;
- exportable redacted support bundle.

## Updates

Desktop update strategy:

- signed app releases;
- stable/beta channel selection;
- connector compatibility data may ship with application updates;
- emergency server-side kill switch should only disable a known-broken connector definition, never remotely execute code.

## Reliability behavior

The rail must remain useful when one provider fails. Connector failures are isolated.

Examples:

- Claude auth/source unavailable -> Claude bubble displays stale/attention state;
- OpenRouter 429 -> other providers continue normally;
- SQLite migration failure -> fail safely and preserve original DB backup;
- provider schema change -> mark connector unsupported/degraded rather than mapping missing fields to zero.

## Resource measurement before release

Benchmark on representative hardware for:

- cold start;
- warm start;
- idle 30-minute CPU average;
- memory after 8 hours;
- disk writes/hour;
- network requests/hour;
- rail animation frame time;
- wake-from-sleep recovery.

Publish measured results instead of making unverified “ultra-lightweight” claims.
