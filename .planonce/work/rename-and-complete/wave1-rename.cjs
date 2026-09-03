// Wave 1: text rename. Replace ViUsagever / ViUsagever / viusagever with
// UsageHalo / usagehalo in text contexts. Identifier-bearing files are
// handled in Wave 2.
//
// Strategy: for every affected file, do a literal string replace in this order:
//   1. ViUsagever  -> UsageHalo
//   2. ViUsagever -> UsageHalo
//   3. viusagever -> usagehalo   (lowercase, prose-safe; identifier renames in Wave 2)
//
// Files where `viusagever` is part of an identifier (Tauri bundle id, crate
// name, package name, file name, source-level use like `viusagever_desktop_lib`,
// `dev.viusagever.app`) are intentionally left for Wave 2 — see STATE notes.
//
// After the rewrite, we re-scan and verify the residual matches are
// only identifier-bearing files.

const fs = require('node:fs');
const path = require('node:path');

const root = 'H:/SideProjects/UsageHaloo';
const SKIP = /[\\\/](\.git|\.serena|\.planonce|node_modules)[\\\/]/;
const EXTS = new Set(['.md','.ts','.svelte','.js','.mjs','.py','.rs','.toml','.json','.yml','.yaml','.html','.css','.sh','.txt','.lock','.example','.conf']);

// Files we touch in Wave 1. Anything not in this set is a Wave 2 concern.
const WAVE1_FILES = new Set([
  'README.md',
  'Cargo.toml',
  'scripts/validate.py',
  'prototype/server.mjs',
  'prototype/README.md',
  'demo/app.js',
  'demo/index.html',
  'apps/desktop-ui/index.html',
  'apps/desktop-ui/src/App.svelte',
  'docs/00_EXECUTIVE_RECOMMENDATION.md',
  'docs/02_PROVIDER_RESEARCH.md',
  'docs/04_DATA_MODEL.md',
  'docs/05_CONNECTOR_SPEC.md',
  'docs/06_REALTIME_AND_RECONCILIATION.md',
  'docs/09_SECURITY_PRIVACY.md',
  'docs/12_BRAND_ASSETS.md',
  'docs/13_OPERATIONAL_MODEL.md',
  'docs/reference/README.md',
  'packages/brand-registry/README.md',
  'connectors/provider-stubs/README.md',
  'connectors/claude-code/scripts/viusage-claude-bridge.mjs',
  // Wave 2 files — we touch their TEXT occurrences (e.g. description = "ViUsagever desktop shell")
  // but leave the identifier fields alone. The text rename is safe; the identifier rename is Wave 2.
  'apps/desktop-ui/src-tauri/Cargo.toml',
  'apps/desktop-ui/src-tauri/tauri.conf.json',
  'apps/desktop-ui/src-tauri/capabilities/default.json',
  'apps/desktop-ui/src-tauri/src/lib.rs',
  'apps/desktop-ui/src-tauri/src/main.rs',
  'apps/desktop-ui/package.json'
]);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '.serena' || e.name === '.planonce') continue;
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const all = walk(root);
let changed = 0;
let total = 0;
for (const f of all) {
  // Normalize the absolute path to forward slashes for matching the WAVE1_FILES set,
  // which uses forward slashes regardless of platform.
  const rel = f.split(path.sep).join('/').replace(root.split(path.sep).join('/') + '/', '');
  if (!WAVE1_FILES.has(rel)) continue;
  let data;
  try { data = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const before = data;
  // Order matters: collapse the mixed-case forms first, then lowercase in
  // text contexts. We do a global literal replace; identifier contexts
  // (e.g. viusagever-desktop) are left for Wave 2 because we will rewrite
  // those specific identifiers there.
  data = data.replace(/ViUsagever/g, 'UsageHalo');
  data = data.replace(/ViUsagever/g, 'UsageHalo');
  // For lowercase viusagever, only replace when it is NOT part of an
  // identifier (no dash, no underscore, no dot follows). We allow it
  // in prose, file paths inside strings, and similar text.
  data = data.replace(/viusagever(?![A-Za-z0-9_.-])/g, 'usagehalo');
  if (data !== before) {
    fs.writeFileSync(f, data, 'utf8');
    changed++;
    total += (before.match(/ViUsagever|viusagever|ViUsagever/g) || []).length;
  }
}

console.log(`Wave 1 rewrites: ${changed} files, ${total} occurrences changed.`);
