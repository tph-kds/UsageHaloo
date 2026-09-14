use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::path::{Path, PathBuf};
use usage_halo_core::{
    epoch_seconds_to_utc, FreshnessClass, MetricKind, Provenance, QuotaWindow, SourceAuthority,
    SourceScope,
};
use usage_halo_core::source::{
    honest_fraction, ObservationStatus, ProviderAdapter, ProviderDiagnosis, ProviderIdentity,
    ProviderSnapshot, SourceDescriptor, SourceFidelity, SourceKind, UsageWindow,
};

/// Parser for the documented Codex app-server rate-limit result/notification.
/// Process lifecycle and version-specific initialization belong in the desktop
/// runtime so they can be updated independently of this pure parser.
pub fn parse_rate_limits(result: &Value) -> Vec<QuotaWindow> {
    parse_rate_limits_at(result, Utc::now())
}

/// Same parser with an explicit observation time, so replays and imports
/// preserve source timestamps instead of stamping read time (P0-05).
pub fn parse_rate_limits_at(
    result: &Value,
    observed_at: chrono::DateTime<Utc>,
) -> Vec<QuotaWindow> {
    let now = observed_at;
    let mut output = Vec::new();

    let snapshots: Vec<(String, &Value)> =
        if let Some(map) = result.get("rateLimitsByLimitId").and_then(Value::as_object) {
            map.iter().map(|(k, v)| (k.clone(), v)).collect()
        } else if let Some(single) = result.get("rateLimits") {
            vec![("codex".into(), single)]
        } else {
            Vec::new()
        };

    for (limit_id, snapshot) in snapshots {
        for (name, label) in [
            ("primary", "Primary window"),
            ("secondary", "Secondary window"),
        ] {
            let Some(window) = snapshot.get(name) else {
                continue;
            };
            if window.is_null() {
                continue;
            }
            let Some(used) = window.get("usedPercent").and_then(Value::as_f64) else {
                continue;
            };
            let duration_mins = window.get("windowDurationMins").and_then(Value::as_u64);
            let resets_at = window
                .get("resetsAt")
                .and_then(Value::as_i64)
                .and_then(epoch_seconds_to_utc);

            output.push(QuotaWindow {
                provider: "codex".into(),
                account_id: None,
                // Same scoping as collectors/providers.mjs normalizeCodexRateLimits:
                // the 'codex' bucket keeps short ids, other limits are scoped.
                limit_id: if limit_id == "codex" {
                    name.to_string()
                } else {
                    format!("{limit_id}:{name}")
                },
                label: label.into(),
                metric_kind: MetricKind::QuotaPercent,
                used_value: None,
                limit_value: None,
                used_percent: Some(used),
                remaining_value: Some((100.0 - used).max(0.0)),
                window_duration_seconds: duration_mins.map(|m| m * 60),
                resets_at,
                provenance: Provenance {
                    source_kind: "codex_app_server".into(),
                    scope: SourceScope::Account,
                    authority: SourceAuthority::ProviderTelemetry,
                    freshness: FreshnessClass::Live,
                    observed_at: now,
                    provider_timestamp: None,
                    confidence: 1.0,
                },
            });
        }
    }

    output
}

pub fn rate_limits_request(id: u64) -> Value {
    serde_json::json!({
        "method": "account/rateLimits/read",
        "id": id,
        "params": {}
    })
}

// ---------------------------------------------------------------------------
// V2 ProviderAdapter (Phase B2 unit 1). Pure helpers take an explicit `now`
// so tests stay deterministic; only `collect`/`diagnose`/`detect` touch the
// filesystem. Never reads auth material; rollout events carry no account id.
// ---------------------------------------------------------------------------

const PROVIDER_ID: &str = "codex";
const STALE_AFTER_SECS: i64 = 60 * 60;
const TAIL_BYTES: u64 = 64 * 1024;
const MAX_SESSION_FILES: usize = 3;
const KNOWN_WINDOWS: [(&str, &str); 2] =
    [("primary", "Primary window"), ("secondary", "Secondary window")];

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

fn sessions_dir(home: &Path) -> PathBuf {
    home.join(".codex").join("sessions")
}

fn cli_resolvable() -> bool {
    if std::env::var_os("CODEX_BIN").is_some() {
        return true;
    }
    if !std::env::var("CODEX_APP_SERVER_CMD")
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return true;
    }
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|dir| dir.join(name).exists())
    })
}

