---
schema: planonce.verify/v1
change_id: rename-and-complete
phase: Wave 3 (realistic data generator)
revision: unavailable
working_tree_digest: unavailable
plan_digest: sha256:5631c037fe47de7a343923416758397b73882b604024e44ab9123a923d86df50
evidence_status: FRESH
---
# Wave 3 VERIFY — Realistic data generator

## Approach

Replaced the hash-fake generator in `prototype/server.mjs` with a per-day-deterministic, registry-driven generator:

- **Seed.** `hash32(provider_id + ':' + utc_day)` so the same provider on the same day always produces the same numbers; a different day produces different numbers.
- **Primary percent.** `realisticPrimary(metric, basePct, dayFraction, dayOfWeek)` branches on the registry's `primaryMetric`:
  - `quota_5h` / `primary_quota` / `quota_5h_credits`: partial daily burn; weekend dip.
  - `tokens_today`: Mon 38 → Tue 60 → Wed 78 → Thu 82 → Fri 70 → Sat 28 → Sun 14, plus small jitter.
  - `budget_month` / `credit_usage` / `spend_month`: linear ramp over the month, Friday spike.
  - `included_usage` / `requests_day` / generic: lower fractions.
- **Cost.** `realisticCost(connector, seed, dow)`: subscription/zai → `"subscription"`; cloud-billing/openai/openrouter → `$0.20..$28.50` with weekend dampening; everything else → `"—"`. The Claude-ingest override (real fixture wins) is preserved.
- **Tokens.** `realisticTokens(seed, dow)`: weekly multiplier; same shape as the prior implementation.
- **Reset strings.** Now derived from the date (`Resets in 12d` instead of a hardcoded `Sep 30`).
- **Response shape.** New fields: `day_utc`, `data_basis: "registry+per-day-deterministic"`, `sample_data: true`. The Claude-ingest override path is unchanged.
- **Spool path.** `SPOOL_LEGACY = ~/.viusagever/inbox/...` added; `latestSpoolRecord` reads new path first, falls back to legacy, then fixture. The one-time copy endpoint is Wave 6.

The demo (`demo/app.js`, `demo/styles.css`) now reads `day_utc` and `sample_data` and shows a "Sample data · as of YYYY-MM-DD" line in the hover card.

## Deterministic checks

| Check | Command | Result |
|---|---|---|
| Syntax | `node --check prototype/server.mjs && node --check demo/app.js` | silent ✅ |
| Tests | `python -m pytest -q` | `14 passed` (8 prior + 6 new) ✅ |
| Validator | `python scripts/validate.py` | `UsageHalo validation: PASS` ✅ |
| Live snapshot smoke | `Start-Process node ...; curl /api/snapshot` | `day_utc`, `data_basis`, `sample_data: true` present; 24 providers; non-negative numbers ✅ |

## New regression tests (`tests/test_realistic_data.py`)

1. `test_sample_data_flag_and_day` — `sample_data: true`, `data_basis: "registry+per-day-deterministic"`, `day_utc == utc_today`.
2. `test_per_day_determinism` — two same-day calls return identical numeric data per provider.
3. `test_seed_changes_with_day` — the FNV-1a seed the prototype uses is influenced by the date (at least one provider's bucket changes between today and yesterday).
4. `test_no_negative_or_nan_for_any_provider` — all 24 providers: `primaryPercent` and `secondaryPercent` are 0..100, `tokensToday` parses (or is the `model: ...` Claude override), `costToday` matches one of `subscription` / `—` / `$X.YY` / `$X.YY session`.
5. `test_realistic_cost_rules` — subscription/zai/cloud-billing/openai/openrouter follow the per-connector rules; Claude-Code's fixture override is allowed.
6. `test_tokens_today_weekly_rhythm` — for `primaryMetric == "tokens_today"`, `primaryPercent` is within ±15 of the expected day-of-week bucket.

## Bugs caught and fixed during Wave 3

- Test `test_no_negative_or_nan_for_any_provider` and `test_realistic_cost_rules` initially failed on `claude-code` because the Claude-ingest override produces free-form strings (`"model: Claude Example"`, `"$0.31 session"`). The fix was to whitelist those shapes in the test (the prototype behavior is correct; only the test's prior assumption was wrong).

## Requirement coverage

| ID | Status | Evidence |
|---|---|---|
| R2 (realistic per-day deterministic) | DONE | generator + 6 new tests |
| R5 (registry shape respected) | DONE | `realisticPrimary` branches on `primaryMetric`; `test_realistic_cost_rules` enforces per-connector cost rules |
| R6 (non-negative) | DONE | `test_no_negative_or_nan_for_any_provider` |
| R7 (demo updated) | DONE | `STATE.sampleData` + `STATE.dayUtc` plumbed to the hover card |
| R9 (no regression) | DONE | 14/14 |
| R10 (validator) | DONE | `UsageHalo validation: PASS` |

## Risks
- **No new one-way doors.** Generator is data-only; the response shape is additive.
- The `sample_data: true` flag is the only honest signal; consumers (Svelte app in Wave 4) must surface it as a "Sample data" badge.

## Planonce-review (lightweight)
- Drive-by refactors avoided: yes.
- Contract changes: response shape is additive; `providers[]` and `models[]` are unchanged.
- Unrelated changes: none.

## Next action
Wave 4: Svelte live-data wiring. Vite proxy + `apps/desktop-ui/src/lib/api.ts` + App.svelte change. Add "Sample data" badge driven by the new flag.
