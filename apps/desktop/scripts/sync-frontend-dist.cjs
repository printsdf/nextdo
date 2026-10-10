// Copies the @nextdo/mobile web export (apps/mobile/dist) into
// src-tauri/frontend-dist so Tauri bundles it as a resource
// (see tauri.conf.json `beforeBuildCommand` + `bundle.resources`).
//
// Lives in a file instead of a `node -e "..."` one-liner because the
// beforeBuildCommand must stay parseable by BOTH unix shells and
// Windows cmd.exe (no quoting is safe in both).
//
// Runs with any cwd — all paths resolve relative to this file.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// apps/desktop (this file's parent directory)
const desktop = path.join(__dirname, '..');
const src = path.join(desktop, '..', 'mobile', 'dist');
const dest = path.join(desktop, 'src-tauri', 'frontend-dist');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`[nextdo-desktop] missing web export: ${src}`);
  console.error('[nextdo-desktop] run `pnpm --filter @nextdo/mobile exec expo export --platform web` first');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

// --- flatten the deep `assets/__node_modules/...` tree -------------------
// Metro names node_modules assets (fonts, expo-router icons) after their
// REAL path through pnpm's virtual store, e.g.
//   assets/__node_modules/.pnpm/@expo-google-fonts+...@0.4.2/node_modules/...
// On Windows the full bundled path exceeds MAX_PATH (260) and NSIS aborts
// the installer build with "failed opening file". Every asset filename
// carries a content hash and is therefore unique, so each leaf is hoisted
// into assets/deps/ and the references in the JS bundles are rewritten.
// (Only the desktop copy `dest` is modified; the web export in `src` is
//  left untouched — browsers have no path-length limit.)
const deepRoot = path.join(dest, 'assets', '__node_modules');
if (fs.existsSync(deepRoot)) {
  const flatDir = path.join(dest, 'assets', 'deps');
  fs.mkdirSync(flatDir, { recursive: true });
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  const rewrites = [];
  const seen = new Set();
  for (const file of walk(deepRoot)) {
    const base = path.basename(file);
    if (seen.has(base)) {
      console.error(`[nextdo-desktop] asset name collision while flattening: ${base}`);
      process.exit(1);
    }
    seen.add(base);
    const rel = path.relative(deepRoot, file).split(path.sep).join('/');
    fs.renameSync(file, path.join(flatDir, base));
    rewrites.push([`__node_modules/${rel}`, `deps/${base}`]);
  }
  fs.rmSync(deepRoot, { recursive: true, force: true });

  // Rewrite references in every text asset that still mentions the old tree.
  for (const file of walk(dest)) {
    if (!/\.(js|mjs|html|json|css)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('__node_modules')) continue;
    let out = text;
    for (const [oldRef, newRef] of rewrites) {
      out = out.split(oldRef).join(newRef);
    }
    if (out !== text) fs.writeFileSync(file, out);
  }
  console.log(`[nextdo-desktop] flattened ${rewrites.length} node_modules assets into assets/deps/`);
}

// --- prune unused wa-sqlite WASM variants ---------------------------------
// @powersync/web ships FOUR SQLite wasm builds and picks one at runtime:
//   mc-wa-sqlite-async / mc-wa-sqlite  — the `mc` (multi-connection) builds,
//     loaded ONLY when an encryptionKey is set.
//   wa-sqlite-async                    — loaded by IDBBatchAtomicVFS.
//   wa-sqlite                          — loaded by the OPFS-based VFSes.
// This app constructs WASQLiteOpenFactory with `{ dbFilename, worker }` only
// (packages/db/src/powersync.ts), so resolveAndValidateOptions() keeps its
// defaults: encryptionKey=undefined and vfs=IDBBatchAtomicVFS. That path loads
// `wa-sqlite-async` and NOTHING else — on every platform, since neither the
// vfs nor the encryption key is browser-dependent. The other three (~4.7 MB,
// plus their loader chunks) are dead weight in the desktop bundle, so drop
// them. Keep rule ordering: `mc-` first (its async build also contains the
// `wa-sqlite-async` substring), then keep async, then drop the sync fallback.
const isWaSqlite = (base) => /^(mc-)?wa-sqlite/.test(base) && /\.(wasm|js|mjs)$/.test(base);
const shouldKeep = (base) => !base.startsWith('mc-wa-sqlite') && base.includes('wa-sqlite-async');
const walkAll = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walkAll(path.join(dir, e.name)) : [path.join(dir, e.name)],
      )
    : [];
let prunedBytes = 0;
let prunedCount = 0;
for (const file of walkAll(dest)) {
  const base = path.basename(file);
  if (!isWaSqlite(base) || shouldKeep(base)) continue;
  prunedBytes += fs.statSync(file).size;
  fs.rmSync(file);
  prunedCount += 1;
}
if (prunedCount > 0) {
  console.log(
    `[nextdo-desktop] pruned ${prunedCount} unused wa-sqlite files (${(prunedBytes / 1048576).toFixed(1)} MB); kept wa-sqlite-async`,
  );
}

console.log(`[nextdo-desktop] frontend-dist: ${src} -> ${dest}`);
