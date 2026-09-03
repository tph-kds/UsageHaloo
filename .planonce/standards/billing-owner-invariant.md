# Billing Owner Invariant

**Rule:** `billing_owner` and `model_provider`/`model` are independent. The provider of the model is not the billing owner when routed through another product.

Why: Prevents attributing Cursor-routed Claude usage to Anthropic account, or OpenRouter-routed requests to the upstream model vendor. Billing determines cost/quota ownership.

Where: `crates/viusage-core/src/lib.rs:113` (`billing_owner`, `model_provider`, `model` on UsageEvent); `README.md:120`; rollup primary key includes `billing_owner` in `crates/viusage-storage/migrations/0001_init.sql:92`.

Check: Any new connector or instrumentation must populate `billing_owner` from the billing entity, not the model vendor. Tests should assert cross-routing case (e.g., `model_provider=anthropic`, `billing_owner=openrouter`).
