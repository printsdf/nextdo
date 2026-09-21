# Conventions

> TypeScript, naming, exports, error handling, logging.

---

## TypeScript

- `strict: true` everywhere; additionally enable `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch`.
- One shared config lives at the repo root (`tsconfig.base.json`); packages and apps extend it.
- **No `any`**. If a type truly cannot be known, use `unknown` and narrow.
- `@ts-ignore` is forbidden; use `@ts-expect-error` with a `// reason: ...` comment and a link to why.
- Prefer `type` for unions/objects, `interface` only for object shapes that are extended.
- Exhaustiveness: switches over domain enums must end with `never`-check so new variants break the build.

## Naming & Files

- Files and directories: `kebab-case` (`next-action-engine.ts`, `use-today-actions.ts`).
- Component files export a component named in `PascalCase` that matches the file name.
- Hooks: `usePascalCase` (`useFocusSession`).
- Constants: `UPPER_SNAKE_CASE` for true constants; everything else `camelCase`.
- Domain entities: `PascalCase` (`InboxItem`, `NextAction`); IDs are `id: string`.
- Booleans in props/state: `is*`, `has*`, `can*` (`isArchived`, `hasDeadline`).

## Exports

- **Named exports only. No default exports** — with exactly one documented exception:
  **Expo Router route and layout files under `apps/mobile/app/**` must default-export
  their component** (Expo Router requires it). No other file may use a default export.
- Barrel file `index.ts` per package; re-exports must be explicit (`export { X } from "./x"`),
  never `export *` at the package entrypoint.

## Error Handling

1. **Domain errors are typed classes** defined in `packages/core/src/lib/errors.ts`:
   `NextdoError` (base, carries a stable `code: string`) with subclasses
   (`ValidationNextdoError`, `SyncNextdoError`, `EngineNextdoError`, ...).
   Stable string codes (e.g. `"action.already-completed"`) so UI can branch without
   parsing messages.
2. **Throw early, handle at the boundary.** Packages and the engine throw; the app catches
   at the edge (route handler, event handler) and maps errors to user-facing states
   (inline message, banner). No error is silently swallowed — a catch without a
   `logger.*` call or rethrow is a review blocker.
3. **No `alert()`/`console.error` for user-facing failures.** Use the app error boundary
   or an inline error state.
4. Async: always `try/catch` around await chains that touch the DB or sync layer;
   unhandled rejections crash the app.

## Logging

- One logger module: `packages/core/src/lib/logger.ts`. It wraps `console` and is the
  **only** allowed logging path (exposed via `export { logger }` so apps don't touch `console`).
- Levels: `debug` (dev-only, stripped in release builds), `info` (lifecycle: sync
  connect/disconnect, focus session start/end), `warn` (recoverable: skipped action,
  conflict resolved), `error` (always paired with an error object).
- Log **what happened**, not stack traces of expected control flow. Never log user
  free-text content (inbox items contain personal data).
- `console.*` calls in app/package source are forbidden by lint rule.

## Time

- Store timestamps as **ISO-8601 UTC strings** in the DB.
- All domain/engine functions receive `now: Date` as a parameter — never call
  `Date.now()` or `new Date()` inside `packages/core` or `packages/db` logic.
- Human-facing formatting (relative "3 days left") happens only in `packages/ui` /
  `apps/mobile`, with a `now` parameter where practical.
