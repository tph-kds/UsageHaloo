#!/usr/bin/env node
// Phase D unit 0: secondary-provider honesty — instrumented_store rows are
// age-gated, never live-by-presence; down localhost endpoints stay unavailable
// with null numerics. Plain node, no deps. Exit nonzero on first failure.
import assert from 'node:assert/strict';
import { freshnessState, instrumentedOverlayState } from './scheduler.mjs';
import { readOllama, readLMStudio } from './local.mjs';

const DAY_MS = 86400 * 1000;

// 11-day-old instrumented row (the deepseek case: observed 2026-09-03, read
// 2026-09-14) is stale through the schedule policy ...
assert.equal(freshnessState('deepseek', 902343), 'stale');
// ... and the overlay gate keeps it non-live with stale freshness (values are
// retained as last-known-good by the caller, never promoted to live).
assert.deepEqual(instrumentedOverlayState('deepseek', 11 * DAY_MS), { live: false, freshness: 'stale' });

// Genuinely fresh row stays live — no behavior change for fresh data.
assert.equal(freshnessState('deepseek', 10), 'live');
assert.deepEqual(instrumentedOverlayState('deepseek', 10 * 1000), { live: true, freshness: 'live' });

// Future/negative/missing ages are unknown, never live.
assert.equal(freshnessState('deepseek', null), 'unknown');
assert.deepEqual(instrumentedOverlayState('deepseek', -1000), { live: false, freshness: 'unknown' });
assert.deepEqual(instrumentedOverlayState('deepseek', NaN), { live: false, freshness: 'unknown' });

// Unlisted schedule keys are unknown, never live.
assert.equal(freshnessState('litellm', 5), 'unknown');
assert.deepEqual(instrumentedOverlayState('litellm', 5 * 1000), { live: false, freshness: 'unknown' });

// Endpoints-down detection: connection refusal stays unavailable with null
// numerics (both localhost daemons are down on this machine).
const ollama = await readOllama();
assert.equal(Boolean(ollama.live), false);
assert.equal(ollama.primaryPercent ?? null, null);
assert.equal(ollama.secondaryPercent ?? null, null);
const lmstudio = await readLMStudio();
assert.equal(Boolean(lmstudio.live), false);
assert.equal(lmstudio.primaryPercent ?? null, null);
assert.equal(lmstudio.secondaryPercent ?? null, null);

console.log('secondary-honesty: all asserts passed');
