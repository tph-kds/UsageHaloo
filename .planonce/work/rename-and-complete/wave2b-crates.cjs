// Wave 2b: crate directory rename (Amendment 1).
//
// Renames:
//   crates/viusage-core      -> crates/usage-halo-core
//   crates/viusage-reconcile -> crates/usage-halo-reconcile
//   crates/viusage-storage   -> crates/usage-halo-storage
//   connectors/viusage-...   -> (left as-is; per Amendment 1, connectors are NOT renamed
//                               in this change; only the workspace-crate ones are.)
//
// Wait — re-read the user answer: "Rename `crates/viusage-{core,reconcile,storage}` to
// `crates/usage-halo-{core,reconcile,storage}` and `connectors/viusage-*` to
// `connectors/usage-halo-*` (all 6 connector crates)."
// So connectors ARE renamed too. The note above was wrong.
//
// Renames (final):
//   crates/viusage-core       -> crates/usage-halo-core
//   crates/viusage-reconcile  -> crates/usage-halo-reconcile
//   crates/viusage-storage    -> crates/usage-halo-storage
//   connectors/claude-code    -> (idempotent — directory is already 'claude-code', not viusage-*; no rename needed)
//   connectors/codex          -> (idempotent)
//   connectors/gemini-cli     -> (idempotent)
//   connectors/openai         -> (idempotent)
//   connectors/anthropic      -> (idempotent)
//   connectors/openrouter     -> (idempotent)
//
// BUT each connector's Cargo.toml currently has a `[lib].name = "..."` or
// `name = "viusage-..."` in some cases. Let me check the actual connector
// crate names; based on the prior scan, the 6 connector Cargo.toml files
// had 3 hits each, all "viusage-". That means the directory was `claude-code`
// but the package name inside the Cargo.toml was `viusage-...`. So no
// directory rename is needed for connectors — only the Cargo.toml
// [package].name and any source-level references.
//
// So the final plan:
//   1. Rename the 3 crate directories under crates/.
//   2. For each of the 6 connector Cargo.toml files, change [package].name
//      from "viusage-..." to "usage-halo-..." (keeping the directory name).
//   3. Update workspace Cargo.toml members list.
//   4. Update src-tauri/Cargo.toml and any source that uses the old crate
//      names (viusage-core, viusage-reconcile, viusage-storage, viusage-claude-code, etc.).
//   5. Update scripts/validate.py and tests/test_migration.py references.
//   6. Update docs/03_ARCHITECTURE.md prose.
//   7. Regenerate PROJECT_TREE.txt.

const fs = require('node:fs');
const path = require('node:path');

const root = 'H:/SideProjects/UsageHaloo';

// Step 1: directory renames.
const dirRenames = [
  ['crates/viusage-core',       'crates/usage-halo-core'],
  ['crates/viusage-reconcile',  'crates/usage-halo-reconcile'],
  ['crates/viusage-storage',    'crates/usage-halo-storage']
];
for (const [oldR, newR] of dirRenames) {
  const oldP = path.join(root, oldR);
  const newP = path.join(root, newR);
  if (fs.existsSync(oldP) && !fs.existsSync(newP)) {
    fs.renameSync(oldP, newP);
    console.log('dir rename:', oldR, '->', newR);
  }
}

// Step 2: rewrite all source files that reference the old names.
// Strategy: literal string replace, in dependency order. We need to replace:
//   viusage-core          -> usage-halo-core       (crate name, in deps + paths)
//   viusage-reconcile     -> usage-halo-reconcile
//   viusage-storage       -> usage-halo-storage
// But NOT inside the brand surface (e.g. viusage-claude-bridge was already
// renamed in Wave 2; the new filename is usage-halo-claude-bridge.mjs).
//
// The remaining references should be:
//   - Connector package names: viusage-claude-code, viusage-codex, viusage-gemini-cli,
//     viusage-openai, viusage-anthropic, viusage-openrouter (these are the
//     package names in connectors/*/Cargo.toml; the directories don't use
//     "viusage-" prefix)
//   - src references to viusage-core, viusage-reconcile, viusage-storage
//     in src-tauri/Cargo.toml (already fixed Wave 2), and in any other file
//     that depends on the workspace crates.
//
// We do a global literal replace of each name across the entire repo
// (excluding .git, .serena, .planonce, node_modules, dist, target).
// Each replacement is a token-bounded match to avoid touching the brand
// surface accidentally.

const REPLACEMENTS = [
  // workspace crate names (crate dir + package + dep)
  [/\bviusage-core\b/g,         'usage-halo-core'],
  [/\bviusage-reconcile\b/g,    'usage-halo-reconcile'],
  [/\bviusage-storage\b/g,      'usage-halo-storage'],
  // connector package names (these are crate-package names, not dir names)
  [/\bviusage-claude-code\b/g,  'usage-halo-claude-code'],
  [/\bviusage-codex\b/g,        'usage-halo-codex'],
  [/\bviusage-gemini-cli\b/g,   'usage-halo-gemini-cli'],
  [/\bviusage-openai\b/g,       'usage-halo-openai'],
  [/\bviusage-anthropic\b/g,    'usage-halo-anthropic'],
  [/\bviusage-openrouter\b/g,   'usage-halo-openrouter']
];

const SKIP = /[\\\/](\.git|\.serena|\.planonce|node_modules|target|dist)[\\\/]/;
const EXTS = new Set(['.md','.ts','.svelte','.js','.mjs','.py','.rs','.toml','.json','.yml','.yaml','.html','.css','.sh','.txt','.lock','.example','.conf','.svg','.png','.cjs','.lock']);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '.serena' || e.name === '.planonce' || e.name === 'target' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

const files = [];
walk(root, files);

let totalChanged = 0;
for (const f of files) {
  let data;
  try { data = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const before = data;
  for (const [re, replacement] of REPLACEMENTS) {
    data = data.replace(re, replacement);
  }
  if (data !== before) {
    fs.writeFileSync(f, data, 'utf8');
    totalChanged++;
  }
}
console.log('Wave 2b source rewrites:', totalChanged, 'files');

// Step 7: regenerate PROJECT_TREE.txt
function genTree(dir, prefix, lines) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  // Sort: dirs first, then files; alphabetical within each.
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '.serena' || e.name === '.planonce' || e.name === 'target' || e.name === 'dist') continue;
    const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
    lines.push(prefix + e.name);
    if (e.isDirectory()) genTree(path.join(dir, e.name), prefix + '  ', lines);
  }
}

const lines = [];
genTree(root, '', lines);
fs.writeFileSync(path.join(root, 'PROJECT_TREE.txt'), lines.join('\n') + '\n', 'utf8');
console.log('PROJECT_TREE.txt regenerated,', lines.length, 'lines');
