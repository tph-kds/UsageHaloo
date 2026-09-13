use async_trait::async_trait;
use chrono::DateTime;
use chrono::Utc;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use usage_halo_core::{
    epoch_seconds_to_utc, ConnectorCapabilities, ConnectorError, ConnectorHealth, ConnectorState,
    FreshnessClass, MetricKind, Provenance, QuotaWindow, SourceAuthority, SourceScope,
    UsageConnector, UsageSnapshot,
};
use usage_halo_core::source::{
    honest_fraction, ObservationStatus, ProviderAdapter, ProviderDiagnosis, ProviderIdentity,
    ProviderSnapshot, SourceDescriptor, SourceFidelity, SourceKind, UsageWindow,
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
        // P0-05: preserve the source measurement time. The status-line bridge
        // stamps `observed_at` at ingest; re-reads must never refresh it.
        let now = Utc::now();
        let observed_at = payload
            .get("observed_at")
            .and_then(Value::as_str)
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now);
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
                    observed_at,
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

// ---------------------------------------------------------------------------
// V2 ProviderAdapter (Phase B1). Pure helpers take an explicit `now` so tests
// stay deterministic; only `collect`/`diagnose`/`detect` touch the filesystem.
// The Desktop Electron profile (%APPDATA%/Claude) is intentionally NOT parsed:
// it is LevelDB/IndexedDB with no documented stable schema, so it stays
// unsupported rather than guessed at.
// ---------------------------------------------------------------------------

const PROVIDER_ID: &str = "claude-code";
const SPOOL_RELS: [&str; 2] = [
    ".usagehalo/inbox/claude-code.jsonl",
    ".viusagever/inbox/claude-code.jsonl",
];
const STATS_CACHE_REL: &str = ".claude/stats-cache.json";
const STALE_AFTER_SECS: i64 = 24 * 60 * 60;
const KNOWN_WINDOWS: [(&str, &str, u64); 2] = [
    ("five_hour", "5-hour limit", 5 * 60),
    ("seven_day", "7-day limit", 7 * 24 * 60),
];

/// Home dir via env only (same convention as the Tauri legacy adapter and the
/// JS collector's `os.homedir()`); never touches auth/cookie stores.
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn spool_paths(home: &Path) -> Vec<PathBuf> {
    SPOOL_RELS.iter().map(|rel| home.join(rel)).collect()
}

fn stats_cache_path(home: &Path) -> PathBuf {
    home.join(STATS_CACHE_REL)
}

/// Newest non-empty spool line only (same `lines().rfind` approach as the
/// Tauri `import_claude_spool`); the spool is append-only so a full scan on
/// every poll would be unbounded work.
fn read_newest_spool_line(path: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(path).ok()?;
    let last = content.lines().rfind(|l| !l.trim().is_empty())?;
    serde_json::from_str(last).ok()
}

