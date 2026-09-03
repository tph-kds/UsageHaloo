# Connector Contract

**Rule:** Every connector implements `UsageConnector` (`id`, `capabilities`, `snapshot`, `health`) and declares `ConnectorCapabilities` before collection. One connector = one billing domain. Health states are `healthy/degraded/auth_required/permission_denied/rate_limited/stale/unsupported_version/offline`.

Why: Uniform adapter lifecycle lets the runtime isolate, sanitize, normalize, persist, and surface sources consistently; capabilities drive UI permission view and polling policy.

Where: `crates/viusage-core/src/lib.rs:205` (trait), `crates/viusage-core/src/lib.rs:152` (ConnectorCapabilities), `docs/05_CONNECTOR_SPEC.md:5`; example: `connectors/claude-code/src/lib.rs:112`, `connectors/codex/src/lib.rs`, `connectors/openrouter/src/lib.rs`.

Invariants:
- No connector mutates UI state directly; Tauri commands expose read-oriented view models (`docs/03_ARCHITECTURE.md:92`).
- Quota windows declare `window_duration_seconds` + `resets_at` as provider-epoch converted via `epoch_seconds_to_utc` (`crates/viusage-core/src/lib.rs:216`).

Check: New connector requires fixture under `fixtures/` + sanitizer test matching Claude pattern in `connectors/claude-code/src/lib.rs:154`; `scripts/validate.py:36` checks registry parity.
