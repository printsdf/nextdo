/**
 * Side-effect CSS imports (app/global.css, consumed by the NativeWind metro
 * transformer). `expo-env.d.ts` (the `expo/types` reference) is deliberately
 * not part of this app's tsconfig — this is the minimal declaration that
 * keeps `import '../global.css'` type-checking.
 */
declare module '*.css';
