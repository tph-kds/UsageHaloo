import { honestFraction, isUserVisibleValue, resolveHeadline } from './contracts.ts';

let failures = 0;
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok ${name}`);
  }
}

check('honestFraction(42,100,null)', honestFraction(42, 100, null), 0.42);
check('honestFraction(5,0,null)', honestFraction(5, 0, null), null);
check('honestFraction(null,null,0.42)', honestFraction(null, null, 0.42), 0.42);
check('honestFraction(42,100,1.5)', honestFraction(42, 100, 1.5), null);

const w = (id) => ({
  id, label: id, used: 1, limit: 10, remaining: 9, used_fraction: null,
  starts_at: null, resets_at: null, duration_minutes: null, source_metric_id: id,
});
const first = resolveHeadline([w('a'), w('b')], 'b');
const second = resolveHeadline([w('b'), w('a')], 'b');
check('resolveHeadline stability id', second?.source_metric_id, first?.source_metric_id);
check('resolveHeadline stability value', second?.source_metric_id, 'b');

check("isUserVisibleValue('stale')", isUserVisibleValue('stale'), true);
check("isUserVisibleValue('unsupported')", isUserVisibleValue('unsupported'), false);
check("isUserVisibleValue('demo')", isUserVisibleValue('demo'), false);

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('all contracts.v2 assertions passed');
