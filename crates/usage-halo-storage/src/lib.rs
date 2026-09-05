use anyhow::Context;
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;
use usage_halo_core::UsageEvent;

pub struct Storage {
    pool: SqlitePool,
}

impl Clone for Storage {
    fn clone(&self) -> Self {
        Self {
            pool: self.pool.clone(),
        }
    }
}

/// Database location: `~/.usagehalo/usagehalo.db` on every platform
/// (USERPROFILE on Windows, HOME elsewhere). Single file, single authority.
pub fn db_path() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
    #[cfg(not(windows))]
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    home.map(|h| h.join(".usagehalo").join("usagehalo.db"))
}

pub fn db_url() -> Option<String> {
    db_path().map(|p| format!("sqlite:{}?mode=rwc", p.to_string_lossy()))
}

/// Stable source fingerprint over identity + measurement fields only.
/// Ingest/read time is deliberately excluded so re-reads deduplicate.
pub fn stable_fingerprint(event: &UsageEvent) -> String {
    let p = &event.provenance;
    let mut h = Sha256::new();
    h.update(
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
            event.provider,
            event.surface,
            event.billing_owner,
            event.model_provider.as_deref().unwrap_or(""),
            event.model.as_deref().unwrap_or(""),
            event.account_id.as_deref().unwrap_or(""),
            event.workspace_id.as_deref().unwrap_or(""),
            event.session_id.as_deref().unwrap_or(""),
            event.request_id.as_deref().unwrap_or(""),
            event.reconciliation_key.as_deref().unwrap_or(""),
            p.observed_at.to_rfc3339(),
            event.tokens.input,
            event.tokens.output,
            event.tokens.reasoning,
            event.tokens.cache_read,
            event.tokens.cache_write,
            event.requests,
            event.provider_cost,
            event.estimated_cost,
            event.currency.as_deref().unwrap_or(""),
        )
        .as_bytes(),
    );
    format!("{:x}", h.finalize())[..16].to_string()
}

pub struct InsertOutcome {
    pub inserted: bool,
}

pub struct RetentionReport {
    pub events: u64,
    pub quotas: u64,
    pub alert_events: u64,
    pub hourly_rollups: u64,
}

pub struct HealthAttempt<'a> {
    pub connector_id: &'a str,
    pub success: bool,
    pub expected_refresh_seconds: Option<i64>,
    pub error_class: Option<&'a str>,
    pub error_message: Option<&'a str>,
    pub http_status: Option<i64>,
    pub retry_after_secs: Option<i64>,
}

pub struct AlertRuleInput<'a> {
    pub id: &'a str,
    pub label: Option<&'a str>,
    pub provider: Option<&'a str>,
    pub billing_owner: Option<&'a str>,
    pub account_id: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    pub window_id: Option<&'a str>,
    pub metric_key: &'a str,
    pub operator: &'a str,
    pub threshold: f64,
    pub cooldown_seconds: i64,
}

pub struct BudgetInput<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub billing_owner: Option<&'a str>,
    pub provider_id: Option<&'a str>,
    pub account_id: Option<&'a str>,
    pub metric_key: &'a str,
    pub unit: &'a str,
    pub limit_value: &'a str,
    pub period_kind: &'a str,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct QuotaRow {
    pub provider: String,
    pub account_id: Option<String>,
    pub limit_id: String,
    pub label: String,
    pub used_value: Option<f64>,
    pub limit_value: Option<f64>,
    pub used_percent: Option<f64>,
    pub resets_at: Option<String>,
    pub source_authority: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct WindowSumRow {
    input_tokens: i64,
    output_tokens: i64,
    observations: i64,
    token_present: i64,
    requests: i64,
}

