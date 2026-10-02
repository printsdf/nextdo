# 简化云同步连接：单地址 + 服务端下发 endpoint + 连接串

## Goal

把设置页的三个手填输入（后端地址 / 同步流地址 / owner token）收敛为一个低门槛流程：默认只需填**一个服务器地址**，路径由客户端推导或服务端下发；owner token 改为可粘贴的**连接串**（支持 `nextdo://` deep link 与纯文本两种形态）。目标是让不了解反代路径布局、不想手抄 64 位十六进制密钥的用户能独立完成连接。

## 背景与已确认事实（代码证据）

- **当前 UI 是三个输入框**：`apps/mobile/app/(tabs)/settings.tsx:243-283`（后端地址 / 同步流地址 / owner token），未连接态文案在 `:234-235`。
- **客户端配置形状是两个独立 URL**：`NextdoPowerSyncConfig { backendUrl, endpoint }`（`packages/db/src/powersync.ts:54-59`）。`backendUrl` 拼 `/credentials` + `/upload`；`endpoint` 直接交给 PowerSync SDK 作为同步流地址（`powersync.ts:268`）。
- **`/credentials` 已经在做鉴权握手，但不下发 endpoint**：`server/app/src/app.ts:77-86` 返回 `{ token }`，注释明确写「The client reads ONLY `data.token`」。客户端 `fetchCredentialsOnce` 也确实忽略该字段——现有单测 `packages/db/src/test/fetch-credentials-once.test.ts:41-48` 断言「ignores non-contractual extra fields」。
- **`endpoint` 完全不参与鉴权**：PowerSync 服务自己用 JWT 校验，客户端持有该 URL 不构成任何安全风险。
- **存储层已支持双 key**：`nextdo.auth.owner-token` + `nextdo.sync.config`（`packages/db/src/owner-token.ts`），`setStoredBackendConfig` 校验两字段均为绝对 http(s) URL。
- **连接生命周期由 `subscribeToOwnerTokenChange` 单一 poke 驱动**：provider（`apps/mobile/app/_layout.tsx:158-198`）与设置页 hook（`hooks/use-cloud-sync.ts:88-124`）都订阅它，poke 后重读 token + config。启动预校验在 `_layout.tsx:379-395`。
- **`app.json` 已配置 `"scheme": "nextdo"`**，deep link 的容器已就绪，缺的是路由与解析。
- **owner token 是所有设备共享的同一全局密钥**（`server/deploy/.env.example` 的 `NEXTDO_OWNER_TOKEN`，`openssl rand -hex 32`），每台设备手抄一次。
- **现有设置页测试面很厚**：`apps/mobile/__tests__/settings-screen.test.tsx` 有 12+ 个用例锁定当前三输入行为（含「连接按钮的 enabled 条件」「地址非法不发网络」「401 / 网络错三态」）。
- **PowerSync SDK 的 endpoint 只在 connect 时读一次**（`powersync.ts:268` 的 `fetchCredentials` 回调返回 `{ endpoint, token }`），所以 endpoint 可以由服务端在每次凭证刷新时下发，天然跟随。

## 决策（用户拍板，2026-10-02）

- **D1 范围**：L1 + L2 + L3 全做（单地址输入、服务端下发 endpoint、连接串）。
- **D2 高级字段**：原双输入框收进「高级设置」折叠区，**默认隐藏**。
- **D3 连接串形态**：两种都支持——`nextdo://sync?...` deep link（手机可扫码点击）+ 纯文本串（桌面可粘贴）。
- **D4 endpoint 来源**：新增 `NEXTDO_SYNC_ENDPOINT` 环境变量，由部署者显式配置；**不做**自动推导回落（保持配置显式、可预测）。

## Requirements

### R1 客户端单地址推导（`packages/db` + 设置页）

- 新增纯函数 `deriveSyncConfig(serverAddress: string): StoredBackendConfig`（放在 `packages/db/src/owner-token.ts` 或邻近的 config 模块），规则：
  - 输入去除首尾空白与末尾 `/`；非绝对 http(s) URL → 抛/返回错误（复用现有 `sync.invalid-backend-url` 语义）；
  - `backendUrl = {base}/api`，`endpoint = {base}/sync`；
  - 输入本身已带 `/api` 或 `/sync` 后缀时先剥离该后缀再拼（容忍用户直接粘贴完整地址）。