/// The `rate_limits` envelope inside a rollout `event_msg`. Real rollout
/// lines nest it under `payload`; bare fixtures keep it top-level.
fn event_rate_limits(event: &Value) -> Option<&Value> {
    if let Some(rl) = event.pointer("/payload/rate_limits") {
        if !rl.is_null() {
            return Some(rl);
        }
    }
    if let Some(rl) = event.get("rate_limits") {
        if !rl.is_null() {
            return Some(rl);
        }
    }
    None
}

fn parse_rfc3339(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn observed_at_of(event: &Value) -> Option<DateTime<Utc>> {
    for key in ["timestamp", "observed_at"] {
        if let Some(s) = event.get(key).and_then(Value::as_str) {
            if let Some(d) = parse_rfc3339(s) {
                return Some(d);
            }
        }
        if let Some(payload) = event.get("payload") {
            if let Some(s) = payload.get(key).and_then(Value::as_str) {
                if let Some(d) = parse_rfc3339(s) {
                    return Some(d);
                }
            }
        }
    }
    None
}

/// Display-only plan label (`plan:plus`). Rollout events carry no account id,
/// so this is never used as an identity key.
fn plan_label_of(rate_limits: &Value) -> Option<String> {
    rate_limits
        .get("plan_type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("plan:{s}"))
}

fn file_modified(path: &Path) -> Option<DateTime<Utc>> {
    std::fs::metadata(path)
        .ok()?
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
}

fn tail_text(path: &Path) -> Option<(String, DateTime<Utc>)> {
    use std::io::{Read, Seek, SeekFrom};
    let modified = file_modified(path)?;
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    if start > 0 {
        // Chunk may start mid-line; drop the partial first line.
        if let Some(idx) = text.find('\n') {
            text = text[idx + 1..].to_string();
        } else {
            text.clear();
        }
    }
    Some((text, modified))
}

/// Newest event in `text` whose payload contains `rate_limits`. A file holding
/// a single JSON object (sanitized fixture) parses as one event.
fn newest_event_with_rate_limits(
    text: &str,
    fallback_observed: DateTime<Utc>,
) -> Option<(Value, DateTime<Utc>)> {
    let trimmed = text.trim();
    if !trimmed.is_empty() && !trimmed.contains('\n') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if event_rate_limits(&value).is_some() {
                let at = observed_at_of(&value).unwrap_or(fallback_observed);
                return Some((value, at));
            }
            return None;
        }
    }
    for line in text.lines().rev() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if event_rate_limits(&value).is_none() {
            continue;
        }
        let at = observed_at_of(&value).unwrap_or(fallback_observed);
        return Some((value, at));
    }
    None
}

struct RolloutHit {
    event: Value,
    observed_at: DateTime<Utc>,
    file: PathBuf,
}

/// Newest-first walk by mtime, capped at the newest few `.jsonl` files; each
/// file is tail-scanned so polls never replay full session history.
fn rollout_candidates(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<(PathBuf, i64)>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
                continue;
            }
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let mtime = file_modified(&path).map(|d| d.timestamp()).unwrap_or(0);
            out.push((path, mtime));
        }
    }
    let mut found = Vec::new();
    walk(dir, &mut found);
    found.sort_by_key(|a| std::cmp::Reverse(a.1));
    found
        .into_iter()
        .take(MAX_SESSION_FILES)
        .map(|(path, _)| path)
        .collect()
}

fn find_newest_rollout(dir: &Path) -> Option<RolloutHit> {
    for path in rollout_candidates(dir) {
        let (text, modified) = tail_text(&path)?;
        if let Some((event, observed_at)) = newest_event_with_rate_limits(&text, modified) {
            return Some(RolloutHit {
                event,
                observed_at,
                file: path,
            });
        }
    }
    None
}

struct ParsedRollout {
    windows: Vec<UsageWindow>,
    validation_error: Option<String>,
    plan_label: Option<String>,
}

