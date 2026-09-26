# Implement — 生产部署与客户端连接

顺序原则：先服务端（独立可验证）→ 再 db 包（纯函数 + 存储）→ 再 mobile 应用层 → 最后部署产物。每步都有独立验证命令；失败可停在任一步。

## Step 1 — Hono 后端 CORS（R5）

- [ ] `server/app/src/app.ts`：`createApp` 加 `app.use('*', cors(...))`（hono 内置 `hono/cors`；参数见 design.md R5）。
- [ ] `server/app/test/`：新增 CORS 用例——OPTIONS preflight（Origin + `Access-Control-Request-Header: authorization`）返回 `access-control-allow-origin` / `allow-headers`；带 Origin 的 GET `/credentials`（无 token → 401 且带 ACAO 头）与 POST `/upload`。
- [ ] 验证：`pnpm --filter @nextdo/server test && pnpm --filter @nextdo/server build`

回滚点：本步独立，revert 即回滚。

## Step 2 — 抽取 fetchCredentialsOnce（packages/db）

- [ ] `packages/db/src/powersync.ts`：把 `fetchCredentials` 中 Bearer GET + 响应校验抽为导出纯函数 `fetchCredentialsOnce(config, ownerToken)`（契约见 design.md R3）；connector 内部改调；`from './powersync'` 或包 index 导出（遵循包现有导出方式）。
- [ ] 现有 connector 测试不动须全绿（行为等价）；为纯函数补直接单测（200 / 401 / 500 / 网络错 / 响应缺 token）。
- [ ] 验证：`pnpm --filter @nextdo/db test && pnpm --filter @nextdo/db typecheck`

## Step 3 — stronghold 存储重写（R4）

- [ ] `packages/db/src/owner-token.ts`：按 design.md R4 重写 `createStrongholdStore`（`Stronghold.load` → `loadClient`/`createClient` → `getStore` → `get/insert/remove` + `save`；TextEncoder/TextDecoder；固定快照路径/密码常量；保留单 key 契约）。更新文件头 KNOWN DEFECT 注释（改为已修复说明）。
- [ ] 单测：mock `@tauri-apps/plugin-stronghold`（模拟 2.3.2 形状），覆盖 get（无/有）/set/remove/多 key 拒绝/save 被调用/createClient 回退 loadClient。
- [ ] 验证：`pnpm --filter @nextdo/db test`
- [ ] 桌面实机（用户 Mac）：`pnpm --filter @nextdo/desktop run dev` + 本地 docker 栈（R2 常量临时指 localhost）——首次进入 Gate 输入 token 后确认无 stronghold 运行时报错；若 ACL 缺命令，补 `capabilities/default.json` 单行。

回滚点：Step 2/3 都在 packages/db，可整体 revert。

## Step 4 — 配置点切换（R2）

- [ ] `apps/mobile/lib/env.ts`：`DEV_BACKEND` → `BACKEND` 生产常量（带「部署后填写」注释块）；更新文件头注释（去掉「dev defaults」表述）。
- [ ] 验证：`pnpm --filter @nextdo/mobile typecheck`（消费方 `_layout.tsx` 接口不变）。

## Step 5 — Gate + 启动预校验（R3）

- [ ] 新组件 `apps/mobile/components/connect-gate.tsx`（Paper Serenity 样式，遵循 `app/component-guidelines.md`）：token 输入 + 连接按钮 + 内联错误（token 不正确 / 连不上服务器）。
- [ ] `apps/mobile/app/_layout.tsx`：RootLayout 增加 token 状态（loading/signed-out/signed-in）；signed-out 渲染 Gate；有 token 时先 `fetchCredentialsOnce` 预校验：200 → 正常进主界面（现有 provider 机制 connect）；401 → `clearOwnerToken()` + Gate（「token 无效，请重新输入」）；网络错 → 进主界面（离线可用）。
- [ ] 单测（apps/mobile jest）：Gate 三态；RootLayout 状态机（mock `@nextdo/db`：getOwnerToken/fetchCredentialsOnce/setOwnerToken/clearOwnerToken）。
- [ ] 验证：`pnpm --filter @nextdo/mobile test && pnpm --filter @nextdo/mobile typecheck`
- [ ] 桌面实机复验（同 Step 3 环境）：未输 token 只见 Gate；错 token 有内联错误；正确 token 进主界面且数据同步（本地 docker 有种子数据）；重启 `tauri dev` 不再要 token（stronghold 持久化生效）。