#[derive(Debug, Clone, Default)]
pub struct WindowSums {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub observation_count: i64,
    pub token_present_count: i64,
    pub requests: i64,
    pub costs: Vec<(String, f64)>,
    pub cost_present_count: i64,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EventRow {
    pub provider: String,
    pub billing_owner: String,
    pub model_provider: Option<String>,
    pub model: Option<String>,
    pub account_id: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub requests: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub cache_write_tokens: Option<i64>,
    pub provider_cost: Option<f64>,
    pub currency: Option<String>,
    pub source_kind: Option<String>,
    pub source_authority: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct HealthRow {
    pub connector_id: String,
    pub state: String,
    pub last_success: Option<String>,
    pub last_attempt: Option<String>,
    pub last_failure_at: Option<String>,
    pub consecutive_failures: i64,
    pub retry_after_at: Option<String>,
    pub error_class: Option<String>,
    pub error_message: Option<String>,
    pub http_status: Option<i64>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BudgetRow {
    pub id: String,
    pub enabled: i64,
    pub label: String,
    pub billing_owner: Option<String>,
    pub provider_id: Option<String>,
    pub account_id: Option<String>,
    pub metric_key: String,
    pub unit: String,
    pub money_currency: Option<String>,
    pub limit_value: String,
    pub period_kind: String,
    pub period_timezone: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AlertRuleRow {
    pub id: String,
    pub enabled: i64,
    pub label: Option<String>,
    pub provider: Option<String>,
    pub billing_owner: Option<String>,
    pub account_id: Option<String>,
    pub workspace_id: Option<String>,
    pub window_id: Option<String>,
    pub metric_key: String,
    pub operator: String,
    pub threshold: f64,
    pub cooldown_seconds: i64,
}

impl Storage {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        // WAL + foreign keys are connection properties, not migration steps:
        // PRAGMAs cannot run inside sqlx's migration transaction, so a WAL
        // pragma inside 0001 broke every file-backed migrate (in-memory test
        // DBs masked it). 0001 was edited before any file DB could apply it
        // successfully — pre-release alpha, no deployed ledger to conflict.
        let options = SqliteConnectOptions::from_str(url)
            .context("parse SQLite url")?
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .context("connect SQLite")?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .context("run SQLite migrations")?;
        Ok(())
    }

    pub async fn insert_usage_event(&self, event: &UsageEvent) -> anyhow::Result<InsertOutcome> {
        let p = &event.provenance;
        // Atomic dedup: UNIQUE(reconciliation_key) + UNIQUE(raw_fingerprint).
        // OR IGNORE makes concurrent identical inserts collapse to one row.
        let fingerprint = stable_fingerprint(event);
        let rows = sqlx::query(
            r#"INSERT OR IGNORE INTO usage_events (
                id, provider, surface, billing_owner, model_provider, model,
                account_id, workspace_id, device_id, session_id, request_id,
                input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
                cache_write_tokens, tool_tokens, requests, tool_calls, active_ms,
                lines_added, lines_removed, provider_cost, estimated_cost, currency,
                reconciliation_key, raw_fingerprint, source_kind, source_scope, source_authority,
                freshness_class, confidence, observed_at, provider_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(event.id.to_string())
        .bind(&event.provider)
        .bind(&event.surface)
        .bind(&event.billing_owner)
        .bind(&event.model_provider)
        .bind(&event.model)
        .bind(&event.account_id)
        .bind(&event.workspace_id)
        .bind(&event.device_id)
        .bind(&event.session_id)
        .bind(&event.request_id)
        .bind(event.tokens.input.map(|v| v as i64))
        .bind(event.tokens.output.map(|v| v as i64))
        .bind(event.tokens.reasoning.map(|v| v as i64))
        .bind(event.tokens.cache_read.map(|v| v as i64))
        .bind(event.tokens.cache_write.map(|v| v as i64))
        .bind(event.tokens.tool.map(|v| v as i64))
        .bind(event.requests.map(|v| v as i64))
        .bind(event.tool_calls.map(|v| v as i64))
        .bind(event.active_ms.map(|v| v as i64))
        .bind(event.lines_added.map(|v| v as i64))
        .bind(event.lines_removed.map(|v| v as i64))
        .bind(event.provider_cost)
        .bind(event.estimated_cost)
        .bind(&event.currency)
        .bind(&event.reconciliation_key)
        .bind(&fingerprint)
        .bind(&p.source_kind)
        .bind(format!("{:?}", p.scope).to_lowercase())
        .bind(format!("{:?}", p.authority).to_lowercase())
        .bind(format!("{:?}", p.freshness).to_lowercase())
        .bind(p.confidence as f64)
        .bind(p.observed_at.to_rfc3339())
        .bind(p.provider_timestamp.map(|t| t.to_rfc3339()))
        .execute(&self.pool)
        .await
        .context("insert usage event")?;
        Ok(InsertOutcome {
            inserted: rows.rows_affected() == 1,
        })
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Delete raw events older than `retention_days` (rollups are separate,
    /// longer-lived aggregates). Returns the number of rows removed.
    pub async fn prune_events_older_than(&self, retention_days: i64) -> anyhow::Result<u64> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
        let n = sqlx::query("DELETE FROM usage_events WHERE observed_at < ?")
            .bind(cutoff.to_rfc3339())
            .execute(&self.pool)
            .await
            .context("prune old usage events")?
            .rows_affected();
        Ok(n)
    }

    pub async fn count_usage_events(&self) -> anyhow::Result<i64> {
        sqlx::query_scalar("SELECT COUNT(*) FROM usage_events")
            .fetch_one(&self.pool)
            .await
            .context("count usage events")
    }

    /// Highest applied migration version (`_sqlx_migrations` ledger).
    pub async fn schema_version(&self) -> anyhow::Result<i64> {
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&self.pool)
            .await
            .context("read schema version")
    }

    /// Crash-safe backup before migrations: `VACUUM INTO <path>`.
    pub async fn backup_into(&self, dest: &std::path::Path) -> anyhow::Result<()> {
        let sql = format!(
            "VACUUM INTO '{}'",
            dest.to_string_lossy().replace('\'', "''")
        );
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .context("backup database")?;
        Ok(())
    }

    /// Record a connector attempt. Success clears failure state; failure
    /// updates failure fields while preserving `last_success` (P0-13).
    pub async fn record_health_attempt(&self, attempt: HealthAttempt<'_>) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let retry_after = attempt
            .retry_after_secs
            .map(|s| (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339());
        let state = if attempt.success {
            "healthy"
        } else if attempt.error_class == Some("auth") {
            "auth_error"
        } else if attempt.error_class == Some("rate_limit") {
            "rate_limited"
        } else {
            "degraded"
        };
        sqlx::query(
            r#"INSERT INTO connector_health (
                connector_id, state, last_success, last_attempt, first_seen_at,
                last_failure_at, consecutive_failures, retry_after_at,
                expected_refresh_seconds, error_class, error_message, http_status, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(connector_id) DO UPDATE SET
                state = excluded.state,
                last_attempt = excluded.last_attempt,
                last_success = COALESCE(excluded.last_success, connector_health.last_success),
                first_seen_at = COALESCE(connector_health.first_seen_at, excluded.first_seen_at),
                last_failure_at = COALESCE(excluded.last_failure_at, connector_health.last_failure_at),
                consecutive_failures = CASE WHEN excluded.last_success IS NOT NULL THEN 0
                    ELSE connector_health.consecutive_failures + 1 END,
                retry_after_at = excluded.retry_after_at,
                expected_refresh_seconds = excluded.expected_refresh_seconds,
                error_class = excluded.error_class,
                error_message = excluded.error_message,
                http_status = excluded.http_status,
                message = excluded.message"#,
        )
        .bind(attempt.connector_id)
        .bind(state)
        .bind(if attempt.success { Some(now.clone()) } else { None })
        .bind(&now)
        .bind(&now)
        .bind(if attempt.success { None } else { Some(now.clone()) })
        .bind(if attempt.success { 0 } else { 1 })
        .bind(&retry_after)
        .bind(attempt.expected_refresh_seconds)
        .bind(attempt.error_class)
        .bind(attempt.error_message)
        .bind(attempt.http_status)
        .bind(attempt.error_message)
        .execute(&self.pool)
        .await
        .context("record connector health")?;
        Ok(())
    }

    pub async fn connector_last_success(
        &self,
        connector_id: &str,
    ) -> anyhow::Result<Option<String>> {
        sqlx::query_scalar("SELECT last_success FROM connector_health WHERE connector_id = ?")
            .bind(connector_id)
            .fetch_optional(&self.pool)
            .await
            .context("read connector last_success")
    }

    /// Persist a quota snapshot idempotently. Returns the stable row id
    /// `provider:limit_id:observed_at` plus whether it was newly inserted
    /// (replays report `false`, never duplicate).
    pub async fn insert_quota_snapshot(
        &self,
        q: &usage_halo_core::QuotaWindow,
    ) -> anyhow::Result<(String, bool)> {
        let id = format!(
            "{}:{}:{}",
            q.provider,
            q.limit_id,
            q.provenance.observed_at.to_rfc3339()
        );
        let p = &q.provenance;
        let rows = sqlx::query(
            r#"INSERT OR IGNORE INTO quota_snapshots (
                id, provider, account_id, limit_id, label, metric_kind,
                used_value, limit_value, used_percent, remaining_value,
                window_duration_seconds, resets_at,
                source_kind, source_scope, source_authority, freshness_class,
                confidence, observed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&id)
        .bind(&q.provider)
        .bind(&q.account_id)
        .bind(&q.limit_id)
        .bind(&q.label)
        .bind(format!("{:?}", q.metric_kind).to_lowercase())
        .bind(q.used_value)
        .bind(q.limit_value)
        .bind(q.used_percent)
        .bind(q.remaining_value)
        .bind(q.window_duration_seconds.map(|v| v as i64))
        .bind(q.resets_at.map(|t| t.to_rfc3339()))
        .bind(&p.source_kind)
        .bind(format!("{:?}", p.scope).to_lowercase())
        .bind(format!("{:?}", p.authority).to_lowercase())
        .bind(format!("{:?}", p.freshness).to_lowercase())
        .bind(p.confidence as f64)
        .bind(p.observed_at.to_rfc3339())
        .execute(&self.pool)
        .await
        .context("insert quota snapshot")?
        .rows_affected();
        Ok((id, rows == 1))
    }

    /// Latest quota row for a provider+window (account-aware when given).
    /// Returns `(used_percent, observed_at)` — None when never observed.
    pub async fn latest_quota_percent(
        &self,
        provider: &str,
        limit_id: &str,
        account_id: Option<&str>,
    ) -> anyhow::Result<Option<(Option<f64>, String)>> {
        let row: Option<(Option<f64>, String)> = sqlx::query_as(
            "SELECT used_percent, observed_at FROM quota_snapshots
             WHERE provider = ? AND limit_id = ?
               AND (account_id = ? OR (? IS NULL AND account_id IS NULL))
             ORDER BY observed_at DESC LIMIT 1",
        )
        .bind(provider)
        .bind(limit_id)
        .bind(account_id)
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .context("read latest quota")?;
        Ok(row)
    }

    // -- projection reads -------------------------------------------------------
    //
    // The Phase 4 projection service consumes ONLY these typed reads — never
    // raw table scans from command handlers. All window parameters are UTC
    // instant bounds computed by `usage_halo_core::time`.

    /// Full latest quota row for a provider+window, for projection mapping.
    pub async fn latest_quota(
        &self,
        provider: &str,
        limit_id: &str,
        account_id: Option<&str>,
    ) -> anyhow::Result<Option<QuotaRow>> {
        let row: Option<QuotaRow> = sqlx::query_as(
            r#"SELECT provider, account_id, limit_id, label,
                used_value, limit_value, used_percent,
                resets_at, source_authority, observed_at
             FROM quota_snapshots
             WHERE provider = ? AND limit_id = ?
               AND (account_id = ? OR (? IS NULL AND account_id IS NULL))
             ORDER BY observed_at DESC LIMIT 1"#,
        )
        .bind(provider)
        .bind(limit_id)
        .bind(account_id)
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await
        .context("read latest quota row")?;
        Ok(row)
    }

    /// Distinct limit ids ever observed for a provider (window discovery).
    pub async fn quota_limits_for(&self, provider: &str) -> anyhow::Result<Vec<String>> {
        sqlx::query_scalar("SELECT DISTINCT limit_id FROM quota_snapshots WHERE provider = ?")
            .bind(provider)
            .fetch_all(&self.pool)
            .await
            .context("list quota limits")
    }

    /// Token/request/cost sums over a UTC window, optionally scoped to one
    /// provider. Missing dimensions never contribute; counts expose coverage.
    pub async fn sum_window(
        &self,
        provider: Option<&str>,
        start_utc: &str,
        end_utc: &str,
    ) -> anyhow::Result<WindowSums> {
        let row: WindowSumRow = sqlx::query_as(
            r#"SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COUNT(*) AS observations,
                SUM(input_tokens IS NOT NULL OR output_tokens IS NOT NULL) AS token_present,
                COALESCE(SUM(requests), 0) AS requests
             FROM usage_events
             WHERE observed_at >= ? AND observed_at < ?
               AND (? IS NULL OR provider = ?)"#,
        )
        .bind(start_utc)
        .bind(end_utc)
        .bind(provider)
        .bind(provider)
        .fetch_one(&self.pool)
        .await
        .context("sum window")?;
        let costs: Vec<(Option<String>, Option<f64>)> = sqlx::query_as(
            r#"SELECT currency, SUM(provider_cost) FROM usage_events
             WHERE observed_at >= ? AND observed_at < ?
               AND (? IS NULL OR provider = ?)
               AND provider_cost IS NOT NULL
             GROUP BY currency"#,
        )
        .bind(start_utc)
        .bind(end_utc)
        .bind(provider)
        .bind(provider)
        .fetch_all(&self.pool)
        .await
        .context("sum window costs")?;
        let cost_present: Option<i64> = sqlx::query_scalar(
            r#"SELECT COUNT(*) FROM usage_events
             WHERE observed_at >= ? AND observed_at < ?
               AND (? IS NULL OR provider = ?)
               AND provider_cost IS NOT NULL"#,
        )
        .bind(start_utc)
        .bind(end_utc)
        .bind(provider)
        .bind(provider)
        .fetch_one(&self.pool)
        .await
        .context("count window costs")?;
        Ok(WindowSums {
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            observation_count: row.observations,
            token_present_count: row.token_present,
            requests: row.requests,
            costs: costs
                .into_iter()
                .map(|(c, v)| (c.unwrap_or_else(|| "USD".into()), v.unwrap_or(0.0)))
                .collect(),
            cost_present_count: cost_present.unwrap_or(0),
        })
    }

    /// Billed-cost sums per billing owner over a UTC window (P0-08).
    pub async fn cost_by_billing_owner(
        &self,
        start_utc: &str,
        end_utc: &str,
    ) -> anyhow::Result<Vec<(String, String, f64)>> {
        sqlx::query_as(
            r#"SELECT billing_owner, COALESCE(currency, 'USD'), SUM(provider_cost)
             FROM usage_events
             WHERE observed_at >= ? AND observed_at < ? AND provider_cost IS NOT NULL
             GROUP BY billing_owner, COALESCE(currency, 'USD')"#,
        )
        .bind(start_utc)
        .bind(end_utc)
        .fetch_all(&self.pool)
        .await
        .context("cost by billing owner")
    }

    /// Event rows in a UTC window for activity views (newest first, bounded).
    pub async fn query_events(
        &self,
        start_utc: &str,
        end_utc: &str,
        providers: &[String],
        limit: i64,
    ) -> anyhow::Result<Vec<EventRow>> {
        let list = if providers.is_empty() {
            None
        } else {
            Some(providers.join(","))
        };
        sqlx::query_as(
            r#"SELECT provider, billing_owner, model_provider, model, account_id,
                input_tokens, output_tokens, requests, cache_read_tokens, cache_write_tokens,
                provider_cost, currency,
                source_kind, source_authority, observed_at
             FROM usage_events
             WHERE observed_at >= ? AND observed_at < ?
               AND (? IS NULL OR instr(',' || ? || ',', ',' || provider || ',') > 0)
             ORDER BY observed_at DESC LIMIT ?"#,
        )
        .bind(start_utc)
        .bind(end_utc)
        .bind(list.clone())
        .bind(list)
        .bind(limit.max(0))
        .fetch_all(&self.pool)
        .await
        .context("query events")
    }

    pub async fn health_all(&self) -> anyhow::Result<Vec<HealthRow>> {
        sqlx::query_as(
            r#"SELECT connector_id, state, last_success, last_attempt,
                last_failure_at, consecutive_failures, retry_after_at,
                error_class, error_message, http_status
             FROM connector_health"#,
        )
        .fetch_all(&self.pool)
        .await
        .context("read all connector health")
    }

    pub async fn budgets_all(&self) -> anyhow::Result<Vec<BudgetRow>> {
        sqlx::query_as(
            r#"SELECT id, enabled, label, billing_owner, provider_id, account_id,
                metric_key, unit, money_currency, limit_value, period_kind, period_timezone
             FROM budgets WHERE enabled = 1"#,
        )
        .fetch_all(&self.pool)
        .await
        .context("read budgets")
    }

    pub async fn alert_rules_all(&self) -> anyhow::Result<Vec<AlertRuleRow>> {
        sqlx::query_as(
            r#"SELECT id, enabled, label, provider, billing_owner, account_id,
                workspace_id, window_id, metric_key, operator, threshold, cooldown_seconds
             FROM alert_rules WHERE enabled = 1"#,
        )
        .fetch_all(&self.pool)
        .await
        .context("read alert rules")
    }

    pub async fn latest_alert_event(
        &self,
        rule_id: &str,
    ) -> anyhow::Result<Option<(String, bool, String)>> {
        let row: Option<(String, i64, String)> = sqlx::query_as(
            "SELECT evaluated_at, fired, reason FROM alert_events
             WHERE rule_id = ? ORDER BY evaluated_at DESC LIMIT 1",
        )
        .bind(rule_id)
        .fetch_optional(&self.pool)
        .await
        .context("read latest alert event")?;
        Ok(row.map(|(at, fired, reason)| (at, fired != 0, reason)))
    }

    /// Newest observation instant overall or for one provider — drives
    /// freshness and data-health without scanning event bodies.
    pub async fn latest_observed_at(
        &self,
        provider: Option<&str>,
    ) -> anyhow::Result<Option<String>> {
        let row: Option<(String,)> = sqlx::query_as(
            r#"SELECT observed_at FROM (
                 SELECT observed_at FROM usage_events
                 WHERE (? IS NULL OR provider = ?)
                 UNION ALL
                 SELECT observed_at FROM quota_snapshots
                 WHERE (? IS NULL OR provider = ?)
               ) ORDER BY observed_at DESC LIMIT 1"#,
        )
        .bind(provider)
        .bind(provider)
        .bind(provider)
        .bind(provider)
        .fetch_optional(&self.pool)
        .await
        .context("read latest observation")?;
        Ok(row.map(|r| r.0))
    }

    // -- alert rules / events -------------------------------------------------

    pub async fn save_alert_rule(&self, rule: AlertRuleInput<'_>) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO alert_rules (
                id, enabled, label, provider, billing_owner, account_id,
                workspace_id, window_id, metric_key, operator, threshold,
                cooldown_seconds, created_at, updated_at
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label, provider = excluded.provider,
                billing_owner = excluded.billing_owner, account_id = excluded.account_id,
                workspace_id = excluded.workspace_id, window_id = excluded.window_id,
                metric_key = excluded.metric_key, operator = excluded.operator,
                threshold = excluded.threshold, cooldown_seconds = excluded.cooldown_seconds,
                updated_at = excluded.updated_at"#,
        )
        .bind(rule.id)
        .bind(rule.label)
        .bind(rule.provider)
        .bind(rule.billing_owner)
        .bind(rule.account_id)
        .bind(rule.workspace_id)
        .bind(rule.window_id)
        .bind(rule.metric_key)
        .bind(rule.operator)
        .bind(rule.threshold)
        .bind(rule.cooldown_seconds)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .context("save alert rule")?;
        Ok(())
    }

    /// Immutable evaluation record: explains fires AND suppressions.
    pub async fn record_alert_event(
        &self,
        rule_id: &str,
        fired: bool,
        metric_value: Option<f64>,
        reason: &str,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO alert_events (id, rule_id, evaluated_at, fired, metric_value, reason)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(rule_id)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(if fired { 1 } else { 0 })
        .bind(metric_value)
        .bind(reason)
        .execute(&self.pool)
        .await
        .context("record alert event")?;
        Ok(())
    }

    pub async fn count_alert_events(&self, rule_id: &str) -> anyhow::Result<i64> {
        sqlx::query_scalar("SELECT COUNT(*) FROM alert_events WHERE rule_id = ?")
            .bind(rule_id)
            .fetch_one(&self.pool)
            .await
            .context("count alert events")
    }

    // -- budgets / settings ---------------------------------------------------

    pub async fn save_budget(&self, budget: BudgetInput<'_>) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO budgets (
                id, enabled, label, billing_owner, provider_id, account_id,
                metric_key, unit, limit_value, period_kind, created_at, updated_at
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label = excluded.label, limit_value = excluded.limit_value,
                updated_at = excluded.updated_at"#,
        )
        .bind(budget.id)
        .bind(budget.label)
        .bind(budget.billing_owner)
        .bind(budget.provider_id)
        .bind(budget.account_id)
        .bind(budget.metric_key)
        .bind(budget.unit)
        .bind(budget.limit_value)
        .bind(budget.period_kind)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .context("save budget")?;
        Ok(())
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await
        .context("set setting")?;
        Ok(())
    }

    pub async fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .context("get setting")
    }

    // -- rollups ----------------------------------------------------------------
    //
    // Idempotent rebuilds: DELETE the bucket scope, re-aggregate from
    // usage_events. Never blind-increment on a scheduler tick. Timezone-aware
    // calendar buckets land in Phase 3; buckets below are UTC hours/days with
    // the requested timezone recorded on each row.

    pub async fn rebuild_hourly_rollups(&self, timezone: &str) -> anyhow::Result<u64> {
        let mut tx = self.pool.begin().await.context("begin rollup tx")?;
        sqlx::query("DELETE FROM hourly_rollups WHERE timezone = ?")
            .bind(timezone)
            .execute(&mut *tx)
            .await
            .context("clear hourly rollups")?;
        let n = sqlx::query(
            r#"INSERT INTO hourly_rollups (
                bucket_start_utc, timezone, provider, surface, billing_owner, model,
                input_tokens, output_tokens, requests,
                provider_cost, estimated_cost, observation_count
            )
            SELECT
                strftime('%Y-%m-%dT%H:00:00Z', observed_at), ?, provider, surface,
                billing_owner, COALESCE(model, ''),
                COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(requests), 0),
                COALESCE(SUM(provider_cost), 0), COALESCE(SUM(estimated_cost), 0),
                COUNT(*)
            FROM usage_events
            GROUP BY 1, provider, surface, billing_owner, COALESCE(model, '')"#,
        )
        .bind(timezone)
        .execute(&mut *tx)
        .await
        .context("rebuild hourly rollups")?
        .rows_affected();
        tx.commit().await.context("commit rollup tx")?;
        Ok(n)
    }

    pub async fn count_hourly_rollups(&self) -> anyhow::Result<i64> {
        sqlx::query_scalar("SELECT COUNT(*) FROM hourly_rollups")
            .fetch_one(&self.pool)
            .await
            .context("count hourly rollups")
    }

    // -- JSONL import / replay ----------------------------------------------------
    //
    // Legacy spool format (`~/.usagehalo/store/usage_events.jsonl`) becomes an
    // import boundary: rows flow through the same INSERT OR IGNORE path, so a
    // crash replay or double import can never duplicate canonical rows.

    pub async fn import_jsonl_events(&self, path: &std::path::Path) -> anyhow::Result<(u64, u64)> {
        let content = std::fs::read_to_string(path).context("read jsonl spool")?;
        let mut inserted = 0u64;
        let mut skipped = 0u64;
        for line in content.lines().filter(|l| !l.trim().is_empty()) {
            let v: serde_json::Value = serde_json::from_str(line).context("parse spool line")?;
            let event = jsonl_row_to_event(&v)?;
            if self.insert_usage_event(&event).await?.inserted {
                inserted += 1;
            } else {
                skipped += 1;
            }
        }
        Ok((inserted, skipped))
    }

    /// Import quota-snapshot JSONL rows (daemon/file pollers) idempotently.
    /// Same stable-id semantics as events: replays never duplicate.
    pub async fn import_jsonl_quotas(&self, path: &std::path::Path) -> anyhow::Result<(u64, u64)> {
        let content = std::fs::read_to_string(path).context("read quota spool")?;
        let mut inserted = 0u64;
        let mut skipped = 0u64;
        for line in content.lines().filter(|l| !l.trim().is_empty()) {
            let v: serde_json::Value = serde_json::from_str(line).context("parse quota line")?;
            let (q, cost_event) = jsonl_row_to_quota(&v)?;
            if self.insert_quota_snapshot(&q).await?.1 {
                inserted += 1;
            } else {
                skipped += 1;
            }
            if let Some(e) = cost_event {
                self.insert_usage_event(&e).await?;
            }
        }
        Ok((inserted, skipped))
    }

    // -- retention ------------------------------------------------------------------
    //
    // One policy across every persisted dataset: raw events, quota snapshots,
    // alert history keep `retention_days`; hourly rollups keep a year.

    pub async fn prune_all(&self, retention_days: i64) -> anyhow::Result<RetentionReport> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(retention_days)).to_rfc3339();
        let events = self.prune_events_older_than(retention_days).await?;
        let quotas: u64 = sqlx::query("DELETE FROM quota_snapshots WHERE observed_at < ?")
            .bind(&cutoff)
            .execute(&self.pool)
            .await
            .context("prune quotas")?
            .rows_affected();
        let alert_events: u64 = sqlx::query("DELETE FROM alert_events WHERE evaluated_at < ?")
            .bind(&cutoff)
            .execute(&self.pool)
            .await
            .context("prune alert events")?
            .rows_affected();
        let rollup_cutoff = (chrono::Utc::now() - chrono::Duration::days(365)).to_rfc3339();
        let hourly_rollups: u64 =
            sqlx::query("DELETE FROM hourly_rollups WHERE bucket_start_utc < ?")
                .bind(&rollup_cutoff)
                .execute(&self.pool)
                .await
                .context("prune hourly rollups")?
                .rows_affected();
        Ok(RetentionReport {
            events,
            quotas,
            alert_events,
            hourly_rollups,
        })
    }
}

