# 开源化云同步：默认本地 + 服务器自选 + 可扩展

## Goal

Nextdo 作为开源项目，云同步必须是**用户完全可选、服务器完全自选**的能力：开源代码默认不指向任何人的服务器（纯本地）；要同步的用户在设备上填自己的同步服务器（自托管或任意），用 owner token 连接。同步机制（PowerSync + 自托管栈）保持 v1 唯一实现，但配置层与机制解耦，为未来其他同步方式（P2P 等）留扩展空间。

## 背景与已确认事实（代码证据）

- **当前默认值不适合作为开源默认**：`apps/mobile/lib/env.ts:24-25` 硬编码 `backendUrl: https://api.printsdf.de5.net`、`endpoint: https://sync.printsdf.de5.net`（维护者个人生产域名）。全仓 grep 确认个人域名仅出现在此（及本文档）。任何人 clone 构建都会默认连到私人服务器，必须移除。
- 客户端同步配置形状是**两个独立 URL**：`NextdoPowerSyncConfig { backendUrl, endpoint }`（`packages/db/src/powersync.ts:47`）；`backendUrl` 拼 `/credentials` + `/upload`，`endpoint` 拼 `/sync/stream`。`createPowerSyncConnector(config)`（`powersync.ts:252`）与 `fetchCredentialsOnce(config, token)` 都**显式接收 config 参数**——机制层已经与「config 从哪来」解耦。
- **同步已是可选项**（R6，已实现）：无 token → 纯本地（PowerSync 断开）；设置 tab 云同步区块目前只有 token 输入（「URL 不进 UI」是上一任务明确的 out of scope，本任务推翻该边界）。
- **服务器侧已可自托管**（R1）+ **token 首启自动生成、只可查看一次**（R7，已实现并实跑验证）：`server/deploy/` compose + Caddy 文档（单域 `/api/*` + `/sync/*` 前缀布局）。
- `getBackendConfig()`（env.ts 模块常量）恰好 3 个调用点：`hooks/use-cloud-sync.ts:86`（connect 校验）、`app/_layout.tsx:163`（provider connect）、`app/_layout.tsx:334`（启动预校验）。`configureBackend()` 测试接缝**零调用**（全仓 grep：仅 env.ts 自身与旧任务文档提及）。
- 连接生命周期由 `subscribeToOwnerTokenChange` 单一 poke 通知驱动（provider + 设置页 hook 都订阅，poke 后重读）；测试面：11 个 apps/mobile 测试文件 mock 了该函数（大多 `() => () => undefined`）+ `packages/db` connector.test 用真实实现。
- 存储矩阵（`packages/db/src/owner-token.ts`，全仓唯一碰客户端密钥存储处）：RN → expo-secure-store；Tauri → stronghold（当前**单 key 契约**，异 key 抛 `storage.multi-key`）；浏览器/Node → 内存。测试接缝 `__setStorageBackendForTests`。
- e2e（`e2e/run.ts:343`）自带常量、直接 `createPowerSyncConnector({backendUrl, endpoint})`，不经过 env.ts / 应用 provider——**不受本任务影响**。

## 决策（用户拍板）

- **D1 开源默认 + 配置入口（2026-09-28）**：开源代码默认后端配置为**空 = 纯本地**；服务器地址进**设置页 UI**，与 token 同区块、同处按平台持久化；用户设备端自选任意服务器；个人/维护者域名从代码中移除。
- **D2 其他同步方式范围（2026-09-28）**：v1 只留架构接缝（PowerSync 仍是唯一实现）；P2P 等作为 post-MVP 独立任务。
- **D3 URL 输入形态（2026-09-28）**：设置页**两个字段**——「后端地址」（`/credentials` 所在）+「同步流地址」（`/sync/stream` 所在），兼容任意反代布局（单域前缀、子域拆分都行）。

## Requirements

- **R1 移除硬编码域名，默认纯本地**：`lib/env.ts` 不再持有后端常量（`BACKEND` / `getBackendConfig` / 零调用的 `configureBackend` 一并移除，仅保留 `POWERSYNC_WEB_WORKER_PATH`）。全新设备启动 = 未连接、纯本地，行为同 R6 现状。
- **R2 存储层新增「服务器地址」配置**（packages/db，与 owner token 同一按平台存储）：
  - 新 key `nextdo.sync.config`，值为 JSON `{ backendUrl, endpoint }`（复用 `NextdoPowerSyncConfig` 形状）；
  - API：`getStoredBackendConfig(): Promise<NextdoPowerSyncConfig | null>` / `setStoredBackendConfig(config)` / `clearStoredBackendConfig()`；
  - `setStoredBackendConfig` 校验：两字段非空、绝对 http(s) URL（`new URL` + protocol 检查），否则抛 `ValidationNextdoError`；
  - 损坏值（JSON 解析失败）→ 按 null 处理 + 日志（恢复路径 = 用户重填）；
  - stronghold 单 key 契约放宽为**恰好两个已知 key**（`nextdo.auth.owner-token` + `nextdo.sync.config`），其余仍拒绝；secure-store / 内存分支无 key 限制，不受影响。
