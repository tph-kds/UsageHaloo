# Freshness and Polling

**Rule:** Freshness is explicit per connector (`Live/Fresh/Hourly/Daily/Manual/Stale/Unknown`). Event-driven where possible; poll only when provider has no events. Poll cadence belongs to connector metadata, not a global timer. Forecasts rendered visually distinct from observations.

Why: "Realtime" is provider-dependent; hiding delay creates false urgency for quota windows. Respecting documented poll SLAs avoids rate-limit bans (e.g., Cursor, Copilot).

Where: `crates/viusage-core/src/lib.rs:50` (FreshnessClass), `docs/06_REALTIME_AND_RECONCILIATION.md:8` (derived UI states), `docs/06_REALTIME_AND_RECONCILIATION.md:26` (per-connector polling examples), `docs/03_ARCHITECTURE.md:112` (background behavior).

Check: New polling connector must document `expected_refresh_seconds` (used in `crates/viusage-storage/migrations/0001_init.sql:88` connector_health) and surface degraded/stale via `ConnectorHealth` rather than reporting zero usage.
