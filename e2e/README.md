# E2E sync round-trip (manual / on-demand)

End-to-end verification of the real sync chain:

```
client (Node, PowerSync) ──/credentials, /upload──▶ server/app (:8787) ──▶ Postgres (:5432)
        ▲                                                                          │
        └──────── stream "all" via PowerSync Service (:8080) ◀──────────────────────┘
```

It exercises the **actual product code** — `server/powersync/` docker stack
(postgres:16-alpine + journeyapps/powersync-service:1.26.1), `server/app`
(built, run on the host), and `packages/db` (`createPowerSyncConnector`,
`subscribeAppStream`, `SYNC_STREAM_NAME`, owner-token storage with an
injected in-memory backend, `AppSchema`, `wrapDb`) — against a real PowerSync
client.

## Run

```sh
node e2e/sync-roundtrip.ts          # full run (bootstrap → 7 steps → cleanup)
node e2e/sync-roundtrip.ts down     # stop the docker stack
```

One command, non-zero exit on any failed step, per-step PASS/FAIL report on
stdout. Re-runnable: each run uses fresh secrets, fresh temp-dir client DB
files, and unique row ids (idempotent against a leftover Postgres volume).

## Requirements

- Docker daemon running (OrbStack / Docker Desktop) — ports 5432 + 8080
  free unless this stack already owns them.
- Node ≥ 23.6 (type stripping; developed on Node 24/26). No npm install:
  the runner imports `packages/db`/`packages/core` sources directly (see
  `hooks/resolve-ts.mjs`) and resolves the `@powersync/node` SDK through
  `packages/db`'s existing node_modules.

## What the steps do (prd.md protocol)

1. **bootstrap** — write `server/powersync/.env` + `server/app/.env`
   (fresh base64url `JWT_SECRET` + random `NEXTDO_OWNER_TOKEN`; both
   gitignored), `docker compose pull && up -d`, wait for postgres healthy +
   service ready, `pnpm --filter @nextdo/server build`, start
   `server/app` on :8787.
2. **auth negatives** — `/credentials` + `/upload` × (missing, wrong)
   token → 401.
3. **JWT accepted** — client A connects with the product connector; the
   minted 15-min JWT is accepted by the PowerSync Service; stream `all`
   subscribed.
4. **read path** — one row seeded directly into Postgres appears in client
   A's local SQLite (bounded wait).
5. **write path** — client A's local INSERT goes ps_crud → `uploadData` →
   `POST /upload` → Postgres with field-exact values; an append-only
   `review_records` PATCH is rejected by the endpoint but answered 2xx
   (queue drains; Postgres row unchanged).
6. **cross-client** — a fresh client B (new DB file, same token) sees the
   rows from steps 4 + 5.
7. **cleanup** — clients closed, `server/app` stopped. **The docker stack
   is left running** on success; stop it with the `down` subcommand.

## Client SDK note (PRD deviation)

The PRD named `@powersync/web` + the `{ opened: DBAdapter }` hook (the
`packages/db/src/test/powersync-node.ts` pattern). That path cannot sync on
plain Node: the web SDK auto-detects SSR (no `window`) and installs its
no-op SSR sync implementation. This runner therefore uses the first-party
**`@powersync/node`** SDK — already a devDependency of `packages/db` (no new
dependency), same PowerSync C extension + `node:sqlite` mechanism as the
test harness, same shared protocol code, real fetch/WebSocket. Flagged in
the task report.

## Deliberately outside the gates

Not a pnpm workspace package (no matching `pnpm-workspace.yaml` glob), no
`test`/`typecheck` scripts (so `pnpm -r test` / `pnpm -r typecheck` skip
it), and ignored by the root ESLint config. It needs Docker, so it is a
manual / on-demand verification — same positioning as the scaffold's
"NOT part of the unit-test gate" note in `server/powersync/docker-compose.yml`.

Run artifacts (client DB files, server log) live in a per-run temp dir
(`os.tmpdir()/nextdo-e2e-*`), removed by the cleanup step. The two `.env`
files remain on disk (gitignored) so `down` works and the compose recipe
stays inspectable.
