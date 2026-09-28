# 生产部署与客户端连接（默认地址 + token 首次输入 + CORS）

## Goal

用户把后端部署到自己的 https 域名服务器（域名细节由用户掌握，代码不依赖具体地址），手机端（Expo 原生）与电脑端（Tauri 桌面）直连该服务器完成同步。**不做 web 端。**

## 背景与已确认事实（代码证据）

- 客户端配置是两个独立 URL：`NextdoPowerSyncConfig { backendUrl, endpoint }`（`packages/db/src/powersync.ts:47`）；`endpoint` 来自客户端配置（`fetchCredentials` 返回 `{ endpoint: config.endpoint, token }`，`powersync.ts:226`）→ 用户域名下的路径/子域布局不影响客户端代码形状。
- `apps/mobile/lib/env.ts`：当前开发默认 `http://localhost:3000` / `http://localhost:8080`；已有 `configureBackend()` 接缝（保留为测试接缝）。
- owner token 存储矩阵已实现（`packages/db/src/owner-token.ts`）：React Native → `expo-secure-store`；Tauri webview（`__TAURI_INTERNALS__`）→ `@tauri-apps/plugin-stronghold`；浏览器/Node → 仅内存。API 齐全：`getOwnerToken` / `setOwnerToken` / `clearOwnerToken` + `subscribeToOwnerTokenChange`（`_layout.tsx` 的 provider 订阅后驱动 connect/disconnect）。
- **已知缺陷（本任务修复）**：`owner-token.ts` 的 stronghold 分支按不存在的文件 API 编写；安装的 `@tauri-apps/plugin-stronghold@2.3.2` 真实 API 是 vault 模型（`Stronghold.load(path, password)` → `createClient`/`loadClient` → `getStore().insert/get/remove` + `save()`，读自 `dist-js/index.d.ts`）。Jest 走 Node 内存分支所以全绿，真实桌面运行时必抛错，且位于 `fetchCredentials` 路径（源码 KNOWN DEFECT 注释）。
- Rust 侧插件已注册（`apps/desktop/src-tauri/src/lib.rs`：Argon2 + app 数据目录 salt），ACL 已含 `stronghold:default` + `allow-remove-store-record`（`capabilities/default.json`）。
- 后端 `server/app`：`GET /credentials`（Bearer → PowerSync JWT）、`POST /upload`；**无 CORS**。PowerSync service **自带** `access-control-allow-origin: *`（实测）→ CORS 只需加在 Hono 后端。
- **401 不上抛**：错误 token 时 connector 抛 `credentials.rejected`，PowerSync v2 SDK 内部重试、App 层无法感知（`_layout.tsx:84-89` 仅日志兜底）→ token 有效性必须在连接前主动校验。
- 桌面端 = Tauri v2 壳加载同一 `apps/mobile/dist` web 构建（`apps/desktop/README.md`），无独立 React 代码。
- 部署积木已齐：`server/powersync/docker-compose.yml`（postgres:16 wal_level=logical + powersync-service:1.26.1，含 init/service.yaml/sync-config.yaml）、`server/app/Dockerfile`（node:24-alpine，context=repo root）。本地全链路 e2e：`node e2e/sync-roundtrip.ts`（自有常量 `e2e/run.ts:61`，不依赖客户端配置）。
- App 路由：`app/index.tsx` + `(tabs)` inbox/now/projects/review + clarify/focus/reclarify/review；无设置/连接页。

## 决策（用户拍板）

- **鉴权模型**：维持 v1 owner token（Home Assistant 模式），不做账号体系（spec 既定 post-MVP）。
- **首次启动 UX（2026-09-27 修订，用户拍板）**：**云同步是可选项**。首次启动不再显示全屏门槛页（R3 的 Gate 整体移除）——直接进主界面；无 token 时应用仅本地运行（PowerSync 保持断开，本地 SQLite 照常可用，底层机制 R3 实现时已具备）。配置入口：新增底部「设置」标签页（第 5 个 tab），内含云同步区块（状态 + token 输入 + 连接/断开）。token 仍走 SecureStore/stronghold 持久化，一次输入之后不再问。

## Requirements

