//! Legacy wire adapter (Phase 4; removal target in Phase 7 frontend convergence).
//!
//! Maps the canonical [`OverviewProjection`] to the pre-existing snapshot
//! JSON shape the current Svelte UI consumes. Formatting only: every number,
//! window, freshness, and provenance decision arrives from the projection
//! service. The one deliberate interim feed is the Claude spool overlay
//! (live status-line file → row overlay); Phase 5 ingests the spool into
//! SQLite and this overlay disappears.

use chrono::{DateTime, Utc};
use usage_halo_core::contracts::{
    DataKind, FreshnessState, MetricUnit, MetricValue, NumericMetric, OverviewProjection,
};
use usage_halo_projection::ModelBreakdown;

use super::{format_tokens, primary_label};

// -- spool overlay (interim; Phase 5 ingests this into SQLite) ---------------

#[derive(Debug, serde::Deserialize, Default)]
pub struct SpoolClaude {
    #[serde(default)]
    pub observed_at: Option<String>,
    #[serde(default)]
    pub model: Option<SpoolModel>,
    #[serde(default)]
    pub cost: Option<SpoolCost>,
    #[serde(default)]
    pub rate_limits: Option<SpoolRateLimits>,
}
#[derive(Debug, serde::Deserialize, Default)]
pub struct SpoolModel {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}
#[derive(Debug, serde::Deserialize, Default)]
pub struct SpoolCost {
    #[serde(default)]
    pub total_cost_usd: Option<f64>,
}
#[derive(Debug, serde::Deserialize, Default)]
pub struct SpoolRateLimits {
    #[serde(default)]
    pub five_hour: Option<SpoolWindow>,
    #[serde(default)]
    pub seven_day: Option<SpoolWindow>,
}
#[derive(Debug, serde::Deserialize, Default)]
pub struct SpoolWindow {
    #[serde(default)]
    pub used_percentage: Option<f64>,
}

fn dirs_home() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(std::path::PathBuf::from)
    }
}

/// Real Claude spool only (never the checked-in fixture), preserving the
/// source measurement time. Honest-empty (no file) stays empty.
pub fn read_live_claude() -> Option<(SpoolClaude, i64)> {
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
                let observed = v
                    .observed_at
                    .as_deref()
                    .and_then(|s| {
                        chrono::DateTime::parse_from_rfc3339(s)
                            .ok()
                            .map(|d| d.timestamp())
                    })
                    .or_else(|| {
                        std::fs::metadata(&path)
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                    });
                if let Some(ts) = observed {
                    return Some((v, ts));
                }
            }
        }
    }
    None
}

/// Spool freshness from observation age (mirrors collectors/local.mjs):
/// <=120s live, <=10min fresh, <=60min delayed, else stale.
pub fn spool_freshness(age_secs: Option<u64>) -> (&'static str, bool) {
    match age_secs {
        None => ("unknown", false),
        Some(a) if a <= 120 => ("live", true),
        Some(a) if a <= 600 => ("fresh", true),
        Some(a) if a <= 3600 => ("delayed", false),
        _ => ("stale", false),
    }
}

// -- canonical → legacy mapping --------------------------------------------------

fn authority_label(kind: &DataKind) -> &'static str {
    match kind {
        DataKind::ProviderReported => "provider_reported",
        DataKind::LocallyObserved => "locally_observed",
        DataKind::Reconciled => "reconciled",
        DataKind::Estimated => "estimated",
        DataKind::Sample => "sample",
    }
}

fn freshness_str(f: &FreshnessState) -> &'static str {
    match f {
        FreshnessState::Live => "live",
        FreshnessState::Fresh => "fresh",
        FreshnessState::Delayed => "delayed",
        FreshnessState::Stale => "stale",
        FreshnessState::Unknown => "unknown",
    }
}

