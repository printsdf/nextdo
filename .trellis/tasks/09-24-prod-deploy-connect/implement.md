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

## 桌面运行时修复（2026-09-26，release 构建阶段）

第 4 个运行时缺陷：**release 构建下 PowerSync module worker 被 WebKit 拒绝**。
PowerSync web 端把 SQLite 引擎跑在 `type: 'module'` web worker 里；WebKit 给
`tauri://` 自定义协议的是 opaque origin，opaque origin 的 module worker 一律
被 CORS 拒绝（`tauri dev` 走 http dev server 所以暴露不了，只有 release 的
`frontendDist` 文件协议触发）。修复（未提交，待实机验证后提交）：

1. **loopback 静态文件服务器**（`lib.rs`，`#[cfg(not(dev))]` 门控）：release
   构建用 `tiny_http` 在 `127.0.0.1:52123` 提供 bundle（SPA fallback：无扩展名
   路径回退 `index.html`；`..` 路径段一律 403；仅绑 127.0.0.1；端口被占时
   500ms×20 重试——覆盖「旧实例还没退干净」的 mac 场景）。
2. **`tauri.conf.json`**：`frontendDist` 改为 `http://127.0.0.1:52123`（与
   `FRONTEND_PORT` 常量必须一致——一致才让 Tauri 把页面当 LOCAL origin，
   IPC + capabilities 不变）；`beforeBuildCommand` 追加把 `mobile/dist` 拷到
   `src-tauri/frontend-dist`；`bundle.resources` 打包 `frontend-dist`；
   `app.windows` 清空。
3. **窗口创建移入 `setup`**（label 必须保持 `main`——capabilities 按 label
   授权）：服务器要先于窗口加载，config windows 在 setup 之前创建做不到；
   `WebviewUrl::App("")` 在 dev 解析到 devUrl、release 解析到 frontendDist。
4. 5 个 release-only 定义（`FRONTEND_PORT`/`FRONTEND_URL`/`start_frontend_server`
   /`serve_file_request`/`mime_for`）加 `#[cfg(not(dev))]`，dev profile 零警告。
5. `src-tauri/.gitignore` 忽略生成的 `frontend-dist` 拷贝。

验证：`cargo check`（dev）✓ + `cargo check --release`（编译 release 代码路径）✓
均零警告；根级门禁全绿（pnpm test 642 ✓ / typecheck ✓ / lint ✓ / e2e 7/7 ✓）。
**待办：`tauri build` + 跑 release .app 实机验证（用户在 Mac 上，dev 模式
验证不到该路径）。**

## 云同步可选项（R6，2026-09-27，部署验证后用户拍板）

云同步改为可选项：门槛页整体移除，「设置」tab 第 5 个入口。设计见 design.md R6 节；
prd.md 决策/验收已同步修订。顺序：根布局去 gate → 新设置页 → 测试 → 门禁。

- [ ] `apps/mobile/app/_layout.tsx`：删 `AuthGateState` / `gateError` / `handleConnect` /
      `ConnectGate` import 与两处 auth useEffect；渲染只剩 字体 gate → Provider + Stack。
      保留一个**非阻塞**启动卫生检查 useEffect：有已存 token → `fetchCredentialsOnce` →
      仅 401 时 `clearOwnerToken()` + `logger.warn`（200/网络错不做事）。
- [ ] `apps/mobile/app/(tabs)/settings.tsx`（新）：「设置」页，云同步区块（未连接：
      说明 + token 输入 + 连接 + 内联错误三态；已连接：说明 + 断开）；状态 =
      `getOwnerToken()` + `subscribeToOwnerTokenChange`（挂载读一次 + 跟随）。
- [ ] `apps/mobile/app/(tabs)/_layout.tsx`：追加 settings tab（title「设置」）。
- [ ] 删 `apps/mobile/components/connect-gate.tsx` + `__tests__/connect-gate.test.tsx`；
      新增 `__tests__/settings-screen.test.tsx`（6 条用例见 design.md R6 测试策略）。
- [ ] 9 个屏幕测试文件的 `@nextdo/db` mock 保留（auth 面仍被启动检查 + provider 用），
      仅改过期注释（"Root auth gate (prod-deploy R3)…ConnectGate" → 启动卫生检查表述）。
- [ ] 验证：`pnpm --filter @nextdo/mobile test && pnpm --filter @nextdo/mobile typecheck`，
      然后根级 `pnpm test && pnpm typecheck && pnpm lint`。
- [ ] spec 更新（Phase 3.3）：`app/component-guidelines.md` 的 ConnectGate 小节 → 改为
      设置页云同步区块的约定（或注明 Gate 已移除、fetchCredentialsOnce 三态文案为唯一先例）。
- [ ] 桌面 release 重建（`tauri build`）——设置页在 Tauri 端同样生效（用户实机验证）。

回滚点：R6 全部在 apps/mobile 内（含测试），单 commit revert 即可。
