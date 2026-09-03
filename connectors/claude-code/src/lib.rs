use async_trait::async_trait;
use chrono::Utc;
use serde_json::{json, Value};
use usage_halo_core::{
    epoch_seconds_to_utc, ConnectorCapabilities, ConnectorError, ConnectorHealth, ConnectorState,
    FreshnessClass, MetricKind, Provenance, QuotaWindow, SourceAuthority, SourceScope,
    UsageConnector, UsageSnapshot,
};

#[derive(Default)]
pub struct ClaudeCodeConnector {
    /// The desktop runtime injects the latest sanitized status-line payload.
    latest: Option<Value>,
}

impl ClaudeCodeConnector {
    pub fn with_payload(payload: Value) -> Self {
        Self {
            latest: Some(payload),
        }
    }

    pub fn sanitize(raw: &Value) -> Value {
        json!({
            "session_id": raw.get("session_id"),
            "version": raw.get("version"),
            "model": {
                "id": raw.pointer("/model/id"),
                "display_name": raw.pointer("/model/display_name")
            },
            "cost": {
                "total_cost_usd": raw.pointer("/cost/total_cost_usd"),
                "total_duration_ms": raw.pointer("/cost/total_duration_ms")
            },
            "context_window": {
                "total_input_tokens": raw.pointer("/context_window/total_input_tokens"),
                "total_output_tokens": raw.pointer("/context_window/total_output_tokens"),
                "context_window_size": raw.pointer("/context_window/context_window_size"),
                "used_percentage": raw.pointer("/context_window/used_percentage"),
                "remaining_percentage": raw.pointer("/context_window/remaining_percentage"),
                "current_usage": raw.pointer("/context_window/current_usage")
            },
            "rate_limits": raw.get("rate_limits"),
            "prompt_cache": raw.get("prompt_cache").map(|pc| json!({
                "warm": pc.get("warm"),
                "hit_ratio": pc.get("hit_ratio"),
                "requests": pc.get("requests"),
                "misses": pc.get("misses")
            }))
        })
    }

    pub fn parse(payload: &Value) -> Result<UsageSnapshot, ConnectorError> {
        let now = Utc::now();
        let mut quotas = Vec::new();

        for (limit_id, label, ptr) in [
            ("five_hour", "5-hour limit", "/rate_limits/five_hour"),
            ("seven_day", "7-day limit", "/rate_limits/seven_day"),
            ("spend_limit", "Spend limit", "/rate_limits/spend_limit"),
        ] {
            let Some(window) = payload.pointer(ptr) else {
                continue;
            };
            let used = window.get("used_percentage").and_then(Value::as_f64);
            if used.is_none() {
                continue;
            }
            let resets = window
                .get("resets_at")
                .and_then(Value::as_i64)
                .and_then(epoch_seconds_to_utc);

            quotas.push(QuotaWindow {
                provider: "claude-code".into(),
                account_id: None,
                limit_id: limit_id.into(),
                label: label.into(),
                metric_kind: MetricKind::QuotaPercent,
                used_value: None,
                limit_value: None,
                used_percent: used,
                remaining_value: used.map(|u| (100.0 - u).max(0.0)),
                window_duration_seconds: match limit_id {
                    "five_hour" => Some(5 * 60 * 60),
                    "seven_day" => Some(7 * 24 * 60 * 60),
                    _ => None,
                },
                resets_at: resets,
                provenance: Provenance {
                    source_kind: "claude_code_statusline".into(),
                    scope: SourceScope::Account,
                    authority: SourceAuthority::ProviderTelemetry,
                    freshness: FreshnessClass::Live,
                    observed_at: now,
                    provider_timestamp: None,
                    confidence: 1.0,
                },
            });
        }

        // Status-line context/token values are snapshots, not incremental usage
        // events. They stay in `extra` so rollup code cannot accidentally sum
        // repeated status-line updates as daily token consumption.
        Ok(UsageSnapshot {
            connector_id: "claude-code".into(),
            events: vec![],
            quotas,
            captured_at: now,
            extra: Self::sanitize(payload),
        })
    }
}

#[async_trait]
impl UsageConnector for ClaudeCodeConnector {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn capabilities(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            live_usage: true,
            account_usage: true,
            model_breakdown: true,
            token_breakdown: true,
            cost: true,
            quota_windows: true,
            context_pressure: true,
            ..Default::default()
        }
    }

    async fn snapshot(&self) -> usage_halo_core::Result<UsageSnapshot> {
        let payload = self.latest.as_ref().ok_or_else(|| {
            ConnectorError::Unavailable("waiting for Claude Code status-line event".into())
        })?;
        Self::parse(payload)
    }

    async fn health(&self) -> ConnectorHealth {
        ConnectorHealth {
            connector_id: self.id().into(),
            state: if self.latest.is_some() {
                ConnectorState::Healthy
            } else {
                ConnectorState::Offline
            },
            last_success: self.latest.as_ref().map(|_| Utc::now()),
            last_attempt: Utc::now(),
            expected_refresh_seconds: None,
            message: if self.latest.is_none() {
                Some("Waiting for first Claude Code session event".into())
            } else {
                None
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizer_drops_sensitive_path_fields() {
        let raw = json!({
            "session_id": "s1",
            "transcript_path": "/secret/transcript.jsonl",
            "workspace": {"current_dir": "/secret/project"},
            "model": {"id": "claude-x", "display_name": "Claude X"},
            "rate_limits": {"five_hour": {"used_percentage": 42.0, "resets_at": 1900000000}}
        });
        let sanitized = ClaudeCodeConnector::sanitize(&raw);
        assert!(sanitized.get("transcript_path").is_none());
        assert!(sanitized.get("workspace").is_none());
    }

    #[test]
    fn parses_quota_without_creating_sumable_token_event() {
        let raw = json!({
            "model": {"id": "claude-x"},
            "context_window": {"current_usage": {"input_tokens": 1000}},
            "rate_limits": {
                "five_hour": {"used_percentage": 73.0, "resets_at": 1900000000},
                "seven_day": {"used_percentage": 21.0, "resets_at": 1900500000}
            }
        });
        let snapshot = ClaudeCodeConnector::parse(&raw).unwrap();
        assert_eq!(snapshot.quotas.len(), 2);
        assert!(snapshot.events.is_empty());
    }
}
