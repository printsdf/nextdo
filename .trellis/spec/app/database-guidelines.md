# Database Guidelines

> Local SQLite managed by the PowerSync client; Postgres on the server; sync via PowerSync.

---

## Source of Truth & Layers

```text
Read path (server → client):
  Postgres (source DB) → PowerSync Service (Sync Streams) → PowerSync client → local SQLite

Write path (client → server):
  local SQLite (any write on a synced table) → INSTEAD-OF triggers → ps_crud upload queue
    → connector.uploadData() → app backend upload endpoint (server/) → Postgres

UI:
  UI components → apps/mobile/hooks → packages/db/queries (Kysely) → local SQLite
```

- **All client-side SQL lives in `packages/db`.** Components and hooks never build
  SQL. (Server-side Postgres SQL is isolated to `server/app/src` — the upload
  endpoint's apply logic; never in `packages/db`.)
- One file per aggregate in `packages/db/src/queries/` (`actions.ts`, `projects.ts`,
  `habits.ts`, ...), exporting named query functions with fully typed parameters and
  return types (Kysely infers row types from `schema.ts`).
- Query functions take a `db` handle (injected) so they are testable against a fixture
  DB without app bootstrap.

## Schema Conventions (`packages/db/src/schema.ts`)

- Table names: `snake_case`, plural (`next_actions`, `inbox_items`, `waiting_for_items`).
- Primary keys: `id TEXT NOT NULL` — the entity's ULID (generated in `packages/core`,
  lexicographically sortable by time). The local PK **is** the entity id; there is no
  separate server-side surrogate key. In the PowerSync client schema, `id` is provided
  by the SDK (it is the protocol's row id) and is **not re-declared** as a table
  column. Never autoincrement, never ids generated in two places (exception:
  `HabitDay` deterministic id — see domain/domain-model.md).
- Timestamps: `created_at`, `updated_at` as ISO-8601 UTC TEXT. Every row has both.
- Deletion: soft delete with `deleted_at TEXT NULL` for anything the user may want back
  (Trash is a `deleted_at` filter, not a separate store). Hard delete only for rows with
  no user-visible meaning (e.g. `completion_records` of purged actions).
- Denormalization: prefer small explicit joins over wide tables; the only allowed
  denormalized fields are display strings that the engine needs hot (e.g.
  `next_actions.project_id` is a real FK, not a stored project name).
- No `BOOLEAN` columns with implicit null — use `NOT NULL DEFAULT 0/1` or an enum TEXT.

## PowerSync Rules (official model — verified against docs.powersync.com, 2026-09-21, SDK v2)

- **The two paths are separate — never conflate them:**
  - *Read path*: Postgres → PowerSync Service (Sync Streams) → client local SQLite.
    The stream SQL (v1: "all rows", single user) lives in `server/powersync/` and is
    deployed with the service. The client only *subscribes* to the named stream —
    `packages/db/src/powersync.ts` is the only place that names it.
  - *Write path*: **the PowerSync Service is not in the write path.** Any
    INSERT/UPDATE/DELETE on a synced table is captured by the client's INSTEAD-OF
    triggers into the `ps_crud` upload queue **in the same transaction as the local
    write** (the queue can never desync from local data). The SDK then calls the
    connector's `uploadData(database)` — throttled (default ~1 s), retried on error,
    flushed on (re)connect, in a loop until the queue is empty — which fetches one
    CRUD transaction at a time and POSTs its ops to the **app backend's upload
    endpoint** (`server/`); the endpoint applies them to Postgres synchronously.
- **Connector** (`packages/db/src/powersync.ts`, the only PowerSync-client
  touchpoint; exact API shape follows the current SDK docs at scaffold time):
  - `fetchCredentials()` → app backend credential endpoint → returns
    `{ token: JWT, endpoint: service URL }`. The SDK caches credentials and
    pre-fetches when the JWT has < 30 s left; expiry/401 re-fetches automatically.
    v1 (single user, Proposal §10): the backend mints a short-TTL (15 min)
    PowerSync JWT on request — refresh is automatic. There is **no static
    PowerSync JWT**; the only long-lived secret is the owner token itself
    (see "App backend" below, storage per platform).
  - `uploadData(database)` → **never called directly — the SDK invokes it in a loop.**
    Each call: `const tx = await database.getNextCrudTransaction(); if (!tx) return;`
    → POST `tx.crud` ops (`op.op` PUT/PATCH/DELETE, `op.id`, `op.opData`) to the
    upload endpoint → **after the 2xx response, `await tx.complete()` (client-side —
    the server cannot call a client object, and skipping it leaves the queue stuck).**
    The endpoint applies upserts to Postgres **synchronously** (no async enqueueing —
    the checkpoint mechanism would lose changes). The backend returns 2xx even for
    validation-level rejections (error detail comes back via sync tables); only
    transient failures return 5xx — 4xx or a thrown `uploadData()` error blocks the
    entire queue (official guidance).
- **Upload conflict policy v1 (single user)**: the upload endpoint upserts —
  last-uploaded wins per row. Append-only tables (`completion_records`,
  `review_records`) are insert-only **at the endpoint** (it rejects UPDATE/DELETE
  for them). `focus_sessions` is a **mutable** row (active → completed/abandoned),
  upserted like anything else — do not call it append-only. No CRDTs in v1.
  - **Client-side declaration**: the audit tables are declared as **regular upsert
    tables in `schema.ts` — NOT `Table.createInsertOnly`**. PowerSync's
    createInsertOnly never applies a local write to the local DB (its generated
    INSTEAD-OF INSERT trigger only enqueues the CRuDe op), which would leave
    `review_records`/`completion_records` unreadable offline until a server
    round-trip — violating the "works with no network" rule. As upsert tables, a
    local write applies locally (immediately readable) *and* enqueues the CRuDe op
    in the same transaction (the queue never desyncs from local data); the
    append-only guarantee is enforced solely at the upload endpoint.
- **Schema changes — there is no client-side migration mechanism.** The protocol is
  schemaless; the client schema in `schema.ts` is a *view* that takes effect
  immediately when the new app version runs. Changes must stay backwards-compatible
  for older client versions: additive first (a new Postgres column with NULL default
  is safe); renames/drops/type changes follow the official Postgres schema-change
  flow (touch existing rows / redeploy the stream when the select set changes).
  A schema change = one change unit: `schema.ts` + `server/powersync/` stream
  + (when DDL) the Postgres change.
- **App backend (`server/app`)**: a minimal **Hono (TypeScript) API on Node 24**
  (its own pnpm workspace), containerized (Dockerfile in `server/`); v1 host:
  Fly.io (exact deploy target pinned at scaffold time). Two endpoints, **both
  requiring the owner token** — v1 single-user auth per Proposal §10; a real
  account flow is post-MVP, the seam stays:
  - `GET /credentials` → verifies the owner token, mints a 15-min PowerSync JWT
    (signed with `jose`; the old `powersync-jwt` package was removed in the 2026-07
    SDK v2 revamp);
  - `POST /upload` → verifies the owner token, applies the ps_crud batch to Postgres
    (upserts; 2xx for validation-level rejections).
  Without the owner token both endpoints return 401 — there is no anonymous access.
  The owner token (`NEXTDO_OWNER_TOKEN`) is a shared secret generated once; the
  client stores it per platform — `expo-secure-store` exists only on native, so:

  | Platform | Owner-token storage |
  |----------|---------------------|
  | iOS / Android | `expo-secure-store` (Keychain / Keystore) |
  | Tauri desktop | `@tauri-apps/plugin-stronghold` (encrypted local store) |
  | Browser Web | in-memory only — re-entered after a browser restart (v1; browser is a secondary surface; a cookie/session flow ships with the post-MVP account work) |
- **Web/Tauri assembly**: the JS web client runs SQLite (wasm) inside a **web worker**
  — the Expo Web build must export the worker as a static asset and resolve its path
  at build time (Tauri loads the exported bundle). This is the one known
  web-specific setup point; the scaffold task pins the exact worker/base-path config.
- **Platform adaptation**: `packages/db` is written once; `powersync.ts` selects the
  client module at init — native: `@powersync/react-native` (2.x, with the
  `@op-engineering/op-sqlite` SQLite adapter installed as a direct dependency); web
  & Tauri desktop: `@powersync/web` (the official Tauri plugin is alpha — tracked,
  not used in v1; the RN-Web support path is beta: both SDKs installed,
  platform-specific instantiation, worker assets in `public/`, Metro
  `resolveRequest` stubbing the other platform's SDK — details pinned in the
  scaffold task research). No separate desktop sync code. Kysely integration
  goes through `@powersync/kysely-driver` (kysely pinned to 0.29.x).
- **`@powersync/react` boundary** (React binding, 2.x): the **only** PowerSync
  package importable outside `packages/db` — limited to the app's root layout
  (`PowerSyncContext.Provider` wrapping the `packages/db` instance; the package
  exports `PowerSyncContext`, not a `PowerSyncProvider` component) and app data
  hooks (its hooks: `usePowerSync`, `useQuery`, `useStatus`, ...). Split: the
  Sync Stream name and subscription setup live in `packages/db/src/powersync.ts`;
  each React watch-query subscription is owned and cleaned up by the data hook
  that creates it (per Hook Guidelines). The instance, connector, schema, and
  SQL stay exclusively in `packages/db`.
- **Offline from first launch**: the client schema exists locally before the first
  successful sync; the full app works with no network; queued uploads flush on
  reconnect.

## Mutations

- Domain operations (complete, skip, snooze, clarify) are **methods in
  `packages/db/src/queries`** that (a) validate invariants from `packages/core` and
  (b) apply the DB writes in one local transaction, returning immediately (sync happens
  in the background — see app/state-management.md Rule 4).
- Canonical example — `completeAction(db, { actionKind, actionId, now })` runs exactly
  the transaction specified in domain/domain-model.md ("The Complete Transaction"):
  status change, `CompletionRecord` insert, Reminder cancel, habit-day advance —
  atomically. Project action coverage is **not** written here; it is derived by query.
- A mutation that breaks an invariant throws the matching typed `NextdoError` subclass;
  it does not half-apply.

## Schema Changes

- No client-side migrations exist (see PowerSync Rules above) — the `schema.ts` view
  applies when the new app version runs; keep changes backwards-compatible.
- Any change that rewrites user data ships with a fixture-based test proving the
  transform (exercised through the upload endpoint's apply logic) on a seeded DB.

## Testing

- In-memory (or temp-file) PowerSync/SQLite fixture per test file, seeded with the
  canonical "demo user" dataset from `packages/db/src/test/fixtures.ts`.
- Every query function: happy path + empty result + (for mutations) invariant-violation
  case.

## Forbidden

- Raw SQL strings in `apps/mobile` or `packages/ui`.
- `expo-sqlite` directly (the PowerSync client owns the SQLite connection).
- Storing ISO timestamps as epoch milliseconds (keeps SQL and logs human-readable).
- Adding a table without a fixture entry and a query file.