- 设置页默认只渲染**一个**「服务器地址」输入框（placeholder：`https://nextdo.example.com`）+ 一个「连接串 / owner token」输入框。
- **高级设置折叠区**（默认折叠）保留原有的「后端地址」+「同步流地址」两个输入框；填了高级值时以高级值为准，跳过推导。
- 已有存储的 config 仍预填（保持 R4「断开后重连不必重填」）。

### R2 服务端下发 endpoint

- `server/app` 新增环境变量 `NEXTDO_SYNC_ENDPOINT`（**必填**，缺失/为空则拒绝启动，错误文案命名该变量，参照 `owner-token.ts` 的既有做法）。
- `GET /credentials` 响应体从 `{ token }` 扩展为 `{ token, endpoint }`。
- `server/deploy/docker-compose.yml` 把该变量透传给 `api` 服务；`.env.example` 补该项并注释说明「填客户端要填的同步流地址，形如 `https://your.domain/sync`」。
- `server/deploy/README.md` 更新：部署时填 `NEXTDO_SYNC_ENDPOINT` 只需填一次，之后每台设备只填服务器地址。

### R3 客户端消费服务端下发的 endpoint

- `fetchCredentialsOnce` 的成功结果扩展为 `{ ok: true, token, endpoint? }`：`endpoint` 是**可选**字段，存在且为合法 http(s) URL 时采用，缺失时回落到本地 config 的 `endpoint`（**向后兼容旧服务端**）。
- `useCloudSync.connect` 在 `/credentials` 成功后，若响应带回了 endpoint，用它覆盖 `storedConfig.endpoint` 再落盘（写序仍是 config → token，保证 poke 时两者俱在）。
- 连接器的 `fetchCredentials` 回调改为使用 `/credentials` 响应里的 endpoint（每次凭证刷新都可能更新），回落本地值。
- **契约测试更新**：`fetch-credentials-once.test.ts` 里「ignores non-contractual extra fields」用例改为断言 endpoint 被解析；补「endpoint 缺失 → 回落」「endpoint 非法 → 回落」两个用例。

### R4 连接串与 deep link

- 定义连接串格式（两种输入，同一解析器）：
  - deep link：`nextdo://sync?s=<urlencoded backendUrl 基础地址>&t=<urlencoded token>`
  - 纯文本：`<backendUrl 基础地址>|<token>`（竖线分隔，便于从终端复制）
- 新增解析纯函数 `parseConnectionString(input): { serverAddress, token } | null`（放 `apps/mobile/lib/`，与 `snooze-options.ts` 等纯 helper 同级）。
- 设置页的第二个输入框接受**两种**内容：完整连接串，或裸 token（沿用现有行为）。
- deep link 落地：新增 `apps/mobile/app/sync.tsx` 路由，读取 `s` / `t` 查询参数 → 调用同一个 `useCloudSync.connect` → 成功后重定向到 `(tabs)/now`；失败时把错误带到设置页。
- 部署侧：`server/deploy/README.md` 增加一段「生成连接串」的说明（给出一条 `docker compose exec api pnpm connection-string` 之类的命令输出示例）；**是否实现该 CLI 命令见 Out of Scope 裁决**。

### R5 文档与规范同步

- `server/deploy/README.md`「Connect a device」重写为「填一个服务器地址 + 粘贴连接串」。
- `.trellis/spec/app/database-guidelines.md`：`/credentials` 响应形状、`NEXTDO_SYNC_ENDPOINT`、客户端 endpoint 回落规则、连接串格式。
- `.trellis/spec/app/component-guidelines.md`：provider 订阅描述更新（endpoint 可能来自服务端）。
- `README.md`（若含云同步章节）同步。

## Acceptance Criteria

