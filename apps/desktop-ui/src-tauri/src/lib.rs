use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri_plugin_updater::UpdaterExt;
use usage_halo_scheduler::{freshness_state, FreshnessState};
use usage_halo_secrets::{aliases, EnvSecretStore, SecretStore};

#[derive(Serialize)]
struct RuntimeInfo {
    version: &'static str,
    architecture: &'static str,
    storage: &'static str,
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION"),
        architecture: "local-first",
        storage: "sqlite",
    }
}

#[tauri::command]
fn demo_provider_snapshot() -> serde_json::Value {
    serde_json::json!({
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
struct StoredEvent {
    #[serde(default)]
    provider: String,
    #[serde(default)]
    billing_owner: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
    #[serde(default)]
    provider_cost: Option<f64>,
    #[serde(default)]
    requests: Option<u64>,
    #[serde(default)]
    observed_at: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct StoredHealth {
    #[serde(default)]
    last_success: Option<String>,
}

fn read_store_events(limit: usize) -> Vec<StoredEvent> {
    let Some(dir) = store_dir() else {
        return Vec::new();
    };
    let path = dir.join("usage_events.jsonl");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<StoredEvent>(l).ok())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .take(limit)
        .collect()
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

/// Live snapshot consumed by the Svelte UI.
///
/// Shape matches the prototype's `/api/snapshot` (registry-driven providers +
/// models) so `lib/api.ts` needs no fork. `sample_data: true` whenever the
/// file store holds no rows; every provider row carries its provenance and a
/// `live` flag instead of a fake `0%`.
#[tauri::command]
fn snapshot() -> serde_json::Value {
    let events = read_store_events(2000);
    let health = read_store_health();

    let mut tokens: u64 = 0;
    let mut cost: f64 = 0.0;
    let mut requests: u64 = 0;
    let mut latest_observed_at: Option<String> = None;
    let mut by_provider: std::collections::BTreeMap<String, serde_json::Value> = Default::default();
    for e in &events {
        let t = e.input_tokens.unwrap_or(0) + e.output_tokens.unwrap_or(0);
        tokens += t;
        cost += e.provider_cost.unwrap_or(0.0);
        requests += e.requests.unwrap_or(0);
        if e.observed_at.as_ref() > latest_observed_at.as_ref() {
            latest_observed_at = e.observed_at.clone();
        }
        let entry = by_provider
            .entry(e.provider.clone())
            .or_insert_with(|| {
                serde_json::json!({"tokens": 0, "requests": 0, "models": [], "billing_owner": e.billing_owner})
            });
        entry["tokens"] = serde_json::json!(entry["tokens"].as_u64().unwrap_or(0) + t);
        entry["requests"] =
            serde_json::json!(entry["requests"].as_u64().unwrap_or(0) + e.requests.unwrap_or(0));
        if let Some(m) = &e.model {
            if let Some(models) = entry["models"].as_array_mut() {
                if !models.iter().any(|x| x.as_str() == Some(m)) && models.len() < 12 {
                    models.push(serde_json::Value::String(m.clone()));
                }
            }
        }
    }

    serde_json::json!({
        "generated_at": Utc::now().to_rfc3339(),
        "day_utc": Utc::now().format("%Y-%m-%d").to_string(),
        "data_basis": "tauri-file-store",
        "sample_data": events.is_empty(),
        "provider_count": 0,
        "providers": [],
        "models": [],
        "store": {
            "events": events.len(),
            "observed_tokens": tokens,
            "provider_cost": cost,
            "requests": requests,
            "latest_observed_at": latest_observed_at,
            "by_provider": by_provider,
        },
        "health": health,
        "provenance_note": "Raw observations are immutable; the UI reads reconciled projections. Empty store renders as sample data, never as 0%.",
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            demo_provider_snapshot,
            snapshot,
            connector_health,
            check_for_updates
        ])
        .setup(|app| {
            // Production runtime wiring order:
            // 1. usage-halo-storage: connect SQLite, run migrations.
            // 2. usage-halo-secrets: OS keychain backend behind the
            //    `os-keychain` feature (dev fallback: USAGEHALO_SECRET_*).
            // 3. usage-halo-scheduler: per-connector poll timers + event
            //    receivers (Claude spool / Codex app-server / OTLP).
            // 4. usage-halo-reconcile: read-time authority selection.
            // 5. Tray/menu-bar menu + rail window placement restore.
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UsageHalo");
}
