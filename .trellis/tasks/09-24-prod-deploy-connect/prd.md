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
- **首次启动 UX**：全屏门槛页——无 token（或 token 预校验 401）时只显示连接页，输入成功后才进主界面；一次输入，SecureStore/stronghold 持久化，之后永不再问。

## Requirements

- **R1 生产部署**：新增 `server/deploy/` 生产 docker compose（postgres + powersync + hono，全部只绑 127.0.0.1 给同机反代）+ `.env.example` + 部署 README（含 Caddy 反代示例：`/api/*` → hono、`/sync/*` → powersync，WebSocket upgrade）。具体域名布局由用户定。
- **R2 客户端默认地址**：`lib/env.ts` 的 localhost 默认替换为生产 URL 常量（两个 URL，唯一配置点，用户部署后填一次，手机/桌面共用）。
- **R3 首次启动 token 门槛页**：全屏 Gate（token 输入 + 连接 + 内联错误：token 不正确 / 连不上服务器）；提交前用新抽取的纯函数 `fetchCredentialsOnce(config, token)` 校验（200 → `setOwnerToken` 进入主界面，复用现有 connect 机制；401 → 内联错误；网络错 → 内联错误）；启动时对已存 token 做同样预校验（401 → `clearOwnerToken` + Gate「token 无效」）。会话内 token 轮换不感知（重启即恢复，deferred）。
- **R4 修复 stronghold 存储**：按 2.3.2 真实 vault API 重写 `createStrongholdStore`（固定快照路径/密码常量，v1 单用户本机加密取舍；保留单 key 契约）；单测 mock 插件 + 桌面实机验证。
- **R5 后端 CORS**：`server/app` 加 hono `cors` 中间件（`origin: *`，allow `authorization`/`content-type`）；鉴权行为不变。

## Acceptance Criteria

- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；本地 `node e2e/sync-roundtrip.ts` 全绿（回归）。
- [ ] CORS：OPTIONS preflight 与带 Origin 请求的响应头有单测覆盖。
- [ ] stronghold：单测覆盖 2.3.2 形状（get/set/remove/多 key 拒绝/save）；桌面 `tauri dev` 实机下输入 token 成功持久化、重启免输入（用户 Mac 上验证）。
- [ ] Gate：单测覆盖三态；无 token 只见 Gate；错 token 内联错误可重试；正确 token 进主界面并同步成功；重启 App 不再要求输入。
- [ ] 生产 compose `docker compose config` 通过；用户按 README 在自己服务器上起栈 + 填 `lib/env.ts` 常量后，手机/桌面端到端同步成功（用户侧验证步骤，交付时明确提示）。

## Out of Scope

- web 端部署/托管；多用户/账号体系（post-MVP）；除 token 外的设置页（URL 不进 UI）。
- 服务器 TLS/域名解析（用户侧运维）；App Store 分发。
- 会话内 token 轮换感知（仅启动预校验）；Rust 侧死代码脚手架命令的清理。