fn parse_rollout_windows(rate_limits: &Value) -> ParsedRollout {
    let mut windows = Vec::new();
    let mut validation_error: Option<String> = None;
    // Only known window keys are read; anything else (credits, spend flags,
    // future keys) is ignored so a provider-side addition cannot break parsing.
    for (id, label) in KNOWN_WINDOWS {
        let Some(window) = rate_limits.get(id) else {
            continue;
        };
        if window.is_null() {
            continue;
        }
        let Some(used) = window.get("used_percent").and_then(Value::as_f64) else {
            if window.get("used_percent").is_some() {
                validation_error = Some(format!(
                    "validation: rate_limits.{id}.used_percent is not a number \
                     (window dropped, never coerced)"
                ));
            }
            continue;
        };
        if !(used.is_finite() && (0.0..=100.0).contains(&used)) {
            validation_error = Some(format!(
                "validation: rate_limits.{id}.used_percent={used} out of range 0..=100 \
                 (window dropped, never clamped)"
            ));
            continue;
        }
        // `window_minutes` is a duration in minutes, never a timestamp.
        let duration_minutes = window
            .get("window_minutes")
            .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)));
        let resets_at = window
            .get("resets_at")
            .and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_u64().and_then(|u| i64::try_from(u).ok()))
            })
            .and_then(epoch_seconds_to_utc);
        windows.push(UsageWindow {
            id: id.into(),
            label: label.into(),
            used: None,
            limit: None,
            remaining: None,
            used_fraction: honest_fraction(None, None, Some(used / 100.0)),
            starts_at: None,
            resets_at,
            duration_minutes,
            source_metric_id: id.into(),
        });
    }
    ParsedRollout {
        windows,
        validation_error,
        plan_label: plan_label_of(rate_limits),
    }
}

struct SnapshotParts {
    now: DateTime<Utc>,
    status: ObservationStatus,
    message: Option<String>,
    retry_at: Option<DateTime<Utc>>,
    windows: Vec<UsageWindow>,
    active_source_id: Option<&'static str>,
    last_successful_at: Option<DateTime<Utc>>,
    observed_at: Option<DateTime<Utc>>,
    account_label: Option<String>,
}

fn base_snapshot(p: SnapshotParts) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: PROVIDER_ID.into(),
        account_key: None,
        account_label: p.account_label,
        collected_at: p.now,
        last_successful_at: p.last_successful_at,
        observed_at: p.observed_at,
        headline_metric_id: Some("primary".into()),
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

/// Snapshot from one rollout `event_msg` at explicit `now`. The observed
/// account key is always None for rollouts: when an expected account is
/// configured the payload cannot prove ownership, so windows are withheld.
pub fn snapshot_from_rollout_event(
    event: &Value,
    now: DateTime<Utc>,
    expected_account: Option<&str>,
) -> ProviderSnapshot {
    let observed = observed_at_of(event).unwrap_or(now);
    let Some(rate_limits) = event_rate_limits(event) else {
        return base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Unavailable,
            message: Some("no rate_limits in rollout event".into()),
            retry_at: None,
            windows: vec![],
            active_source_id: Some("rollout-fallback"),
            last_successful_at: None,
            observed_at: Some(observed),
            account_label: None,
        });
    };
    if expected_account.is_some() {
        return base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Error,
            message: Some(
                "account unverified: rollout carries no account identifier while an \
                 expected account is configured; windows withheld"
                    .into(),
            ),
            retry_at: None,
            windows: vec![],
            active_source_id: Some("rollout-fallback"),
            last_successful_at: None,
            observed_at: Some(observed),
            account_label: plan_label_of(rate_limits),
        });
    }
    let parsed = parse_rollout_windows(rate_limits);
    if let Some(err) = parsed.validation_error {
        return base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Error,
            message: Some(err),
            retry_at: None,
            windows: parsed.windows,
            active_source_id: Some("rollout-fallback"),
            last_successful_at: None,
            observed_at: Some(observed),
            account_label: parsed.plan_label,
        });
    }
    if parsed.windows.is_empty() {
        return base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Unavailable,
            message: Some("no quota windows in rollout event".into()),
            retry_at: None,
            windows: vec![],
            active_source_id: Some("rollout-fallback"),
            last_successful_at: None,
            observed_at: Some(observed),
            account_label: parsed.plan_label,
        });
    }
    let age_secs = now.signed_duration_since(observed).num_seconds();
    if age_secs > STALE_AFTER_SECS {
        // Domain staleness: a stale observation whose window has not reset yet
        // is still the provider's last-known-good position, so it is kept as
        // STALE; once the reset passed (or no reset is known) the numbers no
        // longer describe any live window and are dropped.
        let reset_still_future =
            parsed.windows.iter().any(|w| w.resets_at.is_some_and(|r| r > now));
        if reset_still_future {
            return base_snapshot(SnapshotParts {
                now,
                status: ObservationStatus::Stale,
                message: Some(format!(
                    "rollout observation is stale (age_s={age_secs} > {STALE_AFTER_SECS}) \
                     but resets_at is still future; last-known-good windows retained"
                )),
                retry_at: None,
                windows: parsed.windows,
                active_source_id: Some("rollout-fallback"),
                last_successful_at: None,
                observed_at: Some(observed),
                account_label: parsed.plan_label,
            });
        }
        return base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Stale,
            message: Some(format!(
                "rollout observation is stale (age_s={age_secs} > {STALE_AFTER_SECS}) \
                 and resets_at passed or is unknown; windows dropped"
            )),
            retry_at: None,
            windows: vec![],
            active_source_id: Some("rollout-fallback"),
            last_successful_at: None,
            observed_at: Some(observed),
            account_label: parsed.plan_label,
        });
    }
    base_snapshot(SnapshotParts {
        now,
        status: ObservationStatus::Live,
        message: None,
        retry_at: None,
        windows: parsed.windows,
        active_source_id: Some("rollout-fallback"),
        last_successful_at: Some(now),
        observed_at: Some(observed),
        account_label: parsed.plan_label,
    })
}

