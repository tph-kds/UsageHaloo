-- Phase A (WP3): real-provider source tracking + observation history base.
--
-- Additive only: no ALTERs to existing tables. New tables for per-source
-- attempt/backoff state, normalized provider snapshots, metric observation
-- history (Today/Week/Month), and activity events. Timestamps are UTC
-- RFC3339 text, matching existing tables. No secret columns here.

CREATE TABLE IF NOT EXISTS provider_sources (
  provider_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER,
  fidelity TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  backoff_until TEXT,
  PRIMARY KEY(provider_id, source_id)
);

CREATE TABLE IF NOT EXISTS provider_snapshots (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  account_id TEXT,
  active_source_id TEXT,
  health_state TEXT NOT NULL,
  headline_metric_id TEXT,
  collected_at TEXT NOT NULL,
  last_successful_at TEXT,
  payload_version INTEGER NOT NULL DEFAULT 1,
  normalized_payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_provider_account_time
  ON provider_snapshots(provider_id, account_id, collected_at);

CREATE TABLE IF NOT EXISTS metric_observations (
  id TEXT PRIMARY KEY,
  provider_snapshot_id TEXT,
  provider_id TEXT NOT NULL,
  account_id TEXT,
  metric_id TEXT NOT NULL,
  value_numeric REAL,
  value_text TEXT,
  unit TEXT,
  status TEXT NOT NULL,
  fidelity TEXT,
  source_id TEXT,
  observed_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observations_provider_metric_time
  ON metric_observations(provider_id, metric_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_observations_account
  ON metric_observations(provider_id, account_id, observed_at);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  account_id TEXT,
  state TEXT NOT NULL,
  fidelity TEXT,
  source_id TEXT,
  observed_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_provider_time
  ON activity_events(provider_id, observed_at);
