/**
 * Tailwind theme — the color/radius values come from packages/ui's token
 * files (single source of truth: the same JSON files the tokens module
 * exports to TypeScript code). Screen classes (`bg-canvas`, `text-ink`,
 * `rounded-md`, …) are defined by this mapping, never by raw hex values
 * (component-guidelines: no raw hex colors / magic pixels outside tokens).
 */
const colors = require('../../packages/ui/src/tokens/colors.json');
const radii = require('../../packages/ui/src/tokens/radii.json');

module.exports = {
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
    '../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: colors.canvas,
        'canvas-dark': colors.canvasDark,
        surface: colors.surface,
        'surface-dark': colors.surfaceDark,
        ink: colors.ink,
        'ink-dark': colors.inkDark,
        muted: colors.muted,
        'muted-dark': colors.mutedDark,
        accent: colors.accent,
        'accent-dark': colors.accentDark,
        'on-accent': colors.onAccent,
        'on-accent-dark': colors.onAccentDark,
        danger: colors.danger,
        'danger-dark': colors.dangerDark,
        warning: colors.warning,
        'warning-dark': colors.warningDark,
        border: colors.border,
        'border-dark': colors.borderDark,
      },
      borderRadius: {
        sm: radii.sm,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
        '2xl': radii['2xl'],
        full: radii.full,
      },
    },
  },
  plugins: [],
};