/// Single-line, secret-free diagnosis summary.
pub fn diagnosis_line(
    status: ObservationStatus,
    live_attempted: bool,
    file: Option<&str>,
    event_age_s: Option<i64>,
    windows: usize,
) -> String {
    format!(
        "codex status={status:?} live_attempted={live_attempted} file={} event_age_s={} windows={windows} sources=[app-server-live,rollout-fallback]",
        file.unwrap_or("none"),
        event_age_s.map(|v| v.to_string()).unwrap_or_else(|| "none".into()),
    )
}

#[derive(Default)]
pub struct CodexProviderAdapter {
    expected_account: Option<String>,
    rollout_override: Option<Value>,
    sessions_dir_override: Option<PathBuf>,
}

impl CodexProviderAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_expected_account(mut self, key: impl Into<String>) -> Self {
        self.expected_account = Some(key.into());
        self
    }

    /// In-memory rollout event (e.g. loaded fixture); `collect` prefers it
    /// over disk so parsers stay testable without touching HOME.
    pub fn with_rollout_event(mut self, event: Value) -> Self {
        self.rollout_override = Some(event);
        self
    }

    pub fn with_sessions_dir(mut self, dir: PathBuf) -> Self {
        self.sessions_dir_override = Some(dir);
        self
    }

    fn sessions_root(&self) -> Option<PathBuf> {
        if let Some(dir) = self.sessions_dir_override.clone() {
            return Some(dir);
        }
        home_dir().map(|home| sessions_dir(&home))
    }

    fn newest_rollout_hit(&self) -> Option<RolloutHit> {
        if let Some(event) = self.rollout_override.clone() {
            let observed = observed_at_of(&event).unwrap_or_else(Utc::now);
            return Some(RolloutHit {
                event,
                observed_at: observed,
                file: PathBuf::from("override"),
            });
        }
        find_newest_rollout(self.sessions_root()?.as_path())
    }

    fn collect_internal(&self, now: DateTime<Utc>) -> (ProviderSnapshot, Option<String>, Option<i64>) {
        // Live-first ordering by design: the app-server handshake is the
        // authoritative source, but spawning its subprocess is B2 unit 2, so
        // this unit records the live source as attempted-unavailable and
        // proceeds to the rollout fallback.
        let live_attempted = true;
        let _ = live_attempted;
        if let Some(hit) = self.newest_rollout_hit() {
            let age_s = now
                .signed_duration_since(hit.observed_at)
                .num_seconds()
                .max(0);
            let snap =
                snapshot_from_rollout_event(&hit.event, now, self.expected_account.as_deref());
            let file = hit.file.to_string_lossy().into_owned();
            return (snap, Some(file), Some(age_s));
        }
        let snap = base_snapshot(SnapshotParts {
            now,
            status: ObservationStatus::Unavailable,
            message: Some(
                "live app-server handshake lands in unit 2; \
                 no rollout session with rate_limits found"
                    .into(),
            ),
            retry_at: None,
            windows: vec![],
            active_source_id: None,
            last_successful_at: None,
            observed_at: None,
            account_label: None,
        });
        (snap, None, None)
    }
}

