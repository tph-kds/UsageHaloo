use async_trait::async_trait;
use chrono::Utc;
use serde::Deserialize;
use usage_halo_core::{
    ConnectorCapabilities, ConnectorError, ConnectorHealth, ConnectorState, FreshnessClass,
    MetricKind, Provenance, QuotaWindow, SourceAuthority, SourceScope, UsageConnector,
    UsageSnapshot,
};

#[derive(Clone)]
pub struct OpenRouterConnector {
    client: reqwest::Client,
    management_key: String,
}

#[derive(Debug, Deserialize)]
struct CreditsEnvelope {
    data: Credits,
}
#[derive(Debug, Deserialize)]
struct Credits {
    total_credits: f64,
    total_usage: f64,
}

impl OpenRouterConnector {
    pub fn new(management_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            management_key: management_key.into(),
        }
    }

    /// Pure credits → quota-window mapping (total_credits <= 0 yields no
    /// percentage — never a fake 0%/100%).
    pub fn credits_quota(
        total_credits: f64,
        total_usage: f64,
        now: chrono::DateTime<chrono::Utc>,
    ) -> QuotaWindow {
        let remaining = (total_credits - total_usage).max(0.0);
        let pct = if total_credits > 0.0 {
            Some(total_usage / total_credits * 100.0)
        } else {
            None
        };
        QuotaWindow {
            provider: "openrouter".into(),
            account_id: None,
            limit_id: "credits".into(),
            label: "Credits used".into(),
            metric_kind: MetricKind::Credits,
            used_value: Some(total_usage),
            limit_value: Some(total_credits),
            used_percent: pct,
            remaining_value: Some(remaining),
            window_duration_seconds: None,
            resets_at: None,
            provenance: Provenance {
                source_kind: "openrouter_credits_api".into(),
                scope: SourceScope::Account,
                authority: SourceAuthority::ProviderBilling,
                freshness: FreshnessClass::Fresh,
                observed_at: now,
                provider_timestamp: None,
                confidence: 1.0,
            },
        }
    }

    async fn credits(&self) -> usage_halo_core::Result<Credits> {
        let response = self
            .client
            .get("https://openrouter.ai/api/v1/credits")
            .bearer_auth(&self.management_key)
            .send()
            .await
            .map_err(|e| ConnectorError::Unavailable(e.to_string()))?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(ConnectorError::Auth(
                "OpenRouter management key rejected".into(),
            ));
        }
        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(ConnectorError::Permission(
                "OpenRouter credits endpoint requires a management key".into(),
            ));
        }
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(ConnectorError::RateLimited(
                "OpenRouter credits endpoint".into(),
            ));
        }
        let response = response
            .error_for_status()
            .map_err(|e| ConnectorError::Unavailable(e.to_string()))?;
        response
            .json::<CreditsEnvelope>()
            .await
            .map(|v| v.data)
            .map_err(|e| ConnectorError::InvalidPayload(e.to_string()))
    }
}

#[async_trait]
impl UsageConnector for OpenRouterConnector {
    fn id(&self) -> &'static str {
        "openrouter"
    }

    fn capabilities(&self) -> ConnectorCapabilities {
        ConnectorCapabilities {
            account_usage: true,
            cost: true,
            credits: true,
            quota_windows: true,
            ..Default::default()
        }
    }

    async fn snapshot(&self) -> usage_halo_core::Result<UsageSnapshot> {
        let c = self.credits().await?;
        let now = Utc::now();
        let quota = Self::credits_quota(c.total_credits, c.total_usage, now);
        let remaining = quota.remaining_value.unwrap_or(0.0);
        Ok(UsageSnapshot {
            connector_id: self.id().into(),
            events: vec![],
            quotas: vec![quota],
            captured_at: now,
            extra: serde_json::json!({"total_credits": c.total_credits, "total_usage": c.total_usage, "remaining": remaining}),
        })
    }

    async fn health(&self) -> ConnectorHealth {
        ConnectorHealth {
            connector_id: self.id().into(),
            state: ConnectorState::Healthy,
            last_success: None,
            last_attempt: Utc::now(),
            expected_refresh_seconds: Some(300),
            message: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credits_math_never_invents_a_percentage() {
        let q = OpenRouterConnector::credits_quota(100.5, 25.75, Utc::now());
        assert!((q.used_percent.unwrap() - 25.621).abs() < 0.01);
        assert_eq!(q.remaining_value, Some(74.75));
        assert_eq!(q.provenance.authority, SourceAuthority::ProviderBilling);
        // Zero/negative totals: no percentage rather than 0% or 100%.
        assert_eq!(
            OpenRouterConnector::credits_quota(0.0, 5.0, Utc::now()).used_percent,
            None
        );
        // Over-spend clamps remaining at zero but keeps the true ratio.
        let over = OpenRouterConnector::credits_quota(10.0, 12.0, Utc::now());
        assert_eq!(over.remaining_value, Some(0.0));
        assert_eq!(over.used_percent, Some(120.0));
    }
}
