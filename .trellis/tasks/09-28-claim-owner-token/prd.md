# owner token 首连自动申领（claim）

## Goal

消除「SSH 上服务器查 token → 手动逐台输入 64 位 hex」的痛点：同步服务器增加**一次性申领接口** `POST /claim`——服务器「未申领」时，第一台连接的设备填好服务器地址、token 留空即可连接：token 由服务器自动生成并**自动填入该设备**；申领后接口永久 409，token 永不回显（API/UI/日志）。显式 `NEXTDO_OWNER_TOKEN`（env）路径保持不变且**永不**被 `/claim` 吐出。后续设备一次性手动输入（D2）。

## 背景与已确认事实（代码证据）

- 服务端鉴权：`server/app/src/auth.ts` `requireOwnerToken(expectedToken)`（timing-safe、401 矩阵 fail-closed）；`createApp({ pool, ownerToken, jwtSecret })`（`app.ts`）构造时接收 token。
- 启动解析：`resolveOwnerToken()`（`owner-token.ts`，R7）= 显式 env > 持久化文件（`data/owner-token`，静默复用）> 首启自动生成 + 日志横幅。本任务变更第三分支为「未申领」（token 从此不入任何日志，R7 横幅废弃）。
- 客户端：设置页 `useCloudSync.connect({backendUrl, endpoint, token})`，「token 不能为空」客户端分支本任务删除（空 token = 触发 claim）；200 后先存 config 后存 token 的写顺序与 poke 机制不变。
- e2e 显式传 `NEXTDO_OWNER_TOKEN`（env 路径）→ 零改动。
- 单写者假设既定（R7：一个 api 服务每栈，无锁）；`/claim` 沿用。

## 决策（用户拍板）

- **D1 claim 语义（2026-09-28）**：一次性申领——未申领态 `POST /claim` 生成并返回 token（仅此一次，持久化后永久 409）；显式 env token 恒 409 且不吐出；未申领态 `/credentials`、`/upload` 一律 401。
- **D2 第二台设备（2026-09-28）**：首台自动、后续设备**手动输入**（从服务器文件取）。「查看 token」/QR 接力不做（用户拍板：保持范围最小；日后需要另立任务，不影响本架构）。
- **D3 安全取舍（随 D1 确认）**：接受「未申领窗口」内可被抢先申领（一次性 + 日志可见不含 token + 删文件重启可恢复）；移除 R7 日志横幅（日志不再含密钥，净安全提升）。

## Requirements

- **R1 服务端 `POST /claim`**（hono 路由，引导路径无鉴权；CORS 现有中间件覆盖）：
  - 未申领（无 env、文件缺失/空白）→ 生成 64-hex、持久化 `data/owner-token`、日志（**不含 token**：「token claimed by first device, claim closed」）→ `200 { token }`；
  - 已申领（文件非空）→ `409 { error: 'owner-token.claimed', code: 'owner-token.claimed', reason: 'file' }`；
  - 显式 env → `409 … reason: 'explicit'`（env token 永不服务）；
  - 申领成功后**同进程内** `/credentials` 立即可用（闭包更新），重启由文件恢复。
- **R2 启动语义变更**：`resolveOwnerToken` 第三分支 → `{ token: null, source: 'unclaimed' }`（不写文件、不打印、无横幅）；`index.ts` 记一行提示（「first device to POST /claim mints it」）；`createApp` 接受 `ownerToken: null` → `requireOwnerToken(null)` 对 `/credentials`、`/upload` 一律 401（响应形状/码不变）；`logger.ts` 的「首启横幅特许例外」注释删除。
- **R3 packages/db 引导调用**：`claimOwnerTokenOnce(config)`（与 `fetchCredentialsOnce` 同域）→ `POST {backendUrl}/claim`；`{ok:true, token}` / `{ok:false, kind:'claimed', reason}` / `kind:'network'` / `kind:'invalid'`（200 但 token 非非空 string）。
- **R4 客户端设置页**：token 输入**可选**（placeholder「owner token（首次连接可留空，自动获取）」）；提交：地址校验不变（空/非法内联错误零网络）→ token 空 → claim：200 → 存 config + token（顺序不变）切已连接；409 → 内联「服务器已有 token，请手动输入」（token 输入保留，手填后走原路径）；网络 → 「连不上服务器，请稍后重试」。token 非空路径（fetchCredentialsOnce + 三态文案）零改动。
- **R5 文档**：`.env.example`（两条路：显式 / 首连自动申领，删「看日志横幅」）；`README.md`（两路重写 + **现有部署迁移**：服务器先部署新代码 → `.env` 清空 `NEXTDO_OWNER_TOKEN` + `rm ./data/owner-token` + 重启）；spec 中横幅/例外描述同步。

## Acceptance Criteria

- [ ] 未申领服务器：`POST /claim` → `200` 64-hex 且文件落盘；同进程内 `/credentials` + 该 token → 200；再次 `/claim` → 409 reason file。重启后：文件静默复用、`/claim` 恒 409。
- [ ] 显式 env token：`/claim` → 409 reason explicit，**任何响应**不含该 token；`/credentials` 行为与现状一致。
- [ ] 未申领态：`/credentials`、`/upload`（任意 Bearer）→ 401，响应形状不变。
- [ ] 日志零密钥：代码与测试中无横幅残留（`grep "FIRST RUN\|AUTO-GENERATED" server/` 为空）；claim 成功日志不含 token。
- [ ] 客户端：地址合法 + token 留空 + claim 200 → config 与 token 双落存储、切已连接；claim 409 → 内联「服务器已有 token，请手动输入」且存储双空、手填 token 重提交走原路径成功；claim 网络错 → 「连不上服务器，请稍后重试」；token 非空路径与既有三态文案零变化。
- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；`node e2e/sync-roundtrip.ts` 7/7（零改动）；桌面 `tauri build` 成功。
- [ ] 本机 docker 实跑（同 R7 手法）：空 token 起栈 → curl `/claim` 200/409 序列 + `/credentials` 200 + 重启复用；验证后拆栈清现场。
- [ ] 实机（用户 Mac，交付提示）：重置后的服务器 + 新构建，设置页只填地址、token 留空 → 连接成功。

## Out of Scope

- 后续设备的「查看 token」按钮 / QR 接力（D2 明确不做；另立任务，不影响本架构）。
- claim 限流 / 时间锁 / 多设备配对码（单用户自托管信任域，YAGNI）。
- 多用户/账号体系（post-MVP，既定）。
- 显式 env 部署的行为变化（零变化）。

## 风险与缓解

- **申领窗口**（未申领 → 首次 claim）：可被抢先申领。缓解：一次性、日志可见（无 token）、删文件重启可恢复；显式 env 路径无此窗口。已在 D3 由用户确认接受。
- **现有设备**：服务器走新流程（重置）后所有设备需重连一次（首台申领、其余手动）——README 迁移节 + 交付提示。
- **数据兼容**：claim 与 R7 写同一 `data/owner-token` 文件，双向兼容（R7 代码读到 = file 分支）。
