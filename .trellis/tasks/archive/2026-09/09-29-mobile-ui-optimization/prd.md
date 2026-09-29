# Mobile UI/UX Ergonomics and Usability Optimization

## Goal

Resolve critical layout and usability defects across the Nextdo Expo mobile app: Safe Area insets (status bar & home indicator), missing ScrollViews on overflowing screens, keyboard avoidance on input forms, date picker UX consistency, and bottom tab bar iconography.

## Requirements

### R1: Safe Area Insets & Status Bar
- Wrap the app in `SafeAreaProvider` at the root layout level (`app/_layout.tsx`).
- Configure `expo-status-bar` so the status bar style (`light` / `dark`) adapts to `colorScheme`.
- Provide safe area top padding across all tab screens (`now`, `inbox`, `projects`, `review`, `settings`) and modal/detail screens (`projects/[id]`, `focus/[id]`, `clarify/[inboxId]`, `reclarify/[id]`) so headers and navigation buttons never overlap with the notch, Dynamic Island, or status bar.
- Update `(tabs)/_layout.tsx` so the tab bar dynamically handles bottom safe area insets (home indicator) rather than using a static cramped 52pt height.
- In `SnoozeSheet` (`components/snooze-sheet.tsx`), add safe area bottom padding to the bottom sheet container to prevent the "取消" button from overlapping the system gesture bar.

### R2: Scroll Container & Overflow Fixes
- `NowScreen` (`app/(tabs)/now.tsx`): Replace the rigid unscrollable `View` with a `ScrollView` (`keyboardShouldPersistTaps="handled"`) containing the EngineContextBar, StatsCell row, Recommendation Hero Card, primary/secondary action buttons, context chips filter, eligible action rows, and today's habit strip.
- `ProjectDetailScreen` (`app/projects/[id].tsx`): Wrap screen content in a `ScrollView` so projects with multiple actions, open edit forms, or add-action forms can be scrolled smoothly without content truncation.
- `InboxScreen` (`app/(tabs)/inbox.tsx`): Move the static "GTD 澄清心法" card into `FlatList`'s `ListFooterComponent` so the whole screen scrolls naturally without a pinned card consuming vertical space.

### R3: Keyboard Avoidance
- In `ProjectsScreen` (`app/(tabs)/projects.tsx`), `ProjectDetailScreen` (`app/projects/[id].tsx`), and `SettingsScreen` (`app/(tabs)/settings.tsx`), ensure text inputs and submit buttons remain visible when the on-screen keyboard is active (using `KeyboardAvoidingView` / scrollable containers with `keyboardShouldPersistTaps="handled"`).

### R4: Date Picker UX Unification
- In `ProjectDetailScreen` (`app/projects/[id].tsx`), update `AddActionForm` and `EditActionForm` to use the interactive modal `DateTimePicker` (from `components/datetime-picker.tsx`) instead of forcing manual typing of raw `YYYY-MM-DD` strings into a `TextInput`.

### R5: Tab Bar Iconography
- In `(tabs)/_layout.tsx`, display clean vector icons for each tab (`inbox`: archive/tray, `now`: flash/play/compass, `projects`: folder/layers, `review`: checkmark-circle/repeat, `settings`: settings/cog) using `@expo/vector-icons`, respecting active and inactive color tokens.

### R6: Theme Preference Toggle
- In `(tabs)/settings.tsx`, provide an "外观主题" selector (跟随系统, 浅色模式, 深色模式).
- Persist user preference across restarts via `useAppTheme` (`expo-secure-store` on native, `localStorage` on web).
- Synchronize instant visual theme updates across NativeWind styles, the bottom tab bar, and the system status bar.

## Acceptance Criteria

- [x] All tab headers and back buttons on iPhone (with Dynamic Island) and Android render comfortably below the status bar.
- [x] Bottom tab bar on iPhone has appropriate bottom inset clearance above the home indicator.
- [x] `NowScreen` can be scrolled all the way to reveal all eligible actions and the habit strip.
- [x] `ProjectDetailScreen` can be scrolled smoothly with multiple actions and open forms.
- [x] Adding/editing actions in `ProjectDetailScreen` allows picking a deadline via `DateTimePicker` without typing strings.
- [x] Keyboard opening on `SettingsScreen` and project forms does not conceal input fields.
- [x] Tab bar displays distinct icons for Inbox, Now, Projects, Review, and Settings.
- [x] All existing test suites pass (`pnpm test` and `pnpm --filter @nextdo/mobile typecheck`).
- [x] Settings screen supports toggling between Follow System, Light Mode, and Dark Mode with instant visual update and persistence.
