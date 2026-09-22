# E2E sync round-trip verification

## Goal

对 monorepo-scaffold 交付的同步链路做真实端到端验证：docker compose 起 Postgres +
PowerSync Service，`server/app` 连真 Postgres，用真实 PowerSync 客户端（Node 端
web SDK）走完读路径（stream `all` 订阅 → 数据到达本地）与写路径（本地变更 →
`uploadData` → `/upload` → Postgres → 第二个客户端同步到），并验证
`/credentials` 签发的 JWT 能被 PowerSync Service 接受。产出可复跑的验证脚本与
结果记录。

**背景**：scaffold 的单测全部 mock 了 pg（server）或不起同步（db harness 显式
禁 `connect()`），所以「客户端 ↔ 服务 ↔ 数据库」这条完整链路从未真跑过。本任务
补上这一环，不新增产品功能。

## Scope

- 客户端侧：**Node-only**（用户已确认）。Node 脚本用 `@powersync/web` SDK +
  `node:sqlite`（SDK 的 `{ opened: DBAdapter }` hook，与
  `packages/db/src/test/powersync-node.ts` 同模式）——同步协议、CRUD 队列、
  connector、`/credentials`、`/upload` 全部真实，仅 SQLite 引擎因 Node 无 web
  worker 而替换。浏览器/App 侧验证不在本任务。
- 服务端侧：`server/powersync/docker-compose.yml` 原样使用（postgres:16-alpine +
  journeyapps/powersync-service:1.26.1）；`server/app` 构建后在宿主机运行。
- 不修改同步语义。若 E2E 暴露 bug：在产品代码里修 + 加回归测试，重跑 E2E 确认。

## Verification protocol（实现按此执行）

1. **Bootstrap**：生成 `JWT_SECRET`（base64url）与 `NEXTDO_OWNER_TOKEN`（随机串），
   写入 `server/powersync/.env` 与 `server/app/.env`（均已 gitignore）；
   `docker compose up -d`；等 postgres healthy + 服务就绪；
   `pnpm --filter @nextdo/server build` 后带 env 启动 `server/app`（:8787）。
2. **Auth 负例**（对真实 server）：`/credentials`、`/upload` 各验证无 token /
   错误 token → 401。
3. **JWT 被服务接受**：客户端 A 注入 owner token（in-memory store，
   `__setStorageBackendForTests`），`connect(createPowerSyncConnector({
   backendUrl: 'http://localhost:8787', endpoint: 'http://localhost:8080' }))` +
   `subscribeAppStream()`，连接 + 订阅成功无 401。
4. **读路径**：直接向 Postgres 种一行（如 `next_actions`，必填列齐全）→ 在有界
   等待内（checkpoint 间隔 + 余量）客户端 A 本地库可 kysely 查询到该行。
5. **写路径**：客户端 A 本地 INSERT 一行同步表 → SDK 入队 → `uploadData` POST
   `/upload` → 直接查 Postgres 确认行存在且字段值正确（append-only 表 PATCH 被拒
   但 2xx 的行为可用一行 `review_records` 顺带覆盖）。
6. **跨客户端**：客户端 B（全新本地库文件、同 token）连接订阅后能看到步骤 4、5
   的两行 —— 证明服务从 Postgres 到客户端的复制成立。
7. **清理**：脚本结束断开客户端、停 `server/app`；docker 栈可留可停（脚本提供
   `down` 子命令）。

## Deliverables

- 可复跑脚本：单命令完成 bootstrap → 全部断言 → 清晰 pass/fail 输出；
  位置与 TS 运行方式实现时定（候选：repo 根 `e2e/`，不进根 `pnpm test` 门——
  依赖 Docker，属手动/按需验证，与 scaffold 的"NOT part of the unit-test gate"
  定位一致）。
- 结果记录：本任务 `research/` 或 notes 中记录真实运行输出（各步 pass/fail、
  耗时、发现的 bug 及修复引用）。

## Acceptance Criteria

- [ ] AC1：compose 栈 healthy；`server/app` 对真 Postgres 启动成功。
- [ ] AC2：`/credentials` 带 owner token → 200 `{token}`；该 JWT 被 PowerSync
      Service 接受（客户端连接 + 订阅 stream `all` 成功）。
- [ ] AC3：Auth 负例：两端点 ×（无 token、错误 token）均 401。
- [ ] AC4：读路径：直种 Postgres 的行在有界等待内到达客户端 A 本地库。
- [ ] AC5：写路径：客户端 A 本地 INSERT 经 `/upload` 落 Postgres，字段值正确。
- [ ] AC6：跨客户端：客户端 B 连接后看到 AC4、AC5 的两行。
- [ ] AC7：脚本单命令可复跑（幂等：可重复执行，不依赖上一次的状态残留——
      重复跑前清库或换唯一行 id）。
- [ ] AC8：若发现 bug：产品代码修复 + 回归测试 + 根门（lint/typecheck/test）
      保持绿；修复记录在结果记录里。
- [ ] AC9：工作树干净提交；`git status` 无未跟踪产物（.env、本地库文件均被
      gitignore 或清理）。

## Constraints

- 不新增产品功能、不改同步语义（见 Scope）。
- `.env`、本地 PowerSync 库文件（`nextdo.db*`）不得入库。
- 根门命令不变：`pnpm lint / typecheck / test`（E2E 脚本不加入其中）。
