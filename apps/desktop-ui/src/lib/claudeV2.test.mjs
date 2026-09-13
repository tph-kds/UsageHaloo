// Phase B1 unit 2: rule examples for claudeV2Snapshot()/claudeV2FromRecord()
// in prototype/server.mjs (mirror of connectors/claude-code/src/lib.rs).
// Local copy of the pure mapping: server.mjs binds its HTTP port on import,
// so it cannot be imported here without side effects; live behavior of the
// real builder is proven via curl against /api/snapshot instead.
const STALE_MS = 24 * 60 * 60 * 1000;
const KNOWN = [['five_hour', '5-hour limit'], ['seven_day', '7-day limit']];

function mapWindows(rateLimits) {
  const windows = [];
  let invalid = false;
  if (rateLimits != null && typeof rateLimits === 'object') {
    for (const [id, label] of KNOWN) {
      const w = rateLimits[id];
      if (w == null || typeof w !== 'object' || w.used_percentage == null) continue;
      const used = Number(w.used_percentage);
      if (!Number.isFinite(used) || used < 0 || used > 100) { invalid = true; continue; }
      windows.push({ id, label, used_fraction: used / 100, source_metric_id: id });
    }
  }
  return { windows, invalid };
}

function gate(nowMs, observedMs, record) {
  if (nowMs - observedMs > STALE_MS) return { health_state: 'stale', windows: [] };
  const { windows, invalid } = mapWindows(record?.rate_limits);
  if (invalid) return { health_state: 'error', windows };
  if (windows.length === 0) return { health_state: 'unavailable', windows };
  return { health_state: 'live', windows };
}

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL ${name}: expected ${e}, got ${a}`);
  } else {
    console.log(`ok ${name}`);
  }
}

// Fraction mapping with literal spool values.
const live = mapWindows({ five_hour: { used_percentage: 73 }, seven_day: { used_percentage: 21 } });
check('five_hour 73 -> 0.73', live.windows.find((w) => w.id === 'five_hour')?.used_fraction, 0.73);
check('seven_day 21 -> 0.21', live.windows.find((w) => w.id === 'seven_day')?.used_fraction, 0.21);
check('live window count', live.windows.length, 2);

// Out-of-range drops the window and flags error, never clamps.
const oor = mapWindows({ five_hour: { used_percentage: 150 }, seven_day: { used_percentage: 21 } });
check('out-of-range flags invalid', oor.invalid, true);
check('out-of-range drops five_hour', oor.windows.some((w) => w.id === 'five_hour'), false);
check('out-of-range keeps seven_day', oor.windows.some((w) => w.id === 'seven_day'), true);
const neg = mapWindows({ five_hour: { used_percentage: -5 } });
check('negative flags invalid', neg.invalid, true);
check('negative yields zero windows', neg.windows.length, 0);

// Unknown extra window keys are ignored.
const unk = mapWindows({
  five_hour: { used_percentage: 73 },
  seven_day: { used_percentage: 21 },
  ten_hour: { used_percentage: 50 },
});
check('unknown key ignored', unk.windows.some((w) => w.id === 'ten_hour'), false);
check('known windows kept', unk.windows.length, 2);

// Stale gate at the 24h boundary with a fixed now.
const NOW = Date.parse('2026-09-14T12:00:00.000Z');
const rec = { rate_limits: { five_hour: { used_percentage: 73 }, seven_day: { used_percentage: 21 } } };
check('exactly 24h is not stale', gate(NOW, NOW - STALE_MS, rec).health_state, 'live');
const over = gate(NOW, NOW - STALE_MS - 1000, rec);
check('24h+1s is stale', over.health_state, 'stale');
check('stale carries zero windows', over.windows.length, 0);

// No quota windows in payload -> unavailable, never fabricated.
check('empty rate_limits unavailable', gate(NOW, NOW - 1000, { rate_limits: {} }).health_state, 'unavailable');
check('missing rate_limits unavailable', gate(NOW, NOW - 1000, {}).health_state, 'unavailable');

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('all claudeV2 assertions passed');
