use chrono::Utc;
use usage_halo_core::{
    ConnectorError, Provenance, Result, SourceAuthority, SourceScope, TokenUsage, UsageEvent,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct OpenAiAdminClient {
    client: reqwest::Client,
    admin_key: String,
    base_url: String,
}

impl OpenAiAdminClient {
    pub fn new(admin_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            admin_key: admin_key.into(),
            base_url: "https://api.openai.com/v1".into(),
        }
    }

    pub async fn completions_usage(
        &self,
        start_time: i64,
        bucket_width: &str,
    ) -> Result<serde_json::Value> {
        self.get(
            "organization/usage/completions",
            &[
                ("start_time", start_time.to_string()),
                ("bucket_width", bucket_width.to_string()),
            ],
        )
        .await
    }

    pub async fn costs(&self, start_time: i64, bucket_width: &str) -> Result<serde_json::Value> {
        self.get(
            "organization/costs",
            &[
                ("start_time", start_time.to_string()),
                ("bucket_width", bucket_width.to_string()),
            ],
        )
        .await
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<serde_json::Value> {
        let url = format!("{}/{}", self.base_url, path);
        let response = self
            .client
            .get(url)
            .bearer_auth(&self.admin_key)
            .query(query)
            .send()
            .await
            .map_err(|e| ConnectorError::Unavailable(e.to_string()))?;

        match response.status().as_u16() {
            401 => return Err(ConnectorError::Auth("OpenAI admin key rejected".into())),
            403 => {
                return Err(ConnectorError::Permission(
                    "OpenAI organization usage permission denied".into(),
                ))
            }
            429 => {
                return Err(ConnectorError::RateLimited(
                    "OpenAI organization usage API".into(),
                ))
            }
            _ => {}
        }
        response
            .error_for_status()
            .map_err(|e| ConnectorError::Unavailable(e.to_string()))?
            .json()
            .await
            .map_err(|e| ConnectorError::InvalidPayload(e.to_string()))
    }
}

/// Paginated completions usage fetch. Follows `next_page` cursors up to
/// `max_pages`; reports whether the window is complete so callers never
/// present a partial first page as a full total (TRUTH-017).
pub async fn completions_usage_all(
    client: &OpenAiAdminClient,
    start_time: i64,
    bucket_width: &str,
    max_pages: usize,
) -> Result<(Vec<serde_json::Value>, bool)> {
    let mut buckets = Vec::new();
    let mut page: Option<String> = None;
    for _ in 0..max_pages.max(1) {
        let mut query = vec![
            ("start_time", start_time.to_string()),
            ("bucket_width", bucket_width.to_string()),
        ];
        if let Some(cursor) = page.clone() {
            query.push(("page", cursor));
        }
        let body = client.get("organization/usage/completions", &query).await?;
        let data = body.get("data").unwrap_or(&body);
        let items = data
            .get("buckets")
            .or_else(|| data.get("data"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let complete_page = !items.is_empty();
        buckets.extend(items);
        let next = data
            .get("next_page")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        match (next, data.get("has_more").and_then(|v| v.as_bool())) {
            (Some(cursor), _) => page = Some(cursor),
            (None, Some(true)) => {
                return Ok((buckets, false));
            }
            _ => {
                if !complete_page && buckets.is_empty() {
                    // Empty first page: complete (no usage), not partial.
                }
                return Ok((buckets, true));
            }
        }
    }
    Ok((buckets, false))
}

/// Map completions buckets onto canonical usage events (tokens + requests;
/// cost arrives separately from the costs endpoint so the two never double
/// count). `observed_at` is each bucket's end time — the source measurement
/// window — never poll time. Buckets without token/request dimensions are
/// skipped rather than zero-filled.
pub fn buckets_to_events(buckets: &[serde_json::Value]) -> Vec<UsageEvent> {
    let mut out = Vec::new();
    for b in buckets {
        let end = b
            .get("end_time")
            .and_then(|v| v.as_i64())
            .and_then(usage_halo_core::epoch_seconds_to_utc)
            .unwrap_or_else(Utc::now);
        for r in b
            .get("results")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
        {
            let input = r.get("input_tokens").and_then(|v| v.as_u64());
            let output = r.get("output_tokens").and_then(|v| v.as_u64());
            let cached = r.get("input_cached_tokens").and_then(|v| v.as_u64());
            let requests = r.get("num_model_requests").and_then(|v| v.as_u64());
            if input.is_none() && output.is_none() && cached.is_none() && requests.is_none() {
                continue;
            }
            let model = r.get("model").and_then(|v| v.as_str()).map(str::to_string);
            let start = b.get("start_time").and_then(|v| v.as_i64());
            let end_s = b.get("end_time").and_then(|v| v.as_i64());
            out.push(UsageEvent {
                id: Uuid::new_v4(),
                provider: "openai-api".into(),
                surface: "openai-api".into(),
                billing_owner: "openai".into(),
                model_provider: Some("openai".into()),
                model: model.clone(),
                account_id: None,
                workspace_id: None,
                device_id: None,
                session_id: None,
                request_id: None,
                tokens: TokenUsage {
                    input,
                    output,
                    reasoning: None,
                    cache_read: cached,
                    cache_write: None,
                    tool: None,
                },
                requests,
                tool_calls: None,
                active_ms: None,
                lines_added: None,
                lines_removed: None,
                provider_cost: None,
                estimated_cost: None,
                currency: None,
                reconciliation_key: Some(format!(
                    "openai:{}:{}:{}:{}",
                    model.as_deref().unwrap_or(""),
                    start.map(|v| v.to_string()).unwrap_or_default(),
                    end_s.map(|v| v.to_string()).unwrap_or_default(),
                    input.unwrap_or(0),
                )),
                provenance: Provenance {
                    source_kind: "openai_admin_api".into(),
                    scope: SourceScope::Organization,
                    authority: SourceAuthority::ProviderBilling,
                    freshness: usage_halo_core::FreshnessClass::Daily,
                    observed_at: end,
                    provider_timestamp: None,
                    confidence: 1.0,
                },
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_map_to_canonical_events_with_window_timestamps() {
        let buckets = serde_json::json!([
            {"start_time": 1756684800, "end_time": 1756771200,
             "results": [
                {"model": "gpt-4o", "input_tokens": 1000, "output_tokens": 200, "num_model_requests": 3},
                {"model": "gpt-4o-mini"}
             ]}
        ]);
        let events = buckets_to_events(buckets.as_array().unwrap());
        // Dimensionless result rows are skipped, never zero-filled.
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.tokens.input, Some(1000));
        assert_eq!(e.requests, Some(3));
        assert_eq!(e.billing_owner, "openai");
        assert_eq!(e.model_provider.as_deref(), Some("openai"));
        // observed_at is the bucket end (source window), not poll time.
        assert_eq!(
            e.provenance.observed_at.to_rfc3339(),
            "2025-09-02T00:00:00+00:00"
        );
        assert!(e
            .reconciliation_key
            .as_deref()
            .unwrap()
            .starts_with("openai:gpt-4o:"));
    }
}
