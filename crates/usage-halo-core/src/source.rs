use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Provenance tier of a source. The tier decides the canonical
/// [`super::contracts::DataKind`]; freshness is tracked separately and never
/// inferred from this enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceFidelity {
    OfficialPublic,
    OfficialSession,
    FirstPartyLocal,
    Derived,
    Manual,
}

impl SourceFidelity {
    pub fn to_data_kind(self) -> super::contracts::DataKind {
        match self {
            SourceFidelity::OfficialPublic | SourceFidelity::OfficialSession => {
                super::contracts::DataKind::ProviderReported
            }
            SourceFidelity::FirstPartyLocal => super::contracts::DataKind::LocallyObserved,
            SourceFidelity::Derived => super::contracts::DataKind::Reconciled,
            SourceFidelity::Manual => super::contracts::DataKind::Estimated,
        }
    }
}

/// Transport by which a source is read. `snake_case` wire names are the
/// contract (`local_db`, `runtime_api`, …).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Api,
    Cli,
    LocalDb,
    LocalCache,
    LocalLog,
    RuntimeApi,
    LanguageServer,
    Manual,
}

/// One declared way to observe a provider. A descriptor is static metadata;
/// it never carries a measurement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct SourceDescriptor {
    pub source_id: String,
    pub provider_id: String,
    pub kind: SourceKind,
    pub fidelity: SourceFidelity,
    pub label: String,
    pub requires_local_access: bool,
}

/// Collection outcome for one poll. Only `live | stale | derived` may back a
/// user-visible number; every other state renders as `—` with a reason.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObservationStatus {
    Live,
    Stale,
    Derived,
    NeedsAuth,
    RateLimited,
    Unavailable,
    Unsupported,
    Error,
    Disabled,
    Demo,
}

impl ObservationStatus {
    pub fn is_user_visible_value(self) -> bool {
        matches!(
            self,
            ObservationStatus::Live | ObservationStatus::Stale | ObservationStatus::Derived
        )
    }
}

/// One quota/balance window. All numerics are `Option`: unknown stays `None`
/// and is rendered as `—`, never as zero.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub used_fraction: Option<f64>,
    pub starts_at: Option<DateTime<Utc>>,
    pub resets_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<u64>,
    pub source_metric_id: String,
}

/// Canonical fraction for a window: prefer the provider's own fraction, else
/// `used / limit`. Returns `None` rather than guessing or dividing by
/// zero/unknown.
pub fn honest_fraction(
    used: Option<f64>,
    limit: Option<f64>,
    authoritative: Option<f64>,
) -> Option<f64> {
    if let Some(a) = authoritative {
        if a.is_finite() && (0.0..=1.0).contains(&a) {
            return Some(a);
        }
        return None;
    }
    match (used, limit) {
        (Some(u), Some(l)) if u.is_finite() && l.is_finite() && l > 0.0 && u >= 0.0 => {
            Some(u / l)
        }
        _ => None,
    }
}

/// Identity evidence for one provider account. No usage numbers live here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ProviderIdentity {
    pub account_key: Option<String>,
    pub account_label: Option<String>,
}

/// Health outcome of one poll, kept separate from any measurement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ProviderDiagnosis {
    pub status: ObservationStatus,
    pub message: Option<String>,
    pub retry_at: Option<DateTime<Utc>>,
}

/// Collected state for one provider. Windows carry the numbers; `health_*`
/// explains why numbers may be absent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct ProviderSnapshot {
    pub provider_id: String,
    pub account_key: Option<String>,
    pub account_label: Option<String>,
    pub collected_at: DateTime<Utc>,
    pub last_successful_at: Option<DateTime<Utc>>,
    /// Provider-side measurement time (spool observed_at or equivalent).
    /// UI ages staleness against this, never against collection time.
    pub observed_at: Option<DateTime<Utc>>,
    pub headline_metric_id: Option<String>,
    pub capabilities: Vec<String>,
    pub active_source_id: Option<String>,
    pub windows: Vec<UsageWindow>,
    pub activity_state: Option<String>,
    pub activity_observed_at: Option<DateTime<Utc>>,
    pub activity_source_id: Option<String>,
    pub health_state: ObservationStatus,
    pub health_message: Option<String>,
    pub retry_at: Option<DateTime<Utc>>,
}

/// V2 provider adapter. All async methods are required with no default
/// bodies, so an adapter cannot silently inherit fabricated data.
#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn source_descriptors(&self) -> Vec<SourceDescriptor>;
    fn headline_metric_id(&self) -> Option<String>;
    async fn detect(&self) -> super::Result<bool>;
    async fn get_capabilities(&self) -> super::Result<Vec<String>>;
    async fn get_identity(&self) -> super::Result<ProviderIdentity>;
    async fn collect(&self) -> super::Result<ProviderSnapshot>;
    async fn diagnose(&self) -> super::Result<ProviderDiagnosis>;
}

/// Static registration for a provider: what it can offer and which window is
/// the headline. Lookup is always by metric id, never positional.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ProviderDefinition {
    pub id: String,
    pub display_name: String,
    pub capabilities: Vec<String>,
    pub sources: Vec<SourceDescriptor>,
    pub headline_metric_id: Option<String>,
    pub secondary_metric_ids: Vec<String>,
    pub quota_active_secs: Option<u64>,
    pub quota_idle_secs: Option<u64>,
    pub activity_secs: Option<u64>,
    pub runtime_secs: Option<u64>,
    pub billing_secs: Option<u64>,
}

