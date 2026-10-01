// One-off asset generation (task 09-30): white 96x96 notification icon from
// the app icon (background → transparent, glyph → white). jimp-compact is a
// transitive pnpm dep; resolved from the store path on purpose.
import { pathToFileURL } from 'node:url';

const storePath =
  '/Users/printsdf/Research/projects/Nextdo/node_modules/.pnpm/jimp-compact@0.16.1/node_modules/jimp-compact/dist/jimp.js';
const mod = await import(pathToFileURL(storePath).href);
const Jimp = mod.default ?? mod;

const img = await Jimp.read('assets/icon.png');
const BG = [15, 32, 43]; // the #0f202b background
img.scan(0, 0, img.bitmap.width, img.bitmap.height, (_x, _y, i) => {
  const r = img.bitmap.data[i];
  const g = img.bitmap.data[i + 1];
  const b = img.bitmap.data[i + 2];
  const a = img.bitmap.data[i + 3];
  if (a === 0) return;
  const dr = r - BG[0];
  const dg = g - BG[1];
  const db = b - BG[2];
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const t = Math.max(0, Math.min(1, (dist - 24) / 60));
  img.bitmap.data[i] = 255;
  img.bitmap.data[i + 1] = 255;
  img.bitmap.data[i + 2] = 255;
  img.bitmap.data[i + 3] = Math.round(a * t);
});
img.resize(96, 96);
await img.write('assets/notification-icon.png');
console.log('wrote assets/notification-icon.png (96x96 white glyph)');
