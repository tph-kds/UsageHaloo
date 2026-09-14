use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use usage_halo_core::source::{
    ObservationStatus, ProviderAdapter, ProviderDiagnosis, ProviderIdentity,
    ProviderSnapshot, SourceDescriptor, SourceFidelity, SourceKind,
};
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
    // P0-05: honor the OTLP observation time when the receiver supplies one;
    // only fall back to receipt time for legacy payloads without it.
    let observed_at = metric
        .observed_unix_ms
        .and_then(usage_halo_core::epoch_millis_to_utc)
        .unwrap_or_else(Utc::now);

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
            observed_at,
            provider_timestamp: None,
            confidence: 1.0,
        },
    }
}

// ---------------------------------------------------------------------------
// Gemini CLI / Antigravity local-state adapter (Phase B4). Observed real
// state 2026-09-14: no gemini CLI on PATH; ~/.gemini holds
// google_accounts.json (keys: active, old), tmp/ project-hash dirs,
// antigravity/ brain dirs; ~/.antigravity holds extensions only. No local
// quota/limit files exist anywhere. Quota semantics belong to the
// Antigravity product; no verified quota source exists, so collect() is
// always Unsupported and request counts stay DERIVED-only via OTLP.
// Identity reads ONLY google_accounts.json `active`; oauth_creds.json and
// any token file must NEVER be opened here.
// ---------------------------------------------------------------------------

const PROVIDER_ID: &str = "gemini-cli";
const LOCAL_STATE_ID: &str = "local-state";
const OTLP_ID: &str = "otlp-telemetry";
const ACCOUNTS_FILE: &str = "google_accounts.json";

fn file_modified(p: &std::path::Path) -> Option<DateTime<Utc>> {
    std::fs::metadata(p)
        .ok()?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
}