#[async_trait]
impl ProviderAdapter for CodexProviderAdapter {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn source_descriptors(&self) -> Vec<SourceDescriptor> {
        vec![
            SourceDescriptor {
                source_id: "app-server-live".into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::Cli,
                fidelity: SourceFidelity::OfficialSession,
                label: "local Codex app-server stdio (account/rateLimits/read)".into(),
                requires_local_access: true,
            },
            SourceDescriptor {
                source_id: "rollout-fallback".into(),
                provider_id: PROVIDER_ID.into(),
                kind: SourceKind::LocalLog,
                fidelity: SourceFidelity::FirstPartyLocal,
                label: "newest-session rollout tail scan (~/.codex/sessions); \
                        last-known-good rate_limits when live is unavailable"
                    .into(),
                requires_local_access: true,
            },
        ]
    }

    fn headline_metric_id(&self) -> Option<String> {
        Some("primary".into())
    }

    async fn detect(&self) -> usage_halo_core::Result<bool> {
        if let Some(root) = self.sessions_root() {
            if root.exists() {
                return Ok(true);
            }
        }
        Ok(cli_resolvable())
    }

    async fn get_capabilities(&self) -> usage_halo_core::Result<Vec<String>> {
        Ok(vec!["quota_windows".into()])
    }

    async fn get_identity(&self) -> usage_halo_core::Result<ProviderIdentity> {
        let label = self
            .newest_rollout_hit()
            .and_then(|hit| event_rate_limits(&hit.event).cloned())
            .and_then(|rl| plan_label_of(&rl));
        Ok(ProviderIdentity {
            account_key: None,
            account_label: label,
        })
    }

    async fn collect(&self) -> usage_halo_core::Result<ProviderSnapshot> {
        Ok(self.collect_internal(Utc::now()).0)
    }

