#!/usr/bin/env node
/**
 * Alert engine: rule evaluation with cooldown + dedupe.
 * Rules: { id, provider?, metric_key, operator:'>='|'>', threshold, cooldown_seconds, enabled }.
 * State file keeps last_fired per rule id. Pure evaluate() is testable without I/O.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function evaluateRule(rule, value, nowMs = Date.now(), lastFiredMs = 0) {
  if (!rule || rule.enabled === false) return { fire: false, reason: 'disabled' };
  const hit = rule.operator === '>' ? value > rule.threshold : value >= rule.threshold;
  if (!hit) return { fire: false, reason: 'below_threshold' };
  const cooldownMs = (rule.cooldown_seconds ?? 3600) * 1000;
  if (nowMs - lastFiredMs < cooldownMs) return { fire: false, reason: 'cooldown' };
  return { fire: true, reason: 'threshold_hit' };
}
function stateFile() { return path.join(os.homedir(), '.usagehalo', 'store', 'alerts.json'); }
export function loadAlertState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
export function evaluateAll(rules, values, nowMs = Date.now()) {
  const state = loadAlertState();
  const fired = [];
  for (const r of rules) {
    const v = values[r.metric_key];
    if (v == null) continue;
    const res = evaluateRule(r, v, nowMs, state[r.id]?.last_fired ?? 0);
    if (res.fire) { fired.push({ rule: r.id, metric_key: r.metric_key, value: v, at: new Date(nowMs).toISOString() }); state[r.id] = { last_fired: nowMs }; }
  }
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {}
  return fired;
}
export const DEFAULT_RULES = [
  { id: 'claude-5h-80', provider: 'claude-code', metric_key: 'claude-code:primaryPercent', operator: '>=', threshold: 80, cooldown_seconds: 1800, enabled: true },
  { id: 'budget-month-80', provider: null, metric_key: 'budget:percent', operator: '>=', threshold: 80, cooldown_seconds: 21600, enabled: true },
];