/// Map one legacy JSONL spool row onto the canonical event. Missing numeric
/// dimensions stay None (P0-11); the row is never coerced to zero.
fn jsonl_row_to_event(v: &serde_json::Value) -> anyhow::Result<UsageEvent> {
    use usage_halo_core::*;
    let opt_u64 = |key: &str| v.get(key).and_then(|x| x.as_u64());
    let opt_f64 = |key: &str| v.get(key).and_then(|x| x.as_f64());
    let opt_str = |key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    let observed_at = opt_str("observed_at")
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);
    Ok(UsageEvent {
        id: uuid::Uuid::new_v4(),
        provider: opt_str("provider").unwrap_or_else(|| "unknown".into()),
        surface: opt_str("provider").unwrap_or_else(|| "unknown".into()),
        billing_owner: opt_str("billing_owner")
            .or_else(|| opt_str("provider"))
            .unwrap_or_else(|| "unknown".into()),
        model_provider: opt_str("model_provider"),
        model: opt_str("model"),
        account_id: opt_str("account_id"),
        workspace_id: None,
        device_id: None,
        session_id: None,
        request_id: opt_str("request_id"),
        tokens: TokenUsage {
            input: opt_u64("input_tokens"),
            output: opt_u64("output_tokens"),
            ..Default::default()
        },
        requests: Some(1),
        tool_calls: None,
        active_ms: None,
        lines_added: None,
        lines_removed: None,
        provider_cost: opt_f64("provider_cost"),
        estimated_cost: None,
        currency: opt_str("currency"),
        reconciliation_key: opt_str("reconciliation_key"),
        provenance: Provenance {
            source_kind: opt_str("source").unwrap_or_else(|| "jsonl_import".into()),
            scope: SourceScope::Request,
            authority: SourceAuthority::Imported,
            freshness: FreshnessClass::Unknown,
            observed_at,
            provider_timestamp: None,
            confidence: 1.0,
        },
    })
}

