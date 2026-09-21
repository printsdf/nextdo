# Project-Level Guidelines

> Monorepo-wide conventions: structure, TypeScript, errors, logging, quality.

---

## Pre-Development Checklist

- [ ] Identify which layer you are touching (`apps/*` or `packages/*`) and read that layer's spec index first
- [ ] New file? Confirm its home in `directory-structure.md` before creating it
- [ ] Cross-package imports go through the package's public entrypoint only (`packages/<name>/src/index.ts`) — never deep imports
- [ ] `packages/core` stays pure: no React, no React Native, no `expo-*`, no PowerSync imports
- [ ] New dependency: install at the package level with pnpm, never at the repo root (root holds dev tooling only)
- [ ] Any time-related logic takes `now: Date` as a parameter instead of calling `Date.now()`

---

## Quality Check

- [ ] `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass from the repo root
- [ ] No `any`, no unexplained `@ts-ignore` (use `@ts-expect-error` with a `// reason:` comment)
- [ ] No cross-package deep imports; no `console.log` in committed code (use the logger)
- [ ] `packages/core` contains no RN/React/PowerSync imports
- [ ] New pure logic in `packages/core` or `packages/db` has a co-located unit test

---

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Monorepo layout and where each kind of file belongs |
| [Conventions](./conventions.md) | TypeScript, naming, exports, error handling, logging |
| [Quality Guidelines](./quality-guidelines.md) | Linting, testing requirements, review standards |

---

**Language**: All documentation should be written in **English**.