- [ ] **单地址连接**：填 `https://x.example.com` + 有效 token → mock `/credentials` 200 → 存储层出现 `{ backendUrl: 'https://x.example.com/api', endpoint: 'https://x.example.com/sync' }` + token → 设置页切已连接 → provider 以该 config 调 `connect`。
- [ ] **高级设置优先**：展开高级区并填两个自定义 URL → 以高级值为准，不做推导。
- [ ] **后缀容忍**：粘贴 `https://x.example.com/api` 与 `https://x.example.com/sync` 都推导出同一 config（不出现 `/api/api`）。
- [ ] **服务端下发 endpoint**：mock 200 `{ token, endpoint: 'https://custom.example.com/stream' }` → 存储的 `endpoint` 为该值（非本地推导值）。
- [ ] **回落兼容**：mock 200 `{ token }`（旧服务端）→ endpoint 仍为本地推导值，连接成功。
- [ ] **非法 endpoint 回落**：mock 200 `{ token, endpoint: 'ftp://bad' }` → 回落本地推导值，不报错。
- [ ] **连接串（纯文本）**：粘贴 `https://x.example.com|abc123` → 等价于填地址 `https://x.example.com` + token `abc123`。
- [ ] **连接串（deep link）**：`nextdo://sync?s=https%3A%2F%2Fx.example.com&t=abc123` 打开 → 走同一 connect 流程 → 成功重定向到 Now。
- [ ] **deep link 失败**：token 错误 → 不静默，错误可见（跳设置页并展示内联错误）。
- [ ] **客户端校验零网络**：地址为空 / 非 http(s) / token 为空 → 对应内联错误，且 `fetchCredentialsOnce` 未被调用（单测断言）。
- [ ] **三态文案不变**：401 → 「token 不正确」；网络/5xx → 「连不上服务器，请稍后重试」；保存失败 → 「保存失败，请重试」。
- [ ] **断开语义不变**：清 token、地址保留、重连免输入。
- [ ] **服务端单测**：`NEXTDO_SYNC_ENDPOINT` 缺失 → 启动被拒；`/credentials` 200 响应体含 `endpoint` 且等于配置值。
- [ ] **启动预校验不变**：存储 token+config 且 401 → token 静默清除、config 保留、主界面照常渲染。
- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿。
- [ ] `node e2e/sync-roundtrip.ts` 全绿（回归；需按 R2 给 e2e 的 server 启动补 `NEXTDO_SYNC_ENDPOINT`）。
- [ ] R5 所列三处文档 + README 更新完成。

## Out of Scope

- **设备配对流程**（App 生成 6 位码 / 二维码，服务器管理页确认，签发设备级 token）——范围明显更大，独立任务。
- **官方托管同步服务**——项目已定调「不指向维护者服务器」。
- **多用户 / 账号体系**——post-MVP，`/credentials` 的 owner token 机制不动。
- **`server/deploy` 的连接串 CLI 命令**——先只在 README 给出可直接复制的命令拼法（`docker compose exec api printenv NEXTDO_OWNER_TOKEN` + 手拼串）；若实现成本低再补 `pnpm connection-string`。
- **二维码渲染**——依赖终端二维码库，本任务只出 deep link 串。

## 风险与缓解

- **旧服务端 + 新客户端**：`endpoint` 可选回落，本地推导值生效，向后兼容。
- **新服务端 + 旧客户端**：旧客户端忽略响应里的 `endpoint` 字段（现有测试已固化这个行为），仍用本地 config——连接可用，只是路径靠推导。降级可用，不破坏。
- **`NEXTDO_SYNC_ENDPOINT` 成为新的必填项**：会让**现有部署**在升级后启动失败。缓解：README 的 Operations 段落明确写出升级步骤（升级前先补该变量），且 `.env.example` 顶部注明。替代方案是设为可选 + 自动推导回落，但那会掩盖配置错误——用户选了显式（D4）。
- **连接串泄露 = token 泄露**：连接串本质是 token 的另一种载体。缓解：文档提示连接串等同密钥、不要贴到公开渠道；deep link 只在本地设备间传递。
- **已有设备的迁移**：存储形状不变（仍是 `{ backendUrl, endpoint }`），无需迁移；用户只是不再需要手填第二项。
