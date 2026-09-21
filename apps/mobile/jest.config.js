/**
 * Jest 29 (jest-expo preset).
 *
 * - `@/*` path alias (tsconfig "paths", also used by Metro via Expo).
 * - `.css` → stub: Metro/NativeWind process the real `global.css`; in the
 *   jest environment the style registration is irrelevant (components
 *   render unstyled — the smoke test never asserts styles).
 * - transformIgnorePatterns: the jest-expo preset default only allows
 *   react-native/expo through the babel transform. ESM-only dependencies
 *   (PowerSync's client packages, the react-navigation / standard-navigation
 *   bridge under expo-router 57, NativeWind's interop) must be transformed
 *   as well — same pnpm caveat as packages/db's jest config: the real files
 *   live under `node_modules/.pnpm/…/node_modules/<pkg>`, so the pattern
 *   also allows the `.pnpm` hop.
 */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '\\.css$': '<rootDir>/test/css-mock.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm|((jest-)?react-native|@react-native|@react-native-community|expo|@expo|react-navigation|@react-navigation|standard-navigation|nativewind|react-native-css-interop|@powersync|@journeyapps|comlink|kysely))',
  ],
};
