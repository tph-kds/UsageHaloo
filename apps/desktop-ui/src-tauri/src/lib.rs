use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use usage_halo_projection::ProjectionService;
use usage_halo_scheduler::{freshness_state, FreshnessState};
use usage_halo_secrets::{aliases, EnvSecretStore, SecretStore};
use usage_halo_storage::Storage;

mod legacy_adapter;

/// Authoritative-store status owned by setup and reported by runtime_info.
/// P0-21: diagnostics must describe the store actually in use — SQLite when
/// migrations applied, otherwise the file-store bridge (never a bare claim).
#[derive(Debug, Clone, Default)]
struct DbState {
    sqlite_ready: bool,
    schema_version: Option<i64>,
    db_path: String,
    snapshot_source: String,
    detail: String,
}

#[derive(Serialize, Clone)]
struct RuntimeInfo {
    version: &'static str,
    architecture: &'static str,
    storage: String,
    sqlite_ready: bool,
    sqlite_schema_version: Option<i64>,
    db_path: String,
    snapshot_source: String,
    detail: String,
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle) -> RuntimeInfo {
    let db: DbState = app
        .try_state::<DbState>()
        .map(|s| s.inner().clone())
        .unwrap_or_default();
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION"),
        architecture: "local-first",
        storage: if db.sqlite_ready {
            "sqlite".to_string()
        } else {
            "file-store-bridge (sqlite unavailable)".to_string()
        },
        sqlite_ready: db.sqlite_ready,
        sqlite_schema_version: db.schema_version,
        db_path: db.db_path,
        snapshot_source: db.snapshot_source,
        detail: db.detail,
    }
}

#[tauri::command]
#[cfg(debug_assertions)]
fn demo_provider_snapshot() -> serde_json::Value {
    // Debug-only demo stub. Never registered in release builds (see run()).
    serde_json::json!({
        "demo": true,
        "sample": true,
        "provider": "claude-code",
        "primary": {"label":"5-hour limit", "used_percent":73, "resets_in":"51 min"},
        "freshness": "live",
        "source": "provider_telemetry",
        "scope": "account"
    })
}

// ---------------------------------------------------------------------------
// File-store snapshot bridge.
//
// The Node prototype (`prototype/server.mjs` + `collectors/store.mjs`) keeps
// an append-only JSONL store under `~/.usagehalo/store/`:
//   usage_events.jsonl   immutable telemetry rows (never mutated)
//   quota_snapshots.jsonl quota snapshots
//   health.json           per-connector health map (`last_success` timestamps)
// This command projects the same store so the Svelte `lib/api.ts` shim stays
// source-compatible between browser-dev mode (`fetch('/api/snapshot')`) and
// Tauri mode (`invoke('snapshot')`). Full SQLite pooling
// (`usage-halo-storage`) is initialized in `setup()`; until the pool is up,
// the file store is the honest source and an empty store renders as sample
// data — never as `0%`.
// ---------------------------------------------------------------------------

fn store_dir() -> Option<PathBuf> {
    dirs_home().map(|h| h.join(".usagehalo").join("store"))
}

#[cfg(windows)]
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

#[cfg(not(windows))]
fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[derive(Debug, Deserialize, Default)]
struct StoredHealth {
    #[serde(default)]
    last_success: Option<String>,
}

fn read_store_health() -> serde_json::Map<String, serde_json::Value> {
    let Some(dir) = store_dir() else {
        return Default::default();
    };
    let path = dir.join("health.json");
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn rfc3339_age_seconds(ts: &str) -> Option<u64> {
    let dt = chrono::DateTime::parse_from_rfc3339(ts).ok()?;
    let age = Utc::now().signed_duration_since(dt.with_timezone(&Utc));
    Some(age.num_seconds().max(0) as u64)
}

fn freshness_label(state: FreshnessState) -> &'static str {
    match state {
        FreshnessState::Live => "live",
        FreshnessState::Fresh => "fresh",
        FreshnessState::Stale => "stale",
        FreshnessState::Unknown => "unknown",
    }
}

fn primary_label(metric: &str) -> &str {
    match metric {
        "quota_5h" => "5-hour limit",
        "primary_quota" => "Primary window",
        "tokens_today" => "Tokens today",
        "budget_month" => "Monthly budget",
        "credit_usage" => "Credits used",
        "included_usage" => "Included usage",
        "quota_5h_credits" => "5-hour credits",
        "spend_month" => "Spend this month",
        "requests_day" => "Daily requests",
        "usage" => "Usage",
        "spend" => "Spend",
        "tokens" => "Tokens",
        "cost" => "Cost",
        "requests" => "Requests",
        _ => "Usage",
    }
}

