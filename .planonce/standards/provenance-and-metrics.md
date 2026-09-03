# Provenance and Metrics

**Rule:** Every usage value carries provenance (`source_kind`, `scope`, `authority`, `freshness`, `observed_at`, `confidence`) and a typed `MetricKind`. Never collapse quotas, tokens, credits, cost, or context pressure into a single fake percentage.

Why: Providers expose fundamentally different signals at different cadences; collapsing loses auditability and misleads quota forecasts. Core domain types enforce this at compile time.

Where: `crates/viusage-core/src/lib.rs:11` (MetricKind, SourceAuthority, SourceScope, FreshnessClass, Provenance, QuotaWindow, UsageEvent).

Exception: UI may show a compact "primary metric" per provider (from `packages/brand-registry/providers.json:9` `primaryMetric`) but must still expose full provenance on hover/detail.

Check: Adding a new metric without `MetricKind` variant + provenance is a contract break; `scripts/validate.py` does not catch this — rely on `cargo test` + connector contract tests with fixtures.
