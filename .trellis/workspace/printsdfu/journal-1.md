# Journal - printsdfu (Part 1)

> AI development session journal
> Started: 2026-09-20

---

## 2026-09-20 — `00-bootstrap-guidelines` completed (archived)

Greenfield spec bootstrap for Nextdo (lightweight GTD, local-first, mobile + desktop).

- Decisions locked with the user: Expo/RN + TypeScript, PowerSync cloud + Postgres,
  Tauri v2 shell over the Expo Web build, pnpm monorepo (`apps/mobile`, `apps/desktop`,
  `packages/core`, `packages/db`, `packages/ui`, `server/app`), Hono backend on Node 20.
- Spec restructured from the template's backend/frontend split into
  `project/` + `app/` + `domain/` layers (13 files, all filled, English).
- Advisor (Codex gpt-5.6-sol, xhigh, read-only) review loop: pass 1 REVISE (11) →
  pass 2 REVISE (8) → pass 3 REVISE (6) → pass 4 REVISE (4) → **pass 5 APPROVE**
  (no blocking, no non-blocking). Full history in the task's prd.md.
- Greenfield exception: no real code examples in spec (deferred to the scaffold
  task, which adds concrete file references in its Phase 3.3).
- Next: create and start the scaffold task.



## 2026-09-21 — PowerSync v2 upgrade (task 040) — packages/core + packages/db

**Environment change discovered mid-task:** `server/app` (the 038 backend) and
`apps/mobile` (the 042 shell) no longer exist on disk; `.trellis/tasks/` was
reorganized (only `09-21-monorepo-scaffold` + archive remain); research/ was
rewritten (versions-*.md re-verified 2026-09-21, incl. service 1.26.1,
sync-config `sync_config` key, JWT via `jose`). Git only has 3 commits;
`packages/db/` is untracked. Backend/mobile verification is therefore out of
scope for this session.

**Work delivered (all in `packages/`):**

- `packages/core` → version 2.0.0 (no code change; zero runtime deps, no
  PowerSync surface).
- `packages/db` → version 3.0.0:
  - `src/schema.ts` — REBUILT. The pre-upgrade file was overwritten before it
    could be recovered (untracked, no git history); reconstructed from
    research/schema-mapping.md (read earlier in session) + core domain types +
    every consumer (queries/*, fixtures.ts, tests). Now v2 builder API:
    `new Schema({...})` + `new Table({...}, {indexes})` + `column.text/integer`,
    `Table.createInsertOnly` for review_records/completion_records,
    `export type Database = typeof AppSchema.types` (verified per-table
    per-column precise via a deliberate @ts-expect-error probe). 16 tables,
    all 14 entity row-mapper pairs + `parseJson` (signature widened to accept
    `undefined` — pool.ts required it). No `Tag` core type exists → no tag
    mappers (junction table stays schema-only).
  - `src/powersync.ts` — NEW: lazy platform client selection
    (`@powersync/react-native` vs `@powersync/web` via `navigator.product`,
    lazy `require` so plain Node/jest never loads native),
    `createPowerSyncDatabase()`, v2 connector `createPowerSyncConnector(config)`
    (injected `NextdoPowerSyncConfig`, no env fallbacks; `fetchCredentials`
    → GET /credentials w/ owner token, null = not signed in, throw =
    temporary; `uploadData` = one crud transaction per call → POST /upload
    body `{ ops: [{ op, id, table, opData }] }`, `complete()` ONLY on 2xx —
    the 2xx-on-rejection protocol), `subscribeAppStream` (stream 'all').
  - `src/owner-token.ts` — NEW: per-user KV session storage (the only
    AsyncStorage-key touchpoint): `nextdo.auth.current-user` +
    `nextdo.auth.owner-token.<userId>`; setSession/clearSession/getOwnerToken/
    getCurrentUserId; lazy backend (AsyncStorage native / localStorage web /
    in-memory Node) + `__setStorageBackendForTests`.
  - `src/test/connector.test.ts` — NEW: 16 tests covering the owner-token
    session semantics + both connector methods (null-when-signed-out,
    2xx-on-rejection completes, non-2xx/network throws without completing,
    exact /upload body, Bearer headers, stream subscription).
  - Fixed 2 pre-existing 043 typecheck errors: `queries/inbox.ts` dead
    `case 'do-now-completed'` (unreachable after the early return) and
    `test/powersync-node.ts` `match[1]!` under noUncheckedIndexedAccess.
  - package.json: removed dead deps `@tauri-apps/plugin-stronghold` +
    `expo-secure-store` (superseded token-crypto design, zero imports);
    added `@react-native-async-storage/async-storage@3.1.1` (lazy require in
    owner-token.ts must resolve under Metro/pnpm); KEPT
    `@powersync/node@1.0.1` devDep — contrary to the task description, the
    test helper `src/test/powersync-node.ts` still needs it for the native
    PowerSync SQLite extension binary.

**Quality gate (green):** `pnpm -r typecheck` (core+db) ✓ · `pnpm -r test`
core 153/153 + db 19/19 ✓ · `pnpm lint` clean ✓.

**Leftovers / notes:**
- Backend rebuild must match the connector contract: /credentials
  `Authorization: Bearer <ownerToken>` → `{ token }`; /upload body
  `{ ops: [{ op: PUT|PATCH|DELETE, id, table, opData }] }`, 2xx-on-rejection.
- `apps/mobile` (re)creation must pin op-sqlite 18.2.5 + copy @powersync/web
  worker assets (research/versions-powersync.md §unverified).
