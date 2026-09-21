# Quality Guidelines

> Linting, testing requirements, review standards.

---

## Tooling (fixed, do not swap)

| Concern | Tool |
|---------|------|
| Lint | ESLint (flat config) + `typescript-eslint`; Prettier for formatting (lint handles only what Prettier can't) |
| Types | `tsc --noEmit` per package/app, aggregated by `pnpm typecheck` |
| Unit tests | Jest — `jest-expo` preset in `apps/mobile`, plain TS transform in `packages/*` and `server/app` |
| Component tests | React Native Testing Library (only where behavior — not pixels — is under test) |
| Formatting | Prettier, single config at repo root, run on save |

Root scripts (all tasks must keep them green):

```bash
pnpm lint          # eslint .
pnpm typecheck     # tsc --noEmit in every workspace
pnpm test          # jest across workspaces
```

## Testing Requirements

- **`packages/core` (engine + domain): the strictest bar.** Pure functions are tested with
  plain fixtures: fixed `now`, fixed action pool, asserted output. Every hard-filter rule
  and every ranking signal needs at least one positive and one negative test.
  Recommendation tie-breaks must be tested (same input twice → same output).
- **`packages/db`:** query functions tested against an in-memory/local PowerSync DB or a
  SQLite fixture; schema changes must update the fixture.
- **`apps/mobile`:** test flows, not components. Minimum: Clarify flow (inbox item → each
  outcome), recommendation screen start/skip, focus session start/complete.
- **`server/app`:** the upload apply logic (upserts, append-only guards for
  `completion_records`/`review_records`, 2xx-on-rejection) tested against a temp
  Postgres (or a mocked `pg` client); both endpoints return 401 on missing/invalid
  owner token.
- A bug fix ships with a regression test that fails without the fix.
- No tests that assert on timestamps rendered from real time — pass `now` in.

## Review Standards (what a checker looks for)

1. Behavior matches `prd.md` / `design.md` for the active task; no unrequested features.
2. Dependency direction respected (`project/directory-structure.md` Rule 1); no deep imports.
3. Errors follow the typed-error convention; no swallowed catches.
4. New engine logic is deterministic (no hidden `Date.now()`, no `Math.random()` without an injected seed).
5. No new runtime dependency in `packages/core`; any new dependency anywhere is justified in the PR description.
6. No placeholder text, `TODO` without an issue link, or commented-out code.
