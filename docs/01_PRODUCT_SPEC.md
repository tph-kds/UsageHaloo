# Product specification

## Product goal

Provide a single, low-friction control surface for understanding consumption across AI subscriptions, coding agents and model APIs without forcing users to repeatedly open provider dashboards.

## Primary users

### Individual developer

Uses Claude Code, Codex, Gemini CLI, Cursor and one or more APIs. Needs to know which quota will expire first, current context pressure, today's usage and approximate spend.

### Power user / AI engineer

Uses many providers directly and through routers. Needs per-model accounting, cost attribution, cache effectiveness and anomaly alerts.

### Team / enterprise admin (later)

Needs organization/workspace usage, policy budgets, adoption and consolidated provider accounting.

## Jobs to be done

1. “Tell me how close I am to each usage limit without opening five dashboards.”
2. “Show which models consumed tokens and money today.”
3. “Warn me before a coding session hits a quota.”
4. “Tell me whether a number is live, delayed or estimated.”
5. “Show whether usage came from this device, an account, or an organization.”
6. “Help me understand whether subscriptions are being under- or over-utilized.”
7. “Give me a historical daily activity view.”
8. “Forecast the next likely limit or budget problem.”

## Metric taxonomy

Use typed metrics rather than a single percentage field.

- `quota_percent`
- `token_count`
- `cost`
- `credit_count`
- `request_count`
- `context_percent`
- `tool_call_count`
- `session_count`
- `active_seconds`
- `line_count`
- `balance`

### Token taxonomy

At minimum:

- input;
- output;
- reasoning/thought;
- cache read;
- cache write;
- tool;
- unknown/other.

Never merge categories if the provider exposes them separately.

## Information architecture

### Ambient surfaces

- edge rail/notch-aligned rail;
- tray/menu-bar icon;
- compact popup;
- OS notifications.

### Main app

- Overview;
- Activity;
- Models;
- Budgets;
- Providers;
- Settings.

### Provider detail

- primary quota(s);
- reset times;
- latest model/session;
- tokens today/7d/30d;
- cost today/7d/30d;
- model split;
- cache ratio;
- history;
- source/freshness/scope;
- connector health.

## Provider settings

Each provider configuration should expose:

- enabled/disabled;
- pinned/unpinned;
- display order;
- connector/account selection;
- primary ring metric;
- poll frequency within provider-supported limits;
- local/account/workspace scope label;
- alert thresholds;
- credential status;
- data permissions;
- connector diagnostics.

## Default rail behavior

Show at most 4–7 providers. Overflow becomes `+N`.

Sort modes:

- pinned order;
- most urgent quota;
- most recently active;
- most used.

Hover opens a non-blocking detail card. Click opens provider dashboard. Right-click/context menu opens quick settings.

## Forecasting features

Start with deterministic statistics, not an LLM.

### Quota exhaustion forecast

Use rolling consumption velocity or EWMA:

- current consumed fraction;
- seconds remaining in quota window;
- recent consumption rate;
- predicted fraction at reset;
- predicted time-to-limit.

Return explicit confidence and suppress predictions if samples are too sparse.

### Cost forecast

Estimate:

- end-of-day;
- end-of-week;
- billing-cycle total.

### Anomaly rules

- usage rate > configured multiple of baseline;
- unexpected model/provider shift;
- cache-hit ratio collapse;
- spend/hour spike;
- connector stale or auth failure.

## Out of scope for v1

- reading prompts/responses for analytics;
- unsupported browser-cookie scraping;
- silently modifying provider credentials;
- forced reverse proxying of all AI traffic;
- arbitrary third-party executable plugins;
- enterprise cloud tenancy;
- identical overlay behavior on every OS.

## Success criteria

The v1 product is successful if a developer can leave it running for a full workday with negligible distraction and answer all of the following within two interactions:

- which provider is closest to a limit;
- when that limit resets;
- today's tokens/cost where available;
- which model is most used;
- whether the displayed data is live or delayed;
- whether a connector is unhealthy.
