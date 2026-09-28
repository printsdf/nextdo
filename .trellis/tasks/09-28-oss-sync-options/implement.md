# 实施计划 — 开源化云同步

## 有序清单

### 1. packages/db 存储层（先做——app 层依赖它的 API）

- [ ] `packages/db/src/owner-token.ts`：
  - 文件头注释：「owner token 存储」→「owner token + 同步配置存储（同一按平台 store）」；
  - 新增 `SYNC_CONFIG_KEY = 'nextdo.sync.config'`；
  - `createStrongholdStore` 允许 key 集合扩为 `{OWNER_TOKEN_KEY, SYNC_CONFIG_KEY}`，`storage.multi-key` 消息更新；
  - 新增段「Sync backend config」：`getStoredBackendConfig` / `setStoredBackendConfig`（含 `ValidationNextdoError` 校验：非空 + http(s) 绝对 URL；新 code `sync.invalid-backend-url`）/ `clearStoredBackendConfig`；JSON 编解码 + 解析失败 → null + warn；
  - `setStoredBackendConfig` 不触发 `notifyOwnerTokenChange`（写顺序由 app 层保证，见 design 数据流）。
- [ ] `packages/db/src/index.ts`：导出三个新函数 + `SYNC_CONFIG_KEY`。
- [ ] 单测（`packages/db/src/test/`，并入 owner-token.test.ts 或新建 sync-settings.test.ts）：
  - set→get 往返（内存后端）；clear→null；
  - 校验拒绝：空字段、`ftp://x`、`example.com/api`（相对）→ 抛 `sync.invalid-backend-url` 且不落盘；
  - 损坏 JSON（直接往后端塞坏值）→ get 返回 null 不抛；
  - stronghold mock 后端：两已知 key 可写、第三 key 抛 multi-key（更新既有单 key 用例）。

### 2. apps/mobile 配置来源切换

- [ ] `lib/env.ts`：删 `BACKEND` / `backend` / `getBackendConfig` / `configureBackend`；留 `POWERSYNC_WEB_WORKER_PATH`；头注释重写（配置来源 = 设备存储；env.ts 只剩 web worker 路径）。
- [ ] `hooks/use-cloud-sync.ts`：
  - `connect({ backendUrl, endpoint, token })`；客户端三段校验（token 空 / 地址空 / 地址非法——非法判定复用 `new URL` + protocol，与存储层同规则，UI 文案不同）；
  - 成功后 `setStoredBackendConfig` → `setOwnerToken`（顺序不可换）；
  - 暴露 `storedConfig`（挂载读 + poke 重读，读取失败按 null + error 日志，同现有 token 读取的容错风格）；
  - 头注释更新。
- [ ] `app/_layout.tsx`：
  - provider `setSyncFromAuth` → 读 `[token, config]`，皆在才 connect（`createPowerSyncConnector(config)`）；
  - 启动预校验 → 读 `[token, config]`，皆在才 `fetchCredentialsOnce(config, token)`；
  - 注释同步更新（「owner-token state」→「token + 存储地址」）。
- [ ] `app/(tabs)/settings.tsx`：
  - 未连接态：两个地址输入（placeholder `https://nextdo.example.com/api` / `https://nextdo.example.com/sync`）+ token 输入；`storedConfig` 非空时预填地址；
  - `canSubmit` = 三字段 trim 非空（地址合法性留给 connect 的内联错误，不在按钮上卡——与现状 token 只卡非空一致）；
  - 已连接态：展示两个存储地址（只读 Text，小字）+ 断开连接；
  - 文案：未连接说明改「填写你的同步服务器地址与 owner token 即可开启同步」。

### 3. 测试面迁移（机械但必须全）

- [ ] 11 个 mock `@nextdo/db` 的测试文件补 `getStoredBackendConfig: async () => null`（默认 null = 未配置，覆盖 provider/预校验路径）：
  `settings-screen / tabs.smoke / inbox / now / projects / focus / review / review-daily / review-weekly / watch-error-null`（+ 任何 grep 出的遗漏）。
- [ ] `settings-screen.test.tsx` 扩展：
  - mock 增加 `storedConfig` 状态 + `setStoredBackendConfig` / `clearStoredBackendConfig`（set 时同步 `storedConfig`；不触发 token 通知——按 production 行为）；
  - 既有 6 个用例适配（token 用例同时给合法地址）；
  - 新用例：预填（storedConfig 存在 → 地址输入有值）；三字段空 → 按钮禁用；token 空提交 → 「token 不能为空」；地址空 → 「请先填写服务器地址」；地址 `ftp://` → 「地址无效…」且 `fetchCredentialsOnce` 未被调用（mock spy 计数）；200 → config 与 token 都落 mock 存储；断开 → token null 且 storedConfig 仍在（地址预填可见）。
- [ ] 根级 gate：`pnpm test && pnpm typecheck && pnpm lint` 全绿。

### 4. 文档与规范

- [ ] `server/deploy/README.md`「Connect a device」：先填两个地址（示例按 Caddy 单域布局：`https://<域名>/api` + `https://<域名>/sync`；子域部署则两个子域 URL）再填 token；升级说明补一句「从硬编码域名版本升级的设备需补填服务器地址」。
- [ ] `.trellis/spec/app/database-guidelines.md`：存储矩阵补 `nextdo.sync.config`（JSON、非密钥、随 token 同处存储）+ 两个 key 的契约。
- [ ] `.trellis/spec/app/component-guidelines.md`：provider 订阅描述更新（poke 后重读 token + 存储地址）。
- [ ] `apps/mobile/lib/env.ts` 头注释（见步骤 2）。

### 5. 回归

- [ ] `node e2e/sync-roundtrip.ts` 全绿（预期零改动；若 e2e 依赖 env.ts 导出则在此暴露并处理）。
- [ ] 桌面 `pnpm --filter @nextdo/desktop run build` 成功（stronghold 路径编译级验证）。
- [ ] 实机（用户 Mac，交付时提示）：装新构建 → 设置页填地址+token → 连接 → 重启 → 仍已连接免输入。

## 验证命令

```bash
pnpm test && pnpm typecheck && pnpm lint        # 根级 gate
node e2e/sync-roundtrip.ts                       # 全链路回归（约 13s）
grep -rn "printsdf.de5.net" apps packages server e2e   # 应为空（开源默认验收）
pnpm --filter @nextdo/desktop run build          # 桌面构建
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚点 |
| ---- | ---- | ------ |
| `packages/db/src/owner-token.ts` | 存储契约（stronghold 双 key）被 app + 测试 + 实机三方依赖 | 步骤 1 独立可 revert（API 未接 app 前无外部影响） |
| `app/_layout.tsx` | provider 生命周期是 App 唯一 PowerSync 接线点 | 步骤 2 内最后改；出错时该文件单文件 revert |
| 11 个测试 mock | 机械改动多文件，漏一个 → 该测试文件红 | 步骤 3 以 gate 为准，不手工核对 |

提交拆分（每步一个 commit，惯例 conventional commits）：
1. `feat(db): stored backend config (server URLs) alongside owner token`
2. `feat(mobile): user-configured sync server in Settings (OSS default = local-only)`
3. `test(mobile): migrate @nextdo/db mocks to stored-config surface`（如与 2 交织则并入 2）
4. `docs: self-hosted server addresses in Settings (README + specs)`

## task.py start 前检查

- [ ] implement.jsonl / check.jsonl 已注入真实 spec/design 条目（非 seed 占位）。
- [ ] 根级 gate 当前为绿基线（改动前最后确认一次）。
- [ ] 用户已明确批准最新规划摘要。
