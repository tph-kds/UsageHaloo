# Provider research and connector plan

Research refreshed for this plan on **2026-08-29**. Provider capabilities change frequently; every connector must be versioned and contract-tested.

## Connector quality levels

- **A — event/live provider telemetry:** best source for ambient UI.
- **B — official account/admin API:** authoritative, may be delayed.
- **C — instrumented request:** exact for requests UsageHalo sees, incomplete for other clients.
- **D — manual/import/dashboard:** useful but never label as realtime.

## Recommended provider matrix

| Provider / product | Primary source | Class | Useful data | MVP status |
|---|---|---:|---|---|
| Claude Code | `statusLine` JSON stdin | A | 5h/7d quota %, resets, model, context, session cost/tokens | P0 |
| Codex | official app-server JSON-RPC | A | primary/secondary rate windows, resets, spend controls/credits where exposed | P0 |
| Gemini CLI | OpenTelemetry | A | input/output/thought/cache/tool tokens, model, tool telemetry | P0 |
| OpenAI API | Organization Usage + Costs API | B | usage buckets, model/project/user/key dimensions, monetary cost | P0 |
| Anthropic API | official usage/admin facilities when authorized | B/C | model/token/cost/account usage | P0/P1 |
| OpenRouter | Credits API + response usage | A/B/C | credits, usage, model/provider, tokens, cost | P0 |
| Cursor | Admin/Analytics API, Enterprise OTel | A/B | token events, charged cost, model usage, activity | P1 |
| Z.ai / ZCode | usage statistics + documented quota rules | B/D until stable machine interface is verified | 5h + weekly credits, plan quota | P1 beta |
| Perplexity | response `usage` | C | input/output/total tokens, cost, tool costs | P1 |
| Mistral / Vibe | Admin usage/analytics | B | cost, input/output/cached tokens, sessions, tools | P1 enterprise |
| GitHub Copilot | usage metrics APIs/reports | B | daily model/CLI/request/session/token/adoption data | P1 |
| Windsurf | enterprise API | B | analytics/usage based on provider refresh behavior | P2 |
| xAI | response usage + console/account sources | C/B | request tokens/cost where available | P2 |
| DeepSeek | response instrumentation / compatible APIs | C | request tokens/cost estimate | P2 |
| Groq | response instrumentation | C | request tokens/model | P2 |
| Together | response instrumentation | C | request tokens/model/cost where returned | P2 |
| Fireworks | response instrumentation | C | request tokens/model/cost where returned | P2 |
| Cerebras | response instrumentation | C | request tokens/model | P2 |
| Ollama | local response metadata | C | local token counts, duration | P2 |
| LM Studio | local API response instrumentation | C | local tokens/model | P2 |
| LiteLLM | proxy telemetry / callbacks | A/C | multi-provider request accounting | P2 |
| AWS Bedrock | cloud usage/billing + request instrumentation | B/C | model invocation usage/cost attribution | P3 |
| Azure OpenAI | Azure metrics/cost + request instrumentation | B/C | deployments/tokens/cost | P3 |
| Vertex AI | cloud monitoring/billing + request instrumentation | B/C | model request/cost usage | P3 |

## Claude Code

Official status-line documentation states that Claude Code runs a configured command, sends JSON session data over stdin, and re-runs the command on relevant events. Current fields include:

- `model.id`, `model.display_name`;
- context-window token counts and used/remaining percentage;
- estimated session cost and duration;
- `rate_limits.five_hour.used_percentage`;
- `rate_limits.five_hour.resets_at`;
- `rate_limits.seven_day.used_percentage`;
- `rate_limits.seven_day.resets_at`;
- spend-limit information in supported gateway cases;
- prompt-cache statistics in newer versions.

Recommended UsageHalo integration:

1. receive the status-line JSON;
2. sanitize it immediately;
3. discard transcript path, cwd/repository metadata and any unneeded fields;
4. write only approved telemetry fields to a local spool/socket;
5. compose with an existing status-line command rather than overwriting it.

Source: https://code.claude.com/docs/en/statusline

## Codex

The official Codex app-server protocol exposes account rate-limit methods/events. Current schemas include:

- `account/rateLimits/read`;
- `account/rateLimits/updated`;
- primary and secondary `RateLimitWindow` values;
- `usedPercent`;
- `windowDurationMins`;
- `resetsAt`;
- multi-bucket snapshots and spend-control state in newer schema versions.

