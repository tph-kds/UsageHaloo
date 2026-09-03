// Quick scan: list files containing TODO/FIXME/XXX/HACK/placeholder, plus pages.
const fs = require('node:fs');
const path = require('node:path');
const root = 'H:/SideProjects/UsageHaloo';
function walk(d, out) {
  const e = fs.readdirSync(d, { withFileTypes: true });
  for (const x of e) {
    if (x.name === 'node_modules' || x.name.startsWith('.git') || x.name === '.serena' || x.name === '.planonce') continue;
    const p = path.join(d, x.name);
    if (x.isDirectory()) walk(p, out);
    else {
      const ext = path.extname(x.name).toLowerCase();
      if (['.ts','.svelte','.js','.mjs','.py','.rs','.toml','.json','.html','.css','.md'].includes(ext)) {
        try {
          const c = fs.readFileSync(p, 'utf8');
          const m = c.match(/TODO|FIXME|XXX|HACK|placeholder/gi);
          if (m) out.push({ file: p.replace(root + path.sep, ''), hits: m.length });
        } catch {}
      }
    }
  }
}
const out = [];
walk(root, out);
out.sort((a,b) => b.hits - a.hits);
console.log('TODO/FIXME/placeholder files:');
for (const r of out.slice(0, 40)) console.log(r.hits.toString().padStart(3), r.file);
console.log('---');
console.log('Svelte pages / mock layers / live-data gaps:');
const pages = [
  'apps/desktop-ui/src/App.svelte',
  'apps/desktop-ui/src/main.ts',
  'apps/desktop-ui/src/lib/mock.ts',
  'apps/desktop-ui/src/lib/types.ts',
  'apps/desktop-ui/src/lib/components/EdgeRail.svelte',
  'apps/desktop-ui/src/lib/components/ProviderPopover.svelte',
  'apps/desktop-ui/src/lib/components/Heatmap.svelte',
  'apps/desktop-ui/src/lib/components/UsageRing.svelte',
  'apps/desktop-ui/src-tauri/src/lib.rs',
  'apps/desktop-ui/src-tauri/tauri.conf.json'
];
for (const f of pages) {
  const full = path.join(root, f);
  if (fs.existsSync(full)) {
    const c = fs.readFileSync(full, 'utf8');
    const hasMock = /mock|Mock/.test(c);
    const hasFetch = /fetch\(|invoke\(|invoke\('plugin:/.test(c);
    console.log(f, 'mock=' + hasMock, 'liveFetch=' + hasFetch, 'size=' + c.length);
  }
}
