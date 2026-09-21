# Directory Structure

> pnpm-workspaces monorepo. Apps are shippable products; packages are shared libraries.

---

## Layout

```text
nextdo/
├── package.json                  # root: scripts only (lint/typecheck/test orchestration), dev tooling only
├── pnpm-workspace.yaml
├── apps/
│   ├── mobile/                   # Expo app — targets iOS, Android, Web
│   │   ├── app/                  # Expo Router file-based routes (+ layouts)
│   │   │   ├── (tabs)/           # tab groups: now, inbox, projects, review
│   │   │   ├── _layout.tsx       # root layout: PowerSync provider, theme
│   │   │   └── +not-found.tsx
│   │   ├── components/           # app-specific components (shared ones live in packages/ui)
│   │   ├── hooks/                # app-specific hooks (data hooks read packages/db)
│   │   ├── lib/                  # app glue: env access, haptics, notifications setup
│   │   ├── assets/
│   │   └── app.json
│   └── desktop/                  # Tauri v2 shell — loads the Expo Web build
│       ├── src-tauri/            # Rust side: tauri.conf.json, icons, capabilities
│       └── README.md             # how the web build is wired in
├── packages/
│   ├── core/                     # GTD domain model + Next Action Engine (pure TS)
│   │   └── src/
│   │       ├── domain/           # entity types, Clarify decision table, state machines, invariants
│   │       ├── engine/           # hard filter + ranking + recommendation (+ weights.ts)
│   │       ├── lib/              # ids (ULID), logger, time helpers, errors
│   │       └── index.ts          # public entrypoint
│   ├── db/                       # local database + sync layer
│   │   └── src/
│   │       ├── schema.ts         # PowerSync client schema (local table view; no client migrations — see app/database-guidelines)
│   │       ├── queries/          # Kysely query functions + mutation transactions, one file per aggregate
│   │       ├── powersync.ts      # platform client init (native vs web), connect, stream subscription
│   │       └── index.ts
│   └── ui/                       # shared UI: design tokens + cross-platform components
│       └── src/
│           ├── tokens/           # colors, spacing, radii, typography
│           ├── components/       # Button, Card, Tag, EmptyState, ...
│           └── index.ts
├── server/                       # app backend (minimal: 2 endpoints) + PowerSync Service config
│   ├── powersync/                # Service deployment: service.yaml + sync-config.yaml (streams), Postgres (source DB) connection
│   └── app/                      # pnpm workspace — Hono (TypeScript) on Node 24, Dockerfile
│       └── src/
│           ├── index.ts          # Hono app: /credentials + /upload (owner-token auth)
│           ├── credentials.ts    # 15-min PowerSync JWT minting
│           ├── upload.ts         # applies ps_crud batches to Postgres (upserts / append-only guards)
│           └── db.ts             # Postgres pool (`pg`) — all server-side SQL lives here
└── .trellis/
```

---

## Placement Rules

| Kind of code | Home |
|--------------|------|
| Any type or logic a screen and the engine both need | `packages/core` |
| GTD rules, filtering, ranking, scoring | `packages/core/src/engine` — never in the app |
| SQL/Kysely (client-local SQLite), client schema, PowerSync client init | `packages/db` |
| Server-side Postgres SQL (upload apply logic, JWT minting) | `server/app/src` only — never in `packages/db` |
| App backend endpoints (credentials, upload) + PowerSync Service config | `server/` |
| Component used by 2+ places in the app, or platform-agnostic | `packages/ui` |
| Route, navigation, app shell | `apps/mobile/app` |
| One-off screen component | `apps/mobile/components` |
| Tauri config, desktop-only native glue | `apps/desktop` |

## Rules

1. **Dependency graph (only allowed directions)**:
   - `apps/*` → `packages/ui` and `packages/db` (and transitively `packages/core`);
   - `packages/ui` → `packages/core`;
   - `packages/db` → `packages/core`;
   - `packages/core` → nothing (zero runtime deps);
   - `server/app` → nothing in the monorepo (isolated: external deps only —
     `hono`, `pg`, PowerSync JWT signing). The client already validates domain
     invariants, so the backend stays a thin trust boundary.
   Packages never import from apps; `server/app` is never imported by client code
   (it speaks PowerSync protocol over HTTP only). `packages/ui` never imports
   `packages/db`
   (UI is presentational — data arrives via props; the app's hooks do the reading).
   Root `pnpm lint` / `typecheck` / `test` cover **every workspace including
   `server/app`**.
2. **Web target**: the desktop app loads the build of `apps/mobile` for the web platform
   (`expo export --platform web` output). Never duplicate mobile code into `apps/desktop`.
3. **Public API**: each package exposes exactly one entrypoint, `src/index.ts`. Internal
   modules are reachable only by adding them to that file.
4. **No `src/` at repo root** — the root is configuration only.
