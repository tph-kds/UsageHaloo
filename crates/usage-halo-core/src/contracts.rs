//! Canonical data contracts (remediation Phase 1, doc `14_CANONICAL_DATA_CONTRACTS`).
//!
//! These types are the single source of truth for every user-visible metric:
//! typed numeric values plus explicit truth metadata (unit, window, source,
//! authority, freshness, scope). Display strings are never the domain model —
//! formatting happens once at the UI boundary (`contracts.ts` mirrors these
//! shapes for the Svelte frontend).
//!
//! Wire format is `snake_case` to match the existing snapshot APIs.
//! Names are adapted to repository conventions where the legacy domain model
//! already owns a name (`DataKind` instead of a second `SourceAuthority`,
//! `MetricProvenance` instead of a second `Provenance`); semantics follow the
//! remediation package exactly.
//!
//! Legacy domain types in the crate root (`SourceAuthority`, `FreshnessClass`,
//! `Provenance`, …) predate this contract. New code must use this module;
//! `From` conversions below define the honest mapping for old values.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Snapshot/projection wire schema version. Adapters reject anything else
/// with a clear update error instead of silently misreading fields.
pub const SCHEMA_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/// Unit of a numeric metric. Percent is always canonical 0–100, never a 0–1
/// fraction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MetricUnit {
    Percent,
    Tokens,
    Requests,
    Credits,
    Seconds,
    Bytes,
    Currency,
}

/// Where a metric value comes from. `Sample` is provenance, never the
/// opposite of live: a stale real observation is `ProviderReported` /
/// `LocallyObserved` with `FreshnessState::Stale` and `sample == false`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataKind {
    ProviderReported,
    LocallyObserved,
    Reconciled,
    Estimated,
    Sample,
}

/// Freshness derives from `now - observed_at` against a source-specific
/// cadence policy. `Delayed` is reserved for the Phase 3 freshness policy;
/// current policies emit the other four states.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessState {
    Live,
    Fresh,
    Delayed,
    Stale,
    Unknown,
}

/// Connector reachability/configuration. Never conflated with data freshness.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Unconfigured,
    Configured,
    Connecting,
    Connected,
    AuthError,
    RateLimited,
    Unavailable,
    Disabled,
}

/// Whether a metric can be shown at all. Missing data is `NoDataYet` /
/// `Unsupported`, rendered as `—`, never as zero.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityState {
    Available,
    NoDataYet,
    Unsupported,
    InsufficientScope,
    InsufficientEvidence,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WindowKind {
    Instant,
    CalendarDay,
    CalendarMonth,
    Rolling,
    ProviderWindow,
    BillingCycle,
    LifetimeBalance,
}

/// A reset timestamp is authoritative only from the provider (or an explicit
/// documented policy). Otherwise it is `Unknown` and rendered as unknown.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResetSource {
    Provider,
    CalculatedPolicy,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Supported,
    Partial,
    RequiresUserInstrumentation,
    RequiresAdminScope,
    UnsupportedByProvider,
    Experimental,
    Planned,
    /// Not yet assessed. The default for every cell until a connector proves
    /// otherwise with fixtures and (for L5) live verification — claiming
    /// support without evidence is what the remediation removes.
    Unknown,
}

/// Connector maturity: L0 registry-only … L5 evidence-quality. A connector
/// is "complete" only at L5 for its declared capabilities.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Maturity {
    L0,
    L1,
    L2,
    L3,
    L4,
    L5,
}

