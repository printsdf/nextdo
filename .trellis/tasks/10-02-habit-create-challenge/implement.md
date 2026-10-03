# 执行计划 — 习惯创建表单与 21 天挑战启动

## 步骤（按序）

1. **补 db 导出**：`packages/db/src/index.ts` 增加 `export { habitCycleDay } from './queries/pool';`（或并入既有 pool 导出行）。跑 `pnpm --filter @nextdo/db exec tsc --noEmit`。
2. **读 hook** `use-habits.ts`：`listHabits` + `listHabitDays`，按 `habitId` 分组出 `HabitWithProgress`，`cycleDay` 走 `habitCycleDay`，`now` 来自 `useAppClock()`。
3. **mutation hooks**：`use-start-habit.ts`（构造 Habit → `startHabit`）、`use-trash-habit.ts`（`trashHabit`）。错误统一 `logger.error` + `error` 状态，与 `use-add-project.ts` 同形。
4. **`use-habit-days.ts` 暴露 `reload()`**：复用现有 `reloadKey`，不改变现有调用方语义。
5. **习惯屏** `app/habits.tsx`：`HabitsScreen` + `HabitRow` + `HabitForm` + 窗口开关段；`KeyboardAvoidingView` + `ScrollView`；空态用 `EmptyState`。
6. **Now 屏接入**：习惯条空态引导（当前 `days.length > 0` 才渲染，需改）、非空时「管理」入口、`useFocusEffect` 刷新。同步更新 `now-screen.test.tsx` 断言。
7. **设置页入口**：新增「习惯」卡片 + 「管理习惯」按钮。
8. **测试**：新增 `__tests__/habits-screen.test.tsx`；按需扩充 `@nextdo/db` mock factory。

## 验证命令

```bash
pnpm --filter @nextdo/db exec tsc --noEmit
pnpm --filter @nextdo/mobile exec tsc --noEmit
pnpm --filter @nextdo/mobile exec jest __tests__/habits-screen.test.tsx __tests__/now-screen.test.tsx __tests__/settings-screen.test.tsx
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @nextdo/mobile exec expo export --platform web   # 桌面壳依赖
```

## 回滚点

- 步骤 1 独立可回滚（只加一行导出）。
- 步骤 4–7 都在 UI 层，若 Now 屏接入出问题，可只回滚 6，`habits` 路由仍可用（只是习惯条不刷新）。
- 没有任何数据迁移，`trashHabit` 是软删除，回滚代码不会丢数据。

## 收尾

- Phase 3.3：在 `.trellis/spec/app/` 记录两条新知识 —— ①「返回本屏时刷新只读数据」用 `useFocusEffect` + hook 暴露 `reload()`（本仓库首用）；②周期日计算必须走 `packages/db` 导出的 `habitCycleDay`，禁止在 app 层复刻。
- Phase 3.4：提交计划先行确认。
- 完成后从 `.trellis/backlog.md` 移除 P1 第 4 项。
