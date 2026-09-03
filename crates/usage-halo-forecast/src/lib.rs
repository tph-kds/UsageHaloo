//! Deterministic, explainable quota and spend forecasts (no LLM).
//!
//! Mirrors `collectors/forecast.mjs` exactly: EWMA burn rate with alpha 0.35,
//! suppression on stale data or too few samples, and labels that are visually
//! distinct from provider observations ("Projected …" / "Likely to hit …").
//! Shared vectors live in `fixtures/forecast-vectors.json` and are consumed
//! by both this crate's tests and the JS contract tests.

pub const EWMA_ALPHA: f64 = 0.35;

pub fn ewma(values: &[f64], alpha: f64) -> f64 {
    let mut iter = values.iter();
    let Some(&first) = iter.next() else {
        return 0.0;
    };
    let mut m = first;
    for &v in iter {
        m = alpha * v + (1.0 - alpha) * m;
    }
    m
}

fn round_to(value: f64, places: u32) -> f64 {
    let f = 10f64.powi(places as i32);
    (value * f).round() / f
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuotaForecast {
    pub suppressed: bool,
    pub burn_per_hour: f64,
    pub projected_at_reset: f64,
    pub eta_hours: Option<f64>,
    pub label: String,
}

/// Forecast quota exhaustion. `None` inputs or too few samples suppress.
pub fn forecast_quota(
    used_percent: Option<f64>,
    hours_left: Option<f64>,
    recent_burn_per_hour: &[f64],
    min_samples: usize,
) -> QuotaForecast {
    let samples: Vec<f64> = recent_burn_per_hour
        .iter()
        .copied()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .collect();
    let (Some(used), Some(left)) = (used_percent, hours_left) else {
        return suppressed();
    };
    if samples.len() < min_samples || !used.is_finite() || !left.is_finite() || left <= 0.0 {
        return suppressed();
    }
    let burn = ewma(&samples, EWMA_ALPHA);
    let projected = used + burn * left;
    let eta_hours = if burn > 0.0 {
        Some((100.0 - used) / burn)
    } else {
        None
    };
    let (eta_h, label) = match eta_hours {
        Some(h) if h <= left => (
            Some(round_to(h, 1)),
            format!("Likely to hit limit in ~{} min", (h * 60.0).round() as i64),
        ),
        _ => (
            eta_hours.map(|h| round_to(h, 1)),
            format!("Projected at reset: {}%", projected.round() as i64),
        ),
    };
    QuotaForecast {
        suppressed: false,
        burn_per_hour: round_to(burn, 3),
        projected_at_reset: round_to(projected, 1),
        eta_hours: eta_h,
        label,
    }
}

fn suppressed() -> QuotaForecast {
    QuotaForecast {
        suppressed: true,
        burn_per_hour: 0.0,
        projected_at_reset: 0.0,
        eta_hours: None,
        label: String::new(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpendForecast {
    pub suppressed: bool,
    pub daily_avg: f64,
    pub projected_month: f64,
    pub label: String,
}

pub fn forecast_spend(daily_costs: &[f64], days_in_month: u32) -> SpendForecast {
    let vals: Vec<f64> = daily_costs
        .iter()
        .copied()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .collect();
    if vals.len() < 3 {
        return SpendForecast {
            suppressed: true,
            daily_avg: 0.0,
            projected_month: 0.0,
            label: String::new(),
        };
    }
    let avg = ewma(&vals, EWMA_ALPHA);
    let projected = avg * days_in_month as f64;
    SpendForecast {
        suppressed: false,
        daily_avg: round_to(avg, 2),
        projected_month: round_to(projected, 2),
        label: format!("On pace for ${:.2} this month", projected),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        let raw = include_str!("../../../fixtures/forecast-vectors.json");
        serde_json::from_str(raw).expect("fixture parses")
    }

    #[test]
    fn ewma_matches_shared_vector() {
        let v = vectors();
        let series: Vec<f64> = v["ewma_series"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let got = ewma(&series, v["ewma_alpha"].as_f64().unwrap());
        let want = v["ewma_expected"].as_f64().unwrap();
        assert!((got - want).abs() < 1e-9, "got {got}, want {want}");
    }

    #[test]
    fn quota_forecast_matches_shared_vector() {
        let q = &vectors()["quota"];
        let burn: Vec<f64> = q["recent_burn_per_hour"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let f = forecast_quota(
            q["used_percent"].as_f64(),
            Some(q["hours_left"].as_f64().unwrap()),
            &burn,
            q["min_samples"].as_u64().unwrap() as usize,
        );
        assert!(!f.suppressed);
        assert!(
            (f.projected_at_reset - q["expected_projected_at_reset"].as_f64().unwrap()).abs()
                < 0.05,
            "got {}",
            f.projected_at_reset
        );
        assert!(f.label.starts_with("Projected"), "got {}", f.label);
    }

    #[test]
    fn quota_suppresses_below_minimum_samples() {
        let q = &vectors()["quota_suppressed_few_samples"];
        let burn: Vec<f64> = q["recent_burn_per_hour"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let f = forecast_quota(
            q["used_percent"].as_f64(),
            Some(q["hours_left"].as_f64().unwrap()),
            &burn,
            q["min_samples"].as_u64().unwrap() as usize,
        );
        assert!(f.suppressed);
    }

    #[test]
    fn spend_forecast_matches_shared_vector() {
        let s = &vectors()["spend"];
        let costs: Vec<f64> = s["daily_costs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();
        let f = forecast_spend(&costs, s["days_in_month"].as_u64().unwrap() as u32);
        assert_eq!(f.suppressed, s["expected_suppressed"].as_bool().unwrap());
        assert!(!f.suppressed);
    }
}