fn percent_of(metric: &Option<MetricValue>) -> serde_json::Value {
    match metric {
        Some(MetricValue::Numeric(m)) if m.unit == MetricUnit::Percent => match m.value {
            Some(v) => serde_json::json!(v.round() as i64),
            None => serde_json::Value::Null,
        },
        _ => serde_json::Value::Null,
    }
}

fn reset_text(metric: &Option<MetricValue>, now: DateTime<Utc>) -> serde_json::Value {
    let reset = match metric {
        Some(MetricValue::Numeric(m)) => m.window.as_ref().and_then(|w| w.reset_at),
        _ => None,
    };
    match reset {
        None => serde_json::Value::Null,
        Some(r) => {
            let secs = (r - now).num_seconds().max(0);
            let text = if secs < 3600 {
                format!("{} min", (secs / 60).max(1))
            } else if secs < 86400 {
                format!("{}h {:02}m", secs / 3600, (secs % 3600) / 60)
            } else {
                format!("{}d", secs / 86400)
            };
            serde_json::Value::String(format!("Resets in {text}"))
        }
    }
}

fn metric_display(m: &NumericMetric) -> (serde_json::Value, serde_json::Value) {
    match (m.unit, m.value) {
        (MetricUnit::Tokens, Some(v)) => (
            serde_json::Value::String(format_tokens(v as u64)),
            serde_json::json!(v),
        ),
        _ => (serde_json::Value::Null, serde_json::Value::Null),
    }
}

const REGISTRY_JSON: &str = include_str!("../../../../packages/brand-registry/providers.json");

fn registry() -> Vec<serde_json::Value> {
    serde_json::from_str(REGISTRY_JSON).unwrap_or_default()
}

