# owner token 改为部署时生成 + 手动填入（移除 /claim）

## Goal

撤销 09-28-claim-owner-token 的「从服务器获取 token」机制：owner token 在**部署时**一次性生成并写入 `server/deploy/.env`（`NEXTDO_OWNER_TOKEN` **必填**，服务器空值拒绝启动），客户端 token 输入恢复**必填**、手动填入一次后存设备加密存储（与现在相同的 store）。删除 `POST /claim` 路由、`data/owner-token` 文件机制、客户端空 token 自动获取分支——所有设备（第一台与后续）流程完全一致，无特殊引导路径。

## 背景与已确认事实（代码证据）

- 用户实机体验：生产服务器跑旧代码（无 `/claim`），`POST /claim` 404 被客户端归为 network → 「连不上服务器，请稍后重试」。用户认为「去服务器获取 token 比较麻烦」（2026-09-28 拍板撤销该机制）。
- 服务端：`server/app/src/owner-token.ts`（env > file > unclaimed 三分支 + `claimOwnerToken`）；`src/index.ts`（unclaimed 提示日志）；`src/app.ts`（`/claim` 路由 + `ownerTokenSource` 配置 + 闭包可变 token）；`src/auth.ts`（`requireOwnerToken(string | null)`，null = unclaimed 全 401）。
- 客户端：`packages/db/src/powersync.ts` `claimOwnerTokenOnce` + `ClaimOutcome`；`apps/mobile/hooks/use-cloud-sync.ts` connect() 的空 token claim 分支（三态文案）；`apps/mobile/app/(tabs)/settings.tsx` placeholder「owner token（首次连接可留空，自动获取）」；测试 `settings-screen.test.tsx` 的 3 个 claim 用例。
- 部署：`server/deploy/docker-compose.yml`（`NEXTDO_OWNER_TOKEN: ${NEXTDO_OWNER_TOKEN:-}` 可选 + `./data:/app/data` 卷）；`.env.example`（两条路）；`README.md`（两路 + 迁移 + 轮换）。
- **生产迁移关键事实**：生产服务器当前 token 要么在 `.env`（显式部署）、要么在 `server/deploy/data/owner-token`（R7 首启自动生成）。新代码要求 .env 必填 → 迁移必须**先读出现有 token 写入 .env，再部署新代码**，否则新容器直接拒绝启动。
- e2e（`e2e/sync-roundtrip.ts`）显式传 env token → 零改动。
- 单写者假设、timing-safe 401 矩阵、config→token 写顺序（单 poke）等不变量全部保持。

## 决策（用户拍板 2026-09-28，AskQuestion）

- **D1 token 出生方式 = 部署时自己生成、写进 .env**（选项 env-manual）：`openssl rand -hex 32` 生成一次写入 `NEXTDO_OWNER_TOKEN`；服务器要求非空，空/缺省 → 拒绝启动（可操作报错，含生成命令）。单一事实来源，无隐藏文件；放弃「首启自动生成 + 文件持久化」与「日志打印一次」两个备选。
- **D2 客户端**：token 输入必填（空 → 客户端内联错误，零网络）；删除 claim 分支与其三态文案（「服务器已有 token，请手动输入」等）。token 存储位置不变（Keychain/Keystore、Tauri stronghold，与 sync config 同一 store）。
- **D3 服务器语义**：`ownerTokenSource` 概念删除（唯一来源 = env）；闭包可变 token 删除（token 启动后不可变，`/claim` 已不存在）；`requireOwnerToken` 只接受 `string`。
- **D4 现有部署迁移**：README 迁移节 + 交付提示——先 `cat` 出当前 token（.env 或旧 `data/owner-token` 文件）写入 .env，再部署新代码；旧文件可随后删除（不再被读取）。

## Requirements

- **R1 服务端**：
  - `owner-token.ts` 重写：`resolveOwnerToken(env)` 只读 `NEXTDO_OWNER_TOKEN`（trim 后非空 → 返回该值；缺失/空 → `throw` 含生成命令 `openssl rand -hex 32` 与 .env 位置的报错）。删除 `claimOwnerToken`、`ClaimResult`、文件读写（`readExistingToken`/`persistToken`/`DEFAULT_TOKEN_FILE`/`NEXTDO_OWNER_TOKEN_FILE`）。
  - `index.ts`：`resolveOwnerToken()` 失败 → 启动失败（现有 `main().catch` → exit 1 + 错误可见）；成功记 `owner token source: env`（一行，不含 token 值）；`createApp({ pool, ownerToken, jwtSecret })`。
  - `app.ts`：删 `/claim` 路由、`ownerTokenSource` 字段、`currentToken` 闭包（静态 `config.ownerToken`）、`claimOwnerToken` import；文件头文档改两端点。
  - `auth.ts`：`requireOwnerToken(expectedToken: string)`（删 null 分支与 unclaimed 文档行）；401 矩阵其余不变（missing header / non-Bearer / 空 token / 不匹配 → 401，timing-safe 不变）。
  - 测试：删 `test/claim.test.ts`；重写 `test/owner-token.test.ts`（env 非空 → 解析；空串/纯空白/缺失 → throw 且消息含生成命令）；`upload/auth/credentials/cors` 测试删 `ownerTokenSource: 'env'` 参数；`auth.test.ts` 若有 unclaimed(null) 用例则删。
