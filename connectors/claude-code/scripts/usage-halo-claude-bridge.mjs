#!/usr/bin/env node
/**
 * Claude Code statusLine bridge.
 *
 * Reads exactly one JSON payload from stdin, retains only approved telemetry,
 * and appends it to ~/.usagehalo/inbox/claude-code.jsonl.
 *
 * It intentionally does NOT store transcript_path, cwd, repository metadata,
 * prompt content or response content.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const raw = await new Promise((resolve, reject) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
  process.stdin.on('error', reject);
});

if (!raw.trim()) process.exit(0);

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.stderr.write('UsageHalo: invalid Claude statusLine JSON\n');
  process.exit(0);
}

const clean = {
  observed_at: new Date().toISOString(),
  session_id: input.session_id ?? null,
  version: input.version ?? null,
  model: input.model ? {
    id: input.model.id ?? null,
    display_name: input.model.display_name ?? null
  } : null,
  cost: input.cost ? {
    total_cost_usd: input.cost.total_cost_usd ?? null,
    total_duration_ms: input.cost.total_duration_ms ?? null
  } : null,
  context_window: input.context_window ? {
    total_input_tokens: input.context_window.total_input_tokens ?? null,
    total_output_tokens: input.context_window.total_output_tokens ?? null,
    context_window_size: input.context_window.context_window_size ?? null,
    used_percentage: input.context_window.used_percentage ?? null,
    remaining_percentage: input.context_window.remaining_percentage ?? null,
    current_usage: input.context_window.current_usage ? {
      input_tokens: input.context_window.current_usage.input_tokens ?? null,
      output_tokens: input.context_window.current_usage.output_tokens ?? null,
      cache_creation_input_tokens: input.context_window.current_usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: input.context_window.current_usage.cache_read_input_tokens ?? null
    } : null
  } : null,
  rate_limits: input.rate_limits ?? null,
  prompt_cache: input.prompt_cache ? {
    warm: input.prompt_cache.warm ?? null,
    hit_ratio: input.prompt_cache.hit_ratio ?? null,
    requests: input.prompt_cache.requests ?? null,
    misses: input.prompt_cache.misses ?? null
  } : null
};

const inbox = path.join(os.homedir(), '.usagehalo', 'inbox');
fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
fs.appendFileSync(path.join(inbox, 'claude-code.jsonl'), JSON.stringify(clean) + '\n', { mode: 0o600 });

// Keep Claude's status line visually minimal. A wrapper installer can compose
// this bridge with an existing statusLine command instead of replacing it.
const pct = clean.rate_limits?.five_hour?.used_percentage;
if (typeof pct === 'number') {
  process.stdout.write(`Halo ${Math.round(pct)}%`);
}
