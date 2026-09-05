//! Canonical time semantics (remediation Phase 3, docs 02-P0-06 / 05).
//!
//! Three concepts, never mixed:
//! - **instant**: a UTC timestamp, the only thing ever persisted;
//! - **calendar period**: "today"/"this month" in the user's IANA timezone;
//! - **provider window**: rolling/quota/billing windows defined by the source.
//!
//! Rules enforced here:
//! - `observed_at` is always UTC; local-day grouping converts explicit
//!   timezone-aware midnight boundaries back to UTC instants for queries;
//! - `timestamp.toISOString().slice(0, 10)` (UTC slicing) is never a valid
//!   local-day grouping — use [`day_bounds_utc`] / [`local_date`];
//! - unknown/invalid timezones are an error, never a silent UTC fallback.

use chrono::{DateTime, Datelike, TimeZone, Utc};
use chrono_tz::Tz;

/// Resolve an IANA timezone name. `UTC` is always accepted.
pub fn parse_timezone(name: &str) -> Result<Tz, String> {
    if name.eq_ignore_ascii_case("utc") {
        return Ok(Tz::UTC);
    }
    name.parse::<Tz>()
        .map_err(|_| format!("unknown IANA timezone: {name}"))
}

/// UTC instants `[start, end)` of the local calendar day containing `now`
/// in `timezone`. DST-safe: boundaries are computed in local wall time and
/// converted back to UTC, so 23/25-hour days behave correctly.
pub fn day_bounds_utc(
    timezone: &str,
    now: DateTime<Utc>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    let tz = parse_timezone(timezone)?;
    let today = now.with_timezone(&tz).date_naive();
    let start = midnight_utc(&tz, today, timezone)?;
    // End = next local midnight, robust across DST transitions.
    let tomorrow = today.succ_opt().ok_or("date overflow")?;
    let end = midnight_utc(&tz, tomorrow, timezone)?;
    Ok((start, end))
}

fn midnight_utc(tz: &Tz, day: chrono::NaiveDate, timezone: &str) -> Result<DateTime<Utc>, String> {
    let naive = day.and_hms_opt(0, 0, 0).ok_or("date overflow")?;
    tz.from_local_datetime(&naive)
        .single()
        .ok_or_else(|| format!("local midnight is ambiguous for {timezone}"))
        .map(|d| d.with_timezone(&Utc))
}

/// UTC instants `[start, end)` of the local calendar month containing `now`
/// in `timezone`.
pub fn month_bounds_utc(
    timezone: &str,
    now: DateTime<Utc>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
    let tz = parse_timezone(timezone)?;
    let local = now.with_timezone(&tz);
    let first = tz
        .from_local_datetime(
            &local
                .date_naive()
                .with_day(1)
                .ok_or("date overflow")?
                .and_hms_opt(0, 0, 0)
                .ok_or("date overflow")?,
        )
        .single()
        .ok_or_else(|| format!("local month start is ambiguous for {timezone}"))?;
    let next_month = if local.date_naive().month() == 12 {
        chrono::NaiveDate::from_ymd_opt(local.date_naive().year() + 1, 1, 1)
            .ok_or("date overflow")?
    } else {
        chrono::NaiveDate::from_ymd_opt(
            local.date_naive().year(),
            local.date_naive().month() + 1,
            1,
        )
        .ok_or("date overflow")?
    };
    let end = midnight_utc(&tz, next_month, timezone)?;
    Ok((first.with_timezone(&Utc), end))
}

/// Local calendar date (`YYYY-MM-DD`) of an instant in `timezone`.
pub fn local_date(timezone: &str, instant: DateTime<Utc>) -> Result<String, String> {
    let tz = parse_timezone(timezone)?;
    Ok(instant.with_timezone(&tz).format("%Y-%m-%d").to_string())
}

/// True when `instant` falls inside today's local-day bounds.
pub fn is_today(
    timezone: &str,
    instant: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<bool, String> {
    let (start, end) = day_bounds_utc(timezone, now)?;
    Ok(instant >= start && instant < end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    #[test]
    fn hcmc_day_bounds_are_utc_plus_7() {
        // 2026-09-05 12:00 UTC == 19:00 in Ho Chi Minh City.
        let (s, e) = day_bounds_utc("Asia/Ho_Chi_Minh", utc(2026, 9, 5, 12, 0)).unwrap();
        assert_eq!(s, utc(2026, 9, 4, 17, 0));
        assert_eq!(e, utc(2026, 9, 5, 17, 0));
    }

    #[test]
    fn utc_slicing_would_misattribute_hcmc_evening() {
        // 2026-09-05 18:30 UTC slices as "09-05" in UTC but is 09-06 01:30 local.
        let instant = utc(2026, 9, 5, 18, 30);
        assert_eq!(
            local_date("Asia/Ho_Chi_Minh", instant).unwrap(),
            "2026-09-06"
        );
        // A "today" query at 12:00 UTC must exclude it.
        assert!(!is_today("Asia/Ho_Chi_Minh", instant, utc(2026, 9, 5, 12, 0)).unwrap());
        // …while a same-local-day morning event is included.
        assert!(is_today(
            "Asia/Ho_Chi_Minh",
            utc(2026, 9, 4, 18, 0),
            utc(2026, 9, 5, 12, 0)
        )
        .unwrap());
    }

    #[test]
    fn exact_midnight_boundary_belongs_to_the_new_day() {
        let (s, _) = day_bounds_utc("Asia/Ho_Chi_Minh", utc(2026, 9, 5, 12, 0)).unwrap();
        assert!(is_today("Asia/Ho_Chi_Minh", s, utc(2026, 9, 5, 12, 0)).unwrap());
        assert!(!is_today(
            "Asia/Ho_Chi_Minh",
            s - chrono::Duration::seconds(1),
            utc(2026, 9, 5, 12, 0)
        )
        .unwrap());
    }

    #[test]
    fn new_york_spring_forward_day_is_23_hours() {
        // DST starts 2026-03-08 02:00 -> 03:00 local.
        let (s, e) = day_bounds_utc("America/New_York", utc(2026, 3, 8, 12, 0)).unwrap();
        assert_eq!((e - s).num_hours(), 23);
        assert_eq!(
            local_date("America/New_York", utc(2026, 3, 8, 6, 30)).unwrap(),
            "2026-03-08"
        );
    }

    #[test]
    fn new_york_fall_back_day_is_25_hours() {
        // DST ends 2026-11-01 02:00 -> 01:00 local.
        let (s, e) = day_bounds_utc("America/New_York", utc(2026, 11, 1, 12, 0)).unwrap();
        assert_eq!((e - s).num_hours(), 25);
    }

    #[test]
    fn unknown_timezone_is_an_error_not_silent_utc() {
        assert!(day_bounds_utc("Mars/Olympus", utc(2026, 9, 5, 12, 0)).is_err());
    }

    #[test]
    fn month_bounds_cover_december_to_january() {
        let (s, e) = month_bounds_utc("Asia/Ho_Chi_Minh", utc(2026, 12, 15, 12, 0)).unwrap();
        assert_eq!(s, utc(2026, 11, 30, 17, 0));
        assert_eq!(e, utc(2026, 12, 31, 17, 0));
    }
}
