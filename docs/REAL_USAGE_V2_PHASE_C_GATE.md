# Phase C gate record — surfaces + history (2026-09-14, branch feat/real-provider-usage-v2)

## Fresh evidence

- cargo test --workspace: 0 failures (exit 0).
- python -m pytest -q: 89 passed. scripts/validate.py: PASS.
- node collectors/history.test.mjs: all checks passed (20/20).
- node contracts/claudeV2/dataMode suites: all assertions passed.
- svelte-check: 0 errors, 0 warnings (per C-task runs; rerun at ship).

## Delivered

- C1+C2 (07e6982): DetailModal "Provider settings and diagnostics" — account,
  capabilities, source, headline, observed age, health, windows, why-line.
  Rows omitted when absent. Visual rendering INCONCLUSIVE (no browser driver).
- C3 (828878a): timezone-correct Today/Week/Month; UTC-slice and ignored-tz
  defects fixed at their owners; gauge values never summed (static guard in
  test); restart-safe proven by fresh-process reread.

## Rollback readiness

- Commits single-purpose, revertible in order. No schema change in Phase C.
- Server endpoint changes additive (?timezone= optional, default UTC).
- RangePicker change is net deletion (delegates to rangeForPreset).

## Residual risks

- Modal visuals unverified in a browser (INCONCLUSIVE).
- Persisted codex rows carry odd 2030 resets (prior-session seed); surfaced as-is.
- Untracked scaffold (collector/projection crates) still deferred to Phase E.