// ---------------------------------------------------------------------------
// Metric building blocks
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetricWindow {
    pub kind: WindowKind,
    pub id: Option<String>,
    pub start_at: Option<DateTime<Utc>>,
    pub end_at: Option<DateTime<Utc>>,
    pub reset_at: Option<DateTime<Utc>>,
    pub reset_source: ResetSource,
    /// IANA timezone for calendar windows, e.g. `Asia/Ho_Chi_Minh`.
    pub timezone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MetricCoverage {
    pub observation_count: u64,
    pub metric_present_count: u64,
    /// 0..1 fraction of observations that exposed this metric.
    pub ratio: f64,
    pub source_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetricProvenance {
    pub source_connector: String,
    pub authority: DataKind,
    /// Source measurement time. Never refreshed by re-reading the same data.
    pub observed_at: Option<DateTime<Utc>>,
    pub received_at: Option<DateTime<Utc>>,
    pub ingested_at: Option<DateTime<Utc>>,
    pub freshness: FreshnessState,
    pub age_seconds: Option<i64>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub scope_label: Option<String>,
    pub sample: bool,
}

impl MetricProvenance {
    /// Release-blocking invariant: `sample == true` iff authority is sample.
    /// A real stale observation has `sample == false`.
    pub fn check_sample_invariant(&self) -> bool {
        self.sample == (self.authority == DataKind::Sample)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NumericMetric {
    pub key: String,
    pub label: String,
    /// Null means unavailable — never zero unless the source reported zero.
    pub value: Option<f64>,
    pub unit: MetricUnit,
    pub availability: AvailabilityState,
    pub window: Option<MetricWindow>,
    pub provenance: MetricProvenance,
    pub coverage: Option<MetricCoverage>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CostKind {
    ProviderCost,
    EstimatedCost,
    SubscriptionCost,
    Budget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MoneyMetric {
    pub key: String,
    pub label: String,
    /// Exact decimal string (`"3.1234"`), never binary float. Null = unknown.
    pub amount: Option<String>,
    pub currency: Option<String>,
    pub kind: CostKind,
    pub availability: AvailabilityState,
    pub window: Option<MetricWindow>,
    pub provenance: MetricProvenance,
    pub coverage: Option<MetricCoverage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CostEstimateMetadata {
    pub pricing_source: String,
    pub pricing_version: String,
    pub effective_at: DateTime<Utc>,
    pub model_coverage_ratio: f64,
}

/// True for non-negative decimal strings like `"0"`, `"3.12"`, `"1423221"`.
pub fn is_decimal_amount(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut parts = s.split('.');
    let int = parts.next().unwrap_or("");
    if int.is_empty() || !int.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    match parts.next() {
        None => true,
        Some(frac) => {
            if frac.is_empty() || !frac.bytes().all(|b| b.is_ascii_digit()) {
                return false;
            }
            parts.next().is_none()
        }
    }
}

// ---------------------------------------------------------------------------
// Provider / overview projections
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub detection: CapabilityStatus,
    pub usage_events: CapabilityStatus,
    pub tokens: CapabilityStatus,
    pub models: CapabilityStatus,
    pub provider_cost: CapabilityStatus,
    pub quota_windows: CapabilityStatus,
    pub reset_at: CapabilityStatus,
    pub credits: CapabilityStatus,
    pub historical_usage: CapabilityStatus,
    pub organization_scope: CapabilityStatus,
    pub account_scope: CapabilityStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthError {
    pub class: HealthErrorClass,
    pub safe_code: Option<String>,
    /// Human-readable, redacted: never secrets, headers, or raw payloads.
    pub safe_message: String,
    pub http_status: Option<u16>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HealthErrorClass {
    Auth,
    Permission,
    RateLimit,
    Network,
    Provider,
    Parse,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorHealthView {
    pub connector_id: String,
    pub provider_id: String,
    pub account_id: Option<String>,
    pub connection: ConnectionState,
    pub first_seen_at: Option<DateTime<Utc>>,
    pub last_attempt_at: Option<DateTime<Utc>>,
    /// Preserved across failures: a failed poll updates failure fields only.
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_failure_at: Option<DateTime<Utc>>,
    pub last_observation_at: Option<DateTime<Utc>>,
    pub consecutive_failures: u32,
    pub retry_after_at: Option<DateTime<Utc>>,
    pub error: Option<HealthError>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttentionSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttentionReason {
    QuotaNearLimit,
    BudgetNearLimit,
    CreditsLow,
    StaleData,
    AuthError,
    ConnectorUnavailable,
    ForecastExhaustion,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttentionState {
    pub severity: AttentionSeverity,
    pub reason: AttentionReason,
    pub title: String,
    pub detail: String,
    pub actionable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProviderProjection {
    pub id: String,
    pub display_name: String,
    pub maturity: Maturity,
    pub capabilities: ProviderCapabilities,
    pub detected: Option<bool>,
    pub health: Vec<ConnectorHealthView>,
    pub primary_metric: Option<MetricValue>,
    pub quota_windows: Vec<NumericMetric>,
    pub credits: Option<MetricValue>,
    pub tokens_today: Option<NumericMetric>,
    pub requests_today: Option<NumericMetric>,
    pub provider_cost_today: Option<MoneyMetric>,
    pub estimated_cost_today: Option<MoneyMetric>,
    pub attention: Option<AttentionState>,
}

/// Either numeric or money primary metric — never a formatted string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MetricValue {
    Numeric(NumericMetric),
    Money(MoneyMetric),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DataHealthProjection {
    pub fresh_provider_count: u32,
    pub delayed_provider_count: u32,
    pub stale_provider_count: u32,
    pub error_provider_count: u32,
    pub unconfigured_provider_count: u32,
    pub latest_observation_at: Option<DateTime<Utc>>,
    pub oldest_active_observation_at: Option<DateTime<Utc>>,
}

/// Canonical overview. No heterogeneous global percent: compatible totals
/// only, each with its own provenance and coverage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OverviewProjection {
    pub schema_version: u32,
    pub generated_at: DateTime<Utc>,
    pub timezone: String,
    pub mode: AppMode,
    pub backend_state: BackendState,
    pub last_successful_projection_at: Option<DateTime<Utc>>,
    pub providers: Vec<ProviderProjection>,
    pub attention: Vec<AttentionState>,
    pub observed_tokens_today: Option<NumericMetric>,
    pub observed_requests_today: Option<NumericMetric>,
    pub provider_cost_today_by_currency: Vec<MoneyMetric>,
    pub data_health: DataHealthProjection,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    Production,
    Demo,
    Test,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackendState {
    Healthy,
    Degraded,
    Unavailable,
}

// ---------------------------------------------------------------------------
// Observations, activity, forecast, budgets, alerts
// ---------------------------------------------------------------------------

/// Canonical raw usage observation. No prompt/completion fields by design.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UsageObservation {
    pub id: String,
    pub source_event_id: Option<String>,
    pub source_connector: String,
    pub source_authority: DataKind,
    pub observed_at: DateTime<Utc>,
    pub received_at: DateTime<Utc>,
    pub ingested_at: DateTime<Utc>,
    pub application_surface: Option<String>,
    pub model_provider: Option<String>,
    pub model_id: Option<String>,
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub request_count: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub provider_cost: Option<CostAmount>,
    pub estimated_cost: Option<CostAmount>,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CostAmount {
    /// Exact decimal string.
    pub amount: String,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuotaObservation {
    pub id: String,
    pub provider_id: String,
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub metric_key: String,
    pub window_id: String,
    pub used_value: Option<f64>,
    pub limit_value: Option<f64>,
    /// Nullable even when used/limit exist if denominator semantics forbid it.
    pub percent_used: Option<f64>,
    pub unit: MetricUnit,
    pub window_start_at: Option<DateTime<Utc>>,
    pub window_end_at: Option<DateTime<Utc>>,
    pub reset_at: Option<DateTime<Utc>>,
    pub reset_source: ResetSource,
    pub observed_at: DateTime<Utc>,
    pub source_connector: String,
    pub source_authority: DataKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityQuery {
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
    /// IANA timezone for bucket boundaries.
    pub timezone: String,
    pub bucket: ActivityBucketSize,
    pub metric: String,
    pub provider_ids: Vec<String>,
    pub model_providers: Vec<String>,
    pub model_ids: Vec<String>,
    pub billing_owners: Vec<String>,
    pub applications: Vec<String>,
    pub project_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityBucketSize {
    Hour,
    Day,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityBucket {
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub value: f64,
    pub unit: MetricUnit,
    pub observation_count: u64,
    pub coverage: Option<MetricCoverage>,
    pub provider_reported: u64,
    pub locally_observed: u64,
    pub reconciled: u64,
    pub estimated: u64,
    /// Production buckets normally carry zero sample counts.
    pub sample: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityRow {
    pub canonical_id: String,
    pub observed_at: DateTime<Utc>,
    pub application_surface: Option<String>,
    pub model_provider: Option<String>,
    pub model_id: Option<String>,
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub project_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_tokens: Option<u64>,
    pub provider_cost: Option<MoneyMetric>,
    pub estimated_cost: Option<MoneyMetric>,
    pub provenance: MetricProvenance,
}

/// Forecast result. Insufficient evidence is an explicit state, never a
/// fabricated ETA.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ForecastResult {
    Available {
        metric_key: String,
        method: String,
        estimated_at: DateTime<Utc>,
        /// 0..1 confidence with evidence metadata.
        confidence: f64,
        sample_count: u64,
        observation_span_seconds: u64,
        input_freshness: FreshnessState,
        estimated_exhaustion_at: Option<DateTime<Utc>>,
        projected_period_end_value: Option<f64>,
    },
    InsufficientEvidence {
        reason: String,
    },
    StaleInput {
        reason: String,
    },
    Unsupported {
        reason: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Budget {
    pub id: String,
    pub enabled: bool,
    pub label: String,
    pub billing_owner: Option<String>,
    pub provider_id: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub metric_key: String,
    pub unit: MetricUnit,
    pub money_currency: Option<String>,
    /// Decimal-safe string for money; parsed according to `unit`.
    pub limit_value: String,
    pub period_kind: BudgetPeriodKind,
    pub period_timezone: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BudgetPeriodKind {
    CalendarDay,
    CalendarMonth,
    BillingCycle,
    Rolling,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlertRule {
    pub id: String,
    pub enabled: bool,
    pub label: String,
    pub provider_id: Option<String>,
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub metric_key: String,
    pub window_id: Option<String>,
    pub operator: AlertOperator,
    pub threshold: f64,
    pub allowed_freshness: Vec<FreshnessState>,
    pub cooldown_seconds: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlertOperator {
    #[serde(rename = ">=")]
    GreaterOrEqual,
    #[serde(rename = ">")]
    Greater,
    #[serde(rename = "<=")]
    LessOrEqual,
    #[serde(rename = "<")]
    Less,
}

impl AlertRule {
    /// Scope matching is enforced by the evaluator: a rule matches a metric
    /// only when every specified scope dimension equals the metric's.
    pub fn matches_scope(
        &self,
        provider_id: Option<&str>,
        billing_owner: Option<&str>,
        account_id: Option<&str>,
    ) -> bool {
        if let Some(want) = self.provider_id.as_deref() {
            if provider_id != Some(want) {
                return false;
            }
        }
        if let Some(want) = self.billing_owner.as_deref() {
            if billing_owner != Some(want) {
                return false;
            }
        }
        if let Some(want) = self.account_id.as_deref() {
            if account_id != Some(want) {
                return false;
            }
        }
        true
    }
}

// ---------------------------------------------------------------------------
// Honest conversions from legacy domain types
// ---------------------------------------------------------------------------

use super::{FreshnessClass, SourceAuthority};

impl From<SourceAuthority> for DataKind {
    fn from(a: SourceAuthority) -> Self {
        match a {
            SourceAuthority::ProviderBilling | SourceAuthority::ProviderTelemetry => {
                DataKind::ProviderReported
            }
            SourceAuthority::InstrumentedResponse | SourceAuthority::Imported => {
                DataKind::LocallyObserved
            }
            SourceAuthority::Derived => DataKind::Reconciled,
            SourceAuthority::Estimated => DataKind::Estimated,
        }
    }
}

impl From<FreshnessClass> for FreshnessState {
    /// `Hourly`/`Daily`/`Manual` described expected cadence, not observation
    /// age, so they convert to `Unknown` rather than inventing freshness.
    /// Callers must compute real freshness from `observed_at` instead.
    fn from(f: FreshnessClass) -> Self {
        match f {
            FreshnessClass::Live => FreshnessState::Live,
            FreshnessClass::Fresh => FreshnessState::Fresh,
            FreshnessClass::Stale => FreshnessState::Stale,
            FreshnessClass::Hourly | FreshnessClass::Daily | FreshnessClass::Manual => {
                FreshnessState::Unknown
            }
            FreshnessClass::Unknown => FreshnessState::Unknown,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provenance(authority: DataKind, freshness: FreshnessState) -> MetricProvenance {
        MetricProvenance {
            source_connector: "test".into(),
            authority,
            observed_at: Some(Utc::now()),
            received_at: None,
            ingested_at: Some(Utc::now()),
            freshness,
            age_seconds: Some(8),
            account_id: None,
            workspace_id: None,
            scope_label: None,
            sample: authority == DataKind::Sample,
        }
    }

    #[test]
    fn stale_real_data_is_never_sample() {
        let p = provenance(DataKind::ProviderReported, FreshnessState::Stale);
        assert!(p.check_sample_invariant());
        assert!(!p.sample);
    }

    #[test]
    fn sample_requires_sample_authority() {
        let mut p = provenance(DataKind::LocallyObserved, FreshnessState::Fresh);
        p.sample = true; // corrupt labeling
        assert!(!p.check_sample_invariant());
    }

    #[test]
    fn legacy_cadence_labels_become_unknown_not_fresh() {
        assert_eq!(
            FreshnessState::from(FreshnessClass::Hourly),
            FreshnessState::Unknown
        );
        assert_eq!(
            FreshnessState::from(FreshnessClass::Daily),
            FreshnessState::Unknown
        );
        assert_eq!(
            FreshnessState::from(FreshnessClass::Live),
            FreshnessState::Live
        );
    }

    #[test]
    fn legacy_authority_maps_to_canonical_kind() {
        assert_eq!(
            DataKind::from(SourceAuthority::ProviderBilling),
            DataKind::ProviderReported
        );
        assert_eq!(
            DataKind::from(SourceAuthority::Derived),
            DataKind::Reconciled
        );
    }

    #[test]
    fn money_rejects_non_decimal_amounts() {
        assert!(is_decimal_amount("3.1234"));
        assert!(is_decimal_amount("0"));
        assert!(!is_decimal_amount(""));
        assert!(!is_decimal_amount("1.42M"));
        assert!(!is_decimal_amount("$3.12"));
        assert!(!is_decimal_amount("71%"));
        assert!(!is_decimal_amount("-1.5"));
        assert!(!is_decimal_amount("1.2.3"));
    }

    #[test]
    fn overview_projection_serializes_snake_case_with_schema_version() {
        let o = OverviewProjection {
            schema_version: SCHEMA_VERSION,
            generated_at: Utc::now(),
            timezone: "Asia/Ho_Chi_Minh".into(),
            mode: AppMode::Production,
            backend_state: BackendState::Healthy,
            last_successful_projection_at: None,
            providers: vec![],
            attention: vec![],
            observed_tokens_today: None,
            observed_requests_today: None,
            provider_cost_today_by_currency: vec![],
            data_health: DataHealthProjection {
                fresh_provider_count: 0,
                delayed_provider_count: 0,
                stale_provider_count: 0,
                error_provider_count: 0,
                unconfigured_provider_count: 0,
                latest_observation_at: None,
                oldest_active_observation_at: None,
            },
        };
        let v: serde_json::Value = serde_json::to_value(&o).unwrap();
        assert_eq!(v["schema_version"], 1);
        assert_eq!(v["mode"], "production");
        assert!(v.get("percentUsed").is_none());
        assert!(v.get("observedTokensToday").is_none());
    }

    #[test]
    fn forecast_insufficient_evidence_is_explicit() {
        let f = ForecastResult::InsufficientEvidence {
            reason: "Need at least 5 non-stale observations spanning 15 minutes".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&f).unwrap();
        assert!(v.get("insufficient_evidence").is_some());
    }

    #[test]
    fn alert_rule_enforces_scope() {
        let r = AlertRule {
            id: "claude-weekly-80".into(),
            enabled: true,
            label: "x".into(),
            provider_id: Some("claude-code".into()),
            billing_owner: None,
            account_id: None,
            workspace_id: None,
            metric_key: "quota.percent_used".into(),
            window_id: Some("weekly".into()),
            operator: AlertOperator::GreaterOrEqual,
            threshold: 80.0,
            allowed_freshness: vec![FreshnessState::Live, FreshnessState::Fresh],
            cooldown_seconds: 3600,
        };
        assert!(r.matches_scope(Some("claude-code"), None, None));
        assert!(!r.matches_scope(Some("openrouter"), None, None));
        let v: serde_json::Value = serde_json::to_value(&r).unwrap();
        assert_eq!(v["operator"], ">=");
    }
}
