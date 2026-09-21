# Nextdo — Spec Root

> Nextdo is a lightweight GTD-based personal action system: local-first, mobile + desktop.
> Source requirement doc: `轻量 GTD 行动系统 Proposal.md` (repo root).

---

## Stack (decided 2026-09-20)

| Area | Decision | Notes |
|------|----------|-------|
| Core app | Expo (React Native) + TypeScript | Targets: iOS, Android, Web |
| Desktop | Tauri v2 shell loading the Expo Web build | `apps/desktop`, same source as mobile web target |
| Sync | PowerSync (cloud) + Postgres | Local SQLite managed by the PowerSync client |
| Query layer (client) | Kysely over the PowerSync database | Typed queries, no ORM magic layer |
| Backend | Hono (TypeScript) on Node 24 | `server/app` workspace, Dockerfile; v1 host: Fly.io |
| Server DB driver | `pg` (node-postgres) | Server Postgres SQL lives only in `server/app/src` |
| UI state | Zustand (transient state only) | The local DB is the source of truth |
| Styling | NativeWind v4 | Tailwind classes on RN + Web |
| Routing | Expo Router (file-based) | Tabs: Now / Inbox / Projects / Review |
| Monorepo | pnpm workspaces | `apps/*` + `packages/*` + `server/app` |

---

## Spec Layers

| Layer | Scope | Index |
|-------|-------|-------|
| `project/` | Monorepo layout, TypeScript conventions, errors, logging, quality | [index](./project/index.md) |
| `app/` | Expo app: components, hooks, state, local database | [index](./app/index.md) |
| `domain/` | GTD domain model + Next Action Engine (pure TS, no RN) | [index](./domain/index.md) |
| `guides/` | Cross-cutting thinking guides (Trellis defaults) | [index](./guides/index.md) |

---

## Status Note

This project was greenfield as of 2026-09-20: these specs record the **agreed baseline
conventions**, not yet-existing code. When the scaffold task lands the first code, update
the spec files with real file paths and code examples (workflow Phase 3.3), so that later
tasks see reality instead of intent.

**Fact corrections (2026-09-21, pre-scaffold)**: two spec statements turned out to be
stale and were corrected before implementation (evidence:
`.trellis/tasks/09-21-monorepo-scaffold/research/`, versions cross-checked against the
npm registry): (1) **Node 20 → 24** — Node 20 EOL'd 2026-04-30 and Expo SDK 57
requires Node ≥ 22.13; (2) **PowerSync SDK v2 revamp (2026-07)** — package renames
(`@powersync/web`, `@powersync/kysely-driver`; `@powersync/client`/`@powersync/axios`/
`powersync-jwt` no longer exist), connector shape (`uploadData(database)` +
`getNextCrudTransaction()` + `await tx.complete()`), and service config format
(`service.yaml` + `sync-config.yaml`, replacing `syncs/app.yaml`).