fn extract_active_id(value: &serde_json::Value) -> Option<String> {
    let active = value.get("active")?;
    if let Some(s) = active.as_str() {
        let s = s.trim();
        return if s.is_empty() { None } else { Some(s.to_string()) };
    }
    if let Some(obj) = active.as_object() {
        for key in ["id", "email"] {
            if let Some(s) = obj.get(key).and_then(|v| v.as_str()) {
                let s = s.trim();
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }
    }
    None
}

fn read_active_account(home: &std::path::Path) -> Option<String> {
    let path = home.join(".gemini").join(ACCOUNTS_FILE);
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    extract_active_id(&value)
}

fn gemini_dir_detected(home: &std::path::Path) -> bool {
    let dir = home.join(".gemini");
    if !dir.is_dir() {
        return false;
    }
    if dir.join(ACCOUNTS_FILE).exists() {
        return true;
    }
    if dir.join("tmp").exists() {
        return true;
    }
    if dir.join("antigravity").exists() {
        return true;
    }
    // Directory exists but holds none of the observed markers.
    false
}

// Diagnostics carry presence/age, never identifiers or secrets.
pub fn diagnosis_line(
    detected: bool,
    signed_in: bool,
    accounts_age_s: Option<i64>,
    status: ObservationStatus,
    windows: usize,
) -> String {
    format!(
        "gemini-cli detected={detected} signed_in={signed_in} accounts_age_s={} status={status:?} windows={windows} sources=[local-state,otlp-telemetry]",
        accounts_age_s
            .map(|v| v.to_string())
            .unwrap_or_else(|| "none".into()),
    )
}

#[derive(Default)]
pub struct GeminiCliAdapter {
    expected_account: Option<String>,
    home_override: Option<PathBuf>,
}

impl GeminiCliAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_expected_account(mut self, key: impl Into<String>) -> Self {
        self.expected_account = Some(key.into());
        self
    }

    pub fn with_home(mut self, home: PathBuf) -> Self {
        self.home_override = Some(home);
        self
    }

    fn home(&self) -> Option<PathBuf> {
        if let Some(h) = self.home_override.clone() {
            return Some(h);
        }
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
    }

    fn accounts_age_s(&self, now: DateTime<Utc>) -> Option<i64> {
        let path = self.home()?.join(".gemini").join(ACCOUNTS_FILE);
        let modified = file_modified(path.as_path())?;
        Some(now.signed_duration_since(modified).num_seconds().max(0))
    }

    fn active_account(&self) -> Option<String> {
        // NEVER open oauth_creds.json or any token file: only the `active`
        // account identifier in google_accounts.json is read.
        read_active_account(self.home()?.as_path())
    }

    fn collect_internal(&self, now: DateTime<Utc>) -> ProviderSnapshot {
        let account = self.active_account();
        if let Some(expected) = self.expected_account.as_deref() {
            if account.as_deref() != Some(expected) {
                return ProviderSnapshot {
                    provider_id: PROVIDER_ID.into(),
                    account_key: None,
                    account_label: None,
                    collected_at: now,
                    last_successful_at: None,
                    observed_at: None,
                    headline_metric_id: None,
                    capabilities: vec!["detection".into(), "token-telemetry".into()],
                    active_source_id: Some(LOCAL_STATE_ID.into()),
                    windows: vec![],
                    activity_state: None,
                    activity_observed_at: None,
                    activity_source_id: None,
                    health_state: ObservationStatus::Error,
                    health_message: Some(
                        "account unverified: local state identity does not match \
                         the expected account; windows withheld"
                            .into(),
                    ),
                    retry_at: None,
                };
            }
        }
        match account {
            Some(account_key) => ProviderSnapshot {
                provider_id: PROVIDER_ID.into(),
                account_key: Some(account_key),
                account_label: None,
                collected_at: now,
                last_successful_at: None,
                observed_at: None,
                headline_metric_id: None,
                capabilities: vec!["detection".into(), "token-telemetry".into()],
                active_source_id: Some(LOCAL_STATE_ID.into()),
                windows: vec![],
                activity_state: None,
                activity_observed_at: None,
                activity_source_id: None,
                health_state: ObservationStatus::Unsupported,
                health_message: Some(
                    "no verified quota source for this Antigravity/Gemini product; \
                     request-count telemetry is DERIVED only and needs OTLP flow"
                        .into(),
                ),
                retry_at: None,
            },
            None => ProviderSnapshot {
                provider_id: PROVIDER_ID.into(),
                account_key: None,
                account_label: None,
                collected_at: now,
                last_successful_at: None,
                observed_at: None,
                headline_metric_id: None,
                capabilities: vec!["detection".into(), "token-telemetry".into()],
                active_source_id: Some(LOCAL_STATE_ID.into()),
                windows: vec![],
                activity_state: None,
                activity_observed_at: None,
                activity_source_id: None,
                health_state: ObservationStatus::NeedsAuth,
                health_message: Some("not signed in to Gemini CLI / Antigravity".into()),
                retry_at: None,
            },
        }
    }
}

#[async_trait]
impl ProviderAdapter for GeminiCliAdapter {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn source_descriptors(&self) -> Vec<SourceDescriptor> {
        vec![
            SourceDescriptor {
                source_id: LOCAL_STATE_ID.into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::LocalCache,
                fidelity: SourceFidelity::FirstPartyLocal,
                label: "Gemini local JSON state files (~/.gemini, ~/.antigravity): \
                        detection+identity only, never usage"
                    .into(),
                requires_local_access: true,
            },
            SourceDescriptor {
                source_id: OTLP_ID.into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::Api,
                fidelity: SourceFidelity::Derived,
                label: "local OTLP ingest (request counts only, DERIVED, never quota)"
                    .into(),
                requires_local_access: true,
            },
        ]
    }

    fn headline_metric_id(&self) -> Option<String> {
        None
    }

    async fn detect(&self) -> usage_halo_core::Result<bool> {
        let Some(home) = self.home() else {
            return Ok(false);
        };
        if gemini_dir_detected(home.as_path()) {
            return Ok(true);
        }
        Ok(home.join(".antigravity").exists())
    }

    async fn get_capabilities(&self) -> usage_halo_core::Result<Vec<String>> {
        Ok(vec!["detection".into(), "token-telemetry".into()])
    }

    async fn get_identity(&self) -> usage_halo_core::Result<ProviderIdentity> {
        Ok(ProviderIdentity {
            account_key: self.active_account(),
            account_label: None,
        })
    }

    async fn collect(&self) -> usage_halo_core::Result<ProviderSnapshot> {
        Ok(self.collect_internal(Utc::now()))
    }