fn format_tokens(t: u64) -> String {
    if t >= 1_000_000 {
        format!("{:.2}M", t as f64 / 1_000_000.0)
    } else if t >= 1_000 {
        format!("{}K", t / 1_000)
    } else {
        format!("{t}")
    }
}

/// Live snapshot consumed by the Svelte UI (thin wrapper, Phase 4).
///
/// All numbers come from the canonical [`ProjectionService`]; this handler
/// only serializes and maps to the legacy wire shape via `legacy_adapter`
/// (formatting boundary, removed in Phase 7). Failures are `Err`, never
/// silent, never mock data.
#[tauri::command]
fn snapshot(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let storage = app
        .try_state::<Storage>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "sqlite store unavailable".to_string())?;
    tauri::async_runtime::block_on(async move {
        let tz = storage
            .get_setting("timezone")
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| "UTC".into());
        let svc = ProjectionService::new(storage);
        let now = Utc::now();
        let proj = svc
            .overview(&tz, now)
            .await
            .map_err(|e| format!("projection failed: {e:#}"))?;
        let models = svc
            .today_models(&tz, now)
            .await
            .map_err(|e| format!("model breakdown failed: {e:#}"))?;
        Ok(legacy_adapter::to_legacy_snapshot(&proj, &models, &tz, now))
    })
}

/// Canonical overview projection (contracts schema v1) for diagnostics and
/// the Phase 7 UI. Same [`ProjectionService`] as `snapshot`, no adapter.
#[tauri::command]
fn projection_overview(
    app: tauri::AppHandle,
    timezone: Option<String>,
) -> Result<serde_json::Value, String> {
    let storage = app
        .try_state::<Storage>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "sqlite store unavailable".to_string())?;
    tauri::async_runtime::block_on(async move {
        let svc = ProjectionService::new(storage);
        let proj = svc
            .overview(&timezone.unwrap_or_else(|| "UTC".into()), Utc::now())
            .await
            .map_err(|e| format!("projection failed: {e:#}"))?;
        serde_json::to_value(&proj).map_err(|e| format!("serialize failed: {e}"))
    })
}

/// Canonical activity projection for an explicit UTC window.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn projection_activity(
    app: tauri::AppHandle,
    from: String,
    to: String,
    timezone: Option<String>,
    bucket: Option<String>,
    metric: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    use usage_halo_core::contracts::ActivityBucketSize;
    use usage_halo_projection::ActivityParams;
    let storage = app
        .try_state::<Storage>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| "sqlite store unavailable".to_string())?;
    tauri::async_runtime::block_on(async move {
        let parse = |s: &str| {
            chrono::DateTime::parse_from_rfc3339(s)
                .map(|d| d.with_timezone(&Utc))
                .map_err(|_| format!("invalid RFC3339: {s}"))
        };
        let svc = ProjectionService::new(storage);
        let proj = svc
            .activity(
                &ActivityParams {
                    from: parse(&from)?,
                    to: parse(&to)?,
                    timezone: timezone.unwrap_or_else(|| "UTC".into()),
                    bucket: match bucket.as_deref().unwrap_or("day") {
                        "hour" => ActivityBucketSize::Hour,
                        _ => ActivityBucketSize::Day,
                    },
                    metric: metric.unwrap_or_else(|| "tokens".into()),
                    providers: vec![],
                    limit: limit.unwrap_or(500),
                },
                Utc::now(),
            )
            .await
            .map_err(|e| format!("activity failed: {e:#}"))?;
        serde_json::to_value(&proj).map_err(|e| format!("serialize failed: {e}"))
    })
}

