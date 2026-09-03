# Planned provider connectors

These are intentionally stubs rather than pretend-working scrapers.

## Cursor

- Team/Enterprise Analytics API.
- Enterprise filtered usage events for granular token/cost data.
- Enterprise OpenTelemetry export where configured.
- Respect hourly aggregation/polling guidance for relevant endpoints.
- Personal-account support should use only a documented machine-readable source when available.

## Z.ai / ZCode

- Model 5-hour and weekly credit windows.
- Mark Beta until a stable documented machine-readable usage-statistics interface is verified.
- Do not make browser-cookie scraping a default connector.

## Perplexity

- Instrument response `usage` for API requests passing through UsageHalo middleware/gateway.
- Label scope `instrumented_traffic_only`.

## Mistral / Vibe

- Admin usage metrics, spend/rate limits and Vibe analytics for eligible plans.
- Expose plan/permission requirements in setup UI.

## GitHub Copilot

- Organization/enterprise usage metrics.
- Treat report cadence as daily/aggregated rather than live.

## Windsurf

- Enterprise API where available.
- Connector metadata must reflect backend refresh cadence.

## xAI / DeepSeek / Groq / Together / Fireworks / Cerebras

- Start with request/response usage instrumentation.
- Add account APIs only when stable official usage endpoints justify them.

## Ollama / LM Studio

- Local response metadata can give low-latency device-scoped token/activity information.

## AWS Bedrock / Azure OpenAI / Vertex AI

- Combine cloud billing/monitoring with request-level instrumentation.
- Reconciliation is mandatory because cloud billing data is delayed and aggregate.
