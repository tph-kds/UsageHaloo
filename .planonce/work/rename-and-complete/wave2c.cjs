// Wave 2c: clean up the remaining `viusage-connector-*` package names.
const fs = require('node:fs');
const path = require('node:path');
const root = 'H:/SideProjects/UsageHaloo';
const SKIP = /[\\\/](\.git|\.serena|\.planonce|node_modules|target|dist)[\\\/]/;
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '.serena' || e.name === '.planonce' || e.name === 'target' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
}
const files = [];
walk(root, files);
const targets = [
  [/\bviusage-connector-anthropic\b/g,   'usage-halo-connector-anthropic'],
  [/\bviusage-connector-claude-code\b/g, 'usage-halo-connector-claude-code'],
  [/\bviusage-connector-codex\b/g,       'usage-halo-connector-codex'],
  [/\bviusage-connector-gemini-cli\b/g,  'usage-halo-connector-gemini-cli'],
  [/\bviusage-connector-openai\b/g,      'usage-halo-connector-openai'],
  [/\bviusage-connector-openrouter\b/g,  'usage-halo-connector-openrouter']
];
let changed = 0;
for (const f of files) {
  let data;
  try { data = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const before = data;
  for (const [re, repl] of targets) data = data.replace(re, repl);
  if (data !== before) { fs.writeFileSync(f, data, 'utf8'); changed++; }
}
console.log('Wave 2c:', changed, 'files');