/// Per-connector health projected from the file store through the real
/// `usage-halo-scheduler` freshness table, plus secret presence (never values)
/// via `usage-halo-secrets` aliases.
#[tauri::command]
fn connector_health() -> serde_json::Value {
    let health = read_store_health();
    let secrets = EnvSecretStore::new();
    let connectors = [
        ("claude-code", None),
        ("codex", None),
        ("gemini-cli", None),
        ("openai-api", Some(aliases::OPENAI_ADMIN)),
        ("anthropic-api", Some(aliases::ANTHROPIC_ADMIN)),
        ("openrouter", Some(aliases::OPENROUTER_MANAGEMENT)),
        ("cursor", Some(aliases::CURSOR_ADMIN)),
        ("mistral", Some(aliases::MISTRAL_ADMIN)),
        ("github-copilot", None),
        ("ollama", None),
        ("lm-studio", None),
    ];
    let rows: Vec<serde_json::Value> = connectors
        .iter()
        .map(|(id, alias)| {
            let last_success = health
                .get(*id)
                .and_then(|v| serde_json::from_value::<StoredHealth>(v.clone()).ok())
                .and_then(|h| h.last_success);
            let age = last_success.as_deref().and_then(rfc3339_age_seconds);
            let state = freshness_state(id, age);
            serde_json::json!({
                "connector_id": id,
                "freshness": freshness_label(state),
                "last_success": last_success,
                "secret_configured": alias.map(|a| secrets.has(a)).unwrap_or(false),
            })
        })
        .collect();
    serde_json::json!({ "connectors": rows })
}

/// Check the configured update endpoint for a newer release.
///
/// Returns `{ available, version?, notes? }` on success, or an `Err` string
/// when the endpoint is unreachable — the placeholder endpoint in
/// `tauri.conf.json` must be replaced with the real release feed before
/// updates can resolve. Never auto-installs; the UI confirms first.
#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(u) => serde_json::json!({
            "available": true,
            "version": u.version,
            "notes": u.body,
        }),
        None => serde_json::json!({ "available": false }),
    })
}

