# PRD: P0 核心缺陷修复（场景筛选、认领安全、同步上传可靠性）

## 1. 背景与目标
在对 Nextdo 的审查中发现了 3 个影响核心逻辑、服务端安全及数据可靠性的 P0 问题：
1. **任意场景与实际筛选逻辑不一致**：默认情况下 `contextIds: []`（界面显示为“任意”），但引擎过滤逻辑把带有 `action.contextIds` 的任务全部当作 `context-mismatch` 排除，导致“任意场景”实际退化为“仅限无场景限制的任务”。
2. **云同步服务存在首次绑定抢占风险**：未认领状态下 `POST /claim` 任何人均可发起，公开服务在用户绑定前可能被恶意第三方抢占。
3. **同步上传失败被静默忽略**：服务端上传接口返回 200 并在 body 中携带 `rejected[]` 时，客户端直接 `transaction.complete()` 吞掉错误，缺乏被拒绝操作的感知与死信/告警追踪能力。

目标：系统性修复上述 3 个 P0 缺陷，补齐回归测试与端到端行为，确保核心推荐与云同步的可靠性。

---

## 2. 需求清单与验收标准

### 需求 1：修复场景筛选逻辑（Core 引擎）
- **现象**：当输入当前场景 `input.context.contextIds` 为空时（界面“任意场景”），不应排除设置了特定场景标签的 action。
- **规则**：
  - 若用户未选择任何场景（`input.context.contextIds.length === 0`），场景过滤不生效，所有任务不论是否包含场景标签均可通过场景检查。
  - 若用户指定了场景（`input.context.contextIds.length > 0`）：
    - 任务无场景要求（`action.contextIds.length === 0`）可通过（随处可做）。
    - 任务有场景要求（`action.contextIds.length > 0`），必须与用户场景存在交集才可通过；无交集时返回 `context-mismatch`。
- **验收标准**：
  - 补充回归单元测试：在默认 `contextIds: []` 下，包含 `contextIds: ['computer']` 的任务成功进入 `ranked`。
  - 用户选定 `['computer']` 时，要求 `['phone']` 的任务返回 `context-mismatch`，要求 `['computer']` 或 `[]` 的任务保留。

### 需求 2：云同步服务认领安全防护（Server）
- **现象**：Worker 部署后在被合法用户连接前处于公开未认证状态，攻击者可直接向 `POST /claim` 提交请求抢占控制权。
- **改动**：
  - 增加配对/部署保护：支持可选的环境变量 `NEXTDO_CLAIM_SECRET` 或部署配置。
  - 如果配置了 `NEXTDO_CLAIM_SECRET`，则 `POST /claim` 必须在 Header（`x-claim-secret` 或 `Authorization: Bearer <secret>`）或 JSON payload 中携带匹配的密钥，否则返回 403 Forbidden。
  - 若服务端未配置任何认领密钥（极简体验），保留默认允许首次绑定的行为，但在返回与文档中明确安全建议。
  - 同时完善文档与环境变量声明。
- **验收标准**：
  - 单元测试：配置了 secret 时，无 secret 的 claim 请求返回 403；携带正确 secret 的 claim 正常绑定。
  - 已经配置了 static `NEXTDO_OWNER_TOKEN` 时，依然返回 409 already_claimed。

### 需求 3：同步上传被拒操作的显式处理（DB / Sync）
- **现象**：客户端 `uploadData` 在服务端返回 200 时直接 `transaction.complete()`，服务端返回的 `rejected: RejectedOp[]` 被完全忽略。
- **改动**：
  - 客户端 `uploadData` 解析服务端 200 响应的 JSON。
  - 检查 `response.rejected` 数组：
    - 若 `rejected` 存在且非空，使用 logger.error 记录死信/被拒绝操作的详情（索引、table、id、错误码、原因），并持久化到本地失败记录（或触发同步异常事件）。
    - 确保不再无感知吞掉错误，同时依然调用 `transaction.complete()` 避免阻塞不可恢复的队列，但将异常显式暴露给上层诊断/状态层。
- **验收标准**：
  - 单元测试：模拟服务端返回 `rejected: [{ index: 0, code: 'upload.unknown-table', message: '...' }]`，客户端正确解析并记录，不崩溃，不丢失错误上下文。
