#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileDir = path.resolve(__dirname, '..');
const distDir = path.resolve(mobileDir, 'dist');
const publicDir = path.resolve(mobileDir, 'public');

console.log('[post-export-web] Post-processing Expo Web output for PWA...');

// 1. Copy all assets from public/ to dist/
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distDir, { recursive: true });
  console.log('[post-export-web] Copied public/ assets (manifest, sw.js, icons) into dist/');
}

// 2. Patch dist/index.html with PWA meta tags & Service Worker registration
const indexPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');

  // Replace or augment viewport for safe-area-inset
  if (html.includes('<meta name="viewport"')) {
    html = html.replace(
      /<meta name="viewport"[^>]*>/,
      '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1.00001, viewport-fit=cover, user-scalable=no" />'
    );
  } else {
    html = html.replace(
      '<head>',
      '<head>\n    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1.00001, viewport-fit=cover, user-scalable=no" />'
    );
  }

  // Inject PWA and iOS tags before </head>
  const pwaTags = `
    <!-- Nextdo PWA & iOS Safari Configuration -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Nextdo" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <meta name="theme-color" content="#0f202b" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="format-detection" content="telephone=no" />
    <style>
      :root {
        --sat: env(safe-area-inset-top);
        --sar: env(safe-area-inset-right);
        --sab: env(safe-area-inset-bottom);
        --sal: env(safe-area-inset-left);
      }
      html, body {
        background-color: #0f202b;
        overscroll-behavior-y: none;
        -webkit-touch-callout: none;
      }
      /* Prevent iOS tap highlight and pull-down reload on standalone */
      * {
        -webkit-tap-highlight-color: transparent;
      }
    </style>
    <script>
      if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/sw.js').then(function(reg) {
            console.log('[Nextdo PWA] Service Worker registered:', reg.scope);
          }).catch(function(err) {
            console.warn('[Nextdo PWA] Service Worker registration failed:', err);
          });
        });
      }
    </script>
  `;

  if (!html.includes('rel="manifest"')) {
    html = html.replace('</head>', `${pwaTags}\n</head>`);
  }

  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log('[post-export-web] Patched dist/index.html with PWA tags successfully.');
} else {
  console.warn('[post-export-web] dist/index.html not found, skipped patching.');
}

console.log('[post-export-web] Finished PWA post-processing.');
