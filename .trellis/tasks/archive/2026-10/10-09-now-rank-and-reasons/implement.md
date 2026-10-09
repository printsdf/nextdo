# Implementation Plan: 优化推荐理由权重贡献与可信度 (now-rank-and-reasons)

## 步骤 1：核心算法与单元测试 (`packages/core`)
1. 修改 `packages/core/src/engine/rank.ts`：
   - 增加软到期日 `candidate.dueDate` 的紧急度推导逻辑（按当天结束点换算剩余小时）。
   - 过滤低价值理由（`candidate.value >= 3` 与 `project.value >= 3` 才输出对应正面理由）。
   - 按实际加权贡献 `W[code] * signals[code]` 降序排列 reasons。
2. 扩展 `packages/core/src/engine/rank.test.ts` 与 `recommend.test.ts`：
   - 测试软到期日计算：已逾期、今天到期、近期到期。
   - 测试理由降序排列：加权分最高的理由排在数组首位。
   - 测试可信度过滤：value 为 1 或 2 时不生成 `goal-value` 理由。
3. 运行 `pnpm --filter @nextdo/core test` 验证。

## 步骤 2：UI 文案与页面精简 (`apps/mobile`)
1. 审查并更新 `apps/mobile/lib/reason-labels.ts`，保证文案精准传达推荐动因。
2. 优化 `apps/mobile/app/(tabs)/now.tsx` 的视觉层级：
   - 精简统计栏与场景控制栏的视觉厚度，强化呼吸感。
   - 优化英雄卡片中 Why this? top-3 标签的展示次序与视觉重量。
3. 运行 `pnpm --filter @nextdo/mobile test` 验证。

## 步骤 3：全量验证与代码质量
1. 运行 `pnpm -r typecheck`。
2. 运行 `pnpm lint`。
3. 运行 `pnpm -r test`。