/// Map a daemon/poller quota-spool row onto a canonical quota window plus an
/// optional cost-only event. Cost is NEVER folded into the quota's used_value:
/// it arrives as a separate event with its own stable key so billed sums and
/// quota percents cannot double count or conflate units.
fn jsonl_row_to_quota(
    v: &serde_json::Value,
) -> anyhow::Result<(usage_halo_core::QuotaWindow, Option<UsageEvent>)> {
    use usage_halo_core::*;
    let opt_str = |key: &str| v.get(key).and_then(|x| x.as_str()).map(str::to_string);
    let opt_f64 = |key: &str| v.get(key).and_then(|x| x.as_f64());
    let provider = opt_str("provider").unwrap_or_else(|| "unknown".into());
    let limit_id = opt_str("limit_id").unwrap_or_else(|| "window".into());
    let observed_at = opt_str("observed_at")
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);
    let source = opt_str("source").unwrap_or_else(|| "jsonl_import".into());
    let authority = if source.contains("official") {
        SourceAuthority::ProviderBilling
    } else if source.contains("codex") || source.contains("status") || source.contains("telemetry")
    {
        SourceAuthority::ProviderTelemetry
    } else {
        SourceAuthority::Imported
    };
    let metric_kind = match opt_str("metric_kind").as_deref() {
        Some("tokens") => MetricKind::Tokens,
        Some("cost") => MetricKind::Cost,
        Some("credits") => MetricKind::Credits,
        Some("requests") => MetricKind::Requests,
        _ => MetricKind::QuotaPercent,
    };
    let quota = QuotaWindow {
        provider: provider.clone(),
        account_id: opt_str("account_id"),
        limit_id: limit_id.clone(),
        label: opt_str("label").unwrap_or_else(|| limit_id.clone()),
        metric_kind,
        used_value: v.get("used_value").and_then(|x| x.as_f64()),
        limit_value: v.get("limit_value").and_then(|x| x.as_f64()),
        used_percent: opt_f64("used_percent"),
        remaining_value: None,
        window_duration_seconds: v.get("window_duration_seconds").and_then(|x| x.as_u64()),
        resets_at: opt_str("resets_at")
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        provenance: Provenance {
            source_kind: source.clone(),
            scope: SourceScope::Account,
            authority: authority.clone(),
            freshness: FreshnessClass::Unknown,
            observed_at,
            provider_timestamp: None,
            confidence: 1.0,
        },
    };
    let cost_event = match (opt_f64("provider_cost"), opt_str("currency")) {
        (Some(cost), currency) => Some(UsageEvent {
            id: uuid::Uuid::new_v4(),
            provider: provider.clone(),
            surface: provider.clone(),
            billing_owner: provider.clone(),
            model_provider: None,
            model: None,
            account_id: opt_str("account_id"),
            workspace_id: None,
            device_id: None,
            session_id: None,
            request_id: None,
            tokens: TokenUsage::default(),
            requests: None,
            tool_calls: None,
            active_ms: None,
            lines_added: None,
            lines_removed: None,
            provider_cost: Some(cost),
            estimated_cost: None,
            currency,
            reconciliation_key: Some(format!(
                "quota-cost:{provider}:{limit}:{when}",
                limit = limit_id,
                when = observed_at.to_rfc3339(),
            )),
            provenance: Provenance {
                source_kind: source,
                scope: SourceScope::Account,
                authority,
                freshness: FreshnessClass::Unknown,
                observed_at,
                provider_timestamp: None,
                confidence: 1.0,
            },
        }),
        (None, _) => None,
    };
    Ok((quota, cost_event))
}

