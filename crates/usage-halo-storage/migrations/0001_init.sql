CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  external_scope_id TEXT,
  scope TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  connector_version TEXT,
  secret_alias TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  billing_owner TEXT NOT NULL,
  model_provider TEXT,
  model TEXT,
  account_id TEXT,
  workspace_id TEXT,
  device_id TEXT,
  session_id TEXT,
  request_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  tool_tokens INTEGER,
  requests INTEGER,
  tool_calls INTEGER,
  active_ms INTEGER,
  lines_added INTEGER,
  lines_removed INTEGER,
  provider_cost REAL,
  estimated_cost REAL,
  currency TEXT,
  reconciliation_key TEXT,
  source_kind TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  freshness_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  observed_at TEXT NOT NULL,
  provider_timestamp TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_observed ON usage_events(observed_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_provider ON usage_events(provider, observed_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model, observed_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_reconcile ON usage_events(reconciliation_key);
CREATE INDEX IF NOT EXISTS idx_usage_events_request ON usage_events(billing_owner, request_id);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT,
  limit_id TEXT NOT NULL,
  label TEXT NOT NULL,
  metric_kind TEXT NOT NULL,
  used_value REAL,
  limit_value REAL,
  used_percent REAL,
  remaining_value REAL,
  window_duration_seconds INTEGER,
  resets_at TEXT,
  source_kind TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  source_authority TEXT NOT NULL,
  freshness_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_latest ON quota_snapshots(provider, limit_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS connector_health (
  connector_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  last_success TEXT,
  last_attempt TEXT NOT NULL,
  expected_refresh_seconds INTEGER,
  message TEXT
);

CREATE TABLE IF NOT EXISTS daily_rollups (
  local_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  provider TEXT NOT NULL,
  surface TEXT NOT NULL,
  billing_owner TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  provider_cost REAL NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(local_date, timezone, provider, surface, billing_owner, model)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  provider TEXT,
  metric_key TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold REAL NOT NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 3600,
  created_at TEXT NOT NULL
);