- **R2 packages/db**：删 `claimOwnerTokenOnce`、`ClaimOutcome`、文件头对应条目；删 `src/test/claim-owner-token-once.test.ts`。`fetchCredentialsOnce` / connector / owner-token.ts 存储层零改动。
- **R3 客户端设置页**：
  - `use-cloud-sync.ts` connect()：删 claim 分支；地址校验后加 token 必填检查 `trimmedToken === ''` → `{ ok: false, message: '请先输入 owner token' }`（零网络，在任何 fetch 之前）；token 非空路径（fetchCredentialsOnce + 「token 不正确」/「连不上服务器，请稍后重试」+ config→token 写顺序）零改动。
  - `settings.tsx`：placeholder 恢复 `owner token`；头部注释删 claim 描述（含「服务器已有 token，请手动输入」先例条目）。
  - `__tests__/settings-screen.test.tsx`：`TOKEN_PLACEHOLDER` 改 `owner token`；删 3 个 claim 用例（200 自动存 / 409 文案 / claim 网络错）与 mock 的 `claim`/`mockClaimCalls`；新增用例：地址合法 + token 空 → 内联「请先输入 owner token」、零网络（fetch 零调用）、存储双空、连接按钮态不变；既有「连接 enables when both addresses are filled (token is OPTIONAL)」用例改为 token 必填语义（token 空时按现有按钮禁用逻辑——按钮禁用只看地址非空，token 必填由 connect() 内联报错，与「地址无效」同模式，保持该模式）。
  - `_layout.tsx`：预检读 token+config 逻辑零改动（注释里 claimed = "asserted" 英文用法，勿误删）。
- **R4 部署**：
  - `docker-compose.yml`：`NEXTDO_OWNER_TOKEN: ${NEXTDO_OWNER_TOKEN:?set NEXTDO_OWNER_TOKEN in .env (openssl rand -hex 32)}`；删 `./data:/app/data` 卷绑定；删 R7 注释。
  - `.env.example`：`NEXTDO_OWNER_TOKEN` 必填（含 `openssl rand -hex 32` 生成说明：token 是所有设备在设置页填入的同一值，.env 泄漏 = 全设备失守，与其余三个 secret 同级）。
  - `README.md`：token 节重写为单路（生成 → .env → 各设备手动填入）；「Connect a device」删「first connect 留空」与「second device」blockquote（所有设备同一流程）；Operations：迁移节（旧部署：token 在旧 .env 或 `./data/owner-token` → 读值写入 .env → 部署新代码；旧文件可删）+ 轮换节（改 .env + `docker compose up -d api` + 所有设备重填）+ 更新节（不变）。
- **R5 spec 同步**：`.trellis/spec/app/database-guidelines.md`（删 unauthenticated claim 条目、unclaimed 态、`data/owner-token` 启动解析描述 → 改 env 必填 + 拒绝启动）；`.trellis/spec/project/directory-structure.md`（`/claim` 路由描述、`owner-token.ts` 职责行、`auth.ts` null 行）；`.trellis/spec/app/component-guidelines.md:90`（claim 三态先例 → 恢复必填 token + 既有三态文案）。

## Acceptance Criteria

- [ ] 服务端：`NEXTDO_OWNER_TOKEN` 缺失/空/纯空白 → 启动失败，报错含 `openssl rand -hex 32`；非空 → 启动成功，`/credentials` 正确 token 200 / 错误 401（形状与现状一致），`POST /claim` → 404（路由不存在）。
- [ ] `grep -rn "claimOwnerToken\|ownerTokenSource\|unclaimed" server/ packages/db/ apps/mobile/` 为空（JWT 的 "claims" 字样与本任务无关，不在范围内）；`grep -rn "claim" server/deploy/` 为空。
- [ ] packages/db：`ClaimOutcome`/`claimOwnerTokenOnce` 无残留（grep 空），其余测试全绿。
- [ ] 客户端：token 空 → 内联「请先输入 owner token」、零网络、存储双空；token 非空三态文案与写顺序零变化；placeholder = `owner token`。
- [ ] 部署：compose 空 token 起栈 → 容器拒绝启动（报错可见）；带 token 起栈 → `/credentials` 200/401 正确、`/claim` 404、无 `./data` 目录被创建；验证后拆栈清理 throwaway `.env`（惯例）。
- [ ] spec 三处更新完成；README/`.env.example` 无 claim 残留。
- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；`node e2e/sync-roundtrip.ts` 7/7（零改动）；桌面 `tauri build` 成功并重装 `/Applications/Nextdo.app`。

## Out of Scope

- 多用户/账号体系（post-MVP，既定）。
- 「查看 token」按钮 / QR 接力（claim 任务 D2 已否，维持不做）。
- 同步数据协议（`/credentials`、`/upload` 线协议）零改动。
- 生产服务器实际部署操作（用户手动执行，本任务只交付代码 + 迁移文档 + 交付提示）。

## 风险与缓解

- **生产迁移顺序**：新代码无 token 拒绝启动。若生产 token 在旧文件（R7 自动生成），必须先 `cat server/deploy/data/owner-token` 读出、写入 .env，**再** `docker compose up -d --build`。缓解：README 迁移节明确顺序 + 交付提示逐步给出。
- **现有已连接设备**：token 值不变 → 零影响；仅当迁移时换了 token 才需各设备重填。
- **删除文件机制**：`data/owner-token` 不再被读取；生产旧文件删除可选（不影响新代码）。
