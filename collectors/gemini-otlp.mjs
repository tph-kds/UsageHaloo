#!/usr/bin/env node
/**
 * Gemini CLI OTLP receiver helpers (shared by prototype server).
 * Accepts two shapes on POST /v1/metrics:
 *  1. UsageHalo compact JSON: { metrics: [{ name?, model, type, value }] }
 *  2. OTLP/JSON subset: { resourceMetrics: [{ scopeMetrics: [{ metrics: [{
 *       name, sum/data?: { dataPoints: [{ attributes: [{key, value:{stringValue|intValue}}],
 *       asInt?, asDouble?, value? }]}}]}]}] }
 * Only `gemini_cli.token.usage` (+ GenAI `gen_ai.client.token.usage` input/
 * output) become events. Prompt/completion/message attributes are dropped
 * before normalization — never stored.
 */
import { normalizeGeminiOtlp } from './providers.mjs';

const TOKEN_METRIC_NAMES = new Set(['gemini_cli.token.usage', 'gen_ai.client.token.usage']);
const PROMPT_ATTR_PREFIXES = ['gen_ai.prompt.', 'gen_ai.completion.', 'gen_ai.system_instructions', 'gen_ai.tool.definitions'];
const ATTR_MODEL_KEYS = ['model', 'gen_ai.request.model', 'gen_ai.response.model'];
const ATTR_TYPE_KEYS = ['type', 'gen_ai.token.type'];

function attrString(attrs, keys) {
  for (const k of keys) {
    const a = attrs.find((x) => x?.key === k);
    const v = a?.value?.stringValue ?? a?.value?.strValue ?? (typeof a?.value === 'string' ? a.value : null);
    if (typeof v === 'string' && v) return v;
  }
  return null;
}
function attrNumber(dp) {
  const v = dp?.asInt ?? dp?.asDouble ?? dp?.value?.intValue ?? dp?.value?.doubleValue ?? dp?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isPromptAttr(key) {
  return PROMPT_ATTR_PREFIXES.some((p) => key === p || key.startsWith(p));
}

/** Parse a request body (already JSON-parsed) into canonical Gemini events. */
export function ingestOtlpMetrics(body, observedAt = null) {
  const events = [];
  if (Array.isArray(body?.metrics)) {
    for (const m of body.metrics) {
      if (m?.model == null || m?.type == null || m?.value == null) continue;
      if (typeof m.model === 'string' && typeof m.type === 'string') {
        const e = normalizeGeminiOtlp({ model: m.model.slice(0, 128), type: m.type, value: Number(m.value) || 0 }, observedAt);
        if (e) events.push(e);
      }
    }
    return { events, shape: 'compact' };
  }
  const rms = body?.resourceMetrics;
  if (!Array.isArray(rms)) return { events, shape: 'unknown' };
  for (const rm of rms) {
    for (const sm of rm?.scopeMetrics || rm?.scope_metrics || []) {
      for (const metric of sm?.metrics || []) {
        if (!TOKEN_METRIC_NAMES.has(metric?.name)) continue;
        const points = metric?.sum?.dataPoints || metric?.sum?.data_points || metric?.data?.dataPoints || metric?.data?.data_points || [];
        for (const dp of points) {
          const attrs = Array.isArray(dp?.attributes) ? dp.attributes.filter((a) => !isPromptAttr(a?.key || '')) : [];
          const model = attrString(attrs, ATTR_MODEL_KEYS) || 'unknown';
          const type = attrString(attrs, ATTR_TYPE_KEYS) || 'input';
          const value = attrNumber(dp);
          if (value == null) continue;
          const e = normalizeGeminiOtlp({ model, type, value }, observedAt);
          if (e) events.push(e);
        }
      }
    }
  }
  return { events, shape: 'otlp-json' };
}
