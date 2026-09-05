-- Phase 2: canonical storage authority (remediation docs 03/05).
--
-- Forward-only migration. Adds stable-identity dedup, connector health
-- history, hourly rollups, budgets, scoped alert rules + evaluation history,
-- reconciliation groups, and a secrets-free settings table.

-- Stable source fingerprint: dedup identity that never includes ingest time.
ALTER TABLE usage_events ADD COLUMN raw_fingerprint TEXT;

-- Atomic dedup: SQLite constraints are the authority, not read-all-append.
-- (SQLite UNIQUE permits multiple NULLs, so keyless rows never collide.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_reconcile_unique
  ON usage_events(reconciliation_key) WHERE reconciliation_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_fingerprint_unique
  ON usage_events(raw_fingerprint) WHERE raw_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_billing_account
  ON usage_events(billing_owner, account_id, observed_at);

-- Connector health history (P0-13): failures update failure fields while
-- last_success_at is preserved by the upsert, never overwritten with NULL.
ALTER TABLE connector_health ADD COLUMN first_seen_at TEXT;
ALTER TABLE connector_health ADD COLUMN last_failure_at TEXT;
ALTER TABLE connector_health ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connector_health ADD COLUMN retry_after_at TEXT;
ALTER TABLE connector_health ADD COLUMN error_class TEXT;
ALTER TABLE connector_health ADD COLUMN error_message TEXT;
ALTER TABLE connector_health ADD COLUMN http_status INTEGER;

-- Quota scope index for account/window-aware latest reads.
CREATE INDEX IF NOT EXISTS idx_quota_account_window
  ON quota_snapshots(provider, account_id, limit_id, observed_at DESC);

-- Hourly rollups: idempotent bucket rows rebuilt from usage_events.
CREATE TABLE IF NOT EXISTS hourly_rollups (
  bucket_start_utc TEXT NOT NULL,
  timezone TEXT NOT NULL,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  billing_owner TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  provider_cost REAL NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  observation_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket_start_utc, timezone, provider, surface, billing_owner, model)
);

-- User budgets (separate from provider quotas; scoped by billing dimension).
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  billing_owner TEXT,
  provider_id TEXT,
  account_id TEXT,
  workspace_id TEXT,
  metric_key TEXT NOT NULL,
  unit TEXT NOT NULL,
  money_currency TEXT,
  limit_value TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  period_timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Alert rules gain real scope + freshness gating (typed scope matching).
ALTER TABLE alert_rules ADD COLUMN label TEXT;
ALTER TABLE alert_rules ADD COLUMN billing_owner TEXT;
ALTER TABLE alert_rules ADD COLUMN account_id TEXT;
ALTER TABLE alert_rules ADD COLUMN workspace_id TEXT;
ALTER TABLE alert_rules ADD COLUMN window_id TEXT;
ALTER TABLE alert_rules ADD COLUMN freshness_requirement TEXT;
ALTER TABLE alert_rules ADD COLUMN updated_at TEXT;

-- Immutable alert evaluation history: explains fire AND suppression.
CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  fired INTEGER NOT NULL,
  metric_value REAL,
  reason TEXT NOT NULL,
  FOREIGN KEY(rule_id) REFERENCES alert_rules(id)
);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events(rule_id, evaluated_at DESC);

-- Which raw observations overlap and which evidence won (Phase 3 fills this).
CREATE TABLE IF NOT EXISTS reconciliation_groups (
  id TEXT PRIMARY KEY,
  billing_owner TEXT,
  account_id TEXT,
  metric_key TEXT NOT NULL,
  window_start_utc TEXT,
  window_end_utc TEXT,
  winner_observation_id TEXT,
  state TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

-- App settings. Secrets are NEVER stored here (OS keychain owns them).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
