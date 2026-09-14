---
schema: planonce.security/v1
change_id: real-provider-usage-v2
revision: b55f56b8f8c225c08f86e99bd50533973c688b49
baseline_revision: 9e5be2fc2d3420a508701f63a659a1be04efee74
scope: diff (main...HEAD, 21 commits, 58 files)
verdict: REVIEWED_NO_CONFIRMED_FINDINGS
---
# Security Review — real-provider-usage-v2

## Threat model

- Assets: provider session tokens (Codex auth.json, Cursor vscdb auth keys,
  Gemini oauth_creds), account identifiers, usage payloads, SQLite truth store.
- Boundaries crossed by this change: new local file reads (spool, rollouts,
  state.vscdb, google_accounts.json); new snapshot JSON fields served on
  localhost :4897 and Tauri IPC; additive SQLite tables.
- Invariants: raw tokens never read/stored/logged/synced; secrets stay
  provider-owned; diagnostics carry presence/age, never identifiers.

## Deterministic checks run

- python scripts/privacy_audit.py: clean (8 files, 288 rows, no secrets).
- python -m pytest -q -k 'privacy or test_privacy': 2 passed.
- Fixture diff secret-pattern scan (sk-/bearer/long-blobs/emails/sessionIds):
  no hits.
- Dependency review: no new crates (chrono/serde/sqlx/tokio all pre-existing
  workspace entries). No scanners auto-installed (none available offline).

## Semantic review (diff-first, second pass)

- Cursor sqlite: exact-key SELECT with .bind, read_only + busy timeout,
  never immutable, never write. No injection path (no user input in SQL).
- Token files never opened: Codex auth.json untouched (keys listed once by
  hand during recon, values never read); Cursor token keys never selected
  (exact-key query for cachedEmail only); Gemini oauth_canary test proves
  oauth_creds.json is never parsed.
- Localhost server additions: fixed paths under home/profile (no user input
  in paths); ?timezone= validated via Intl with 400 on unknown; no new
  external network calls (only localhost runtimes + local child processes).
- No new Tauri commands, no cloud sync, no secret columns in migration 0004.
- SAMPLE_MODE=1 env can enable demo numbers: explicit documented opt-in,
  labeled sample_data:true. Not a finding; noted as accepted behavior.

## Findings

None confirmed. One P3 note: spool/rollout whole-file reads have no size
cap in server.mjs (local-trusted paths; pre-existing pattern). Backlog.

## Not tested

External dependency vulnerabilities (no network scanner run); browser-side
rendering of diagnostics (no driver); live Cursor writer contention.