fn observed_at_of(payload: &Value) -> DateTime<Utc> {
    payload
        .get("observed_at")
        .and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

/// Account/org identifier when the payload carries one, else None. The real
/// status-line bridge currently emits no account fields, so absence is the
/// normal case and must never be invented.
fn account_key_of(payload: &Value) -> Option<String> {
    for key in [
        "account_id",
        "account_key",
        "org_id",
        "organization_id",
        "org",
        "organization",
        "account",
        "login",
    ] {
        if let Some(s) = payload.get(key).and_then(Value::as_str) {
            let s = s.trim();
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    for scope in ["account", "organization"] {
        if let Some(obj) = payload.get(scope) {
            for key in ["id", "key"] {
                if let Some(s) = obj.get(key).and_then(Value::as_str) {
                    let s = s.trim();
                    if !s.is_empty() {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Provider 429 envelope: top-level or nested `status == 429` plus retry-after
/// seconds. Returns the retry delay when recognized.
fn rate_limit_of(payload: &Value) -> Option<i64> {
    let is_429 = payload.get("status").and_then(Value::as_i64) == Some(429)
        || payload
            .get("error")
            .and_then(|e| e.get("status"))
            .and_then(Value::as_i64)
            == Some(429);
    if !is_429 {
        return None;
    }
    let secs = ["retry_after_seconds", "retry_after", "retry-after"]
        .iter()
        .filter_map(|k| payload.get(*k))
        .chain(
            ["retry_after_seconds", "retry_after", "retry-after"]
                .iter()
                .filter_map(|k| payload.get("error").and_then(|e| e.get(*k))),
        )
        .filter_map(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .next()
        .unwrap_or(0)
        .max(0);
    Some(secs)
}

struct SnapshotParts {
    now: DateTime<Utc>,
    account_key: Option<String>,
    status: ObservationStatus,
    message: Option<String>,
    retry_at: Option<DateTime<Utc>>,
    windows: Vec<UsageWindow>,
    active_source_id: Option<&'static str>,
    last_successful_at: Option<DateTime<Utc>>,
    observed_at: Option<DateTime<Utc>>,
}

fn base_snapshot(p: SnapshotParts) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: PROVIDER_ID.into(),
        account_key: p.account_key,
        account_label: None,
        collected_at: p.now,
        last_successful_at: p.last_successful_at,
        observed_at: p.observed_at,
        headline_metric_id: Some("five_hour".into()),
        capabilities: vec!["quota_windows".into()],
        active_source_id: p.active_source_id.map(str::to_string),
        windows: p.windows,
        activity_state: None,
        activity_observed_at: None,
        activity_source_id: None,
        health_state: p.status,
        health_message: p.message,
        retry_at: p.retry_at,
    }
}

/// Snapshot from one status-line spool payload at explicit `now`.
pub fn snapshot_from_spool_payload(
    payload: &Value,
    now: DateTime<Utc>,
    expected_account: Option<&str>,
) -> ProviderSnapshot {
    let observed = observed_at_of(payload);
    let account_key = account_key_of(payload);

    if let Some(secs) = rate_limit_of(payload) {
        return base_snapshot(SnapshotParts {
            now,
            account_key,
            status: ObservationStatus::RateLimited,
            message: Some(format!(
                "provider rate limited; retry in {secs}s (retry_at = observed_at + retry-after)"
            )),
            retry_at: observed
                .checked_add_signed(chrono::Duration::seconds(secs))
                .or(Some(observed)),
            windows: vec![],
            active_source_id: Some("statusline-spool"),
            last_successful_at: None,
            observed_at: Some(observed),
        });
    }

    match (expected_account, account_key.clone()) {
        (Some(_), Some(k)) if Some(k.as_str()) != expected_account => {
            return base_snapshot(SnapshotParts {
                now,
                account_key,
                status: ObservationStatus::Error,
                message: Some(
                    "account mismatch: spool belongs to a different account than configured \
                     (identifiers withheld); windows withheld"
                        .into(),
                ),
                retry_at: None,
                windows: vec![],
                active_source_id: Some("statusline-spool"),
                last_successful_at: None,
                observed_at: Some(observed),
            });
        }
        (Some(_), None) => {
            return base_snapshot(SnapshotParts {
                now,
                account_key: None,
                status: ObservationStatus::Error,
                message: Some(
                    "account unverified: spool carries no account identifier while an \
                     expected account is configured; windows withheld"
                        .into(),
                ),
                retry_at: None,
                windows: vec![],
                active_source_id: Some("statusline-spool"),
                last_successful_at: None,
                observed_at: Some(observed),
            });
        }
        _ => {}
    }

    let age_secs = now.signed_duration_since(observed).num_seconds();
    if age_secs > STALE_AFTER_SECS {
        return base_snapshot(SnapshotParts {
            now,
            account_key,
            status: ObservationStatus::Stale,
            message: Some(format!(
                "spool observation is stale (age_s={age_secs} > {STALE_AFTER_SECS}); \
                 last-successful stays with the caller"
            )),
            retry_at: None,
            windows: vec![],
            active_source_id: Some("statusline-spool"),
            last_successful_at: None,
            observed_at: Some(observed),
        });
    }

    let mut windows = Vec::new();
    let mut validation_error: Option<String> = None;
    // Only known window keys are read; anything else (e.g. a future extra
    // window) is ignored so a provider-side addition cannot break parsing.
    for (id, label, duration_minutes) in KNOWN_WINDOWS {
        let Some(window) = payload.pointer(&format!("/rate_limits/{id}")) else {
            continue;
        };
        let Some(used) = window.get("used_percentage").and_then(Value::as_f64) else {
            continue;
        };
        if !(used.is_finite() && (0.0..=100.0).contains(&used)) {
            validation_error = Some(format!(
                "validation: rate_limits.{id}.used_percentage={used} out of range 0..=100 \
                 (window dropped, never clamped)"
            ));
            continue;
        }
        windows.push(UsageWindow {
            id: id.into(),
            label: label.into(),
            // Only the provider's authoritative percent is known; used/limit
            // counts stay None rather than inventing a denominator.
            used: None,
            limit: None,
            remaining: None,
            used_fraction: honest_fraction(None, None, Some(used / 100.0)),
            starts_at: None,
            resets_at: window
                .get("resets_at")
                .and_then(Value::as_i64)
                .and_then(epoch_seconds_to_utc),
            duration_minutes: Some(duration_minutes),
            source_metric_id: id.into(),
        });
    }

    if let Some(err) = validation_error {
        return base_snapshot(SnapshotParts {
            now,
            account_key,
            status: ObservationStatus::Error,
            message: Some(err),
            retry_at: None,
            windows,
            active_source_id: Some("statusline-spool"),
            last_successful_at: None,
            observed_at: Some(observed),
        });
    }
    if windows.is_empty() {
        return base_snapshot(SnapshotParts {
            now,
            account_key,
            status: ObservationStatus::Unavailable,
            message: Some("no quota windows in spool payload".into()),
            retry_at: None,
            windows,
            active_source_id: Some("statusline-spool"),
            last_successful_at: None,
            observed_at: Some(observed),
        });
    }
    base_snapshot(SnapshotParts {
        now,
        account_key,
        status: ObservationStatus::Live,
        message: None,
        retry_at: None,
        windows,
        active_source_id: Some("statusline-spool"),
        last_successful_at: Some(now),
        observed_at: Some(observed),
    })
}

/// Snapshot when only stats-cache telemetry exists. stats-cache carries token
/// counts with no quota denominator, so it must never produce a quota window
/// or fraction; it only explains why no quota is available.
pub fn snapshot_from_stats_telemetry(now: DateTime<Utc>) -> ProviderSnapshot {
    base_snapshot(SnapshotParts {
        now,
        account_key: None,
        status: ObservationStatus::Unavailable,
        message: Some(
            "stats-cache holds token telemetry only (no quota denominator); \
             quota unavailable until the status-line spool emits"
                .into(),
        ),
        retry_at: None,
        windows: vec![],
        active_source_id: None,
        last_successful_at: None,
        observed_at: None,
    })
}

pub fn identity_of(payload: Option<&Value>) -> ProviderIdentity {
    ProviderIdentity {
        account_key: payload.and_then(account_key_of),
        account_label: None,
    }
}

fn opt_age(value: Option<i64>) -> String {
    value.map(|v| v.to_string()).unwrap_or_else(|| "none".into())
}

/// Single-line, secret-free diagnosis summary.
pub fn diagnosis_line(
    status: ObservationStatus,
    account_known: bool,
    spool_age_s: Option<i64>,
    stats_age_s: Option<i64>,
    windows: usize,
) -> String {
    format!(
        "claude-code status={status:?} account={} spool_age_s={} stats_age_s={} windows={windows} sources=[statusline-spool,stats-cache]",
        if account_known { "known" } else { "unknown" },
        opt_age(spool_age_s),
        opt_age(stats_age_s),
    )
}

fn spool_observed_age_s(now: DateTime<Utc>) -> Option<i64> {
    let home = home_dir()?;
    for path in spool_paths(&home) {
        if let Some(payload) = read_newest_spool_line(&path) {
            let observed = observed_at_of(&payload);
            return Some(now.signed_duration_since(observed).num_seconds().max(0));
        }
    }
    None
}

fn stats_cache_age_s(now: DateTime<Utc>) -> Option<i64> {
    let home = home_dir()?;
    let meta = std::fs::metadata(stats_cache_path(&home)).ok()?;
    let modified: DateTime<Utc> = meta.modified().ok()?.into();
    Some(now.signed_duration_since(modified).num_seconds().max(0))
}

fn stats_cache_exists() -> bool {
    home_dir().is_some_and(|h| stats_cache_path(&h).exists())
}

#[derive(Default)]
pub struct ClaudeCodeProviderAdapter {
    expected_account: Option<String>,
    spool_override: Option<Value>,
}

impl ClaudeCodeProviderAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_expected_account(mut self, key: impl Into<String>) -> Self {
        self.expected_account = Some(key.into());
        self
    }

    /// In-memory spool payload (e.g. loaded fixture); `collect` prefers it
    /// over disk so parsers stay testable without touching HOME.
    pub fn with_spool_payload(mut self, payload: Value) -> Self {
        self.spool_override = Some(payload);
        self
    }

    fn newest_spool_payload(&self) -> Option<Value> {
        if let Some(payload) = self.spool_override.clone() {
            return Some(payload);
        }
        let home = home_dir()?;
        spool_paths(&home)
            .iter()
            .filter_map(|p| read_newest_spool_line(p))
            .next()
    }
}

#[async_trait]
impl ProviderAdapter for ClaudeCodeProviderAdapter {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn source_descriptors(&self) -> Vec<SourceDescriptor> {
        vec![
            SourceDescriptor {
                source_id: "statusline-spool".into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::LocalLog,
                fidelity: SourceFidelity::OfficialSession,
                label: "Status-line spool (~/.usagehalo/inbox/claude-code.jsonl); \
                        provider-emitted quota for the active session"
                    .into(),
                requires_local_access: true,
            },
            SourceDescriptor {
                source_id: "stats-cache".into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::LocalCache,
                fidelity: SourceFidelity::FirstPartyLocal,
                label: "Local stats cache (~/.claude/stats-cache.json); \
                        token telemetry only, never quota"
                    .into(),
                requires_local_access: true,
            },
        ]
    }

    fn headline_metric_id(&self) -> Option<String> {
        Some("five_hour".into())
    }

    async fn detect(&self) -> usage_halo_core::Result<bool> {
        let Some(home) = home_dir() else {
            return Ok(false);
        };
        Ok(spool_paths(&home).iter().any(|p| p.exists()) || stats_cache_path(&home).exists())
    }

    async fn get_capabilities(&self) -> usage_halo_core::Result<Vec<String>> {
        Ok(vec!["quota_windows".into()])
    }

    async fn get_identity(&self) -> usage_halo_core::Result<ProviderIdentity> {
        Ok(identity_of(self.newest_spool_payload().as_ref()))
    }

    async fn collect(&self) -> usage_halo_core::Result<ProviderSnapshot> {
        let now = Utc::now();
        if let Some(payload) = self.newest_spool_payload() {
            return Ok(snapshot_from_spool_payload(
                &payload,
                now,
                self.expected_account.as_deref(),
            ));
        }
        if stats_cache_exists() {
            return Ok(snapshot_from_stats_telemetry(now));
        }
        Ok(base_snapshot(SnapshotParts {
            now,
            account_key: None,
            status: ObservationStatus::Unavailable,
            message: Some(
                "no spool line and no stats-cache; waiting for status-line event".into(),
            ),
            retry_at: None,
            windows: vec![],
            active_source_id: None,
            last_successful_at: None,
            observed_at: None,
        }))
    }

    async fn diagnose(&self) -> usage_halo_core::Result<ProviderDiagnosis> {
        let snap = self.collect().await?;
        let now = Utc::now();
        let line = diagnosis_line(
            snap.health_state,
            snap.account_key.is_some(),
            spool_observed_age_s(now),
            stats_cache_age_s(now),
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

    #[test]
    fn parse_preserves_source_observed_at() {
        let raw = json!({
            "observed_at": "2026-09-01T10:00:00Z",
            "rate_limits": {"five_hour": {"used_percentage": 11.0}}
        });
        let snapshot = ClaudeCodeConnector::parse(&raw).unwrap();
        let at = snapshot.quotas[0].provenance.observed_at;
        assert_eq!(at.to_rfc3339(), "2026-09-01T10:00:00+00:00");
    }
}

#[cfg(test)]
mod adapter_tests {
    use super::*;
    use std::path::PathBuf;
    use usage_halo_core::source::ProviderDefinition;

    fn fixture(name: &str) -> Value {
        let path: PathBuf = [
            env!("CARGO_MANIFEST_DIR"),
            "..",
            "..",
            "fixtures",
            "claude",
            name,
        ]
        .iter()
        .collect();
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        serde_json::from_str(&text).expect("fixture is valid JSON")
    }

    /// Deterministic fresh `now` derived from the fixture's own observed_at.
    fn fresh_now(payload: &Value) -> chrono::DateTime<Utc> {
        observed_at_of(payload) + chrono::Duration::seconds(3600)
    }

    fn definition() -> ProviderDefinition {
        ProviderDefinition {
            id: "claude-code".into(),
            display_name: "Claude Code".into(),
            capabilities: vec!["quota_windows".into()],
            sources: ClaudeCodeProviderAdapter::new().source_descriptors(),
            headline_metric_id: Some("five_hour".into()),
            secondary_metric_ids: vec!["seven_day".into()],
            quota_active_secs: None,
            quota_idle_secs: None,
            activity_secs: None,
            runtime_secs: None,
            billing_secs: None,
        }
    }

    #[test]
    fn live_fixture_parses_to_live_snapshot_with_resolvable_headline() {
        let payload = fixture("usage-live.json");
        let snap = snapshot_from_spool_payload(&payload, fresh_now(&payload), None);
        assert_eq!(snap.health_state, ObservationStatus::Live);
        assert_eq!(snap.windows.len(), 2);
        let headline = definition()
            .resolve_headline(&snap.windows)
            .expect("five_hour headline resolves");
        assert_eq!(headline.source_metric_id, "five_hour");
        assert_eq!(headline.used_fraction, Some(0.73));
        assert!(snap.account_key.is_none());
    }

    #[test]
    fn stats_telemetry_alone_yields_no_windows() {
        let telemetry = fixture("stats-telemetry.json");
        assert!(telemetry.get("rate_limits").is_none());
        let snap = snapshot_from_stats_telemetry(Utc::now());
        assert!(snap.windows.is_empty());
        assert_eq!(snap.health_state, ObservationStatus::Unavailable);
    }

    #[test]
    fn stale_spool_is_stale_not_live() {
        let payload = fixture("usage-stale.json");
        let snap = snapshot_from_spool_payload(&payload, Utc::now(), None);
        assert_eq!(snap.health_state, ObservationStatus::Stale);
        assert!(snap.windows.is_empty());
    }

    #[test]
    fn wrong_account_with_expected_key_is_error() {
        let payload = fixture("usage-wrong-account.json");
        let snap =
            snapshot_from_spool_payload(&payload, fresh_now(&payload), Some("org-A-expected"));
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(snap.windows.is_empty());
        // Without an expected key the observed key is recorded, not rejected.
        let open = snapshot_from_spool_payload(&payload, fresh_now(&payload), None);
        assert_eq!(open.health_state, ObservationStatus::Live);
        assert_eq!(open.account_key.as_deref(), Some("org-B-observed"));
        assert_eq!(
            identity_of(Some(&payload)).account_key.as_deref(),
            Some("org-B-observed")
        );
        assert!(identity_of(None).account_key.is_none());
    }

    #[test]
    fn rate_limited_envelope_sets_retry_at() {
        let payload = fixture("usage-rate-limited.json");
        let snap = snapshot_from_spool_payload(&payload, fresh_now(&payload), None);
        assert_eq!(snap.health_state, ObservationStatus::RateLimited);
        assert!(snap.windows.is_empty());
        let observed = observed_at_of(&payload);
        assert_eq!(
            snap.retry_at,
            observed.checked_add_signed(chrono::Duration::seconds(90))
        );
    }

    #[test]
    fn schema_changed_parses_known_windows_and_ignores_unknown_key() {
        let payload = fixture("usage-schema-changed.json");
        let snap = snapshot_from_spool_payload(&payload, fresh_now(&payload), None);
        assert_eq!(snap.health_state, ObservationStatus::Live);
        assert_eq!(snap.windows.len(), 2);
        assert!(snap.windows.iter().all(|w| w.id != "ten_hour"));
        let five = snap.windows.iter().find(|w| w.id == "five_hour").unwrap();
        // Renamed `reset_at` is not read; the window still parses.
        assert_eq!(five.resets_at, None);
        let seven = snap.windows.iter().find(|w| w.id == "seven_day").unwrap();
        assert!(seven.resets_at.is_some());
    }

    #[test]
    fn out_of_range_percent_drops_window_with_error() {
        let mut payload = fixture("usage-live.json");
        payload["rate_limits"]["five_hour"]["used_percentage"] = json!(150.0);
        let snap = snapshot_from_spool_payload(&payload, fresh_now(&payload), None);
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(
            snap.health_message
                .as_deref()
                .unwrap_or_default()
                .contains("validation"),
            "unexpected message: {:?}",
            snap.health_message
        );
        assert!(snap.windows.iter().all(|w| w.id != "five_hour"));
        assert!(snap.windows.iter().any(|w| w.id == "seven_day"));
    }

    #[test]
    fn diagnosis_line_is_single_line_without_secrets() {
        let line = diagnosis_line(ObservationStatus::Live, true, Some(42), None, 2);
        assert!(!line.contains('\n'));
        assert!(line.contains("status=Live"));
        assert!(line.contains("account=known"));
        assert!(!line.contains("org-B"));
    }
}