- **R1 生产部署**：新增 `server/deploy/` 生产 docker compose（postgres + powersync + hono，全部只绑 127.0.0.1 给同机反代）+ `.env.example` + 部署 README（含 Caddy 反代示例：`/api/*` → hono、`/sync/*` → powersync，WebSocket upgrade）。具体域名布局由用户定。
- **R2 客户端默认地址**：`lib/env.ts` 的 localhost 默认替换为生产 URL 常量（两个 URL，唯一配置点，用户部署后填一次，手机/桌面共用）。
- **R3 首次启动 token 门槛页**：全屏 Gate（token 输入 + 连接 + 内联错误：token 不正确 / 连不上服务器）；提交前用新抽取的纯函数 `fetchCredentialsOnce(config, token)` 校验（200 → `setOwnerToken` 进入主界面，复用现有 connect 机制；401 → 内联错误；网络错 → 内联错误）；启动时对已存 token 做同样预校验（401 → `clearOwnerToken` + Gate「token 无效」）。会话内 token 轮换不感知（重启即恢复，deferred）。**（Gate 的 UX 已被 R6 取代：门槛页移除；`fetchCredentialsOnce` 纯函数与启动预校验保留，见 R6。）**
- **R6 云同步可选项（取代 R3 的门槛页 UX，2026-09-27）**：
  - 移除全屏 ConnectGate 组件与 RootLayout 的 auth gate 状态机（loading/signed-out/signed-in）——任何启动状态下都直接渲染主界面。
  - 新增底部「设置」标签页（第 5 个 tab，`(tabs)/settings.tsx`），内含云同步区块：
    - **未连接**（无已存 token）：说明文案 + token 输入 + 「连接」按钮 + 内联错误（复用 R3 三态：token 不正确 / 连不上服务器，请稍后重试）；提交走 `fetchCredentialsOnce`，200 → `setOwnerToken`（现有 `subscribeToOwnerTokenChange` 通知驱动 provider connect，UI 切到已连接）。
    - **已连接**（有已存 token）：已连接状态说明 + 「断开」按钮（`clearOwnerToken`，同一通知机制驱动 provider disconnect，UI 切回未连接）。
  - 启动预校验降级为后台卫生检查（不阻塞渲染）：启动时对已存 token 调 `fetchCredentialsOnce`，401 → `clearOwnerToken` + 日志（防 SDK 无意义重试、让设置页状态诚实）；200 / 网络错 → 什么都不做（离线优先）。
  - 桌面端（Tauri 加载同一 web 构建）自动获得相同设置页，无分叉。
- **R4 修复 stronghold 存储**：按 2.3.2 真实 vault API 重写 `createStrongholdStore`（固定快照路径/密码常量，v1 单用户本机加密取舍；保留单 key 契约）；单测 mock 插件 + 桌面实机验证。
- **R5 后端 CORS**：`server/app` 加 hono `cors` 中间件（`origin: *`，allow `authorization`/`content-type`）；鉴权行为不变。
- **R7 生产 owner token 自动生成 + 首次可查看（2026-09-28，用户拍板）**：
  - `NEXTDO_OWNER_TOKEN` 不再必填：`server/app` 启动时若未设置（或为空），**自动生成** `crypto.randomBytes(32)` 的 64 位 hex token，持久化到文件（`NEXTDO_OWNER_TOKEN_FILE`，生产 compose 绑定 `server/deploy/data/`），并在启动日志**醒目地打印一次**（仅此一次；之后启动只记来源，不打印 token）。
  - 优先级：显式 `NEXTDO_OWNER_TOKEN`（env）> 持久化文件 > 自动生成（写文件 + 打印）。文件已存在（非空）时静默复用——重建容器/重启不轮换、不重复打印。
  - 部署侧：compose 的 `NEXTDO_OWNER_TOKEN` 改为可选（`${NEXTDO_OWNER_TOKEN:-}`）+ api 服务加 `./data:/app/data` 卷；`.env.example` 与 README 说明两条路（手动生成 / 首次启动看 `docker compose logs api`）。API/UI 永不回显 token（客户端设置页只进不出）。

## Acceptance Criteria

- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；本地 `node e2e/sync-roundtrip.ts` 全绿（回归）。
- [ ] CORS：OPTIONS preflight 与带 Origin 请求的响应头有单测覆盖。
- [ ] stronghold：单测覆盖 2.3.2 形状（get/set/remove/多 key 拒绝/save）；桌面 `tauri dev` 实机下输入 token 成功持久化、重启免输入（用户 Mac 上验证）。
- [x] ~~Gate（R3 原验收，已被 R6 取代）~~：门槛页已实现后又按 R6 移除，原 Gate 单测随组件删除。
- [ ] 设置页（R6）：无 token 启动直接进主界面（无任何门槛页）；「设置」tab 云同步区块单测覆盖未连接/已连接两态与 token 提交三态（成功/401 内联「token 不正确」/网络错内联「连不上服务器」）；断开后回到未连接；已存 token 启动预校验 401 → 静默清除且主界面照常渲染。
- [ ] token 自举（R7）：单测覆盖 env 显式设置（不回退文件）/ 文件已存在（静默复用、不重新生成）/ 无 env 无文件（生成 64-hex + 写文件 + 一次性日志）/ 空文件（重新生成）；`docker compose config` 通过；首次启动 `docker compose logs api` 可见 token 横幅（用户部署时验证）。
- [ ] 生产 compose `docker compose config` 通过；用户按 README 在自己服务器上起栈 + 填 `lib/env.ts` 常量后，手机/桌面端到端同步成功（用户侧验证步骤，交付时明确提示）。

## Out of Scope

- web 端部署/托管；多用户/账号体系（post-MVP）；除 token 外的设置页（URL 不进 UI）。
- 服务器 TLS/域名解析（用户侧运维）；App Store 分发。
- 会话内 token 轮换感知（仅启动预校验）；Rust 侧死代码脚手架命令的清理。