/// Supervised connector runtime (Phase 5).
///
/// Runs on Tauri's async runtime for the life of the process: a boot
/// collection pass, then a 60s cadence loop where each connector's own
/// nominal interval decides. Secrets resolve from the OS keychain with a
/// logged environment fallback (migration-friendly until keys move over).
/// Sleep/wake is handled by wall-clock jump detection inside the host
/// (staggered resume, no burst, no manufactured failures).
fn spawn_collector(db: Storage) {
    tauri::async_runtime::spawn(async move {
        use std::sync::Arc;
        use usage_halo_collector::ConnectorHost;
        use usage_halo_secrets::keychain::OsKeychainStore;

        let home = usage_halo_storage::db_path()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .and_then(|d| d.parent().map(|h| h.to_path_buf()))
            .or_else(dirs_home)
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let secrets: Arc<dyn SecretStore> = Arc::new(OsKeychainStore::new());
        let mut host = ConnectorHost::new(db, secrets, home).with_env_fallback();
        let stamp = || chrono::Utc::now().timestamp();
        // Boot pass converges everything already collected (spool, file
        // store, pollable APIs) before the first UI paint reads it.
        host.collect_due(stamp(), 60).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let reports = host.collect_due(stamp(), 60).await;
            for r in reports.iter().filter(|r| !r.ok) {
                eprintln!("usagehalo: collect {} failed: {}", r.connector_id, r.detail);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_info,
        demo_provider_snapshot,
        snapshot,
        projection_overview,
        projection_activity,
        connector_health,
        check_for_updates
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_info,
        snapshot,
        projection_overview,
        projection_activity,
        connector_health,
        check_for_updates
    ]);
    builder
        .setup(|app| {
            if let Some(dir) = store_dir() {
                let _ = std::fs::create_dir_all(&dir);
            }
            // Phase 4: the authoritative SQLite store is opened, migrated,
            // and shared with every command. The projection service reads
            // only this store; the legacy file bridge is retired for reads.
            let state = tauri::async_runtime::block_on(async {
                let mut s = DbState {
                    db_path: usage_halo_storage::db_path()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    snapshot_source: "canonical projection service (SQLite)".into(),
                    ..Default::default()
                };
                if let Some(path) = usage_halo_storage::db_path() {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                }
                let Some(url) = usage_halo_storage::db_url() else {
                    s.detail = "no home directory for database path".into();
                    return (s, None);
                };
                match usage_halo_storage::Storage::connect(&url).await {
                    Err(e) => {
                        s.detail = format!("sqlite connect failed: {e:#}");
                        (s, None)
                    }
                    Ok(db) => match db.migrate().await {
                        Err(e) => {
                            s.detail = format!("sqlite migrate failed: {e:#}");
                            (s, None)
                        }
                        Ok(()) => {
                            s.sqlite_ready = true;
                            s.schema_version = db.schema_version().await.ok();
                            s.detail = "sqlite migrations applied".into();
                            (s, Some(db))
                        }
                    },
                }
            });
            app.manage(state.0);
            if let Some(db) = state.1 {
                app.manage(db.clone());
                spawn_collector(db);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UsageHalo");
}

#[cfg(test)]
mod tests {
    use super::legacy_adapter;
    use usage_halo_core::contracts::*;
    use usage_halo_projection::ModelBreakdown;

    fn metric(value: Option<f64>) -> NumericMetric {
        NumericMetric {
            key: "quota.percent_used".into(),
            label: "Key limit used".into(),
            value,
            unit: MetricUnit::Percent,
            availability: AvailabilityState::Available,
            window: None,
            provenance: MetricProvenance {
                source_connector: "openrouter".into(),
                authority: DataKind::ProviderReported,
                observed_at: None,
                received_at: None,
                ingested_at: None,
                freshness: FreshnessState::Fresh,
                age_seconds: Some(60),
                account_id: None,
                workspace_id: None,
                scope_label: None,
                sample: false,
            },
            coverage: None,
        }
    }

    fn provider(id: &str, value: Option<f64>, tokens: Option<f64>) -> ProviderProjection {
        ProviderProjection {
            id: id.into(),
            display_name: "OpenRouter".into(),
            maturity: Maturity::L3,
            capabilities: ProviderCapabilities {
                detection: CapabilityStatus::Supported,
                usage_events: CapabilityStatus::Unknown,
                tokens: CapabilityStatus::Unknown,
                models: CapabilityStatus::Unknown,
                provider_cost: CapabilityStatus::Unknown,
                quota_windows: CapabilityStatus::Unknown,
                reset_at: CapabilityStatus::Unknown,
                credits: CapabilityStatus::Unknown,
                historical_usage: CapabilityStatus::Unknown,
                organization_scope: CapabilityStatus::Unknown,
                account_scope: CapabilityStatus::Unknown,
            },
            detected: Some(true),
            health: vec![],
            primary_metric: value.map(|_| MetricValue::Numeric(metric(value))),
            quota_windows: vec![metric(value)],
            credits: None,
            tokens_today: tokens.map(|v| NumericMetric {
                key: "tokens.today".into(),
                label: "Tokens today".into(),
                value: Some(v),
                unit: MetricUnit::Tokens,
                availability: AvailabilityState::Available,
                window: None,
                provenance: metric(None).provenance,
                coverage: None,
            }),
            requests_today: None,
            provider_cost_today: None,
            estimated_cost_today: None,
            attention: None,
        }
    }

    #[test]
    fn legacy_rows_derive_from_canonical_only() {
        // Gate 4 (Tauri side): every legacy number traces to the canonical
        // projection — no handler-side math, no invented values.
        let proj = OverviewProjection {
            schema_version: SCHEMA_VERSION,
            generated_at: chrono::Utc::now(),
            timezone: "UTC".into(),
            mode: AppMode::Production,
            backend_state: BackendState::Healthy,
            last_successful_projection_at: None,
            providers: vec![
                provider("openrouter", Some(42.0), Some(1500.0)),
                provider("cursor", None, None),
            ],
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
        let models = vec![ModelBreakdown {
            surface: "openrouter".into(),
            model: "model-x".into(),
            billing_owner: "openrouter".into(),
            model_provider: Some("anthropic".into()),
            tokens: 1500,
            observations: 2,
        }];
        let snap = legacy_adapter::to_legacy_snapshot(&proj, &models, "UTC", chrono::Utc::now());
        assert_eq!(snap["schema_version"], 1);
        let by_id: std::collections::HashMap<String, serde_json::Value> = snap["providers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["id"].as_str().unwrap().to_string(), p.clone()))
            .collect();
        let or = &by_id["openrouter"];
        assert_eq!(or["primaryPercent"], 42);
        assert_eq!(or["tokens_today_value"], 1500.0);
        assert_eq!(or["tokensToday"], "1K"); // legacy integer-K formatting, preserved
        assert_eq!(or["provenance"]["sample"], false);
        // No evidence: nulls, never zero; never sample-mislabeled real data.
        let cur = &by_id["cursor"];
        assert!(cur["primaryPercent"].is_null());
        assert!(cur["tokens_today_value"].is_null());
        let m = &snap["models"].as_array().unwrap()[0];
        assert_eq!(m["model_provider"], "anthropic");
        assert_eq!(m["billing_owner"], "openrouter");
        assert_eq!(m["tokens"], 1500);
    }
}
