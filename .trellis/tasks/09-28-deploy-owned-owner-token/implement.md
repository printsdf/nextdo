# Implementation plan — deploy-owned owner token

**约束**：子代理只改代码/文档，**不提交**（parent 提交）；每步完成即绿（该包 `pnpm --filter <pkg> test` 可跑）；文案精确使用 PRD 中的字符串。

## Step 1 — server/app（对应提交 1）

1. `src/owner-token.ts` **重写**：
   - 删：`claimOwnerToken`、`ClaimResult`、`readExistingToken`、`persistToken`、`DEFAULT_TOKEN_FILE`、`OwnerTokenEnv.NEXTDO_OWNER_TOKEN_FILE`、`OwnerTokenResolution`、`randomBytes`/fs/path import。
   - 留/改：`export function resolveOwnerToken(env: OwnerTokenEnv = process.env): string`——`env.NEXTDO_OWNER_TOKEN?.trim()`；非空 → 返回；否则 `throw new Error('NEXTDO_OWNER_TOKEN is not set — generate one with: openssl rand -hex 32 and set it in server/deploy/.env')`。文件头注释重写（唯一来源 = env；空 → 拒绝启动；token 不入日志）。
2. `src/index.ts`：`const ownerToken = resolveOwnerToken()`（sync，无 await）；删 unclaimed 分支日志，统一 `logger.info('owner token source: env')`；`createApp({ pool, ownerToken, jwtSecret })`；更新文件头/行内注释（claim 字样清零）。
3. `src/app.ts`：删 `/claim` 路由整体、`ownerTokenSource` 字段、`currentToken` 闭包（`requireOwnerToken(config.ownerToken)` 静态）、`claimOwnerToken` import、`ServerConfig.ownerToken` 类型改 `string`（注释更新）；文件头「Three endpoints」→「Two endpoints」+ 删 claim 段落 + 「While the server is unclaimed」段删除。
4. `src/auth.ts`：`requireOwnerToken(expectedToken: string)`——删 `expectedToken === null ||` 分支；401 矩阵文档删 unclaimed 行；函数注释删 unclaimed 句。
5. 测试：
   - 删 `test/claim.test.ts`。
   - `test/owner-token.test.ts` **重写**：env 非空（含首尾空白 → trim 后返回）；空串 / 纯空白 / 未设置 → throw 且消息含 `openssl rand -hex 32`；无文件相关用例。
   - `test/upload.test.ts`、`test/auth.test.ts`、`test/credentials.test.ts`、`test/cors.test.ts`：createApp 调用删 `ownerTokenSource: 'env'`；`auth.test.ts` 若有 `ownerToken: null` 用例删除并核对其余矩阵用例仍通过。
   - `pnpm --filter @nextdo/server test` 全绿。

## Step 2 — packages/db（提交 2）

1. `src/powersync.ts`：删 `claimOwnerTokenOnce` 函数、`ClaimOutcome` 类型、文件头第 33-37 行 bullet；其余零改动。
2. 删 `src/test/claim-owner-token-once.test.ts`。
3. `pnpm --filter @nextdo/db test` 全绿。

## Step 3 — apps/mobile（提交 3）

1. `hooks/use-cloud-sync.ts`：
   - 删 `claimOwnerTokenOnce` import；
   - connect()：地址两校验后插入 `if (trimmedToken === '') { return { ok: false, message: '请先输入 owner token' }; }`；删整个 `if (trimmedToken === '')` claim 分支（200/409/network 三态）；保留 token 非空路径逐字不变；
   - 函数上方注释更新（删「EITHER the claim (empty token) OR」描述）。
2. `app/(tabs)/settings.tsx`：placeholder `owner token（首次连接可留空，自动获取）` → `owner token`；头部注释第 9-15 行 claim 描述改回「token 必填；地址/token 客户端校验（零网络）+ 服务器三态文案（token 不正确 / 连不上服务器）」（删「服务器已有 token，请手动输入」先例）。
3. `__tests__/settings-screen.test.tsx`：
   - `TOKEN_PLACEHOLDER = 'owner token'`；
   - 删 mock 的 `claim` 字段、`mockClaimCalls` 及重置；
   - 删 3 个 claim 用例（约 385-450 行区：200 自动存 / 409 文案 / claim network）；
   - 新增用例「empty token → inline 「请先输入 owner token」, nothing stored, zero network」：填两合法地址、token 留空、press 连接 → 文案出现、`mockFetchCalls === 0`、存储双空、未连接；
   - 用例「连接 enables when both addresses are filled (token is OPTIONAL)」改标题为「…(token may be empty — the requirement is enforced by connect() inline)」（断言逻辑不变：按钮禁用只看地址）；
   - 核对其余用例引用 placeholder 处全部一致。
