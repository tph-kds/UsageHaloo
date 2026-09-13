//! Per-connector polling cadence and freshness evaluation.
//!
//! Mirrors `collectors/scheduler.mjs`. Poll cadence belongs to connector
//! metadata, never to one global timer. Event sources (Claude status-line,
//! Codex app-server, Gemini OTLP) are push; poll sources declare a nominal
//! interval plus a maximum healthy age.

use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshMode {
    Event,
    Poll,
    PollMix,
}

#[derive(Debug, Clone, Copy)]
pub struct ConnectorSchedule {
    pub mode: RefreshMode,
    /// Nominal poll interval for poll sources; None for pure event sources.
    pub nominal_seconds: Option<u64>,
    pub max_healthy_age_seconds: u64,
    pub note: &'static str,
}

pub fn schedule(connector_id: &str) -> Option<ConnectorSchedule> {
    let (mode, nominal_seconds, max_healthy_age_seconds, note) = match connector_id {
        "claude-code" => (
            RefreshMode::Event,
            None,
            24 * 3600,
            "status-line events; stale after 24h without a session",
        ),
        "codex" => (
            RefreshMode::Event,
            None,
            3600,
            "app-server notifications plus an initial read",
        ),
        "gemini-cli" => (RefreshMode::Event, None, 3600, "OTLP events"),
        "openai-api" => (
            RefreshMode::Poll,
            Some(3600),
            2 * 3600,
            "org usage is delayed; hourly polling is plenty",
        ),
        "anthropic-api" => (
            RefreshMode::Poll,
            Some(3600),
            2 * 3600,
            "admin/instrumented mix",
        ),
        "openrouter" => (
            RefreshMode::PollMix,
            Some(900),
            1800,
            "credits poll plus live response usage",
        ),
        "cursor" => (
            RefreshMode::Poll,
            Some(3600),
            2 * 3600,
            "respect hourly aggregation guidance",
        ),
        "github-copilot" => (
            RefreshMode::Poll,
            Some(86400),
            2 * 86400,
            "daily/aggregated reports, never live",
        ),
        "mistral" => (
            RefreshMode::Poll,
            Some(3600),
            2 * 3600,
            "admin API for eligible plans",
        ),
        "perplexity" => (
            RefreshMode::Event,
            None,
            86400,
            "instrumented responses only",
        ),
        "ollama" => (RefreshMode::Poll, Some(60), 300, "localhost, cheap"),
        "lm-studio" => (RefreshMode::Poll, Some(60), 300, "localhost, cheap"),
        _ => return None,
    };
    Some(ConnectorSchedule {
        mode,
        nominal_seconds,
        max_healthy_age_seconds,
        note,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreshnessState {
    Live,
    Fresh,
    Stale,
    Unknown,
}

/// Evaluate freshness from the age of the last successful observation.
///
/// Honesty cap (mirrors `collectors/scheduler.mjs`): slow poll sources
/// (nominal interval above five minutes) publish hourly/daily aggregates, so
/// their best state is [`FreshnessState::Fresh`] — never `Live`. Localhost
/// polls and event/poll-mix sources may report `Live`.
pub fn freshness_state(connector_id: &str, age_seconds: Option<u64>) -> FreshnessState {
    let Some(meta) = schedule(connector_id) else {
        return FreshnessState::Unknown;
    };
    let Some(age) = age_seconds else {
        return FreshnessState::Unknown;
    };
    let nominal = meta.nominal_seconds.unwrap_or(300);
    let live_cap = meta.mode == RefreshMode::Poll && nominal > 300;
    if age <= nominal {
        return if live_cap {
            FreshnessState::Fresh
        } else {
            FreshnessState::Live
        };
    }
    if age <= meta.max_healthy_age_seconds {
        return FreshnessState::Fresh;
    }
    FreshnessState::Stale
}

pub fn age_seconds(since: DateTime<Utc>, now: DateTime<Utc>) -> u64 {
    now.signed_duration_since(since).num_seconds().max(0) as u64
}

/// V2 data-class cadence (brief section 7 starting defaults, not provider
/// promises). Quota polling splits by engagement; live classes poll fast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataClass {
    QuotaActive,
    QuotaIdle,
    QuotaBackground,
    Activity,
    Runtime,
    Billing,
}

pub fn data_class_interval_secs(class: DataClass) -> u64 {
    match class {
        DataClass::QuotaActive => 60,
        DataClass::QuotaIdle => 300,
        DataClass::QuotaBackground => 600,
        DataClass::Activity => 2,
        DataClass::Runtime => 5,
        DataClass::Billing => 900,
    }
}

/// Persisted 429 backoff ladder: 30, 60, 120, 300, then 900 capped.
pub fn backoff_ladder_secs(consecutive_failures: u32) -> i64 {
    match consecutive_failures {
        0 => 30,
        1 => 60,
        2 => 120,
        3 => 300,
        _ => 900,
    }
}

/// Deterministic jitter in [base, base + base/4] from a salt via integer
/// hash (no RNG, stable for tests).
pub fn backoff_with_jitter_secs(base_secs: i64, salt: u64) -> i64 {
    if base_secs <= 0 {
        return base_secs;
    }
    let mut h = salt.wrapping_add(0x9e37_79b9_7f4a_7c15);
    h ^= h >> 30;
    h = h.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    h ^= h >> 27;
    h = h.wrapping_mul(0x94d0_49bb_1331_11eb);
    h ^= h >> 31;
    let quarter = base_secs / 4;
    base_secs.saturating_add((h % (quarter as u64 + 1)) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_connectors_have_schedules() {
        for id in ["claude-code", "codex", "openrouter", "github-copilot"] {
            assert!(schedule(id).is_some(), "{id} needs a schedule");
        }
        assert!(schedule("nope").is_none());
    }

    #[test]
    fn copilot_is_never_live_from_a_single_poll() {
        // Daily cadence: a 1-hour-old observation is fresh, not live.
        assert_eq!(
            freshness_state("github-copilot", Some(3600)),
            FreshnessState::Fresh
        );
        assert_eq!(
            freshness_state("github-copilot", Some(3 * 86400)),
            FreshnessState::Stale
        );
    }

    #[test]
    fn localhost_polls_may_report_live() {
        assert_eq!(freshness_state("ollama", Some(60)), FreshnessState::Live);
        assert_eq!(
            freshness_state("openrouter", Some(120)),
            FreshnessState::Live
        );
    }

    #[test]
    fn unknown_age_is_unknown_not_zero() {
        assert_eq!(freshness_state("codex", None), FreshnessState::Unknown);
    }

    #[test]
    fn backoff_ladder_values_and_cap() {
        assert_eq!(backoff_ladder_secs(0), 30);
        assert_eq!(backoff_ladder_secs(1), 60);
        assert_eq!(backoff_ladder_secs(2), 120);
        assert_eq!(backoff_ladder_secs(3), 300);
        assert_eq!(backoff_ladder_secs(4), 900);
        assert_eq!(backoff_ladder_secs(5), 900);
        assert_eq!(backoff_ladder_secs(99), 900);
    }

    #[test]
    fn jitter_within_bounds_and_deterministic() {
        for base in [30i64, 60, 120, 300, 900] {
            let quarter = base / 4;
            for salt in [0u64, 1, 7, 12345, u64::MAX] {
                let j = backoff_with_jitter_secs(base, salt);
                assert!(j >= base && j <= base + quarter, "{base} {salt} -> {j}");
                assert_eq!(j, backoff_with_jitter_secs(base, salt));
            }
        }
    }

    #[test]
    fn quota_cadence_ordering() {
        let active = data_class_interval_secs(DataClass::QuotaActive);
        let idle = data_class_interval_secs(DataClass::QuotaIdle);
        let background = data_class_interval_secs(DataClass::QuotaBackground);
        let activity = data_class_interval_secs(DataClass::Activity);
        let runtime = data_class_interval_secs(DataClass::Runtime);
        let billing = data_class_interval_secs(DataClass::Billing);
        assert_eq!((active, idle, background, activity, runtime, billing), (60, 300, 600, 2, 5, 900));
        assert!(active < idle && idle <= background);
        assert!(activity < active && runtime < active);
        assert!(billing >= background && billing > active);
    }
}