#[cfg(test)]
mod tests {
    use super::*;
    use usage_halo_core::*;

    fn event(id: uuid::Uuid, observed_at: chrono::DateTime<chrono::Utc>) -> UsageEvent {
        UsageEvent {
            id,
            provider: "openrouter".into(),
            surface: "openrouter".into(),
            billing_owner: "openrouter".into(),
            model_provider: Some("anthropic".into()),
            model: Some("model-x".into()),
            account_id: None,
            workspace_id: None,
            device_id: None,
            session_id: None,
            request_id: Some("req-1".into()),
            tokens: TokenUsage {
                input: Some(100),
                output: Some(20),
                ..Default::default()
            },
            requests: Some(1),
            tool_calls: None,
            active_ms: None,
            lines_added: None,
            lines_removed: None,
            provider_cost: Some(0.02),
            estimated_cost: None,
            currency: Some("USD".into()),
            reconciliation_key: Some("openrouter:req-1".into()),
            provenance: Provenance {
                source_kind: "test".into(),
                scope: SourceScope::Request,
                authority: SourceAuthority::InstrumentedResponse,
                freshness: FreshnessClass::Live,
                observed_at,
                provider_timestamp: None,
                confidence: 1.0,
            },
        }
    }

    async fn migrated() -> Storage {
        let s = Storage::connect("sqlite::memory:")
            .await
            .expect("in-memory connect");
        s.migrate().await.expect("migrate");
        s
    }

