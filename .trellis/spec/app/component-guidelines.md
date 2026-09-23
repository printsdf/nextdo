# Component Guidelines

> How components are built in `apps/mobile` and `packages/ui`.

---

## Patterns

- Function components only. Named exports only (`export function ActionCard(...)`) —
  no default exports, **except** Expo Router route/layout files under
  `apps/mobile/app/**`, which must default-export (see project/conventions.md).
- **One component per file**, file name `kebab-case`, component name matches (file
  `action-card.tsx` → `export function ActionCard`).
- Presentational components receive data + callbacks as props; they never query the DB
  and never import from `packages/db`. Data flows in from hooks (see Hook Guidelines).
- Composition over configuration: prefer a `children` slot and small composable parts
  (`<Card>`, `<CardTitle>`) over a `variant` prop with 10 branches.
- Keep components reviewable in one pass — split into subcomponents or a hook once
  that stops being the case (~150 lines is a soft trigger for a look, not a limit).

## Props

- Props type is an `interface` named `<Component>Props`, defined and exported in the same file.
- Required props first; optional props default to `undefined`, not to values that hide mistakes.
- No `props: any`, no destructuring with silent fallbacks for required data.

## Styling (NativeWind)

- Styling is NativeWind class strings + design tokens from `packages/ui/tokens`
  (colors, spacing, radii, typography). **No raw hex colors, no magic pixel numbers**
  outside tokens.
- Dynamic classes: build the full class string (`cn()` helper in `packages/ui`) —
  NativeWind does not recognize classes assembled from partial fragments at runtime.
- Dark mode: class-based (`dark:` variant). Tokens are defined for both modes.
- Text styling: text color and typography classes (`text-*`, `font-*`) must be placed directly on `<Text>` elements, never on `<View>` containers (React Native native runtimes do not cascade text styles from View to Text).

## Lists

- Task/action lists render from a **bounded, pre-fetched** slice (the engine or a query
  already limits rows). No "load 500 rows then filter in `map`".
- `FlashList` only when scroll performance problems are observed on a large list;
  `FlatList` is the default otherwise (evidence-driven, not row-count-driven).
- Keys are stable entity `id`s — never array index.

## Accessibility

- Every tappable element: `accessibilityRole="button"` + `accessibilityLabel` that names
  the action and its object (`"Start focus session: run baseline"`).
- Touch targets ≥ 44×44 pt (use padding or `hitSlop` on compact visual elements, not smaller hit areas).
- Color is never the only state signal (due/overdue gets an icon or text, not just red).

## Forbidden

- `console.*`, `alert()`, direct network calls, direct SQLite access in components.
- Side effects in render (assignment, `setState` during render, subscription setup — use effects or the data layer).
- Business rules (clarify logic, skip counting, deadline math) in components — that belongs in `packages/core`.
