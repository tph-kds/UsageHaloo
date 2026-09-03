# Security and Privacy

**Rule:** No secret keys, prompts, responses, transcripts, or source paths in SQLite. Secrets referenced by `secret_alias` only and stored in OS keychain. The Claude status-line bridge sanitizes to an allowlist before writing to inbox.

Why: High-value credentials + sensitive workspace paths. Persistence of secrets or transcripts would widen compromise blast radius and violate data minimization.

Where: `crates/viusage-storage/migrations/0001_init.sql:6` (provider_accounts has `secret_alias` not secret); `crates/viusage-storage/src/lib.rs:30` (insert binds only alias-derived fields); `connectors/claude-code/scripts/viusage-claude-bridge.mjs:33` (allowlist `clean` object); `connectors/claude-code/src/lib.rs:21` (`sanitize` drops transcript_path/workspace).

Invariants:
- `usage_events` and `quota_snapshots` must never gain a column that stores raw prompts, transcripts, or credentials.
- Bridge `clean` section must not contain `transcript_path:` assignment — enforced by `scripts/validate.py:61`.

Check: `python scripts/validate.py` privacy guardrail + `cargo test sanitizer_drops_sensitive_path_fields` in `connectors/claude-code/src/lib.rs:154`.