    #[tokio::test]
    async fn migration_creates_expected_tables() {
        let s = migrated().await;
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .fetch_all(s.pool())
                .await
                .unwrap();
        for t in [
            "provider_accounts",
            "usage_events",
            "quota_snapshots",
            "connector_health",
            "daily_rollups",
            "alert_rules",
        ] {
            assert!(tables.contains(&t.to_string()), "missing table {t}");
        }
    }

    #[tokio::test]
    async fn duplicate_event_ids_are_ignored_not_doubled() {
        let s = migrated().await;
        let id = uuid::Uuid::new_v4();
        let now = chrono::Utc::now();
        s.insert_usage_event(&event(id, now)).await.unwrap();
        s.insert_usage_event(&event(id, now)).await.unwrap();
        assert_eq!(s.count_usage_events().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn prune_removes_only_expired_rows() {
        let s = migrated().await;
        let now = chrono::Utc::now();
        s.insert_usage_event(&event(uuid::Uuid::new_v4(), now))
            .await
            .unwrap();
        let mut old = event(uuid::Uuid::new_v4(), now - chrono::Duration::days(100));
        old.reconciliation_key = Some("openrouter:req-old".into());
        old.request_id = Some("req-old".into());
        s.insert_usage_event(&old).await.unwrap();
        assert_eq!(s.prune_events_older_than(90).await.unwrap(), 1);
        assert_eq!(s.count_usage_events().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn schema_version_tracks_migrations() {
        let s = migrated().await;
        assert_eq!(s.schema_version().await.unwrap(), 3);
    }

    #[tokio::test]
    async fn migration_creates_phase2_tables() {
        let s = migrated().await;
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .fetch_all(s.pool())
                .await
                .unwrap();
        for t in [
            "hourly_rollups",
            "budgets",
            "alert_events",
            "reconciliation_groups",
            "settings",
        ] {
            assert!(tables.contains(&t.to_string()), "missing table {t}");
        }
    }

    #[tokio::test]
    async fn concurrent_identical_inserts_collapse_to_one_row() {
        // Gate 2: SQLite constraints — not read-all-append — own dedup.
        let s = migrated().await;
        let now = chrono::Utc::now();
        let mut handles = Vec::new();
        for _ in 0..10 {
            let db = s.clone();
            let e = event(uuid::Uuid::new_v4(), now);
            handles.push(tokio::spawn(async move {
                db.insert_usage_event(&e).await.unwrap().inserted
            }));
        }
        let mut inserted = 0;
        for h in handles {
            if h.await.unwrap() {
                inserted += 1;
            }
        }
        assert_eq!(inserted, 1);
        assert_eq!(s.count_usage_events().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn fingerprint_dedups_keyless_replays_without_ingest_time() {
        let s = migrated().await;
        let now = chrono::Utc::now();
        let mut a = event(uuid::Uuid::new_v4(), now);
        a.reconciliation_key = None;
        a.request_id = None;
        let mut b = a.clone();
        b.id = uuid::Uuid::new_v4();
        assert_eq!(stable_fingerprint(&a), stable_fingerprint(&b));
        assert!(s.insert_usage_event(&a).await.unwrap().inserted);
        assert!(!s.insert_usage_event(&b).await.unwrap().inserted);
        assert_eq!(s.count_usage_events().await.unwrap(), 1);
    }

    #[tokio::test]
    async fn health_failures_preserve_last_success() {
        let s = migrated().await;
        let healthy = HealthAttempt {
            connector_id: "openrouter",
            success: true,
            expected_refresh_seconds: Some(300),
            error_class: None,
            error_message: None,
            http_status: None,
            retry_after_secs: None,
        };
        s.record_health_attempt(healthy).await.unwrap();
        let first = s.connector_last_success("openrouter").await.unwrap();
        assert!(first.is_some());
        for _ in 0..2 {
            s.record_health_attempt(HealthAttempt {
                connector_id: "openrouter",
                success: false,
                expected_refresh_seconds: Some(300),
                error_class: Some("network"),
                error_message: Some("timeout"),
                http_status: None,
                retry_after_secs: Some(60),
            })
            .await
            .unwrap();
        }
        // last_success survives both failures.
        assert_eq!(s.connector_last_success("openrouter").await.unwrap(), first);
        let failures: i64 = sqlx::query_scalar(
            "SELECT consecutive_failures FROM connector_health WHERE connector_id = 'openrouter'",
        )
        .fetch_one(s.pool())
        .await
        .unwrap();
        assert_eq!(failures, 2);
    }

    fn quota(
        provider: &str,
        limit: &str,
        pct: Option<f64>,
        at: chrono::DateTime<chrono::Utc>,
    ) -> QuotaWindow {
        QuotaWindow {
            provider: provider.into(),
            account_id: None,
            limit_id: limit.into(),
            label: "window".into(),
            metric_kind: MetricKind::QuotaPercent,
            used_value: None,
            limit_value: None,
            used_percent: pct,
            remaining_value: None,
            window_duration_seconds: None,
            resets_at: None,
            provenance: Provenance {
                source_kind: "test".into(),
                scope: SourceScope::Account,
                authority: SourceAuthority::ProviderBilling,
                freshness: FreshnessClass::Live,
                observed_at: at,
                provider_timestamp: None,
                confidence: 1.0,
            },
        }
    }

    #[tokio::test]
    async fn quota_snapshot_reaches_latest_read_idempotently() {
        let s = migrated().await;
        let now = chrono::Utc::now();
        let (id1, first) = s
            .insert_quota_snapshot(&quota("openrouter", "key-limit", Some(42.0), now))
            .await
            .unwrap();
        let (id2, second) = s
            .insert_quota_snapshot(&quota("openrouter", "key-limit", Some(42.0), now))
            .await
            .unwrap();
        assert_eq!(id1, id2, "same observation replays to the same row");
        assert!(first && !second, "replay reports inserted=false");
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM quota_snapshots")
            .fetch_one(s.pool())
            .await
            .unwrap();
        assert_eq!(n, 1);
        let latest = s
            .latest_quota_percent("openrouter", "key-limit", None)
            .await
            .unwrap()
            .expect("quota reaches the read path");
        assert_eq!(latest.0, Some(42.0));
    }

    #[tokio::test]
    async fn jsonl_import_is_idempotent_and_preserves_nulls() {
        let s = migrated().await;
        let dir = std::env::temp_dir().join(format!("uh-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("usage_events.jsonl");
        std::fs::write(
            &file,
            "{\"provider\":\"openrouter\",\"model\":\"m\",\"input_tokens\":100,\"request_id\":\"r1\",\"reconciliation_key\":\"openrouter:r1\",\"observed_at\":\"2026-09-05T10:00:00Z\"}\n\
             {\"provider\":\"openrouter\",\"model\":\"m\",\"observed_at\":\"2026-09-05T11:00:00Z\"}\n",
        )
        .unwrap();
        let (ins1, skip1) = s.import_jsonl_events(&file).await.unwrap();
        assert_eq!((ins1, skip1), (2, 0));
        let (ins2, skip2) = s.import_jsonl_events(&file).await.unwrap();
        assert_eq!((ins2, skip2), (0, 2), "replay must not duplicate");
        // Missing output_tokens stayed NULL, not zero.
        let nulls: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM usage_events WHERE output_tokens IS NULL")
                .fetch_one(s.pool())
                .await
                .unwrap();
        assert_eq!(nulls, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn hourly_rollup_rebuild_is_idempotent() {
        let s = migrated().await;
        let now = chrono::Utc::now();
        s.insert_usage_event(&event(uuid::Uuid::new_v4(), now))
            .await
            .unwrap();
        let n1 = s.rebuild_hourly_rollups("UTC").await.unwrap();
        assert!(n1 >= 1);
        let n2 = s.rebuild_hourly_rollups("UTC").await.unwrap();
        assert_eq!(n1, n2, "rebuild must replace, not accumulate");
        assert_eq!(s.count_hourly_rollups().await.unwrap() as u64, n1);
    }

    #[tokio::test]
    async fn retention_covers_quotas_and_alert_history() {
        let s = migrated().await;
        let now = chrono::Utc::now();
        let old = now - chrono::Duration::days(100);
        s.insert_quota_snapshot(&quota("openrouter", "key-limit", Some(9.0), old))
            .await
            .unwrap();
        s.insert_quota_snapshot(&quota("openrouter", "key-limit", Some(42.0), now))
            .await
            .unwrap();
        s.save_alert_rule(AlertRuleInput {
            id: "r1",
            label: None,
            provider: Some("openrouter"),
            billing_owner: None,
            account_id: None,
            workspace_id: None,
            window_id: None,
            metric_key: "openai-api:requests",
            operator: ">=",
            threshold: 80.0,
            cooldown_seconds: 3600,
        })
        .await
        .unwrap();
        s.record_alert_event("r1", false, None, "insufficient_data")
            .await
            .unwrap();
        // Backdate the alert event past retention.
        sqlx::query("UPDATE alert_events SET evaluated_at = ?")
            .bind(old.to_rfc3339())
            .execute(s.pool())
            .await
            .unwrap();
        let rep = s.prune_all(90).await.unwrap();
        assert_eq!(rep.quotas, 1);
        assert_eq!(rep.alert_events, 1);
        assert!(s
            .latest_quota_percent("openrouter", "key-limit", None)
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn budgets_and_settings_round_trip_without_secrets() {
        let s = migrated().await;
        s.save_budget(BudgetInput {
            id: "b1",
            label: "Monthly cap",
            billing_owner: Some("openrouter"),
            provider_id: None,
            account_id: None,
            metric_key: "provider_cost",
            unit: "currency",
            limit_value: "50.00",
            period_kind: "calendar_month",
        })
        .await
        .unwrap();
        s.set_setting("timezone", "Asia/Ho_Chi_Minh").await.unwrap();
        assert_eq!(
            s.get_setting("timezone").await.unwrap().as_deref(),
            Some("Asia/Ho_Chi_Minh")
        );
    }
}
