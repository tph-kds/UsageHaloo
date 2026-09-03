use usage_halo_core::{ConnectorError, Result};

#[derive(Clone)]
pub struct OpenAiAdminClient {
    client: reqwest::Client,
    admin_key: String,
    base_url: String,
}

impl OpenAiAdminClient {
    pub fn new(admin_key: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
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
