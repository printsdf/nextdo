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

## Forms (date/time)

- The user never hand-types an ISO string: date/time fields open the
  `DateTimePicker` modal (`apps/mobile/components/datetime-picker.tsx` —
  pure RN, identical on all platforms including web). The community native
  picker (`@react-native-community/datetimepicker`) renders NOTHING on web
  and must not be introduced — the web build is the desktop surface.
- Field values stay `'YYYY-MM-DD'` / `'HH:mm'` strings (the clarify-flow
  contract); the picker's defaults come from the app clock (`now` prop).

## ConnectGate (auth threshold, `apps/mobile/components/connect-gate.tsx`)

- The full-screen first-launch gate: rendered by the RootLayout while no
  owner token is stored, or after the startup pre-check rejected a stored
  token (prod-deploy R3). One input, one button, one inline error.
- Presentational by contract: NO `packages/db` imports, NO network calls.
  The RootLayout passes `onConnect`, which runs `fetchCredentialsOnce` +
  `setOwnerToken` and maps the outcome to user-facing copy (token 不正确 /
  连不上服务器). The gate never dismisses itself — the RootLayout's
  owner-token subscription is the single owner of the auth state machine
  and unmounts the gate on success.
- `initialError` carries the pre-submit state (e.g. 「token 无效，请重新输入」
  after a 401 pre-check); submit errors replace it inline, never throw.

## Tag (packages/ui)

- tone → palette (Paper Serenity solid warm fills, no alpha tints for
  neutral/accent/warning): neutral = `surface-container` + muted;
  accent = `secondary-fixed` + accent; warning = `tag-earth-3` amber;
  danger = danger tint.
- Optional `dot` (live-indicator dot, e.g. the 正在澄清 badge) and `count`
  (solid circular count badge, e.g. the 待处理 control).

## ContextChip / ProgressBar (packages/ui)

- `ContextChip` (`packages/ui/src/components/context-chip.tsx`): the single
  owner of the five earth-tone pairs (`tag-earth-N-bg/-text` in
  `colors.json`). Tone is chosen by the exported pure `contextTone(name)`
  (djb2 hash % 5) — deterministic, so user-created contexts get a stable
  color too. The tone class string is applied to the container **and** the
  `<Text>` (native runtimes do not cascade text styles). Two shapes: no
  `onPress` = read-only row chip (`accessibilityRole="text"`); with
  `onPress` = selector chip (role button, `active` adds an accent border,
  hitSlop gives a 44pt target around the 22px visual pill).
- `ProgressBar` (`packages/ui/src/components/progress-bar.tsx`): thin (h-1.5)
  fully-rounded bar — accent fill on a border-color track; `value` is a
  [0, 1] ratio clamped inside the component; exposes
  `accessibilityRole="progressbar"` + `accessibilityValue` (width is never
  the only signal).

## Forbidden

- `console.*`, `alert()`, direct network calls, direct SQLite access in components.
- Side effects in render (assignment, `setState` during render, subscription setup — use effects or the data layer).
- Business rules (clarify logic, skip counting, deadline math) in components — that belongs in `packages/core`.
