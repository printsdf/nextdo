# Implement Plan — Monorepo Scaffold

Ordered execution checklist. Each step ends in a verifiable state.
Conventions: `.trellis/spec/` (injected); structure: `design.md`; scope:
`prd.md`. Rollback points are marked **[R]**.

## Step 0 — Git init + version pins **[R0]**

1. `git init` (default branch `main`), write `.gitignore`
   (node_modules, dist, .expo, .swc, src-tauri/target, .env, *.local,
   powersync local state).
2. Read `research/versions-*.md`; install EXACTLY these versions
   (all cross-checked against the npm registry on 2026-09-21 — do not let
   `pnpm add` resolve to a different one; the traps are marked):

   | Dependency | Pinned version | Trap / note |
   |------------|---------------|-------------|
   | pnpm | `12.5.1` | no `workspaces` field in root package.json (pnpm ≥12.4.1 warns); `pnpm-workspace.yaml` is the single workspace declaration |
   | Node | `24` (v24.21.0; `.nvmrc` 24.x, `engines >=22.13`) | spec fact-correction: Node 20 EOL 2026-04-30, Expo 57 needs ≥22.13 |
   | typescript | `~6.0.3` | **npm latest is 7.0.2** (native compiler) — unsupported by typescript-eslint 8.70 (<6.1.0) and Expo 57; always pass the explicit version |
   | expo | `~57.0.24` | SDK 57; `58.0.0-preview` = next tag, do not use |
   | react / react-dom | `19.2.3` | official template exact pin |
   | react-native / react-native-web | `0.86.3` / `~0.21.0` | official template pins |
   | react-native-reanimated / worklets / gesture-handler / screens / safe-area-context | `4.5.1` / `0.10.1` / `~2.32.0` / `~4.26.0` / `~5.7.0` | official template pins (reanimated 4 needs worklets) |
   | expo-router / expo-secure-store | `~57.0.22` / `~57.0.4` | |
   | jest-expo / jest | `~57.0.5` / `29.7.0` | **jest 30 is INCOMPATIBLE** (jest-expo 57 is Jest 29-line; npm jest latest is 30.5.2) — pin 29.7.0 everywhere, one Jest major repo-wide |
   | nativewind / tailwindcss | `4.2.7` / `3.4.19` | NativeWind 5 is RC only; tailwind 4.x is for NW5 |
   | @powersync/react-native | `2.2.1` | v2 SDK (2026-07 revamp); `@powersync/client` no longer exists |
   | @op-engineering/op-sqlite | `18.2.5` | must be a DIRECT dependency (autolinking) + allowlisted in `pnpm-workspace.yaml` `onlyBuiltDependencies` (pnpm 10+ blocks build scripts) |
   | @powersync/web / @powersync/react | `2.3.1` / `2.0.1` | web/Tauri client + React hooks |
   | @powersync/kysely-driver / kysely | `2.0.1` / `0.29.6` | driver is a separate package now; kysely 0.30 is beta |
   | jose | `6.2.12` | server-side JWT minting; old `powersync-jwt` package is gone |
   | PowerSync Service image | `journeyapps/powersync-service:1.26.1` | config = `service.yaml` + `sync-config.yaml` (NOT `syncs/app.yaml`) |
   | Tauri (Rust crate) / cli / api / plugin-stronghold | `2.11.6` / `2.11.5` / `2.11.1` / `2.3.2` | Tauri 3.0 is alpha — do not use; Rust stable 1.98.1 (MSRV 1.77.2); config field is `build.frontendDist` (v2) + `beforeBuildCommand` |
   | hono / @hono/node-server / pg | `4.13.8` / `2.1.1` / `8.23.0` | node adapter package is `@hono/node-server`, not `hono/node` |
   | eslint / @eslint/js / typescript-eslint / prettier | `^10.11.0` / `^10.0.1` / `^8.70.0` / `3.9.8` | ESLint 10 (flat config is the only form); typescript-eslint 8.70 supports eslint 8/9/10 + TS <6.1.0 |
   | @types/node / @types/react | `24.13.6` / `~19.2.2` | @types/node latest is 26.x (Node 26 line) — use the 24.x line |

   If any pinned version turns out unresolvable during install, stop and
   record it — do not silently substitute.

## Step 1 — Root tooling **[R1]**

1. Root `package.json` (private, scripts only), `pnpm-workspace.yaml`,
   `tsconfig.base.json`, ESLint flat config, Prettier config.
2. Verify: `pnpm install` clean; `pnpm lint` / `pnpm typecheck` /
   `pnpm test` run (zero workspaces yet — scripts must not crash).

## Step 2 — `packages/core` **[R2]**

1. Scaffolds: `tsconfig.json`, `jest.config`, `package.json`
   (`@nextdo/core`, zero runtime deps).
2. `lib/`: errors (NextdoError hierarchy), ids (local ULID — no dep),
   time, logger.
3. `domain/`: types (all MVP entities per domain-model.md), state
   transitions, invariants, Clarify decision table.
4. `engine/`: types (contract from next-action-engine.md verbatim),
   weights (pinned v1), filters (fixed order), rank, recommend.