    async fn diagnose(&self) -> usage_halo_core::Result<ProviderDiagnosis> {
        let now = Utc::now();
        let (snap, file, age_s) = self.collect_internal(now);
        let line = diagnosis_line(
            snap.health_state,
            true,
            file.as_deref(),
            age_s,
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
    use serde_json::json;

    #[test]
    fn parses_primary_secondary() {
        let body = json!({
            "rateLimits": {
                "primary": {"usedPercent": 28, "windowDurationMins": 300, "resetsAt": 1900000000},
                "secondary": {"usedPercent": 61, "windowDurationMins": 10080, "resetsAt": 1900500000}
            }
        });
        let q = parse_rate_limits(&body);
        assert_eq!(q.len(), 2);
        assert_eq!(q[0].used_percent, Some(28.0));
        // 'codex' bucket keeps short ids, like normalizeCodexRateLimits.
        assert_eq!(q[0].limit_id, "primary");
        assert_eq!(q[1].limit_id, "secondary");
    }

    #[test]
    fn non_codex_limit_ids_are_scoped() {
        let body = json!({
            "rateLimitsByLimitId": {
                "codex": {
                    "primary": {"usedPercent": 0, "windowDurationMins": 300, "resetsAt": 1900000000},
                    "secondary": {"usedPercent": 31, "windowDurationMins": 10080, "resetsAt": 1900500000}
                },
                "base_model_inference": {
                    "limitId": "base_model_inference",
                    "limitName": "gpt-reserve",
                    "primary": {"usedPercent": 12, "windowDurationMins": 10080, "resetsAt": 1900000000},
                    "secondary": null
                }
            }
        });
        let q = parse_rate_limits(&body);
        assert_eq!(q.len(), 3);
        let ids: Vec<&str> = q.iter().map(|w| w.limit_id.as_str()).collect();
        assert!(ids.contains(&"primary"));
        assert!(ids.contains(&"secondary"));
        assert!(ids.contains(&"base_model_inference:primary"));
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
            "codex",
            name,
        ]
        .iter()
        .collect();
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        serde_json::from_str(&text).expect("fixture is valid JSON")
    }

    fn fresh_now(event: &Value) -> chrono::DateTime<Utc> {
        observed_at_of(event).expect("fixture carries a timestamp")
            + chrono::Duration::seconds(1800)
    }

    fn definition() -> ProviderDefinition {
        ProviderDefinition {
            id: "codex".into(),
            display_name: "Codex".into(),
            capabilities: vec!["quota_windows".into()],
            sources: CodexProviderAdapter::new().source_descriptors(),
            headline_metric_id: Some("primary".into()),
            secondary_metric_ids: vec!["secondary".into()],
            quota_active_secs: None,
            quota_idle_secs: None,
            activity_secs: None,
            runtime_secs: None,
            billing_secs: None,
        }
    }

    #[test]
    fn primary_only_parses_one_window_with_honest_fraction() {
        let event = fixture("rollout-primary-only.json");
        let snap = snapshot_from_rollout_event(&event, fresh_now(&event), None);
        assert_eq!(snap.health_state, ObservationStatus::Live);
        assert_eq!(snap.windows.len(), 1);
        let window = &snap.windows[0];
        assert_eq!(window.id, "primary");
        assert_eq!(window.source_metric_id, "primary");
        assert_eq!(window.duration_minutes, Some(10080));
        assert_eq!(window.used_fraction, Some(0.01));
        assert!(snap.windows.iter().all(|w| w.id != "secondary"));
        assert!(snap.account_key.is_none());
        assert_eq!(snap.account_label.as_deref(), Some("plan:plus"));
        let headline = definition()
            .resolve_headline(&snap.windows)
            .expect("primary headline resolves");
        assert_eq!(headline.source_metric_id, "primary");
    }

    #[test]
    fn primary_secondary_parses_both_windows() {
        let event = fixture("rollout-primary-secondary.json");
        let snap = snapshot_from_rollout_event(&event, fresh_now(&event), None);
        assert_eq!(snap.health_state, ObservationStatus::Live);
        assert_eq!(snap.windows.len(), 2);
        let secondary = snap
            .windows
            .iter()
            .find(|w| w.id == "secondary")
            .expect("secondary window present");
        assert_eq!(secondary.used_fraction, Some(0.125));
        assert_eq!(secondary.duration_minutes, Some(10080));
        assert!(secondary.resets_at.is_some());
    }

    #[test]
    fn malformed_drops_window_with_error() {
        let event = fixture("rollout-malformed.json");
        let snap = snapshot_from_rollout_event(&event, fresh_now(&event), None);
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(snap.windows.is_empty());
        assert!(
            snap.health_message
                .as_deref()
                .unwrap_or_default()
                .contains("validation"),
            "unexpected message: {:?}",
            snap.health_message
        );
    }

    #[test]
    fn stale_with_future_reset_retains_windows() {
        let event = fixture("rollout-primary-only.json");
        let observed = observed_at_of(&event).expect("fixture timestamp");
        let now = observed + chrono::Duration::seconds(2 * 3600);
        let snap = snapshot_from_rollout_event(&event, now, None);
        assert_eq!(snap.health_state, ObservationStatus::Stale);
        assert_eq!(snap.windows.len(), 1);
        assert_eq!(snap.windows[0].id, "primary");
    }

    #[test]
    fn stale_with_expired_reset_drops_windows() {
        let event = fixture("rollout-stale-expired.json");
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let snap = snapshot_from_rollout_event(&event, now, None);
        assert_eq!(snap.health_state, ObservationStatus::Stale);
        assert!(snap.windows.is_empty());
    }

    #[test]
    fn expected_account_withholds_unkeyed_rollout() {
        let event = fixture("rollout-primary-only.json");
        let snap = snapshot_from_rollout_event(&event, fresh_now(&event), Some("expected"));
        assert_eq!(snap.health_state, ObservationStatus::Error);
        assert!(snap.windows.is_empty());
    }

    #[test]
    fn unknown_extra_keys_are_ignored() {
        let mut event = fixture("rollout-primary-only.json");
        event["payload"]["rate_limits"]["future_window"] =
            serde_json::json!({"used_percent": 99.0});
        event["payload"]["rate_limits"]["notes"] = serde_json::json!("ignore me");
        let snap = snapshot_from_rollout_event(&event, fresh_now(&event), None);
        assert_eq!(snap.health_state, ObservationStatus::Live);
        assert_eq!(snap.windows.len(), 1);
        assert_eq!(snap.windows[0].id, "primary");
    }

    #[test]
    fn appserver_live_fixture_uses_existing_parser() {
        let body = fixture("appserver-live.json");
        let windows = parse_rate_limits(&body);
        assert_eq!(windows.len(), 2);
    }

    #[test]
    fn diagnosis_line_is_single_line_without_secrets() {
        let line = diagnosis_line(ObservationStatus::Live, true, Some("sessions/abc.jsonl"), Some(42), 1);
        assert!(!line.contains('\n'));
        assert!(line.contains("status=Live"));
        assert!(line.contains("live_attempted=true"));
        assert!(line.contains("windows=1"));
    }
}
