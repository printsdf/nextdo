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

## 2026-09-21 — apps/mobile 重建 + Web 平台支持（scaffold 目标 7）

上会话已重建 `apps/mobile`（Expo 57 / SDK 54 代际、Expo Router 4 tabs、
NativeWind v4、`@nextdo/db` 连接器接线、登录门、owner-token 会话）。
本会话补上 **Web 平台**：`@powersync/react-native` 是原生-only，web export
会在运行时 `Cannot read property 'product' of undefined` 崩溃。

**改动：**
- `packages/db`：
  - `src/powersync.ts` — 重写为**按平台分发工厂**：
    `createPowerSyncDatabase()` 内做惰性 `require('@powersync/react-native')` /
    `require('@powersync/web')` 分发（Metro 与 webpack 都不会预打包
    react-native 原生模块，避免 web 崩溃与 node/jest 加载原生模块）。
    `PowerSyncInstance` 是两 SDK 的最小公共子集结构类型（无 import，
    避免 @types/react 传递依赖）。导出 `PowerSyncInstanceExport` /
    `PowerSyncDatabase`（db 包内别名）。
  - `src/index.ts` — 改导出工厂 + 类型（删除 `powerSync` 单例导出）。
  - `src/test/connector.test.ts` — mock 从 `../powersync` 改为
    `@powersync/react-native`（新结构下 connector 直接从 SDK 取 client）；
    新增"非 RN 平台分发到 @powersync/web"用例（jest.doMock web 模块）→ 20 测试。
  - `src/test/powersync-node.ts` — 原生 Node 实例改为 `new PowerSyncDatabase()`
    （@powersync/node），不再经由工厂。
  - 新增 devDep `@powersync/web@1.0.1`（与 @powersync/react-native 1.1.1
    同为 v1.0.1 core —— 两 SDK 的 core 版本必须一致，见
    `.trellis/tasks/09-21-monorepo-scaffold/research/versions-powersync.md`）。
- `apps/mobile`：
  - `package.json` + 根 `pnpm-workspace.yaml` — 新增 `@powersync/web`
    （catalog:）；根 `pnpm install` 通过。
  - `app/_layout.tsx` — `usePowerSync(createPowerSyncDatabase())`（替换单例导入）。
  - 根 `babel.config.js` — 新增 `babel-preset-expo/metro-fix`（expo-router
    官方要求的 metro 修复预设）。
  - `tailwind.config.js` — **修复路径 bug**：tokens require 从
    `../packages/ui/...` 改为 `../../packages/ui/...`（上会话写错一级，
    导致 web export 在 jiti 加载配置时崩）。
- `packages/ui` — `package.json` 新增 `@types/react`（peer deps 显式化，
  消除 tsc TS7016）。

**质量门（全绿）：** `pnpm -r typecheck`（ui/core/db/mobile）✓ ·
`pnpm -r test` core 153/153 + db 20/20 ✓ · `pnpm lint` ✓ ·
`expo export --platform web` ✓。

**Web 运行时资产验证：** `dist/@powersync/worker.js` + 4 个 `.wasm` 就位
（来自 `public/@powersync/`），entry bundle 引用 `/@powersync/worker.js`，
本地静态服务 curl 探测 MIME 正确（worker=text/javascript，wasm=application/wasm）。
**未验证：** 真实浏览器运行时启动（本会话 IDE 浏览器 MCP 持续报
"MCP descriptor not found"，停止重试）；完整同步 E2E 需 PowerSync server
（本工作区无 server 项目）。


## Session 1: Monorepo scaffold: Step 6 verification, clean gate, spec backfill
<!-- trellis-session: v=2 fp=30aa3e8c3062e1c0 -->

**Date**: 2026-09-22
**Task**: Monorepo scaffold: Step 6 verification, clean gate, spec backfill
**Branch**: `main`

### Summary

Verified Step 6 server backend against the client contract (51 mocked-pg tests, tsc build, JWT/sync-config parity). Independently reproduced and fixed the packages/db cold-parallel jest failure (inline babel plugin functions dropped by jest config serialization -> path-based .cjs plugin); db cold+parallel 127/127 green 3/3. Ran the Step 7 clean-state gate (rm node_modules -> pnpm install -> lint/typecheck/test): all green (core 153, db 127, mobile 4, server 51). Step 8: backfilled .trellis/spec from intent to reality (directory-structure tree, next-action-engine Implementation mapping, database-guidelines real-file citations + jest gotcha + recorded deviations: server app.ts/index.ts split, Tauri stronghold defect).

### Git Commits

| Hash | Message |
|------|---------|
| `9e7b904` | fix(db): load the import.meta babel plugin by path (cold parallel) |
| `bdda947` | feat(server): Step 6 Hono backend + PowerSync service |
| `0ff05ec` | docs(spec): Step 8 backfill spec from intent to reality |

### Status

[OK] **Completed**


## Session 2: E2E sync round-trip: real-chain verification green, scaffold runtime fixes
<!-- trellis-session: v=2 fp=6d01105dedfbed3f -->

**Date**: 2026-09-22
**Task**: E2E sync round-trip: real-chain verification green, scaffold runtime fixes
**Branch**: `main`

### Summary

Built the re-runnable E2E runner (e2e/sync-roundtrip.ts, @powersync/node clients on node:sqlite, 7-step protocol: bootstrap -> auth negatives -> JWT acceptance -> read path -> write path incl. append-only 2xx -> cross-client -> cleanup) and drove the real chain to green: final run 7/7 PASS, 14s, exit 0. Found and fixed 3 scaffold runtime bugs the compose-only validation missed: POWERSYNC_CONFIG_PATH (service exited 150 / ran without sync config -> PSYNC_S2302 on every /sync/stream while connect+subscribe still succeeded), postgres wal_level=logical, and CREATE PUBLICATION powersync in the init DDL (PSYNC_S1141); init scripts only run at container creation, so existing postgres needs a recreate. Also fixed 2 e2e-tool bugs: crudQueueDepth queried a non-existent ps_crud.table_name column (v2 schema: id/data/tx_id, table name at json_extract(data,'$.type'), probe-verified 1/2/3) and awaitWithTimeout's unref'd timer drained the event loop when the SDK close() promise stayed pending -> 'unsettled top-level await' exit 13 (ref'd timer + clearTimeout in finally; close() itself settles in <10ms once the loop stays alive). No product-code bugs: connector, JWT minting, /upload, append-only trigger all behaved as designed; no product regression tests needed — the E2E suite is the regression test for the service layer. Root gate green (lint/typecheck/test). Spec updated: database-guidelines gained the self-hosted service operational contract (hard requirements + failure/symptom matrix + ps_crud v2 debugging) and the E2E runner entry in Testing; app/index.md Quality Check gained the 'sync-chain changes must pass the E2E runner' item. Note: the implementation subagent died twice on transient Anthropic 502s (its orphaned background run had already proven the sync chain works); the parent session completed the remaining work directly. Docker stack left running by design (down subcommand documented).

### Git Commits

| Hash | Message |
|------|---------|
| `b9f2513` | fix(server): self-hosted stack runtime fixes — POWERSYNC_CONFIG_PATH, wal_level=logical, powersync publication |
| `20a004b` | test(e2e): real sync-chain round-trip runner (manual, outside root gate) |
| `18b35ec` | docs(spec): self-hosted service contract + e2e runner in database guidelines |

### Status

[OK] **Completed**
