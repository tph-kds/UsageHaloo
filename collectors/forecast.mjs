#!/usr/bin/env node
/**
 * Deterministic, explainable forecast engine (no LLM).
 * - EWMA burn-rate → quota exhaustion ETA + projected-at-reset %.
 * - Spend forecast from daily rollups.
 * - Visually distinct from observations: callers must label "Projected".
 * - Suppressed when data stale or sample count below minimum.
 */
export function ewma(values, alpha = 0.35) {
  if (!values.length) return 0;
  let m = values[0];
  for (let i = 1; i < values.length; i++) m = alpha * values[i] + (1 - alpha) * m;
  return m;
}
/** Quota exhaustion forecast. Returns null when suppressed. */
export function forecastQuota({ usedPercent, resetsAtIso, recentBurnPerHour, minSamples = 3, nowIso = null }) {
  const samples = (recentBurnPerHour || []).filter((v) => Number.isFinite(v) && v >= 0);
  if (samples.length < minSamples) return { suppressed: true, reason: 'insufficient_samples' };
  if (usedPercent == null || !resetsAtIso) return { suppressed: true, reason: 'no_quota' };
  const now = nowIso ? new Date(nowIso) : new Date();
  const reset = new Date(resetsAtIso);
  const hoursLeft = Math.max(0, (reset - now) / 3600e3);
  if (!Number.isFinite(hoursLeft) || hoursLeft <= 0) return { suppressed: true, reason: 'window_expired' };
  const burn = ewma(samples);
  const projected = usedPercent + burn * hoursLeft;
  const etaHours = burn > 0 ? Math.max(0, (100 - usedPercent) / burn) : Infinity;
  return {
    suppressed: false, method: 'ewma', alpha: 0.35,
    burn_per_hour: Number(burn.toFixed(3)),
    projected_at_reset: Number(projected.toFixed(1)),
    eta_hours: Number.isFinite(etaHours) ? Number(etaHours.toFixed(1)) : null,
    eta_minutes: Number.isFinite(etaHours) ? Math.round(etaHours * 60) : null,
    label: Number.isFinite(etaHours) && etaHours <= hoursLeft ? `Likely to hit limit in ~${Math.round(etaHours * 60)} min` : `Projected at reset: ${projected.toFixed(0)}%`,
  };
}
/** Spend forecast from daily costs. */
export function forecastSpend(dailyCosts, daysInMonth = 30, dayOfMonth = 15) {
  const vals = (dailyCosts || []).filter((v) => Number.isFinite(v) && v >= 0);
  if (vals.length < 3) return { suppressed: true, reason: 'insufficient_samples' };
  const avg = ewma(vals);
  const projected = avg * daysInMonth;
  return { suppressed: false, method: 'ewma', daily_avg: Number(avg.toFixed(2)), projected_month: Number(projected.toFixed(2)), label: `On pace for $${projected.toFixed(2)} this month` };
}
