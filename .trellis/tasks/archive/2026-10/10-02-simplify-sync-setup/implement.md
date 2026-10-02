# Implement — 简化云同步连接

## 阶段划分

四个阶段，按依赖顺序执行。每个阶段结束时项目应是绿的，可以独立停下。

---

## 阶段 1 · 协议：`/credentials` 下发 endpoint（无 UI 依赖，先做）

- [ ] `server/app/src/owner-token.ts`（或邻近 env 校验模块）新增 `resolveSyncEndpoint()`：读 `NEXTDO_SYNC_ENDPOINT`，缺失/空/非绝对 http(s) → 抛错，文案命名该变量（参照 `resolveOwnerToken` 的写法）
- [ ] `server/app/src/app.ts`：`ServerConfig` 加 `syncEndpoint: string`；`/credentials` 返回 `c.json({ token, endpoint: config.syncEndpoint })`
- [ ] `server/app/src/index.ts`：调用 `resolveSyncEndpoint()`，结果注入 `createApp`
- [ ] `server/app/test/`：新增/更新用例 —— env 缺失被拒、env 非法被拒、200 响应体 `endpoint` 等于配置值
- [ ] `server/deploy/docker-compose.yml`：`api` 服务透传 `NEXTDO_SYNC_ENDPOINT`
- [ ] `server/deploy/.env.example`：补该项 + 注释（填 `https://your.domain/sync` 形态）
- [ ] 验证：`cd server/app && pnpm test && pnpm typecheck`

---

## 阶段 2 · 客户端存储层：推导函数 + 解析下发 endpoint

- [ ] `packages/db/src/owner-token.ts`（或邻近 config 模块）新增 `deriveSyncConfig(serverAddress: string): StoredBackendConfig`
  - `new URL()` 解析；非法 → `ValidationNextdoError('sync.invalid-backend-url', …)`
  - 剥尾部 `/`、`/api`、`/sync` 后缀；输出 `{ backendUrl: base+'/api', endpoint: base+'/sync' }`
- [ ] `packages/db/src/powersync.ts`：
  - `FetchCredentialsOnceResult` 成功分支加 `endpoint?: string`
  - `fetchCredentialsOnce`：解析 body 的 `endpoint`，仅当它是合法绝对 http(s) URL 时保留，否则省略（token 校验逻辑不变）
  - 连接器 `fetchCredentials` 回调：`endpoint: result.endpoint ?? config.endpoint`
- [ ] `packages/db/src/index.ts`：导出 `deriveSyncConfig`
- [ ] 测试：
  - `deriveSyncConfig` 各种输入形态 + 非法输入
  - 改写 `packages/db/src/test/fetch-credentials-once.test.ts:41-48` 的「ignores non-contractual extra fields」→ 断言 endpoint 被采用
  - 新增：endpoint 缺失 → `endpoint` 未出现在结果里；endpoint 为 `ftp://bad` → 同上
  - 连接器单测：响应带 endpoint 时用它，不带时用 config 的
- [ ] 验证：`cd packages/db && pnpm test && pnpm typecheck`

---

## 阶段 3 · 设置页 UI：单地址 + 高级折叠区

- [ ] `apps/mobile/lib/sync-connection.ts`（新建）：`parseConnectionString(input): { serverAddress, token } | null`
  - 竖线分隔纯文本 / `nextdo://sync?s=&t=` 两种形态
  - 裸 token 返回 `null`（调用方回落现有行为）
- [ ] `apps/mobile/lib/sync-connection.test.ts`（新建）
- [ ] `apps/mobile/hooks/use-cloud-sync.ts`：
  - `connect` 入参改为接受「基础地址 + token」或「已推导好的 config」二选一（具体形状见 design D2）
  - `/credentials` 成功后：响应带 `endpoint` → 用它覆盖 config 里的 `endpoint`，再 `setStoredBackendConfig` → `setOwnerToken`（写序不变）
  - 三态文案与客户端校验顺序不变
- [ ] `apps/mobile/app/(tabs)/settings.tsx`：
  - 默认渲染：①「服务器地址」单输入（placeholder `https://nextdo.example.com`）②「连接串 / owner token」输入
  - 「高级设置」折叠区（默认折叠）：原「后端地址」+「同步流地址」两输入，非空即优先
  - 已有 `storedConfig` 预填规则保留
  - 已连接态展示不变
- [ ] `apps/mobile/__tests__/settings-screen.test.tsx`：扩展 —— 单地址连接、高级优先、后缀容忍、服务端下发 endpoint 覆盖、回落、连接串粘贴、零网络断言
- [ ] 验证：`cd apps/mobile && pnpm test && pnpm typecheck`

---

## 阶段 4 · Deep link 路由 + 文档

- [ ] `apps/mobile/app/sync.tsx`（新建）：读 `s` / `t` → `connect()` → 成功 `router.replace('/(tabs)/now')`；失败跳设置页并带错误
- [ ] `apps/mobile/__tests__/sync-deeplink.test.tsx`（新建）：合法参数 → connect 被调用 + 重定向；401 → 跳设置页
- [ ] `server/deploy/README.md`：
  - 「Connect a device」重写为「填一个服务器地址 + 粘贴连接串」
  - 第 1 步的 `.env` 表格加 `NEXTDO_SYNC_ENDPOINT`
  - 新增「生成连接串」小节
  - **Operations 段落加升级说明**：升级既有部署前必须先补 `NEXTDO_SYNC_ENDPOINT`，否则服务启动失败
- [ ] `.trellis/spec/app/database-guidelines.md`：`/credentials` 响应形状、`NEXTDO_SYNC_ENDPOINT`、客户端回落规则、连接串格式、provider 订阅描述
- [ ] `.trellis/spec/app/component-guidelines.md`：provider 订阅处补「endpoint 可能来自服务端下发」
- [ ] 仓库根 `README.md`：若有云同步章节则同步
- [ ] 回归：`node e2e/sync-roundtrip.ts`（需给 e2e 的 server 启动补 `NEXTDO_SYNC_ENDPOINT` 环境变量）

---

## 最终验证（提交前）

```bash
pnpm test && pnpm typecheck && pnpm lint
node e2e/sync-roundtrip.ts
```

## 回滚点

| 阶段 | 回滚方式 |
|---|---|
| 1 | 服务端回退到只返 `{ token }`；客户端本来就兼容（endpoint 可选） |
| 2 | `packages/db` 回退；设置页还在用旧接口 |
| 3 | 设置页回退到三输入（旧 UI 可直接恢复，存储形状未变） |
| 4 | 删掉 `app/sync.tsx` + 文档回退；纯增量 |

阶段 1 是唯一有破坏性的（`NEXTDO_SYNC_ENDPOINT` 变必填），但它对旧客户端不可见；真正的破坏面是「既有部署升级后不补变量就起不来」，这一点写进 README 的升级说明即可。

## 待确认（实施中可能需要回头问用户）

- 连接串纯文本形态用竖线分隔是否合适（design D5）——若用户更想要 base64 或 JSON，实施时确认
- 设置页折叠区的文案与交互细节（用 `Pressable` 手风琴还是别的现成组件）
