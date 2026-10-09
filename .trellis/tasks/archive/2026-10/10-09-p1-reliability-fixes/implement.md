# Implementation Plan: P1 可靠性缺陷修复

## 步骤 1：桌面端设置持久化（apps/mobile/lib/engine-context.ts）
1. 在 `apps/mobile/lib/engine-context.ts` 中实现 `createLocalStorageStore()`，安全读取与写入 `localStorage`。
2. 在 `getBackend()` 中增加对可用 `localStorage` 的检查，未提供则回退至内存存储。
3. 增加单元测试（或在现有测试中扩展），验证非 React Native 环境下 localStorage 数据读写与解析。
4. 运行 `pnpm --filter @nextdo/mobile test` 验证。

## 步骤 2：习惯周期日历天计算优化（packages/db/src/queries/pool.ts）
1. 修改 `packages/db/src/queries/pool.ts` 中的 `habitCycleDay`：
   - 将 `startedAtMs + day * DAY_MS` 替换为日历天递增运算（`new Date(year, month, date + day, 12, 0, 0)`）。
2. 在 `packages/db/src/test/pool.test.ts` 或对应习惯周期测试中补充用例：
   - 验证连续多天计算的一致性。
   - 验证夏令时转换与跨时区环境下的稳定对应。
3. 运行 `pnpm --filter @nextdo/db test` 验证。

## 步骤 3：应用时钟前台恢复校准（apps/mobile/hooks/use-app-clock.ts）
1. 在 `apps/mobile/hooks/use-app-clock.ts` 中引入 `AppState` 监听以及 Web `focus`/`visibilitychange` 监听。
2. 当应用恢复为 `active` 状态或页面恢复可见时立即更新 `now`。
3. 补充 `use-app-clock.test.ts`，验证唤醒时立即分发新时间。
4. 运行 `pnpm --filter @nextdo/mobile test` 验证。

## 步骤 4：全量测试与质量门禁
1. 运行 `pnpm -r test` 确保所有模块单元测试 100% 通过。
2. 运行 `pnpm -r typecheck` 确保 TypeScript 检查通过。
