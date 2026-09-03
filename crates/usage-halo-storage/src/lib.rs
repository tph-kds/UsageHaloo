use anyhow::Context;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use usage_halo_core::UsageEvent;

pub struct Storage {
    pool: SqlitePool,
}

impl Storage {
    pub async fn connect(url: &str) -> anyhow::Result<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect(url)
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

    pub async fn insert_usage_event(&self, event: &UsageEvent) -> anyhow::Result<()> {
        let p = &event.provenance;
        sqlx::query(
            r#"INSERT OR IGNORE INTO usage_events (
                id, provider, surface, billing_owner, model_provider, model,
                account_id, workspace_id, device_id, session_id, request_id,
                input_tokens, output_tokens, reasoning_tokens, cache_read_tokens,
                cache_write_tokens, tool_tokens, requests, tool_calls, active_ms,
                lines_added, lines_removed, provider_cost, estimated_cost, currency,
                reconciliation_key, source_kind, source_scope, source_authority,
                freshness_class, confidence, observed_at, provider_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
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
        Ok(())
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
        s.insert_usage_event(&event(
            uuid::Uuid::new_v4(),
            now - chrono::Duration::days(100),
        ))
        .await
        .unwrap();
        assert_eq!(s.prune_events_older_than(90).await.unwrap(), 1);
        assert_eq!(s.count_usage_events().await.unwrap(), 1);
    }
}