## Step 6 — 生产部署产物（R1）

- [ ] 新增 `server/deploy/docker-compose.yml` + `.env.example` + `README.md`（含 Caddy 反代示例；compose 服务只绑 127.0.0.1；复用 `server/powersync/init`、`service.yaml`、`sync-config.yaml`；api 用现成 Dockerfile，context=repo root）。确认 `.gitignore`/`.dockerignore` 覆盖 `server/deploy/.env`。
- [ ] 验证：本机 `cd server/deploy && docker compose -f docker-compose.yml config` 语法检查（不真起，避免与 dev 栈端口冲突；起栈验证留给用户部署时）。

## Step 7 — 全量门禁 + 交付

- [ ] 根级：`pnpm test && pnpm typecheck && pnpm lint`
- [ ] 本地 e2e：起 dev 栈（`server/powersync` compose）→ `node e2e/sync-roundtrip.ts` 全绿（CORS/connector 改动无回归）→ 栈保留或按用户意图关闭。
- [ ] R2 常量：交付态填生产 URL 占位（`REPLACE-WITH-YOUR-DOMAIN`），用户部署后替换真实值——**在最终总结里明确提醒用户这一步**。
- [ ] spec 更新（Phase 3.3）：`app/database-guidelines.md`（stronghold 缺陷已修复、vault 密码取舍、会话内 401 感知 deferred）、`app/component-guidelines.md`（connect-gate 先例，如有新约定）。

## 风险文件 / 回滚

| 文件 | 风险 | 回滚 |
|---|---|---|
| `packages/db/src/powersync.ts` | connector 抽取若改变错误语义，e2e 会红 | Step 2 单独可 revert |
| `packages/db/src/owner-token.ts` | stronghold 分支只在真桌面运行时可达 | 单测 mock 兜底 + 实机验证 |
| `apps/mobile/app/_layout.tsx` | 启动路径改动影响所有平台 | 单测 + e2e 兜底 |
| `server/app/src/app.ts` | 中间件顺序影响鉴权 | Step 1 单独可 revert |

## task.py start 前检查

- [ ] 质量门禁（test/typecheck/lint）当前分支全绿
- [ ] design.md / implement.md / prd.md 已定稿且用户已批准最终规划总结
- [ ] 分支策略：从 `feature/capture-clarify-flow` 开新 feature 分支（Trellis 惯例）

## 桌面运行时修复（2026-09-25，实机验证阶段）

首次 `tauri dev` 实机运行暴露 3 个运行时缺陷（单测/e2e 覆盖不到），已修复：

1. **stronghold salt panic**：`tauri-plugin-stronghold` 写 salt 不建父目录 → 新机器上
   `Failed to write salt: NotFound` panic 掉整个进程。修复：`lib.rs` setup 里先
   `create_dir_all(app_local_data_dir)`。
2. **snapshot 相对路径落错位置**：JS 传相对路径 `nextdo-stronghold`，插件按进程
   cwd 解析（dev 落源码树、release 落启动目录）。修复：新增 Rust 命令
   `stronghold_snapshot_path` 返回绝对路径（app data dir 下），JS 经
   `__TAURI_INTERNALS__.invoke` 取用（owner-token.ts 不新增 Tauri 依赖）。
3. **web 字体 12s 超时**：expo-font 的 web 校验走 fontfaceobserver 轮询
   `document.fonts.load()`，在 WKWebView（macOS Tauri webview）不可靠 →
   `12000ms timeout exceeded`（字体文件本身能取到，是校验/上报问题）。修复：
   `_layout.tsx` 新增 web 字体门（标准 `FontFace` API 逐 face 加载 + 12s 超时
   兜底 + 失败诊断日志），web 侧 `useFonts` 传空 map，native 路径不变。
   附带：`apps/mobile/env.d.ts` 补 `declare module '*.css'`（上一会话删除
   `expo-env.d.ts` 后 typecheck 缺声明）。

验证：cargo check ✓、mobile/db typecheck ✓、eslint ✓、db 190 + mobile 227 测试 ✓、
实机 tauri dev 无 panic / 无字体错误 / salt 落 `~/Library/Application Support/com.nextdo.desktop/` ✓。
