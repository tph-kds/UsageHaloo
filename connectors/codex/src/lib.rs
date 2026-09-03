use chrono::Utc;
use serde_json::Value;
use usage_halo_core::{
    epoch_seconds_to_utc, FreshnessClass, MetricKind, Provenance, QuotaWindow, SourceAuthority,
    SourceScope,
};

/// Parser for the documented Codex app-server rate-limit result/notification.
/// Process lifecycle and version-specific initialization belong in the desktop
/// runtime so they can be updated independently of this pure parser.
pub fn parse_rate_limits(result: &Value) -> Vec<QuotaWindow> {
    let now = Utc::now();
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
                limit_id: format!("{limit_id}:{name}"),
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
    }
}
