use chrono::Utc;
use serde::Deserialize;
use usage_halo_core::{
    FreshnessClass, Provenance, SourceAuthority, SourceScope, TokenUsage, UsageEvent,
};
use uuid::Uuid;

/// Request-level Anthropic response usage normalizer.
/// This is intentionally separate from any account/admin usage connector:
/// instrumented traffic is not account-wide usage.
#[derive(Debug, Clone, Deserialize)]
pub struct AnthropicResponseUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_input_tokens: Option<u64>,
    pub cache_read_input_tokens: Option<u64>,
}

pub fn from_instrumented_response(
    request_id: Option<String>,
    model: String,
    usage: AnthropicResponseUsage,
) -> UsageEvent {
    UsageEvent {
        id: Uuid::new_v4(),
        provider: "anthropic-api".into(),
        surface: "anthropic-api".into(),
        billing_owner: "anthropic".into(),
        model_provider: Some("anthropic".into()),
        model: Some(model),
        account_id: None,
        workspace_id: None,
        device_id: None,
        session_id: None,
        request_id: request_id.clone(),
        tokens: TokenUsage {
            input: usage.input_tokens,
            output: usage.output_tokens,
            reasoning: None,
            cache_read: usage.cache_read_input_tokens,
            cache_write: usage.cache_creation_input_tokens,
            tool: None,
        },
        requests: Some(1),
        tool_calls: None,
        active_ms: None,
        lines_added: None,
        lines_removed: None,
        provider_cost: None,
        estimated_cost: None,
        currency: None,
        reconciliation_key: request_id.map(|id| format!("anthropic:{id}")),
        provenance: Provenance {
            source_kind: "anthropic_instrumented_response".into(),
            scope: SourceScope::InstrumentedTrafficOnly,
            authority: SourceAuthority::InstrumentedResponse,
            freshness: FreshnessClass::Live,
            observed_at: Utc::now(),
            provider_timestamp: None,
            confidence: 1.0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instrumented_response_maps_cache_dimensions_and_keys_off_request() {
        let e = from_instrumented_response(
            Some("req-9".into()),
            "claude-3-5-sonnet".into(),
            AnthropicResponseUsage {
                input_tokens: Some(1000),
                output_tokens: Some(200),
                cache_creation_input_tokens: Some(5000),
                cache_read_input_tokens: Some(9000),
            },
        );
        assert_eq!(e.tokens.input, Some(1000));
        assert_eq!(e.tokens.cache_write, Some(5000));
        assert_eq!(e.tokens.cache_read, Some(9000));
        assert_eq!(e.reconciliation_key.as_deref(), Some("anthropic:req-9"));
        // Instrumented traffic is never account-wide usage.
        assert_eq!(e.provenance.scope, SourceScope::InstrumentedTrafficOnly);
        assert_eq!(
            e.provenance.authority,
            SourceAuthority::InstrumentedResponse
        );
        assert!(e.provider_cost.is_none());
    }
}
