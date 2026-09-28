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
console.log(`[nextdo-desktop] frontend-dist: ${src} -> ${dest}`);
