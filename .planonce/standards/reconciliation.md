# Reconciliation

**Rule:** Reconcile only on explicit identity. `select_authoritative_events` keys by `reconciliation_key` else `billing_owner:request_id`; unkeyed events are preserved unsummed. Winner is higher `SourceAuthority`, then newer `observed_at`. Merge preserves loser token detail + winner billing cost.

Why: Prevents double-counting the same request seen via local instrumentation plus provider billing/telemetry, while retaining per-request token fidelity when billing aggregate lacks detail.

Where: `crates/viusage-reconcile/src/lib.rs:6` (select_authoritative_events), `crates/viusage-reconcile/src/lib.rs:40` (should_replace), `crates/viusage-reconcile/src/lib.rs:48` (merge_detail), `crates/viusage-core/src/lib.rs:34` (authority ordering Estimated < Imported < Derived < InstrumentedResponse < ProviderTelemetry < ProviderBilling).

Invariants:
- Status-line context snapshots never become sumable token events — they stay in `extra` (`connectors/claude-code/src/lib.rs:98`).
- Raw observations remain immutable; UI reads reconciled projections (`docs/03_ARCHITECTURE.md:62`).

Check: `cargo test provider_billing_wins_without_losing_local_token_detail` in `crates/viusage-reconcile/src/lib.rs:126`.
