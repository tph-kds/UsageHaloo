// Phase A/A2: real/demo repository boundary. Default real, demo is
// explicit opt-in only (?demo=1 or localStorage flag). Run with:
//   node --experimental-strip-types src/lib/dataMode.test.mjs
import { register } from 'node:module';

// api.ts uses extensionless relative imports ('./mock', './contracts'),
// which Node ESM does not resolve; retry with a .ts extension.
register('data:text/javascript,export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.startsWith("./")||s.startsWith("../")){return await n(s+".ts",c)}throw e}}');

function makeWindow(search = '', stored = null) {
  const store = new Map();
  if (stored !== null) store.set('usagehalo.dataMode', stored);
  return {
    location: { search },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, v),
    },
  };
}

const { resolveAppDataMode, getRepository, RealProviderRepository, DemoProviderRepository } =
  await import('./dataMode.ts');

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

globalThis.window = makeWindow();
check('default mode is real', resolveAppDataMode(), 'real');

globalThis.window = makeWindow('?demo=1');
check('?demo=1 gives demo', resolveAppDataMode(), 'demo');

globalThis.window = makeWindow('', 'demo');
check('localStorage demo gives demo', resolveAppDataMode(), 'demo');

globalThis.window = makeWindow();
check('unrelated query stays real', resolveAppDataMode(), 'real');

check("getRepository('real').mode", getRepository('real').mode, 'real');
check("getRepository('demo') is DemoProviderRepository", getRepository('demo') === DemoProviderRepository, true);
check("getRepository('real') is RealProviderRepository", getRepository('real') === RealProviderRepository, true);

const demo = await DemoProviderRepository.fetch();
check('demo sampleData true', demo.sampleData, true);
check("demo source 'demo'", demo.source, 'demo');
check('demo serves providers', demo.providers.length > 0, true);

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('all dataMode assertions passed');
