//! Aggregate-aware reconciliation policy (remediation Phase 3, doc 05 §4–6).
//!
//! Exact-duplicate removal lives in `lib.rs`. This module solves the harder
//! problem: **different sources describing overlapping usage** — e.g. ten
//! locally observed requests plus a provider aggregate of the same ten
//! requests and $0.52. Naively summing yields twenty requests.
//!
//! Policy:
//! - overlap is considered only when billing/account/scope/window/currency
//!   dimensions are compatible — never from timestamp proximity alone;
//! - the provider aggregate wins for billed totals, local detail stays
//!   inspectable for activity/model exploration, totals never sum both;
//! - authority is per metric: for model-level detail, local instrumentation
//!   can be the best source while the provider aggregate lacks detail.

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use usage_halo_core::UsageEvent;

/// Preferred dedup identity: connector + account + stable source event id.
/// Returns None when the source supplies no stable id — the caller must fall
/// back to [`fallback_fingerprint`], never to ingest time.
pub fn canonical_key(
    connector: &str,
    account_id: Option<&str>,
    source_event_id: Option<&str>,
) -> Option<String> {
    let id = source_event_id.filter(|s| !s.is_empty())?;
    Some(format!("{}:{}:{}", connector, account_id.unwrap_or(""), id))
}

/// Deterministic fingerprint over stable source dimensions. Must not include
/// ingest/receive time, or logically identical replays will not deduplicate.
pub fn fallback_fingerprint(
    connector: &str,
    account_id: Option<&str>,
    model: Option<&str>,
    observed_at: &DateTime<Utc>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
) -> String {
    let mut h = Sha256::new();
    h.update(
        format!(
            "{}|{}|{}|{}|{:?}|{:?}",
            connector,
            account_id.unwrap_or(""),
            model.unwrap_or(""),
            observed_at.to_rfc3339(),
            input_tokens,
            output_tokens,
        )
        .as_bytes(),
    );
    format!("{:x}", h.finalize())[..16].to_string()
}

/// Dimensions that must agree before two observations may be treated as
/// overlapping evidence for the same usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AggregateScope {
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub currency: Option<String>,
    pub window_start: Option<DateTime<Utc>>,
    pub window_end: Option<DateTime<Utc>>,
}

