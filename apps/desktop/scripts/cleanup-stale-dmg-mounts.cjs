// Ejects stale DMG mounts left behind by a FAILED `tauri build` dmg step.
//
// Tauri ships Apple's bundle_dmg.sh, which builds the image as a temp
// file `bundle/macos/rw.$$.<name>.dmg`, mounts it with
// `hdiutil attach -mountrandom /Volumes` (yielding /Volumes/dmg.XXXXXX),
// and detaches only on its success paths. It installs no `trap`, so any
// failure in between leaks BOTH the mount point and the temp image.
// The next build then fails again, and the volumes accumulate.
//
// This runs before the build and clears exactly that leak signature.
// No-op off macOS, and never fails the build: a stale volume is a
// nuisance, not a reason to reject a working bundle.
//
// Runs with any cwd — all paths resolve relative to this file.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (os.platform() !== 'darwin') {
  process.exit(0);
}

const volumesDir = '/Volumes';

// Eject leftover `dmg.XXXXXX` mount points. `diskutil eject` is the
// supported spelling; `hdiutil detach` warns as deprecated.
for (const entry of fs.readdirSync(volumesDir)) {
  if (!/^dmg\.[A-Za-z0-9]+$/.test(entry)) continue;
  const mount = path.join(volumesDir, entry);
  try {
    execFileSync('diskutil', ['eject', 'force', mount], { stdio: 'ignore' });
    console.log(`[nextdo-desktop] ejected stale mount ${mount}`);
  } catch {
    console.warn(`[nextdo-desktop] could not eject ${mount} (skipping)`);
  }
}

// Drop the temp images those mounts were reading from. Without this,
// hdiutil resize/attach fails on an image that is still open.
const macosDir = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle', 'macos');
if (fs.existsSync(macosDir)) {
  for (const entry of fs.readdirSync(macosDir)) {
    if (!/^rw\.\d+\..*\.dmg$/.test(entry)) continue;
    fs.rmSync(path.join(macosDir, entry), { force: true });
    console.log(`[nextdo-desktop] removed stale image ${entry}`);
  }
}
