# Implementation Plan: P0 核心缺陷修复

## 步骤 1：修复场景过滤逻辑及回归测试（packages/core）
1. 修改 `packages/core/src/engine/filters.ts` 中的 `exclusionRule` 方法：
   - 增加对 `input.context.contextIds.length > 0` 的检查。
2. 在 `packages/core/src/engine/filters.test.ts` 中补充测试用例：
   - 用户 contextIds 为空（任意场景），包含场景标签的任务正常进入 `ranked`。
   - 用户 contextIds 为 `['office']`，包含 `office` 的任务进入 `ranked`，仅包含 `home` 的任务被过滤为 `context-mismatch`。
3. 运行 `pnpm --filter @nextdo/core test` 验证。

## 步骤 2：服务端认领安全防护实现（server/app）
1. 在 `server/app/src/app.ts` 的 `ServerConfig` 中引入 `claimSecret?: string | null`。
2. 在 `POST /claim` 处理逻辑中，如果设置了 `claimSecret`，校验请求头 `x-claim-secret` 或请求体 `claimSecret`：
   - 不匹配则返回 403 `{ error: 'forbidden', code: 'claim.invalid-secret' }`。
3. 更新 `server/app/src/index.ts`（若读取 env 时注入 `process.env.NEXTDO_CLAIM_SECRET`）。
4. 在 `server/app/src/app.test.ts` 中增加测试用例：
   - 未配置 secret 时保持兼容行为。
   - 配置 secret 后，无凭证/凭证错误返回 403，凭证正确成功 claim。
5. 运行 `pnpm --filter @nextdo/server test` 验证。

## 步骤 3：客户端同步上传失败与死信记录（packages/db）
1. 修改 `packages/db/src/powersync.ts` 中的 `uploadData`：
   - 读取响应 `res.json()`，提取 `rejected` 数组。
   - 对每一个被拒绝的 op 结构化记录 `logger.error`。
   - 暴露/持久化最近被拒记录（可通过内存或诊断模块导出），使上层可以查询是否存在同步异常。
2. 编写/完善 `packages/db/src/powersync.test.ts`：
   - 模拟服务端 200 返回包含 `rejected` 列表的情况，断言 `logger.error` 被正确触发，`transaction.complete()` 正常被调用。
3. 运行 `pnpm --filter @nextdo/db test` 验证。

## 步骤 4：全量检查与验证
1. 运行项目全局 `pnpm test` 和 `pnpm typecheck`。
2. 确保没有类型错误和测试破坏。
