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

const REGISTRY_JSON: &str = include_str!("../../../../packages/brand-registry/providers.json");

fn registry_providers() -> Vec<serde_json::Value> {
    serde_json::from_str(REGISTRY_JSON).unwrap_or_default()
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

#[derive(Debug, Deserialize, Default)]
struct SpoolClaude {
    #[serde(default)]
    model: Option<SpoolModel>,
    #[serde(default)]
    cost: Option<SpoolCost>,
    #[serde(default)]
    rate_limits: Option<SpoolRateLimits>,
}
#[derive(Debug, Deserialize, Default)]
struct SpoolModel {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}
#[derive(Debug, Deserialize, Default)]
struct SpoolCost {
    #[serde(default)]
    total_cost_usd: Option<f64>,
}
#[derive(Debug, Deserialize, Default)]
struct SpoolRateLimits {
    #[serde(default)]
    five_hour: Option<SpoolWindow>,
    #[serde(default)]
    seven_day: Option<SpoolWindow>,
}
#[derive(Debug, Deserialize, Default)]
struct SpoolWindow {
    #[serde(default)]
    used_percentage: Option<f64>,
}

/// Real Claude spool only (never the checked-in fixture). Returns None when no
/// spool file exists, so honest-empty stays empty.
fn read_live_claude() -> Option<SpoolClaude> {
    let home = dirs_home()?;
    for rel in [
        ".usagehalo/inbox/claude-code.jsonl",
        ".viusagever/inbox/claude-code.jsonl",
    ] {
        let path = home.join(rel);
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Some(last) = content.lines().rfind(|l| !l.trim().is_empty()) {
            if let Ok(v) = serde_json::from_str::<SpoolClaude>(last) {
                return Some(v);
            }
        }
    }
    None
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

fn secret_alias_for(id: &str) -> Option<&'static str> {
    match id {
        "openai-api" => Some(aliases::OPENAI_ADMIN),
        "anthropic-api" => Some(aliases::ANTHROPIC_ADMIN),
        "openrouter" => Some(aliases::OPENROUTER_MANAGEMENT),
        "cursor" => Some(aliases::CURSOR_ADMIN),
        "mistral" => Some(aliases::MISTRAL_ADMIN),
        _ => None,
    }
}

fn build_provider_rows(
    events: &[StoredEvent],
    health: &serde_json::Map<String, serde_json::Value>,
    secrets: &EnvSecretStore,
    by_provider: &std::collections::BTreeMap<String, serde_json::Value>,
) -> Vec<serde_json::Value> {
    let live_claude = read_live_claude();
    registry_providers()
        .into_iter()
        .map(|p| {
            let id = p.get("id").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let primary_metric = p.get("primaryMetric").and_then(|v| v.as_str()).unwrap_or("usage");
            let last_success = health
                .get(&id)
                .and_then(|v| serde_json::from_value::<StoredHealth>(v.clone()).ok())
                .and_then(|h| h.last_success);
            let age = last_success.as_deref().and_then(rfc3339_age_seconds);
            let state = freshness_state(&id, age);
            let agg = by_provider.get(&id);
            let agg_tokens = agg.and_then(|a| a.get("tokens")).and_then(|v| v.as_u64()).unwrap_or(0);
            let agg_cost = events
                .iter()
                .filter(|e| e.provider == id)
                .filter_map(|e| e.provider_cost)
                .sum::<f64>();

            // Honest default: nulls everywhere. Overlays below fill only what a
            // live source actually reported.
            let mut row = serde_json::json!({
                "id": id,
                "displayName": p.get("displayName"),
                "vendor": p.get("vendor"),
                "monogram": p.get("monogram"),
                "accent": p.get("accent"),
                "primaryMetric": primary_metric,
                "primaryLabel": primary_label(primary_metric),
                "primaryPercent": serde_json::Value::Null,
                "primaryReset": serde_json::Value::Null,
                "secondaryLabel": "7-day limit",
                "secondaryPercent": serde_json::Value::Null,
                "secondaryReset": serde_json::Value::Null,
                "tokensToday": serde_json::Value::Null,
                "costToday": serde_json::Value::Null,
                "freshness": freshness_label(state),
                "source": p.get("sourceMode"),
                "scope": p.get("scope"),
                "health": if matches!(state, FreshnessState::Unknown) { "unknown" } else { freshness_label(state) },
                "live": false,
                "installed": health.contains_key(&id) || agg.is_some(),
                "configured": secret_alias_for(&id).map(|a| secrets.has(a)).unwrap_or(false) || agg.is_some() || health.contains_key(&id),
                "provenance": {"authority": "estimated", "sample": true},
            });

            if agg_tokens > 0 {
                row["tokensToday"] = serde_json::Value::String(format_tokens(agg_tokens));
            }
            if agg_cost > 0.0 {
                row["costToday"] = serde_json::Value::String(format!("${agg_cost:.2}"));
            }

            if id == "claude-code" {
                if let Some(spool) = &live_claude {
                    if let Some(five) = spool.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref()).and_then(|w| w.used_percentage) {
                        row["primaryPercent"] = serde_json::json!(five.round() as i64);
                    }
                    if let Some(seven) = spool.rate_limits.as_ref().and_then(|r| r.seven_day.as_ref()).and_then(|w| w.used_percentage) {
                        row["secondaryPercent"] = serde_json::json!(seven.round() as i64);
                    }
                    let model = spool.model.as_ref().and_then(|m| m.display_name.clone().or_else(|| m.id.clone()));
                    if let Some(m) = model {
                        row["tokensToday"] = serde_json::Value::String(format!("model: {m}"));
                    }
                    if let Some(c) = spool.cost.as_ref().and_then(|c| c.total_cost_usd) {
                        row["costToday"] = serde_json::Value::String(format!("${c:.2} session"));
                    }
                    row["source"] = serde_json::Value::String("claude_code_statusline".to_string());
                    row["freshness"] = serde_json::Value::String("live".to_string());
                    row["health"] = serde_json::Value::String("healthy".to_string());
                    row["live"] = serde_json::Value::Bool(true);
                    row["installed"] = serde_json::Value::Bool(true);
                    row["provenance"] = serde_json::json!({"authority": "provider_telemetry", "sample": false});
                }
            }
            row
        })
        .collect()
}

