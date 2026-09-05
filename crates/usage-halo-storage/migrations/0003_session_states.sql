-- Phase 6A: session activity gauges.
--
-- Status-line snapshots (Claude Code) report *current* context usage, not
-- incremental consumption. Summing repeated snapshots as events would invent
-- tokens, so sessions live here as latest-known gauges keyed by session:
-- one row per (connector, session), upserted on each observation, expired
-- after 24h without an update. Projections read gauges for activity/model
-- detail; event totals never include them (no double count by construction).

CREATE TABLE IF NOT EXISTS session_states (
  connector TEXT NOT NULL,
  session_id TEXT NOT NULL,
  model TEXT,
  model_provider TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(connector, session_id)
);
CREATE INDEX IF NOT EXISTS idx_session_states_observed
  ON session_states(connector, observed_at);