    async fn diagnose(&self) -> usage_halo_core::Result<ProviderDiagnosis> {
        let now = Utc::now();
        let snap = self.collect_internal(now);
        let detected = self.detect().await.unwrap_or(false);
        let signed_in = snap.account_key.is_some();
        let line = diagnosis_line(
            detected,
            signed_in,
            self.accounts_age_s(now),
            snap.health_state,
            snap.windows.len(),
        );
        Ok(ProviderDiagnosis {
            status: snap.health_state,
            message: Some(line),
            retry_at: snap.retry_at,
        })
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

    fn scoped_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gemini-adapter-test-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".gemini")).expect("create temp home");
        dir
    }

    fn write_accounts(home: &std::path::Path, body: &str) {
        std::fs::write(home.join(".gemini").join(ACCOUNTS_FILE), body)
            .expect("write accounts file");
    }

    #[tokio::test]
    async fn string_active_id_detects_and_reports_unsupported() {
        let home = scoped_home("string-active");
        write_accounts(
            &home,
            r#"{"active": "test-account-id-abc123", "old": "previous-id"}"#,
        );
        let adapter = GeminiCliAdapter::new().with_home(home.clone());
        assert!(adapter.detect().await.unwrap());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(
            identity.account_key.as_deref(),
            Some("test-account-id-abc123")
        );
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Unsupported);
        assert!(snap.windows.is_empty());
        assert_eq!(snap.headline_metric_id, None);
        assert_eq!(
            snap.capabilities,
            vec!["detection".to_string(), "token-telemetry".to_string()]
        );
        assert!(
            snap.health_message
                .as_deref()
                .unwrap_or_default()
                .contains("DERIVED only")
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn object_active_id_with_email_is_accepted() {
        let home = scoped_home("object-active");
        write_accounts(
            &home,
            r#"{"active": {"id": "obj-id-1", "email": "user@example.invalid"}, "old": "x"}"#,
        );
        let adapter = GeminiCliAdapter::new().with_home(home.clone());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(identity.account_key.as_deref(), Some("obj-id-1"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn missing_accounts_file_detects_false_identity_none() {
        let home = scoped_home("missing");
        let _ = std::fs::remove_file(home.join(".gemini").join(ACCOUNTS_FILE));
        let adapter = GeminiCliAdapter::new().with_home(home.clone());
        assert!(!adapter.detect().await.unwrap());
        let identity = adapter.get_identity().await.unwrap();
        assert_eq!(identity.account_key, None);
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::NeedsAuth);
        assert!(snap.windows.is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn oauth_canary_is_never_parsed() {
        let home = scoped_home("oauth-canary");
        write_accounts(&home, r#"{"active": "canary-account", "old": "x"}"#);
        std::fs::write(
            home.join(".gemini").join("oauth_creds.json"),
            "THIS IS NOT VALID USAGE DATA {{{{",
        )
        .expect("write canary");
        let adapter = GeminiCliAdapter::new().with_home(home.clone());
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Unsupported);
        assert!(snap.windows.is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test]
    async fn expected_account_mismatch_withholds() {
        let home = scoped_home("mismatch");
        write_accounts(&home, r#"{"active": "real-account", "old": "x"}"#);
        let adapter = GeminiCliAdapter::new()
            .with_home(home.clone())
            .with_expected_account("someone-else");
        let snap = adapter.collect().await.unwrap();
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(snap.windows.is_empty());
        assert_eq!(snap.account_key, None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn descriptors_claim_no_quota() {
        let adapter = GeminiCliAdapter::new();
        let descriptors = adapter.source_descriptors();
        assert_eq!(descriptors.len(), 2);
        assert!(
            descriptors
                .iter()
                .all(|d| !d.label.to_lowercase().contains("quota"))
                || descriptors.iter().any(|d| d.label.contains("never quota"))
        );
        assert_eq!(adapter.headline_metric_id(), None);
    }

    #[test]
    fn diagnosis_line_carries_no_identifiers() {
        let line = diagnosis_line(
            true,
            true,
            Some(7),
            ObservationStatus::Unsupported,
            0,
        );
        assert!(!line.contains('\n'));
        assert!(line.contains("signed_in=true"));
        assert!(!line.contains("canary-account"));
        assert!(line.contains("windows=0"));
    }
}
