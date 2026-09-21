/**
 * Design tokens (design.md §5: `tokens/` — colors, spacing, radii,
 * typography). The raw values live in JSON so the app's tailwind.config.js
 * can consume the SAME files (single source of truth, no build step for the
 * packages — packages export TypeScript source directly, design.md §1).
 *
 * NativeWind class names are built from the theme the app maps onto these
 * tokens (`bg-canvas`, `rounded-md`, …). `spacing.touch` is the minimum
 * tappable size (component-guidelines: touch targets ≥ 44×44 pt).
 */
import colorsJson from './colors.json';
import radiiJson from './radii.json';
import spacingJson from './spacing.json';
import typographyJson from './typography.json';

// `resolveJsonModule` already infers literal types from the JSON files, so no
// `as const` is needed (a const assertion on an import binding is a TS error).
export const colors = colorsJson;
export const radii = radiiJson;
export const spacing = spacingJson;
export const typography = typographyJson;

export type ColorToken = keyof typeof colors;
export type RadiusToken = keyof typeof radii;
export type SpacingToken = keyof typeof spacing;
export type TypographyToken = keyof typeof typography;