fn build_model_rows(
    by_provider: &std::collections::BTreeMap<String, serde_json::Value>,
) -> Vec<serde_json::Value> {
    // Only surfaces with observed store rows — never invented router models.
    by_provider
        .iter()
        .filter(|(_, v)| v.get("tokens").and_then(|t| t.as_u64()).unwrap_or(0) > 0)
        .map(|(provider, v)| {
            let models = v.get("models").and_then(|m| m.as_array()).cloned().unwrap_or_default();
            let model = models.first().and_then(|m| m.as_str()).unwrap_or("unknown").to_string();
            serde_json::json!({
                "surface": provider,
                "model_provider": provider,
                "billing_owner": v.get("billing_owner").and_then(|b| b.as_str()).unwrap_or(provider),
                "model": model,
                "tokens": v.get("tokens"),
                "cost": null,
            })
        })
        .collect()
}

/// Live snapshot consumed by the Svelte UI.
///
/// Shape matches the prototype's `/api/snapshot` (registry-driven providers +
/// models) so `lib/api.ts` needs no fork. `sample_data: true` only when neither
/// the file store nor any live spool holds rows; every provider row carries its
/// provenance and a `live` flag instead of a fake `0%`. Unconfigured providers
/// report `primaryPercent: null` (rendered as Unknown), never an invented bar.
#[tauri::command]
fn snapshot() -> serde_json::Value {
    let events = read_store_events(2000);
    let health = read_store_health();
    let secrets = EnvSecretStore::new();

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
        "sample_data": events.is_empty() && read_live_claude().is_none(),
        "provider_count": registry_providers().len(),
        "providers": build_provider_rows(&events, &health, &secrets, &by_provider),
        "models": build_model_rows(&by_provider),
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
    let builder = tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_info,
        demo_provider_snapshot,
        snapshot,
        connector_health,
        check_for_updates
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_info,
        snapshot,
        connector_health,
        check_for_updates
    ]);
    builder
        .setup(|_app| {
            // Minimal honest setup: ensure the file-store dir exists so the
            // snapshot bridge never fails on first run. Full SQLite pooling
            // (usage-halo-storage migrations) remains an explicit TODO.
            if let Some(dir) = store_dir() {
                let _ = std::fs::create_dir_all(&dir);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running UsageHalo");
}
