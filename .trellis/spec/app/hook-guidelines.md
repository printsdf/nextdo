# Hook Guidelines

> Two kinds of hooks in this project: **data hooks** and **UI hooks**.

---

## Data Hooks

- Read the local database (via `packages/db`) and return typed domain rows.
  Naming: `use<Thing>s` (`useInboxItems`, `useTodayActions`), singular for one row
  (`useRecommendedAction`).
- Live-update with PowerSync subscriptions: the hook owns the subscription and cleans it
  up on unmount. Components never see the subscription mechanism.
- A data hook owns **one** query concern. Need a joined view? Add the query in
  `packages/db/src/queries`, then a thin hook around it. No multi-query aggregation
  inside a hook beyond what one screen needs.
- Loading/error state: data hooks return `{ data, error }` (or `null` + `error` for
  single rows). Reads are local (the local DB), so there is no network-loading spinner
  for reads. Writes are likewise immediate-local (see State Management, Rule 4) — a
  mutation hook resolves when the **local transaction** commits, not when the change
  has synced; surfaces a `SyncNextdoError` only if the local write itself fails.
- Mutations: **never `db.update(...)` in a component.** Mutations go through query
  functions in `packages/db` that wrap the domain operations from `packages/core`
  (e.g. `completeAction(id, now)`), so invariants are enforced in one place.
  Full-row edits of an existing entity follow the same pattern as a **patch-style
  hook** (precedent: task 09-28 project-action-edit-trash — `useUpdateProject` /
  `useUpdateNextAction`): the hook builds `{ ...row, ...patch, updatedAt:
  toIso(useAppClock()) }` and delegates to the db query (`updateProject` /
  `updateNextAction`) — a project status change is asserted against
  `PROJECT_TRANSITIONS` in the db layer (the detail screen only offers
  `active ↔ on-hold`; done/dropped stay terminal), and a title/estimate
  redefinition resets `consecutiveSkips` there too. The weekly review keeps its
  own `useProjectStatus` (status-only patch).

## UI Hooks

- Own transient, local-to-a-screen state: `useFocusSession`, `useSheetOpen`,
  `useNowPageState`.
- May read data hooks; may hold `useState`/`useReducer`/`useEffect`.
- UI hooks live next to the screen that uses them, or in `apps/mobile/hooks` when shared.

## Rules

1. Hook file = one hook. `use-today-actions.ts` exports `useTodayActions` (+ its types).
2. No hooks that take a component or a ref to a component.
3. No `useEffect` whose only job is to sync a derived value — compute it in render.
4. All time-sensitive logic receives `now` (from a single app-level clock hook,
   `useAppClock()`, which ticks on a minute interval) — hooks do not call `Date.now()`.
   When a derived value depends on `now` but its data comes from a PowerSync
   watch (which fires only on row changes, never on clock ticks), keep the
   derivation as a **pure helper that takes an injected `now`** and re-derive
   it on the screen from the app clock — precedent: `isProjectStalled(card,
   now)` in `use-project-cards.ts` (wraps the db-layer `isStalled` predicate;
   the watch mapper must not tick).
   **Documented exception**: sub-minute delivery/timing loops that the app
   clock (1/min) cannot express may read `new Date()` inside a dedicated
   background hook — the module doc must state the exception (precedent:
   `use-reminder-delivery.ts`, desktop 30s tick).
5. A hook must be safe to call unconditionally (rules of hooks); conditional logic goes
   inside the hook.
6. PowerSync watch results: `@powersync/react` types `useQuery`'s `error` as
   `Error | undefined`, but the runtime delivers `null` (watch state). Normalize with a
   **truthy** check (`error ? String(error.message) : null`) — never `error === undefined`
   with an else-branch, which dereferences `null.message` and crashes the whole tree
   (no error boundary in v1). Regression: `apps/mobile/__tests__/watch-error-null.test.tsx`.
7. **A query-style read is stale as soon as another route can write to it.** The
   query-style hooks above read on mount and after a local mutation — but a
   bottom-tab screen stays MOUNTED when a stack screen is pushed on top of it, so
   a row written on that other screen never reaches an already-mounted tab. When
   a screen can be covered by a route that writes the same data, the hook exposes
   a `reload()` (reusing its existing re-read key) and the screen calls it from
   `useFocusEffect` (re-exported by `expo-router`):

   ```ts
   const { days, reload } = useHabitDays(now);
   useFocusEffect(useCallback(() => { reload(); }, [reload]));
   ```

   Precedent: `use-habit-days.ts` / `now.tsx` (task 10-02). Do NOT reach for an
   event bus or a new watch query to solve this — the refresh is one local
   idempotent read, and adding a subscription to a deliberately query-style hook
   is the larger cost. See the testing caveat in Rule 8.
8. **Know which of your refresh tests are real.** Under `renderRouter`, pushing a
   stack route **remounts** the tab underneath, so a test that navigates away and
   back passes even with the refresh removed — the mount-time read picks the new
   rows up. A tab switch does not emit focus events in that harness at all, so
   there is no navigation-only way to isolate the focus path. If a test claims to
   prove a refresh, delete the refresh and confirm the test fails; if it still
   passes, rewrite the test name/comment to claim only the outcome it really
   pins (the data is fresh on return), and keep the mechanism justified by the
   framework's real behavior rather than by the test.

## Forbidden

- Direct `expo-sqlite` / PowerSync API usage outside `packages/db` (exception: `@powersync/react` Provider/hooks per the Database Guidelines boundary).
- `fetch`/network calls in hooks (the sync layer is the only network path).
- Storing DB rows in a Zustand store "for convenience" (see State Management).
