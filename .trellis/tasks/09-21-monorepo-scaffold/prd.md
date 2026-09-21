# Monorepo Scaffold

Deliver the first working code for Nextdo: the full pnpm-workspaces skeleton
with all six workspaces, the complete Next Action Engine (the project's
differentiator, with its full test matrix), the local DB layer (PowerSync
client schema + Kysely queries + connector), the minimal Hono backend, the
Expo app shell, and the Tauri desktop shell. After this task, the repo has
reality — the spec files get updated with real file references in Phase 3.3.

Source of truth for all conventions: `.trellis/spec/` (advisor-APPROVED on
2026-09-20, see archived `00-bootstrap-guidelines` review history).

---

## Goals

1. `git init` the repo (currently not a git repository) with a proper
   `.gitignore`; the first commits land in Phase 3.4.
2. Root tooling: `pnpm lint` / `pnpm typecheck` / `pnpm test` orchestrate
   **every workspace including `server/app`** (per
   `project/directory-structure.md` Rule 1).
3. Every workspace exists, compiles, and tests green — no stub `TODO` files
   (spec rule: no placeholder text).
4. `packages/core` ships the **complete** Next Action Engine per
   `domain/next-action-engine.md`: hard filter (6 rules, fixed order), value
   ranking (7 weighted signals, pinned v1 weights), calendar preemption,
   skip/re-clarify semantics, determinism + tie-breaks — with the full test
   matrix from that file, including the worked example as a named regression
   test.
5. `packages/db` ships the PowerSync client schema for all MVP entities,
   Kysely query functions (one file per aggregate), the canonical mutation
   transactions (at least `completeAction` per `domain/domain-model.md`
   "The Complete Transaction"), the platform connector
   (`powersync.ts`: `fetchCredentials` / `uploadData` / stream subscription),
   and the canonical fixture dataset.
6. `server/app` ships the two endpoints per
   `app/database-guidelines.md` (owner-token auth, 15-min JWT minting,
   ps_crud apply with upserts + append-only guards, 2xx-on-rejection),
   `pg` pool, and a Dockerfile. `server/powersync` ships the Service
   deployment config with stream SQL for every synced table.
7. `apps/mobile` boots: Expo Router tabs Now / Inbox / Projects / Review
   (minimal functional screens — list/empty states — not full feature UIs),
   PowerSync provider in the root layout, NativeWind active. The web build
   (`expo export --platform web`) succeeds.
8. `apps/desktop` is a valid Tauri v2 shell wired to the web build output
   (config + README; a desktop binary build is not part of the gate).
9. Spec update (Phase 3.3): replace intent-only statements in
   `.trellis/spec/` with real file paths / code examples now that code
   exists (per the bootstrap greenfield exception).

## In scope (this task)

- `git init`, `.gitignore`, root `package.json` / `pnpm-workspace.yaml` /
  `tsconfig` base / ESLint flat config / Prettier config.
- `packages/core`: domain types (all MVP entities), Clarify decision table,
  state transitions, invariants, typed `NextdoError` hierarchy, ULID /
  logger / time helpers, and the engine (filters, ranking, recommendation,
  `weights.ts`).
- `packages/db`: client schema, queries per aggregate, mutation
  transactions, `powersync.ts` connector, test fixtures.
- `apps/mobile`: Expo app shell — 4 tabs, root layout (PowerSync provider,
  theme), minimal screens, app-specific hooks that read via `packages/db`.
- `packages/ui`: design tokens + first shared components actually used by
  the shell (e.g. `Card`, `EmptyState`, `Button`).
- `apps/desktop`: Tauri v2 config loading the Expo Web build.
- `server/app`: Hono + Node 24, `/credentials`, `/upload`, `pg` pool,
  owner-token auth, Dockerfile.
- `server/powersync`: `service.yaml` + `sync-config.yaml` (stream SQL per
  table) + Postgres
  connection config.
- Dependency versions pinned from `research/versions-*.md` (2026-09-21).

## Out of scope (later tasks)

- Full MVP feature UIs: Clarify flow screens, capture flow, focus timer
  UI, reminder scheduling/notification wiring, review checklists.
  (The engine, domain model, and DB transactions behind them land here;
  the screens land in feature tasks.)
- Real deployment (Fly.io), Postgres provisioning, PowerSync cloud account
  wiring — config only, local-dev oriented.
- Tauri mobile, external calendar import, account system (post-MVP per
  Proposal §10/§11).

## Acceptance criteria

1. **Root gate green**: `pnpm install && pnpm lint && pnpm typecheck &&
   pnpm test` — all pass, covering `apps/mobile`, `apps/desktop` (config
   typecheck where applicable), `packages/*`, `server/app`.
2. **Engine**: every item in `domain/next-action-engine.md`
   "Determinism & Testing" satisfied (each filter rule, each ranking signal,
   boundary bands, calendar preemption, tie-break, `needsReclarify` at
   exactly 3, resets, frozen input, worked example asserting exact scores to
   2 decimals).
3. **DB layer**: schema tables match `domain/domain-model.md` entities for
   all MVP kinds; `completeAction` transaction behaves exactly as specified
   (tested); pool query enforces the pool contract (open/non-deleted,
   `dependencyDone` resolution, `sourceActionId` tagging).
4. **Server**: both endpoints 401 without a valid owner token; upload apply
   upserts mutable rows, inserts append-only rows only, returns 2xx on
   validation-level rejection; JWT minted with 15-min TTL.
5. **Mobile shell**: `pnpm --filter @nextdo/mobile exec expo export
   --platform web` succeeds; smoke test renders the 4 tabs without crashing.
6. **Desktop**: `tauri.conf.json` valid JSON schema, `frontendDist`/`devUrl`
   point at the mobile web build, README explains the wiring.
7. **No spec violations**: dependency graph per Rule 1 (notably
   `packages/core` zero runtime deps; `server/app` imports nothing from the
   monorepo); named exports only; typed errors; no `Date.now()` in engine.
8. **Specs updated** (Phase 3.3): `.trellis/spec/` files that previously
   described intent now cite the real files that implement it.

## Constraints

- Conventions are frozen by the advisor-APPROVED spec — do not "improve"
  them mid-task; if a spec turns out to be wrong, stop and record it (the
  fix goes through the spec channel, not a silent deviation).
- Single user, v1: no multi-tenancy, no CRDTs (last-uploaded wins).
- **Node 24 (spec fact-correction, 2026-09-21)**: the spec's original "Node 20" was
  stale — Node 20 EOL'd 2026-04-30 and Expo SDK 57 requires Node ≥ 22.13. The spec
  was updated to Node 24 (Krypton, Active LTS to 2028-04) before implementation;
  same round corrected the PowerSync SDK v2 revamp (2026-07: package renames,
  connector shape, service config format). Evidence: `research/versions-node.md`,
  `research/versions-powersync.md` (all versions cross-checked against the npm
  registry).
- Versions: **exact specifiers in every workspace's `package.json`** (no
  `^`/`~` ranges anywhere; the committed lockfile is the source of truth for
  what gets installed); versions come from `research/versions-*.md`.
