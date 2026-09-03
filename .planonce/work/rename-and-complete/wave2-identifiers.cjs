// Wave 2: identifier rename (one-way doors).
//
// Per PLAN.md Wave 2:
//   - Tauri bundle id           dev.viusagever.app   -> dev.usagehalo.app
//   - Crate name                viusagever-desktop   -> usage-halo-desktop
//   - Lib name                  viusagever_desktop_lib -> usage_halo_lib
//   - npm package name          viusagever-desktop-ui -> usage-halo-desktop-ui
//   - Bridge file rename        viusage-claude-bridge.mjs -> usage-halo-claude-bridge.mjs
//   - Cargo.toml workspace.repository URL: viusagever -> usagehalo
//
// After this script, the residual old-name scan must return 0 in any
// non-.planonce file (or only the new path `~/.viusagever/` if the user
// explicitly asks to keep the old spool path; for Wave 2 we keep the old
// path as the legacy-import source and the new path `~/.usagehalo/` is
// the new canonical write target, but that update happens in Wave 6).

const fs = require('node:fs');
const path = require('node:path');

const root = 'H:/SideProjects/UsageHaloo';

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, data) { fs.writeFileSync(p, data, 'utf8'); }

// 1. apps/desktop-ui/src-tauri/tauri.conf.json: bundle identifier.
const tauriConf = path.join(root, 'apps/desktop-ui/src-tauri/tauri.conf.json');
let t = read(tauriConf);
if (!/dev\.usagehalo\.app/.test(t)) {
  t = t.replace(/"dev\.viusagever\.app"/g, '"dev.usagehalo.app"');
  write(tauriConf, t);
  console.log('tauri.conf.json: identifier -> dev.usagehalo.app');
}

// 2. apps/desktop-ui/src-tauri/Cargo.toml: crate + lib name + description (description already renamed in Wave 1).
const tauriCargo = path.join(root, 'apps/desktop-ui/src-tauri/Cargo.toml');
t = read(tauriCargo);
if (/viusagever-desktop/.test(t)) {
  t = t.replace(/viusagever-desktop/g, 'usage-halo-desktop')
       .replace(/viusagever_desktop_lib/g, 'usage_halo_lib');
  write(tauriCargo, t);
  console.log('src-tauri/Cargo.toml: package + lib name renamed');
}

// 3. apps/desktop-ui/src-tauri/src/main.rs: lib call.
const tauriMain = path.join(root, 'apps/desktop-ui/src-tauri/src/main.rs');
t = read(tauriMain);
if (/viusagever_desktop_lib/.test(t)) {
  t = t.replace(/viusagever_desktop_lib/g, 'usage_halo_lib');
  write(tauriMain, t);
  console.log('src-tauri/src/main.rs: lib call renamed');
}

// 4. apps/desktop-ui/package.json: npm package name.
const pkg = path.join(root, 'apps/desktop-ui/package.json');
t = read(pkg);
if (/viusagever-desktop-ui/.test(t)) {
  t = t.replace(/viusagever-desktop-ui/g, 'usage-halo-desktop-ui');
  write(pkg, t);
  console.log('apps/desktop-ui/package.json: name renamed');
}

// 5. workspace Cargo.toml: repository URL.
const wsCargo = path.join(root, 'Cargo.toml');
t = read(wsCargo);
if (/example\.invalid\/viusagever/.test(t)) {
  t = t.replace(/example\.invalid\/viusagever/g, 'example.invalid/usagehalo');
  write(wsCargo, t);
  console.log('workspace Cargo.toml: repository URL updated');
}

// 6. Bridge file rename + path.
// 6a. Rename the file.
const oldBridge = path.join(root, 'connectors/claude-code/scripts/viusage-claude-bridge.mjs');
const newBridge = path.join(root, 'connectors/claude-code/scripts/usage-halo-claude-bridge.mjs');
if (fs.existsSync(oldBridge)) {
  fs.renameSync(oldBridge, newBridge);
  console.log('renamed bridge file: viusage-claude-bridge.mjs -> usage-halo-claude-bridge.mjs');
}

// 6b. Update header comment + log prefix + filename references inside the bridge.
t = read(newBridge);
t = t.replace(/viusagever/gi, 'usagehalo');
t = t.replace(/usage-halo-claude-bridge/g, 'usage-halo-claude-bridge');
write(newBridge, t);
console.log('bridge file: text + filename updated');

// 6c. Update any reference to the old filename elsewhere in the repo.
// (None expected; the old filename was internal to the connectors/ dir.)
// We still scan to be safe.
const oldRefs = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '.serena' || e.name === '.planonce') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (['.md','.ts','.svelte','.js','.mjs','.py','.rs','.toml','.json','.yml','.yaml','.html','.css','.sh','.txt','.example','.conf'].includes(ext)) {
        try {
          const c = fs.readFileSync(p, 'utf8');
          if (/viusage-claude-bridge/.test(c)) oldRefs.push(p);
        } catch {}
      }
    }
  }
}
walk(root);
if (oldRefs.length) {
  for (const p of oldRefs) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/viusage-claude-bridge/g, 'usage-halo-claude-bridge');
    fs.writeFileSync(p, c, 'utf8');
  }
  console.log('updated', oldRefs.length, 'files that referenced the old bridge filename');
}

console.log('Wave 2 done.');
