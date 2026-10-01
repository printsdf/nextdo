/**
 * Metro config — three concerns:
 *
 * 1. Monorepo resolution: watch the whole repo (workspace packages are
 *    consumed as TypeScript source — design.md §1) and resolve their
 *    bare imports (react-native, …) from the app's node_modules.
 *
 * 2. NativeWind v4: the metro transformer turns `global.css` + the
 *    Tailwind theme into RN styles.
 *
 * 3. PowerSync v2 platform split (research/versions-powersync.md, official
 *    react-native-web demo's metro.config.js): the web SDK must resolve
 *    its RN export condition under Metro, and the OTHER platform's SDK is
 *    stubbed to an empty module (packages/db switches at runtime, so each
 *    bundle only ever needs its own SDK).
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(projectRoot, '..', 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionsByPlatform = {
  ...(config.resolver.unstable_conditionsByPlatform ?? {}),
  web: [...(config.resolver.unstable_conditionsByPlatform?.web ?? []), 'react-native-web'],
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    // The web/Tauri build uses @powersync/web; the RN SDK is never loaded.
    if (moduleName === '@powersync/react-native') {
      return { type: 'empty' };
    }
  } else if (moduleName === '@powersync/web') {
    // The native build uses @powersync/react-native; the web SDK (wasm +
    // worker) is never loaded.
    return { type: 'empty' };
  } else if (moduleName === '@tauri-apps/plugin-notification') {
    // The native build never instantiates the tauri adapter (platform
    // selection in lib/reminders/adapters) — stub the desktop-only
    // notification plugin (task 09-30) out of the native bundle.
    return { type: 'empty' };
  }
  // Ensure the default resolver still runs.
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