Recommended integration: speak app-server JSON-RPC over stdio and subscribe to updates. Do **not** extract auth material from internal files and call undocumented endpoints directly.

Source: https://github.com/openai/codex

## Gemini CLI

Gemini CLI documents OpenTelemetry metrics including `gemini_cli.token.usage` with `model` and token type values:

- input;
- output;
- thought;
- cache;
- tool.

It also emits standard generative-AI telemetry attributes. UsageHalo should operate an OTLP receiver that only retains approved metrics, not prompt/message bodies.

Source: https://geminicli.com/docs/cli/telemetry/

## OpenAI API

The OpenAI Admin API currently exposes organization usage endpoints including:

- `GET /organization/usage/completions`;
- `GET /organization/costs`;
- additional usage categories for embeddings/audio/file search/etc.

Cost results include currency/value and usage can be grouped by supported dimensions such as project, user or API key.

Treat this as a separate account connector from Codex subscription usage.

Source: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage

## OpenRouter

Current official endpoint:

`GET https://openrouter.ai/api/v1/credits`

A management key is required. The response includes `total_credits` and `total_usage`. Request responses can also provide usage/cost information, making OpenRouter a strong candidate for exact request-level telemetry when UsageHalo instrumentation is used.

Source: https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits

## Cursor

Current Cursor documentation provides:

- Usage Analytics for Team/Enterprise;
- Analytics API for Enterprise teams;
- detailed filtered usage events with token usage and `chargedCents`;
- hourly-aggregated detailed events with a recommendation to poll at most hourly;
- Enterprise OpenTelemetry export for model usage, tools and logs;
- model usage analytics endpoints.

Useful token fields can include input, output, cache write and cache read. For billing reconciliation, use documented charged cost fields rather than best-effort telemetry cost.

Sources:

- https://cursor.com/docs/account/teams/analytics
- https://prod.cursor.com/docs/account/teams/admin-api
- https://prod.cursor.com/docs/enterprise/opentelemetry-export

## Z.ai / ZCode

Current Coding Plan documentation states that plans are subject to both 5-hour and weekly usage-credit limits, with plan-specific credit allowances and documented reset behavior. Current usage documentation points users to Usage Statistics for consumption progress.

Until a stable documented machine-readable endpoint is verified for personal plans, label this connector Beta and do not rely on browser-cookie scraping.

Sources:

- https://docs.z.ai/devpack/overview
- https://docs.z.ai/devpack/notice/usage-revision

## Perplexity

Perplexity Agent API responses document a `usage` object containing input, output and total token counts plus cost information. That makes request instrumentation accurate for calls UsageHalo can observe.

Source: https://docs.perplexity.ai/api-reference/agent-post

## Mistral / Vibe

Current Mistral Admin API documentation includes organization billing usage, spend/rate limits and Vibe analytics. Vibe usage can include sessions, active users, per-model input/output/cached tokens, tool calls and duration.

Admin API availability and plan restrictions must be respected; do not expose an unusable connector to personal accounts.

Source: https://docs.mistral.ai/admin/admin-api/usage-metrics

## GitHub Copilot

Copilot usage data comes from **report-based** metrics endpoints (the legacy
beta `/usage` endpoints were deprecated in February 2025): report metadata
endpoints return time-limited `download_links`, which the connector follows
to fetch the actual rows (daily request/session/token sums, model/adoption
metrics, CLI fields). These reports are aggregated rather than realtime —
freshness is `daily`, scope is `organization_enterprise`, and the UI must
label their reporting cadence accordingly. Implemented in
`collectors/pollers.mjs::pollCopilot` (report path configurable via
`GITHUB_COPILOT_REPORT_PATH`).

Source: https://docs.github.com/en/copilot/reference/copilot-usage-metrics

## Generic OpenAI-compatible providers

For providers without a good account-wide API, offer an **optional local instrumentation gateway** or SDK middleware. This can observe requests sent through it and capture only response usage metadata.

Important limitation: this represents **instrumented traffic only**, not total provider-account usage. The scope badge must say so.

## Provider acceptance checklist

A connector is not “supported” until it has:

- documented source and authentication method;
- capability map;
- scope semantics;
- freshness semantics;
- fixture-based parser tests;
- rate-limit policy;
- secret-storage policy;
- failure/stale behavior;
- dedupe/reconciliation strategy;
- explicit unsupported fields;
- version/change monitoring plan.
