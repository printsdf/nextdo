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
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
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
        'surface-container': colors.surfaceContainer,
        'surface-container-dark': colors.surfaceContainerDark,
        'secondary-fixed': colors.secondaryFixed,
        'secondary-fixed-dark': colors.secondaryFixedDark,
        'tag-earth-1-bg': colors['tag-earth-1-bg'],
        'tag-earth-1-text': colors['tag-earth-1-text'],
        'tag-earth-2-bg': colors['tag-earth-2-bg'],
        'tag-earth-2-text': colors['tag-earth-2-text'],
        'tag-earth-3-bg': colors['tag-earth-3-bg'],
        'tag-earth-3-text': colors['tag-earth-3-text'],
        'tag-earth-4-bg': colors['tag-earth-4-bg'],
        'tag-earth-4-text': colors['tag-earth-4-text'],
        'tag-earth-5-bg': colors['tag-earth-5-bg'],
        'tag-earth-5-text': colors['tag-earth-5-text'],
      },
      borderRadius: {
        sm: radii.sm,
        md: radii.md,
        lg: radii.lg,
        xl: radii.xl,
        '2xl': radii['2xl'],
        full: radii.full,
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans'],
        display: ['Epilogue'],
      },
    },
  },
  plugins: [],
};
