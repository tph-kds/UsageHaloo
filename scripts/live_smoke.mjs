#!/usr/bin/env node
/**
 * Live-key smoke harness (read-only, opt-in).
 * For each credential-bearing connector: if the env key is present, perform
 * ONE read-only call and print a masked summary; otherwise print SKIP.
 * Never logs key material, never writes to the store.
 *
 * Run: USAGEHALO_LIVE_SMOKE=1 node scripts/live_smoke.mjs
 */
import { pollOpenRouterKey, pollOpenAIUsage, readOllama, readLMStudio } from '../collectors/pollers.mjs';

const masked = (r) => {
  const { live, reason = null, source = null, scope = null, freshness = null } = r;
  const extra = {};
  if (r.primaryPercent != null) extra.primaryPercent = r.primaryPercent;
  if (r.limit_remaining != null) extra.limit_remaining = 'present';
  if (r.tokens_window != null) extra.tokens_window = r.tokens_window;
  if (r.models_loaded) extra.models_loaded = r.models_loaded.length;
  return { live, reason, source, scope, freshness, ...extra };
};

const results = {};
results.openrouter = process.env.OPENROUTER_API_KEY
  ? masked(await pollOpenRouterKey())
  : { skipped: true, reason: 'no OPENROUTER_API_KEY' };
results.openai = process.env.OPENAI_API_KEY
  ? masked(await pollOpenAIUsage())
  : { skipped: true, reason: 'no OPENAI_API_KEY' };
results.ollama = masked(await readOllama());
results.lm_studio = masked(await readLMStudio());
console.log(JSON.stringify(results, null, 2));
