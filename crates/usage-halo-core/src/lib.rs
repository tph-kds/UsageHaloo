use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, ConnectorError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetricKind {
    QuotaPercent,
    Tokens,
    Cost,
    Credits,
    Requests,
    ContextPercent,
    ToolCalls,
    Sessions,
    ActiveSeconds,
    Lines,
    Balance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceAuthority {
    Estimated,
    Imported,
    Derived,
    InstrumentedResponse,
    ProviderTelemetry,
    ProviderBilling,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceScope {
    Request,
    Session,
    Device,
    Account,
    Workspace,
    Organization,
    InstrumentedTrafficOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessClass {
    Live,
    Fresh,
    Hourly,
    Daily,
    Manual,
    Stale,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorState {
    Healthy,
    Degraded,
    AuthRequired,
    PermissionDenied,
    RateLimited,
    Stale,
    UnsupportedVersion,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub reasoning: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    pub tool: Option<u64>,
}

impl TokenUsage {
    pub fn known_total(&self) -> u64 {
        [
            self.input,
            self.output,
            self.reasoning,
            self.cache_read,
            self.cache_write,
            self.tool,
        ]
        .into_iter()
        .flatten()
        .sum()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source_kind: String,
    pub scope: SourceScope,
    pub authority: SourceAuthority,
    pub freshness: FreshnessClass,
    pub observed_at: DateTime<Utc>,
    pub provider_timestamp: Option<DateTime<Utc>>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub id: Uuid,
    pub provider: String,
    pub surface: String,
    pub billing_owner: String,
    pub model_provider: Option<String>,
    pub model: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub device_id: Option<String>,
    pub session_id: Option<String>,
    pub request_id: Option<String>,
    pub tokens: TokenUsage,
    pub requests: Option<u64>,
    pub tool_calls: Option<u64>,
    pub active_ms: Option<u64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub provider_cost: Option<f64>,
    pub estimated_cost: Option<f64>,
    pub currency: Option<String>,
    pub reconciliation_key: Option<String>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaWindow {
    pub provider: String,
    pub account_id: Option<String>,
    pub limit_id: String,
    pub label: String,
    pub metric_kind: MetricKind,
    pub used_value: Option<f64>,
    pub limit_value: Option<f64>,
    pub used_percent: Option<f64>,
    pub remaining_value: Option<f64>,
    pub window_duration_seconds: Option<u64>,
    pub resets_at: Option<DateTime<Utc>>,
    pub provenance: Provenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConnectorCapabilities {
    pub live_usage: bool,
    pub account_usage: bool,
    pub model_breakdown: bool,
    pub token_breakdown: bool,
    pub cost: bool,
    pub credits: bool,
    pub quota_windows: bool,
    pub context_pressure: bool,
    pub tools: bool,
    pub activity: bool,
    pub organization_scope: bool,
    pub historical_backfill: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub connector_id: String,
    pub events: Vec<UsageEvent>,
    pub quotas: Vec<QuotaWindow>,
    pub captured_at: DateTime<Utc>,
    pub extra: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorHealth {
    pub connector_id: String,
    pub state: ConnectorState,
    pub last_success: Option<DateTime<Utc>>,
    pub last_attempt: DateTime<Utc>,
    pub expected_refresh_seconds: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConnectorError {
    #[error("authentication required: {0}")]
    Auth(String),
    #[error("permission denied: {0}")]
    Permission(String),
    #[error("provider rate limited: {0}")]
    RateLimited(String),
    #[error("unsupported provider version: {0}")]
    UnsupportedVersion(String),
    #[error("provider unavailable: {0}")]
    Unavailable(String),
    #[error("invalid provider payload: {0}")]
    InvalidPayload(String),
    #[error("connector failure: {0}")]
    Other(String),
}

#[async_trait]
pub trait UsageConnector: Send + Sync {
    fn id(&self) -> &'static str;
    fn capabilities(&self) -> ConnectorCapabilities;
    async fn snapshot(&self) -> Result<UsageSnapshot>;
    async fn quota_windows(&self) -> Result<Vec<QuotaWindow>> {
        Ok(self.snapshot().await?.quotas)
    }
    async fn health(&self) -> ConnectorHealth;
}

pub fn epoch_seconds_to_utc(value: i64) -> Option<DateTime<Utc>> {
    DateTime::<Utc>::from_timestamp(value, 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_total_only_counts_known_fields() {
        let usage = TokenUsage {
            input: Some(100),
            output: Some(20),
            cache_read: Some(50),
            ..Default::default()
        };
        assert_eq!(usage.known_total(), 170);
    }

    #[test]
    fn authority_order_prefers_provider_billing() {
        assert!(SourceAuthority::ProviderBilling > SourceAuthority::InstrumentedResponse);
        assert!(SourceAuthority::ProviderTelemetry > SourceAuthority::Estimated);
    }
}
