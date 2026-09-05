use std::collections::HashMap;
use usage_halo_core::{SourceAuthority, UsageEvent};

pub mod policy;

/// Reconciles only events that carry an explicit reconciliation identity.
/// Events without one are intentionally preserved to avoid false merges.
pub fn select_authoritative_events(events: Vec<UsageEvent>) -> Vec<UsageEvent> {
    let mut keyed: HashMap<String, UsageEvent> = HashMap::new();
    let mut unkeyed = Vec::new();

    for event in events {
        let key = event.reconciliation_key.clone().or_else(|| {
            event
                .request_id
                .as_ref()
                .map(|id| format!("{}:{}", event.billing_owner, id))
        });

        match key {
            None => unkeyed.push(event),
            Some(key) => match keyed.get(&key) {
                None => {
                    keyed.insert(key, event);
                }
                Some(existing) => {
                    if should_replace(existing, &event) {
                        keyed.insert(key, merge_detail(existing.clone(), event));
                    } else {
                        let merged = merge_detail(event, existing.clone());
                        keyed.insert(key, merged);
                    }
                }
            },
        }
    }

    let mut out: Vec<_> = keyed.into_values().collect();
    out.extend(unkeyed);
    out.sort_by_key(|e| e.provenance.observed_at);
    out
}

fn should_replace(current: &UsageEvent, candidate: &UsageEvent) -> bool {
    candidate.provenance.authority > current.provenance.authority
        || (candidate.provenance.authority == current.provenance.authority
            && candidate.provenance.observed_at > current.provenance.observed_at)
}

/// Preserve detailed token dimensions from one observation while preferring
/// authoritative provider-reported billed cost from the winning observation.
fn merge_detail(loser: UsageEvent, mut winner: UsageEvent) -> UsageEvent {
    if winner.tokens.input.is_none() {
        winner.tokens.input = loser.tokens.input;
    }
    if winner.tokens.output.is_none() {
        winner.tokens.output = loser.tokens.output;
    }
    if winner.tokens.reasoning.is_none() {
        winner.tokens.reasoning = loser.tokens.reasoning;
    }
    if winner.tokens.cache_read.is_none() {
        winner.tokens.cache_read = loser.tokens.cache_read;
    }
    if winner.tokens.cache_write.is_none() {
        winner.tokens.cache_write = loser.tokens.cache_write;
    }
    if winner.provider_cost.is_none() {
        winner.provider_cost = loser.provider_cost;
    }
    if winner.estimated_cost.is_none() {
        winner.estimated_cost = loser.estimated_cost;
    }
    winner
}

pub fn authority_label(authority: &SourceAuthority) -> &'static str {
    match authority {
        SourceAuthority::ProviderBilling => "Provider billing",
        SourceAuthority::ProviderTelemetry => "Provider telemetry",
        SourceAuthority::InstrumentedResponse => "Instrumented response",
        SourceAuthority::Derived => "Derived",
        SourceAuthority::Imported => "Imported",
        SourceAuthority::Estimated => "Estimated",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use usage_halo_core::*;
    use uuid::Uuid;

    fn event(authority: SourceAuthority, cost: Option<f64>, input: Option<u64>) -> UsageEvent {
        UsageEvent {
            id: Uuid::new_v4(),
            provider: "openrouter".into(),
            surface: "openrouter".into(),
            billing_owner: "openrouter".into(),
            model_provider: Some("anthropic".into()),
            model: Some("model-x".into()),
            account_id: None,
            workspace_id: None,
            device_id: None,
            session_id: None,
            request_id: Some("req-1".into()),
            tokens: TokenUsage {
                input,
                ..Default::default()
            },
            requests: Some(1),
            tool_calls: None,
            active_ms: None,
            lines_added: None,
            lines_removed: None,
            provider_cost: cost,
            estimated_cost: Some(0.02),
            currency: Some("USD".into()),
            reconciliation_key: Some("openrouter:req-1".into()),
            provenance: Provenance {
                source_kind: "test".into(),
                scope: SourceScope::Request,
                authority,
                freshness: FreshnessClass::Live,
                observed_at: Utc::now(),
                provider_timestamp: None,
                confidence: 1.0,
            },
        }
    }

    #[test]
    fn provider_billing_wins_without_losing_local_token_detail() {
        let local = event(SourceAuthority::InstrumentedResponse, None, Some(5000));
        let billing = event(SourceAuthority::ProviderBilling, Some(0.0198), None);
        let out = select_authoritative_events(vec![local, billing]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider_cost, Some(0.0198));
        assert_eq!(out[0].tokens.input, Some(5000));
    }

    fn authority_from(name: &str) -> SourceAuthority {
        match name {
            "provider_billing" => SourceAuthority::ProviderBilling,
            "provider_telemetry" => SourceAuthority::ProviderTelemetry,
            "instrumented_response" => SourceAuthority::InstrumentedResponse,
            "derived" => SourceAuthority::Derived,
            "imported" => SourceAuthority::Imported,
            _ => SourceAuthority::Estimated,
        }
    }

    /// Shared vectors in fixtures/reconcile-vectors.json are also consumed by
    /// the JS contract tests — both implementations must agree.
    #[test]
    fn shared_vectors_agree_across_implementations() {
        let raw = include_str!("../../../fixtures/reconcile-vectors.json");
        let doc: serde_json::Value = serde_json::from_str(raw).expect("fixture parses");
        let cases = doc["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let mut events = Vec::new();
            for e in case["events"].as_array().unwrap().iter() {
                let key = e["key"].as_str().map(str::to_string);
                let mut ev = event(
                    authority_from(e["authority"].as_str().unwrap()),
                    e["provider_cost"].as_f64(),
                    e["input_tokens"].as_u64(),
                );
                ev.reconciliation_key = key.clone();
                ev.request_id = key
                    .as_ref()
                    .and_then(|k| k.split(':').nth(1).map(str::to_string));
                events.push(ev);
            }
            let out = select_authoritative_events(events);
            let want = &case["expected"];
            assert_eq!(
                out.len(),
                want["count"].as_u64().unwrap() as usize,
                "case {}",
                case["name"]
            );
            if out.len() == 1 {
                if let Some(cost) = want["provider_cost"].as_f64() {
                    assert_eq!(out[0].provider_cost, Some(cost), "case {}", case["name"]);
                }
                if let Some(input) = want["input_tokens"].as_u64() {
                    assert_eq!(out[0].tokens.input, Some(input), "case {}", case["name"]);
                }
            }
        }
    }
}