impl ProviderDefinition {
    pub fn resolve_headline<'a>(&self, windows: &'a [UsageWindow]) -> Option<&'a UsageWindow> {
        let want = self.headline_metric_id.as_deref()?;
        windows.iter().find(|w| w.source_metric_id == want)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn window(id: &str, metric: &str) -> UsageWindow {
        UsageWindow {
            id: id.into(),
            label: id.into(),
            used: None,
            limit: None,
            remaining: None,
            used_fraction: None,
            starts_at: None,
            resets_at: None,
            duration_minutes: None,
            source_metric_id: metric.into(),
        }
    }

    fn definition(headline: Option<&str>) -> ProviderDefinition {
        ProviderDefinition {
            id: "p".into(),
            display_name: "P".into(),
            capabilities: vec![],
            sources: vec![],
            headline_metric_id: headline.map(str::to_string),
            secondary_metric_ids: vec![],
            quota_active_secs: None,
            quota_idle_secs: None,
            activity_secs: None,
            runtime_secs: None,
            billing_secs: None,
        }
    }

    #[test]
    fn unknown_stays_unknown_not_zero() {
        assert_eq!(honest_fraction(None, None, None), None);
    }

    #[test]
    fn zero_or_unknown_denominator_yields_none() {
        assert_eq!(honest_fraction(Some(5.0), Some(0.0), None), None);
        assert_eq!(honest_fraction(Some(5.0), None, None), None);
        assert_eq!(honest_fraction(None, Some(100.0), None), None);
    }

    #[test]
    fn authoritative_fraction_needs_no_used_or_limit() {
        assert_eq!(honest_fraction(None, None, Some(0.42)), Some(0.42));
    }

    #[test]
    fn out_of_range_authoritative_yields_none() {
        assert_eq!(honest_fraction(None, None, Some(1.5)), None);
        assert_eq!(honest_fraction(None, None, Some(-0.1)), None);
        assert_eq!(honest_fraction(None, None, Some(f64::NAN)), None);
        assert_eq!(honest_fraction(Some(42.0), Some(100.0), Some(1.5)), None);
    }

    #[test]
    fn computed_fraction_divides_used_by_limit() {
        assert_eq!(honest_fraction(Some(42.0), Some(100.0), None), Some(0.42));
    }

    #[test]
    fn resolve_headline_never_falls_back_to_first_window() {
        let def = definition(Some("missing"));
        let windows = vec![window("a", "metric.a"), window("b", "metric.b")];
        assert_eq!(def.resolve_headline(&windows), None);
        let no_headline = definition(None);
        assert_eq!(no_headline.resolve_headline(&windows), None);
    }

    #[test]
    fn resolve_headline_finds_metric_id_match() {
        let def = definition(Some("metric.b"));
        let windows = vec![window("a", "metric.a"), window("b", "metric.b")];
        assert_eq!(def.resolve_headline(&windows), Some(&windows[1]));
    }

    #[test]
    fn non_value_statuses_are_not_user_visible() {
        for s in [
            ObservationStatus::Unavailable,
            ObservationStatus::Unsupported,
            ObservationStatus::Error,
            ObservationStatus::NeedsAuth,
            ObservationStatus::Demo,
            ObservationStatus::Disabled,
        ] {
            assert!(!s.is_user_visible_value());
        }
        assert!(ObservationStatus::Live.is_user_visible_value());
        assert!(ObservationStatus::Stale.is_user_visible_value());
        assert!(ObservationStatus::Derived.is_user_visible_value());
        assert!(!ObservationStatus::RateLimited.is_user_visible_value());
    }

    #[test]
    fn fidelity_maps_to_canonical_data_kind() {
        assert_eq!(
            SourceFidelity::OfficialPublic.to_data_kind(),
            crate::contracts::DataKind::ProviderReported
        );
        assert_eq!(
            SourceFidelity::OfficialSession.to_data_kind(),
            crate::contracts::DataKind::ProviderReported
        );
        assert_eq!(
            SourceFidelity::FirstPartyLocal.to_data_kind(),
            crate::contracts::DataKind::LocallyObserved
        );
        assert_eq!(
            SourceFidelity::Derived.to_data_kind(),
            crate::contracts::DataKind::Reconciled
        );
        assert_eq!(
            SourceFidelity::Manual.to_data_kind(),
            crate::contracts::DataKind::Estimated
        );
    }

    #[test]
    fn snapshot_preserves_absent_health_and_retry() {
        let snap = ProviderSnapshot {
            provider_id: "p".into(),
            account_key: None,
            account_label: None,
            collected_at: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            last_successful_at: None,
            observed_at: None,
            headline_metric_id: None,
            capabilities: vec![],
            active_source_id: None,
            windows: vec![],
            activity_state: None,
            activity_observed_at: None,
            activity_source_id: None,
            health_state: ObservationStatus::NeedsAuth,
            health_message: Some("sign in".into()),
            retry_at: None,
        };
        assert!(!snap.health_state.is_user_visible_value());
        assert_eq!(snap.last_successful_at, None);
    }
}
