# Testing Guidelines (apps/mobile)

> Component tests run on `jest-expo` + `@testing-library/react-native` (RNTL) +
> `expo-router/testing-library` (`renderRouter`). The screen under test runs for
> real against a mocked `@nextdo/db` boundary and a mocked `@powersync/react`.

---

## Fake timers are ON — always

`renderRouter` calls `jest.useFakeTimers()` and pins the system time to
`Date.now()` at render time (workaround for expo#46864). Consequences:

- `Date`, `process.hrtime`, and `performance` are ALL faked. Timing something
  "in real time" from inside a test measures the fake clock — use a subprocess
  (`date`) or system call if you genuinely need wall-clock.
- RNTL's `waitFor` runs its fake-timers loop: `act(advanceTimersByTime(50))`
  per iteration. Anything that never settles inside that loop makes the test
  die on jest's 5s test timeout — **not** on the assertion.

## Every navigation action must be handleable

expo-router's `onUnhandledAction` **throws** in test mode for any unhandled
action (`GO_BACK`, `POP`, `NAVIGATE`, …). If the throw happens mid-React-work
flush — e.g. a submit chain ending in `router.back()` while `waitFor` is
advancing fake timers — it wedges the `waitFor` loop: every assertion would
pass, yet the test times out at 5s.

Therefore: render the screen the way the app actually reaches it — mount the
entry route first, then `testRouter.navigate(...)` to the screen under test,
so `back()`/`pop()` have a parent to return to:

```tsx
const view = renderRouter('app', { initialUrl: '/review' }); // parent (Review tab)
testRouter.navigate('/review/daily');
// ...
await waitFor(() => expect(view.getPathname()).toBe('/review')); // back() landed
```

## Mocking the `@nextdo/db` boundary

- The mock factory must provide **every** `@nextdo/db` export the mounted tree
  touches — and `testRouter.navigate(...)` mounts more than the screen under
  test. Navigating to `/habits` from a Now-screen test mounts `HabitsScreen` →
  `useHabits` → `habitCycleDay`; when the factory omitted it, the read threw and
  the hook logged `habits query failed`, the test still went green, and the
  missing export was invisible. If a mock export is missing, the failure is a
  caught/logged error, not a red assertion — grep the test output for
  `ERROR ... query failed` instead of trusting a green run. Use
  `jest.requireActual('@nextdo/db')` for pure helpers that must not be
  re-implemented (precedent: `habitCycleDay` in both `habits-screen.test.tsx`
  and `now-screen.test.tsx`).
- Shared platform-module fixtures live in `apps/mobile/__tests__/mocks/`
  (e.g. `mocks/expo-notifications.ts`) and are excluded from test discovery via
  `testPathIgnorePatterns` in `jest.config.js`; each test file opts in with one
  `jest.mock('expo-notifications', () => require('../mocks/expo-notifications'))`
  line (file-per-factory pattern, no `setupFiles` global injection).
- `wrapDb: () => ({})` is enough for hooks that call the mocked query
  functions (they ignore the db argument). Watch queries are consumed by the
  mocked `useQuery`, which never executes them — a `{ compile, execute }` stub
  is all they need.
- `@powersync/react` is mocked wholesale (`useQuery` returns a static
  `queryResult`); screens render from the static `dataRef` in the test file.

## Text queries

- Rows that join title + formatted time into one `<Text>`
  (`{title}（{formatLocalDateTime(startsAt)}）`) must be queried by regex on
  the title (`getByText(/团队站会/)`): the date part is locale-dependent
  (`toLocaleDateString`).
- `tsconfig` has `noUncheckedIndexedAccess`: `getAllByText(...)[n]` and
  `Array.at(-1)` are `| undefined` — add `!` in test code. Jest runs through
  babel (no type check), but `pnpm typecheck` covers `__tests__/` too.