/// Canonical projection → legacy snapshot wire shape. The Svelte UI consumes
/// this unchanged until the Phase 7 convergence onto canonical DTOs.
pub fn to_legacy_snapshot(
    proj: &OverviewProjection,
    models: &[ModelBreakdown],
    timezone: &str,
    now: DateTime<Utc>,
) -> serde_json::Value {
    let reg = registry();
    let by_id: std::collections::BTreeMap<String, serde_json::Value> = reg
        .into_iter()
        .map(|p| {
            (
                p.get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                p,
            )
        })
        .collect();

    let spool = read_live_claude();
    let mut any_evidence = false;

    let providers: Vec<serde_json::Value> = proj
        .providers
        .iter()
        .map(|p| {
            let meta = by_id.get(&p.id);
            let primary_metric_key = meta
                .and_then(|m| m.get("primaryMetric"))
                .and_then(|v| v.as_str())
                .unwrap_or("usage");
            let (tokens_display, tokens_value) = p
                .tokens_today
                .as_ref()
                .map(metric_display)
                .unwrap_or((serde_json::Value::Null, serde_json::Value::Null));
            let (cost_display, cost_value) = match &p.provider_cost_today {
                Some(c) => {
                    let text = c.amount.as_deref().and_then(|a| a.parse::<f64>().ok()).map(
                        |v| serde_json::Value::String(format!("${v:.2}")),
                    );
                    let num = c
                        .amount
                        .as_deref()
                        .and_then(|a| a.parse::<f64>().ok())
                        .map(|v| serde_json::json!(v));
                    (
                        text.unwrap_or(serde_json::Value::Null),
                        num.unwrap_or(serde_json::Value::Null),
                    )
                }
                None => (serde_json::Value::Null, serde_json::Value::Null),
            };
            let freshness = provider_freshness(p);
            let has_evidence = p.primary_metric.is_some() || p.tokens_today.is_some();
            if has_evidence {
                any_evidence = true;
            }
            let secondary = p
                .quota_windows
                .iter()
                .filter(|m| m.value.is_some())
                .nth(1)
                .map(|m| {
                    serde_json::json!({
                        "label": m.label,
                        "percent": m.value.map(|v| v.round() as i64),
                    })
                });

            let mut row = serde_json::json!({
                "id": p.id,
                "displayName": meta.and_then(|m| m.get("displayName")).cloned().unwrap_or(serde_json::Value::String(p.display_name.clone())),
                "vendor": meta.and_then(|m| m.get("vendor")).cloned().unwrap_or(serde_json::Value::Null),
                "monogram": meta.and_then(|m| m.get("monogram")).cloned().unwrap_or(serde_json::Value::String("?".to_string())),
                "accent": meta.and_then(|m| m.get("accent")).cloned().unwrap_or(serde_json::Value::String("#888".to_string())),
                "primaryMetric": primary_metric_key,
                "primaryLabel": primary_label(primary_metric_key),
                "primaryPercent": percent_of(&p.primary_metric),
                "primaryReset": reset_text(&p.primary_metric, now),
                "secondaryLabel": secondary.as_ref().and_then(|s| s.get("label")).cloned().unwrap_or(serde_json::Value::String("7-day limit".to_string())),
                "secondaryPercent": secondary.as_ref().and_then(|s| s.get("percent")).cloned().unwrap_or(serde_json::Value::Null),
                "secondaryReset": serde_json::Value::Null,
                "tokensToday": tokens_display,
                "costToday": cost_display,
                "tokens_today_value": tokens_value,
                "cost_today_value": cost_value,
                "freshness": freshness,
                "source": meta.and_then(|m| m.get("sourceMode")).cloned().unwrap_or(serde_json::Value::Null),
                "scope": meta.and_then(|m| m.get("scope")).cloned().unwrap_or(serde_json::Value::Null),
                "health": if freshness == "unknown" { "unknown" } else { freshness },
                "live": freshness == "live" || freshness == "fresh",
                "installed": p.detected == Some(true),
                "configured": p.detected == Some(true),
                "provenance": {
                    "authority": p.primary_metric.as_ref().map(|m| match m {
                        MetricValue::Numeric(n) => authority_label(&n.provenance.authority),
                        MetricValue::Money(n) => authority_label(&n.provenance.authority),
                    }).unwrap_or("estimated"),
                    "freshness": freshness,
                    "sample": !has_evidence,
                },
            });

            // Interim spool overlay (Phase 5 ingests the spool into SQLite).
            if p.id == "claude-code" {
                if let Some((spool, observed_ts)) = &spool {
                    let has_real = spool
                        .rate_limits
                        .as_ref()
                        .and_then(|r| r.five_hour.as_ref())
                        .and_then(|w| w.used_percentage)
                        .is_some()
                        || spool.model.as_ref().and_then(|m| {
                            m.display_name.clone().or_else(|| m.id.clone())
                        }).is_some();
                    if has_real {
                        any_evidence = true;
                        if let Some(five) = spool.rate_limits.as_ref().and_then(|r| r.five_hour.as_ref()).and_then(|w| w.used_percentage) {
                            row["primaryPercent"] = serde_json::json!(five.round() as i64);
                        }
                        if let Some(seven) = spool.rate_limits.as_ref().and_then(|r| r.seven_day.as_ref()).and_then(|w| w.used_percentage) {
                            row["secondaryPercent"] = serde_json::json!(seven.round() as i64);
                        }
                        if let Some(m) = spool.model.as_ref().and_then(|m| m.display_name.clone().or_else(|| m.id.clone())) {
                            row["tokensToday"] = serde_json::Value::String(format!("model: {m}"));
                        }
                        if let Some(c) = spool.cost.as_ref().and_then(|c| c.total_cost_usd) {
                            row["costToday"] = serde_json::Value::String(format!("${c:.2} session"));
                        }
                        let age = (now.timestamp() - observed_ts).max(0) as u64;
                        let (fresh, live) = spool_freshness(Some(age));
                        row["source"] = serde_json::Value::String("claude_code_statusline".to_string());
                        row["freshness"] = serde_json::Value::String(fresh.to_string());
                        row["health"] = serde_json::Value::String(if live { "healthy" } else { fresh }.to_string());
                        row["live"] = serde_json::Value::Bool(live);
                        row["installed"] = serde_json::Value::Bool(true);
                        row["provenance"] = serde_json::json!({"authority": "provider_telemetry", "sample": false, "freshness": fresh});
                    }
                }
            }
            row
        })
        .collect();

    let model_rows: Vec<serde_json::Value> = models
        .iter()
        .map(|m| {
            serde_json::json!({
                "surface": m.surface,
                "model_provider": m.model_provider,
                "billing_owner": m.billing_owner,
                "model": m.model,
                "tokens": m.tokens,
                "cost": null,
            })
        })
        .collect();

    let day_utc = usage_halo_core::time::local_date(timezone, now)
        .unwrap_or_else(|_| now.format("%Y-%m-%d").to_string());
    let tokens_total = proj.observed_tokens_today.as_ref().and_then(|m| m.value);
    let requests_total = proj.observed_requests_today.as_ref().and_then(|m| m.value);
    let cost_total = proj
        .provider_cost_today_by_currency
        .first()
        .and_then(|c| c.amount.as_deref())
        .and_then(|a| a.parse::<f64>().ok());

    serde_json::json!({
        "schema_version": 1,
        "generated_at": now.to_rfc3339(),
        "day_utc": day_utc,
        "data_basis": "tauri-canonical-projection",
        "sample_data": !any_evidence && spool.is_none(),
        "provider_count": proj.providers.len(),
        "providers": providers,
        "models": model_rows,
        "store": {
            "events": serde_json::Value::Null,
            "observed_tokens": tokens_total,
            "provider_cost": cost_total,
            "requests": requests_total,
            "latest_observed_at": proj.data_health.latest_observation_at,
        },
        "health": proj.providers.iter().flat_map(|p| p.health.iter().map(|h| {
            serde_json::json!({ h.connector_id.clone(): { "last_success": h.last_success_at } })
        })).collect::<Vec<_>>(),
        "provenance_note": "Projected from reconciled SQLite store by the canonical projection service; file-store bridge retired for reads.",
    })
}

