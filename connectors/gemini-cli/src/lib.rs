use chrono::Utc;
use serde::{Deserialize, Serialize};
use usage_halo_core::{
    FreshnessClass, Provenance, SourceAuthority, SourceScope, TokenUsage, UsageEvent,
};
use uuid::Uuid;

/// Normalized record emitted by the OTLP receiver after dropping any prompt or
/// message body attributes. The production receiver should translate protobuf
/// OTLP metrics/spans into this type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiTokenMetric {
    pub model: String,
    pub token_type: String,
    pub value: u64,
    pub session_id: Option<String>,
    pub observed_unix_ms: Option<i64>,
}

pub fn normalize(metric: GeminiTokenMetric) -> UsageEvent {
    let mut tokens = TokenUsage::default();
    match metric.token_type.as_str() {
        "input" => tokens.input = Some(metric.value),
        "output" => tokens.output = Some(metric.value),
        "thought" => tokens.reasoning = Some(metric.value),
        "cache" => tokens.cache_read = Some(metric.value),
        "tool" => tokens.tool = Some(metric.value),
        _ => {}
    }

    UsageEvent {
        id: Uuid::new_v4(),
        provider: "gemini-cli".into(),
        surface: "gemini-cli".into(),
        billing_owner: "google-gemini-cli".into(),
        model_provider: Some("google".into()),
        model: Some(metric.model),
        account_id: None,
        workspace_id: None,
        device_id: None,
        session_id: metric.session_id,
        request_id: None,
        tokens,
        requests: None,
        tool_calls: if metric.token_type == "tool" {
            Some(1)
        } else {
            None
        },
        active_ms: None,
        lines_added: None,
        lines_removed: None,
        provider_cost: None,
        estimated_cost: None,
        currency: None,
        reconciliation_key: None,
        provenance: Provenance {
            source_kind: "gemini_cli_otel".into(),
            scope: SourceScope::Device,
            authority: SourceAuthority::ProviderTelemetry,
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

    fn metric(token_type: &str, value: u64) -> GeminiTokenMetric {
        GeminiTokenMetric {
            model: "gemini-1.5-pro".into(),
            token_type: token_type.into(),
            value,
            session_id: Some("s1".into()),
            observed_unix_ms: None,
        }
    }

    #[test]
    fn token_types_land_in_the_right_dimension() {
        assert_eq!(normalize(metric("input", 500)).tokens.input, Some(500));
        assert_eq!(normalize(metric("output", 120)).tokens.output, Some(120));
        assert_eq!(normalize(metric("thought", 30)).tokens.reasoning, Some(30));
        assert_eq!(normalize(metric("cache", 40)).tokens.cache_read, Some(40));
        assert_eq!(normalize(metric("tool", 7)).tokens.tool, Some(7));
    }

    #[test]
    fn unknown_token_type_yields_no_dimensions_but_keeps_provenance() {
        let e = normalize(metric("bogus", 9));
        assert_eq!(e.tokens.known_total(), 0);
        assert_eq!(e.provenance.authority, SourceAuthority::ProviderTelemetry);
        assert_eq!(e.provenance.scope, SourceScope::Device);
        assert_eq!(e.model_provider.as_deref(), Some("google"));
    }
}