5. Tests: the FULL matrix from `domain/next-action-engine.md`
   "Determinism & Testing" + domain invariant tests.
6. Verify: `pnpm --filter @nextdo/core test` green; worked example asserts
   exact scores (A ≈ 0.50, B ≈ 2.05) to 2 decimals.

## Step 3 — `packages/db` **[R3]**

1. Scaffolds (`@nextdo/db`, deps: `@nextdo/core`, powersync client, kysely).
2. `schema.ts`: v2 `Schema` + `Table` declaration for all synced entities
   (v1 `ClientSchema` no longer exists; columns per domain-model.md;
   PK = ULID text; ISO-8601 timestamps; `deleted_at`).
3. `queries/`: one file per aggregate; `completeAction` transaction per
   "The Complete Transaction"; `pool.ts` enforcing the pool contract.
4. `powersync.ts`: platform client selection, `fetchCredentials`,
   `uploadData` (complete() on 2xx), stream name; owner-token module with
   per-platform storage switch (native SecureStore / Tauri stronghold /
   web in-memory; dev/test injects via the runtime setter — no env-var
   fallback: client env values may end up in the build output).
5. `test/fixtures.ts`: canonical demo dataset.
6. Verify: `pnpm --filter @nextdo/db test` green — every query function
   happy path + empty + (mutations) invariant-violation case; pool contract
   tests (open/non-deleted filter, dependencyDone, sourceActionId).

## Step 4 — `packages/ui` + `apps/mobile` **[R4]**

1. `packages/ui`: tokens + `Button` / `Card` / `Tag` / `EmptyState`
   (exactly what the shell uses; no speculative components).
2. Expo app via the pinned SDK: `app.json` (ios+android+web), NativeWind v4
   setup, Expo Router tree per design §4 (`(tabs)/now|inbox|projects|review`
   + root layout with PowerSync provider).
3. `hooks/` data hooks (pool → engine for Now; list hooks for Inbox/
   Projects/Review) reading via `packages/db` (narrow exception: their React
   watch-query subscriptions use `@powersync/react` hooks per the Database
   Guidelines boundary).
4. Minimal screens per design §4 (Now = engine-wired vertical slice).
5. Web worker config for the PowerSync web client so
   `expo export --platform web` succeeds (the known web-specific point).
6. Verify: `pnpm --filter @nextdo/mobile typecheck` green;
   `expo export --platform web` succeeds; RNTL smoke test renders the 4
   tabs without crashing (empty states).

## Step 5 — `apps/desktop` **[R5]**

1. Tauri v2 skeleton: `src-tauri/` (config, minimal Rust entry,
   capabilities, icons), `frontendDist` → mobile web build, `devUrl` →
   Expo dev server.
2. `README.md` wiring doc.
3. Verify: `tauri.conf.json` parses, paths resolve; (no binary build gate).

## Step 6 — `server/app` + `server/powersync` **[R6]**

1. `server/app`: Hono app + node server; `auth.ts` (timing-safe compare,
   401 matrix); `credentials.ts` (15-min JWT); `upload.ts` (apply logic:
   upsert mutable, insert-only append-only, 2xx-on-rejection); `db.ts`
   (pg pool); `Dockerfile` (node:24).
2. `server/powersync`: `service.yaml` + `sync-config.yaml` (single v1 stream,
   per-table SELECTs, `auto_subscribe`), `.env.example`, local `docker-compose.yml` (Postgres +
   PowerSync Service image per research).
3. Verify: `pnpm --filter @nextdo/server test` green (mocked pg: 401
   matrix, upsert vs append-only, 2xx-on-rejection, JWT TTL 15 min);
   `tsc` build to `dist/` succeeds.

## Step 7 — Root gate + cross-layer pass **[R7]**

1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test` — ALL green
   from a clean state (delete node_modules first to be sure).
2. Dependency-graph audit: no rule-1 violations (esp. `@nextdo/core` zero
   runtime deps; `@nextdo/server` no monorepo imports; no app→package
   deep imports); named exports only; no `Date.now()` in engine
   (grep-able); no placeholder text.

## Step 8 — Spec update (workflow Phase 3.3)

1. Update `.trellis/spec/` files from intent to reality: cite the real
   files that now implement each convention (esp.
   `app/database-guidelines.md` → `packages/db/src/*`, `server/app/src/*`;
   `domain/next-action-engine.md` → `packages/core/src/engine/*`;
   `project/directory-structure.md` → actual tree).
2. If implementation forced any deviation from spec, document it here first
   and flag it for the spec channel — never silently deviate.

## Validation commands (canonical)

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @nextdo/mobile exec expo export --platform web
```

## Review gates

- After Step 2: engine test matrix is the highest-risk deliverable — run
  a focused review of `filters.ts` / `rank.ts` against the spec tables
  before moving on (off-by-one in band edges is the classic failure).
- After Step 4: confirm the web worker export actually lands in the export
  bundle (inspect `dist/`), not just that the export command exits 0.
- Step 7 is the task gate: nothing moves to Phase 3 until it is green.