fn provider_freshness(p: &usage_halo_core::contracts::ProviderProjection) -> &'static str {
    let from_primary = p.primary_metric.as_ref().map(|m| match m {
        MetricValue::Numeric(n) => &n.provenance.freshness,
        MetricValue::Money(n) => &n.provenance.freshness,
    });
    let from_tokens = p.tokens_today.as_ref().map(|m| &m.provenance.freshness);
    from_primary
        .or(from_tokens)
        .map(freshness_str)
        .unwrap_or("unknown")
}

#[cfg(test)]
mod tests {
    use super::*;
    use usage_halo_core::contracts::*;

    fn empty_projection() -> OverviewProjection {
        OverviewProjection {
            schema_version: SCHEMA_VERSION,
            generated_at: Utc::now(),
            timezone: "UTC".into(),
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
        }
    }

    #[test]
    fn stale_spool_is_never_live() {
        assert_eq!(spool_freshness(None), ("unknown", false));
        assert_eq!(spool_freshness(Some(30)), ("live", true));
        assert_eq!(spool_freshness(Some(600)), ("fresh", true));
        assert_eq!(spool_freshness(Some(1800)), ("delayed", false));
        assert_eq!(spool_freshness(Some(7200)), ("stale", false));
    }

    #[test]
    fn empty_projection_maps_to_honest_legacy_snapshot() {
        // No HOME spool in CI either way: sample_data follows evidence only.
        let snap = to_legacy_snapshot(&empty_projection(), &[], "UTC", Utc::now());
        assert_eq!(snap["schema_version"], 1);
        assert_eq!(snap["data_basis"], "tauri-canonical-projection");
        assert_eq!(snap["provider_count"], 0);
        assert!(snap["providers"].as_array().unwrap().is_empty());
        assert!(snap["models"].as_array().unwrap().is_empty());
    }
}