- **R3 设置页云同步区块扩展**（未连接态）：
  - 三个输入：后端地址（placeholder 示例 `https://nextdo.example.com/api`）、同步流地址（`https://nextdo.example.com/sync`）、owner token；
  - 已有存储的地址**预填**进前两个输入（断开后重连不必重填地址）；
  - 提交校验（客户端先拦，不发网络）：token 空 → 「token 不能为空」；地址空 → 「请先填写服务器地址」；地址非合法 http(s) URL → 「地址无效，应以 http:// 或 https:// 开头」；
  - 通过后走 `fetchCredentialsOnce(config, token)`：200 → `setStoredBackendConfig`（先）+ `setOwnerToken`（后；其通知驱动 provider connect）；401 → 「token 不正确」；网络/5xx → 「连不上服务器，请稍后重试」（沿用 R3 三态文案）；
  - **已连接态**：展示已配置的两个地址（只读）+ 「断开连接」。
- **R4 断开只清 token，地址保留**：`disconnect()` = `clearOwnerToken()` 不变（本地数据不动）；存储的地址留存 → 下次进入设置页预填，重输 token 即可重连。
- **R5 连接生命周期与预校验改读存储 config**：
  - provider（`_layout.tsx`）：poke 后重读 **token + 存储 config**；两者皆在 → `connect(createPowerSyncConnector(storedConfig))`；任一缺失 → `disconnect()`（纯本地）。
  - 启动后台预校验：token 与 config 皆在 → `fetchCredentialsOnce(storedConfig, token)`；401 → `clearOwnerToken`（config 保留）；其余不动（离线优先）。
  - 通知机制**不新增、不改名**：config 只会在 connect 成功流程中与 token 一起写入，token 的 poke 已覆盖；写顺序 config→token 保证 poke 触发时两者俱在。
- **R6 文档与规范同步**：`server/deploy/README.md` 的「Connect a device」补「先填两个服务器地址」（按部署者的反代布局给出示例）；`.trellis/spec/app/database-guidelines.md` 存储矩阵补 `nextdo.sync.config` key 与「地址非密钥但随 token 同处存储」说明；`component-guidelines.md` 中 provider 订阅描述更新为「重读 token + 存储地址」。

## Acceptance Criteria

- [ ] 开源默认：`apps/mobile/lib/env.ts` 及全仓代码中 grep 不到任何个人/维护者域名（`.trellis/` 任务文档中的历史引用除外）；全新设备（空存储）启动直接进主界面，设置页为未连接态（三个空输入），本地功能完整。
- [ ] 连接成功：填两个地址 + token，mock 200 → 存储层同时出现 config 与 token → 设置页切已连接（展示地址）→ provider 以该 config 调 `connect`。
- [ ] 三态 + 客户端校验：401 → 内联「token 不正确」且不动存储；网络错 → 「连不上服务器，请稍后重试」；token 空 / 地址空 / 地址非法 → 对应内联错误且**不发生网络请求**（单测断言 fetchCredentialsOnce 未被调用）。
- [ ] 断开：清 token、地址保留——断开后重进设置页，地址输入为预填态。
- [ ] 启动预校验用存储地址：存储 token+config 且 401 → token 被静默清除、config 保留、主界面照常渲染。
- [ ] 存储层单测：config set/get/clear 往返；校验拒绝（空字段、`ftp://`、相对路径）；损坏 JSON → null；stronghold mock 下两个已知 key 可写、第三个 key 抛 `storage.multi-key`。
- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；`node e2e/sync-roundtrip.ts` 全绿（回归，预期零改动）。
- [ ] 桌面 `tauri build` 成功；实机（用户 Mac）：设置页填地址+token → 持久化 → 重启后已连接且免输入（stronghold 双 key 真机路径，用户验证）。
- [ ] README / spec 文档更新完成（R6 所列三处）。

## Out of Scope

- 其他同步机制的**实现**（P2P 等）——仅保留 D2 的接缝现状（config/凭证与 PowerSync 机制已解耦），post-MVP 独立任务。
- 维护者运营的官方公共同步服务器（D1 已选用户自选）。
- 会话内 token 轮换感知（仅启动预校验，既定）；多用户/账号体系（post-MVP）。
- 服务器侧代码零改动（R7 已交付）；e2e 零改动（自有常量）。

## 风险与缓解

- **现有设备的迁移**：已装 App（硬编码域名 + 已存 token）不受影响；升级新构建后每台设备需一次性补填服务器地址（token 已存、预填逻辑覆盖地址）——README 升级说明里提示一句。
- **stronghold 快照兼容性**：旧快照只有 token key，`get` 缺失 key 返回 null → 向后兼容，无迁移。
- **config/token 写一半失败**：顺序 config→token；token 写失败时 config 多存一份无害（无 token 时 provider 不连接），下次连接覆盖。