/// True only when every dimension known on BOTH sides agrees. A dimension
/// known on one side and unknown on the other blocks reconciliation —
/// merging across unknown scope is how double counts and misattribution
/// happen.
pub fn scopes_compatible(a: &AggregateScope, b: &AggregateScope) -> bool {
    fn eq_opt(x: &Option<String>, y: &Option<String>) -> bool {
        match (x, y) {
            (Some(a), Some(b)) => a == b,
            (None, _) | (_, None) => false,
        }
    }
    fn eq_time(x: &Option<DateTime<Utc>>, y: &Option<DateTime<Utc>>) -> bool {
        match (x, y) {
            (Some(a), Some(b)) => a == b,
            (None, _) | (_, None) => false,
        }
    }
    eq_opt(&a.billing_owner, &b.billing_owner)
        && eq_opt(&a.account_id, &b.account_id)
        && eq_opt(&a.workspace_id, &b.workspace_id)
        && eq_opt(&a.currency, &b.currency)
        && eq_time(&a.window_start, &b.window_start)
        && eq_time(&a.window_end, &b.window_end)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BilledSource {
    ProviderAggregate,
    LocalDetail,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BilledTotal {
    pub value: f64,
    pub currency: String,
    pub source: BilledSource,
}

/// Resolve a billed total from local detail plus an optional provider
/// aggregate. When scopes are compatible the aggregate is authoritative and
/// the detail sum is NOT added (no double count). Otherwise the detail sum
/// stands on its own.
pub fn resolve_billed_total(
    detail_sum: f64,
    currency: &str,
    aggregate: Option<(f64, &AggregateScope)>,
    detail_scope: &AggregateScope,
) -> BilledTotal {
    if let Some((agg_value, agg_scope)) = aggregate {
        if scopes_compatible(detail_scope, agg_scope) {
            return BilledTotal {
                value: agg_value,
                currency: currency.to_string(),
                source: BilledSource::ProviderAggregate,
            };
        }
    }
    BilledTotal {
        value: detail_sum,
        currency: currency.to_string(),
        source: BilledSource::LocalDetail,
    }
}

/// Billed-cost sums grouped by **billing owner** (P0-08). Model activity and
/// application activity use their own dimensions — never this map.
pub fn sums_by_billing_owner(events: &[UsageEvent]) -> HashMap<String, f64> {
    let mut out = HashMap::new();
    for e in events {
        if let Some(c) = e.provider_cost {
            *out.entry(e.billing_owner.clone()).or_insert(0.0) += c;
        }
    }
    out
}

/// Observed-token sums grouped by (model provider, model) for activity views.
pub fn tokens_by_model(events: &[UsageEvent]) -> HashMap<(String, String), u64> {
    let mut out = HashMap::new();
    for e in events {
        let (Some(mp), Some(m)) = (e.model_provider.clone(), e.model.clone()) else {
            continue;
        };
        let t = e.tokens.input.unwrap_or(0) + e.tokens.output.unwrap_or(0);
        *out.entry((mp, m)).or_insert(0) += t;
    }
    out
}

/// Coverage: how many observations actually exposed a metric dimension.
/// Totals should disclose partial coverage instead of implying completeness.
#[derive(Debug, Clone, PartialEq)]
pub struct Coverage {
    pub observation_count: u64,
    pub metric_present_count: u64,
    pub ratio: f64,
}

pub fn coverage(observation_count: u64, metric_present_count: u64) -> Coverage {
    Coverage {
        observation_count,
        metric_present_count,
        ratio: if observation_count == 0 {
            0.0
        } else {
            metric_present_count as f64 / observation_count as f64
        },
    }
}

/// Quota-window liveness from the provider's own reset timestamp only.
/// `None` reset means unknown — rendered as unknown, never synthesized.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowStatus {
    Active { seconds_to_reset: Option<i64> },
    Expired,
}

pub fn window_status(resets_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> (WindowStatus, bool) {
    match resets_at {
        None => (
            WindowStatus::Active {
                seconds_to_reset: None,
            },
            false,
        ),
        Some(r) if r <= now => (WindowStatus::Expired, true),
        Some(r) => (
            WindowStatus::Active {
                seconds_to_reset: Some((r - now).num_seconds().max(0)),
            },
            true,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use usage_halo_core::*;

    fn scope(owner: &str, account: &str) -> AggregateScope {
        AggregateScope {
            billing_owner: Some(owner.into()),
            account_id: Some(account.into()),
            workspace_id: Some("ws".into()),
            currency: Some("USD".into()),
            window_start: Some(Utc::now()),
            window_end: None,
        }
    }

    fn detail_event(owner: &str, model_provider: &str, cost: f64, tokens: u64) -> UsageEvent {
        UsageEvent {
            id: uuid::Uuid::new_v4(),
            provider: "opencode".into(),
            surface: "opencode".into(),
            billing_owner: owner.into(),
            model_provider: Some(model_provider.into()),
            model: Some("model-x".into()),
            account_id: Some("acct".into()),
            workspace_id: None,
            device_id: None,
            session_id: None,
            request_id: None,
            tokens: TokenUsage {
                input: Some(tokens),
                output: Some(0),
                ..Default::default()
            },
            requests: Some(1),
            tool_calls: None,
            active_ms: None,
            lines_added: None,
            lines_removed: None,
            provider_cost: Some(cost),
            estimated_cost: None,
            currency: Some("USD".into()),
            reconciliation_key: None,
            provenance: Provenance {
                source_kind: "test".into(),
                scope: SourceScope::Request,
                authority: SourceAuthority::InstrumentedResponse,
                freshness: FreshnessClass::Live,
                observed_at: Utc::now(),
                provider_timestamp: None,
                confidence: 1.0,
            },
        }
    }

    #[test]
    fn routed_request_bills_the_router_not_the_model_vendor() {
        // application = OpenCode, model_provider = Anthropic,
        // billing_owner = OpenRouter, $0.40 provider-reported.
        let events = vec![detail_event("openrouter", "anthropic", 0.40, 1000)];
        let billed = sums_by_billing_owner(&events);
        assert_eq!(billed.get("openrouter"), Some(&0.40));
        assert!(
            !billed.contains_key("anthropic"),
            "model vendor must not be billed"
        );
        let activity = tokens_by_model(&events);
        assert_eq!(
            activity.get(&("anthropic".to_string(), "model-x".to_string())),
            Some(&1000)
        );
    }

    #[test]
    fn provider_aggregate_and_local_detail_do_not_double_count() {
        let mut agg_scope = scope("openrouter", "acct");
        // Every scope dimension must be known on both sides; window included.
        let end = Utc::now();
        agg_scope.window_end = Some(end);
        let detail_scope = agg_scope.clone();
        let total = resolve_billed_total(0.52, "USD", Some((0.52, &agg_scope)), &detail_scope);
        assert_eq!(total.value, 0.52);
        assert_eq!(total.source, BilledSource::ProviderAggregate);
    }

    #[test]
    fn account_mismatch_blocks_reconciliation() {
        let agg_scope = scope("openrouter", "other-acct");
        let detail_scope = scope("openrouter", "acct");
        let total = resolve_billed_total(0.52, "USD", Some((0.52, &agg_scope)), &detail_scope);
        assert_eq!(total.source, BilledSource::LocalDetail);
    }

    #[test]
    fn currency_mismatch_blocks_reconciliation() {
        let mut agg_scope = scope("openrouter", "acct");
        agg_scope.currency = Some("EUR".into());
        let detail_scope = scope("openrouter", "acct");
        assert!(!scopes_compatible(&detail_scope, &agg_scope));
    }

    #[test]
    fn unknown_scope_dimension_blocks_reconciliation() {
        let agg_scope = scope("openrouter", "acct");
        let mut detail_scope = agg_scope.clone();
        detail_scope.workspace_id = None;
        assert!(!scopes_compatible(&detail_scope, &agg_scope));
    }

    #[test]
    fn canonical_key_requires_stable_source_id() {
        assert_eq!(
            canonical_key("codex", Some("a"), Some("req-1")).as_deref(),
            Some("codex:a:req-1")
        );
        assert_eq!(canonical_key("codex", Some("a"), None), None);
        assert_eq!(canonical_key("codex", Some("a"), Some("")), None);
    }

    #[test]
    fn fallback_fingerprint_ignores_ingest_time_by_construction() {
        let at = Utc::now();
        let a = fallback_fingerprint("codex", Some("a"), Some("m"), &at, Some(1), Some(2));
        let b = fallback_fingerprint("codex", Some("a"), Some("m"), &at, Some(1), Some(2));
        assert_eq!(a, b);
        assert_ne!(
            a,
            fallback_fingerprint("codex", Some("a"), Some("m"), &at, Some(1), Some(3))
        );
    }

    #[test]
    fn unknown_reset_is_active_without_countdown() {
        let now = Utc::now();
        let (status, known) = window_status(None, now);
        assert_eq!(
            status,
            WindowStatus::Active {
                seconds_to_reset: None
            }
        );
        assert!(!known, "unknown reset must be reported, never fabricated");
    }

    #[test]
    fn past_reset_is_expired() {
        let now = Utc::now();
        let (status, known) = window_status(Some(now - chrono::Duration::hours(1)), now);
        assert_eq!(status, WindowStatus::Expired);
        assert!(known);
    }

    #[test]
    fn coverage_reports_partial_dimensions() {
        let c = coverage(100, 93);
        assert!((c.ratio - 0.93).abs() < 1e-9);
        assert_eq!(coverage(0, 0).ratio, 0.0);
    }
}