4. `_layout.tsx`：零改动（注释里的 "claimed" 是英文"断言"义，勿动）。
5. `pnpm --filter @nextdo/mobile test` 全绿。

## Step 4 — server/deploy（提交 4）

1. `docker-compose.yml`：`NEXTDO_OWNER_TOKEN: ${NEXTDO_OWNER_TOKEN:?set NEXTDO_OWNER_TOKEN in .env (openssl rand -hex 32)}`；删 `- ./data:/app/data` 卷行 + R7 注释；文件头注释「optional (auto-generated on first boot)」→「required」。
2. `.env.example`：`NEXTDO_OWNER_TOKEN` 注释重写——必填；`openssl rand -hex 32`；所有设备在设置页填入同一值；泄漏 = 全设备失守（与其余 secret 同级）。
3. `README.md`：
   - 变量表：`NEXTDO_OWNER_TOKEN` 行改「**required** — `openssl rand -hex 32`」；
   - 「The owner token — two ways」整节 → 单路：部署前生成一次写入 .env；服务器空值拒绝启动；token 只存在于 .env（无文件、无日志、无接口回显）；
   - 「Connect a device」：第 3 条改「owner token — 部署时生成、写入 .env 的同一值」；删「A second (and later) device」blockquote（所有设备同流程，一句带过即可）；
   - Operations：删「Migrate an existing deployment to the first-connect claim flow」bullet → 新 bullet「Migrate an existing deployment to required-token boot」：当前 token = 旧 `.env` 的 `NEXTDO_OWNER_TOKEN`（若非空）或 `./data/owner-token` 文件内容 → 写入 .env → `docker compose up -d --build`；旧文件可删；轮换 bullet 删「delete ./data/owner-token」改「set a new value in .env + `docker compose up -d api` + 所有设备重填」。
4. `grep -rn "claim" server/deploy/` 为空。

## Step 5 — spec 同步（提交 5）

1. `.trellis/spec/app/database-guidelines.md`：「App backend」节——删 `POST /claim` 条目（121-132 行区）、「unclaimed」态描述（134/141 行）、`owner-token.ts` 职责改「boot resolution: NEXTDO_OWNER_TOKEN required（trim 非空），missing/empty → 拒绝启动（消息含生成命令）」（145-146 行）、156 行起 token 段落核对（env 必填语义）。
2. `.trellis/spec/project/directory-structure.md`：66 行 `+ one-time /claim` 删；70 行 app.ts 行删 `+ /claim`；72 行 auth.ts 删「null = unclaimed → all 401」；75 行 owner-token.ts 行改 env 必填语义。
3. `.trellis/spec/app/component-guidelines.md:90`：claim 三态先例（「服务器已有 token，请手动输入」等）→ 改「token 必填：空 → 内联『请先输入 owner token』（零网络，与地址校验同模式）；服务器三态 = token 不正确 / 连不上服务器，请稍后重试 / 保存失败」。

## Step 6 — 验证（parent 执行，非子代理）

- 根级 `pnpm test && pnpm typecheck && pnpm lint`。
- `node e2e/sync-roundtrip.ts`（dev docker 栈保持运行）7/7。
- grep 验收（PRD Acceptance 第 2 条）。
- 本机 docker 实跑（server/deploy，throwaway `.env`）：
  1. 空 `NEXTDO_OWNER_TOKEN=` 起栈 → api 容器退出，logs 含生成命令提示；
  2. 填 token 起栈 → `/credentials` 200（正确 token）/401（错误）、`POST /claim` → 404、无 `./data` 目录生成；重启静默复用（无 banner）；
  3. 拆栈、删 throwaway `.env`（与 `data/` 若有）——惯例强制。
- 桌面 `tauri build` → 重装 `/Applications/Nextdo.app`（bundle 中文串是 \uXXXX 转义，验证时查转义形式）。
