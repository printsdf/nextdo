# Waiting For 事项管理与跟进专屏

## Goal

为 Nextdo 提供 Waiting For（等待事项）独立管理与跟进页面，支持浏览正在等待他人/外部响应的事项、到期提醒展示、快速新建以及标记完成（移出等待池），并在收件箱等主路径中暴露便捷入口。

## Requirements

1. **响应式查询与数据层支持 (`packages/db`)**：
   - 在 `watch-queries.ts` 中提供 `waitingForWatchQuery(db)`，实时订阅未被软删除的 `waiting_for_items`。
   - 在 `packages/db/src/index.ts` 中导出 `addWaitingForItem`, `updateWaitingForItem`, `trashWaitingForItem`, `waitingForWatchQuery`。
   - 严格遵循 `deleted_at IS NULL` 软删除过滤。

2. **移动端数据 Hook (`apps/mobile/hooks/use-waiting-for.ts`)**：
   - 使用 `@powersync/react` 的 `useQuery` 驱动数据，暴露 `data: WaitingForItem[]`、`loading`、`error`。
   - 暴露 `add({ title, waitingOn, expectedBy, notes })`、`trash(id)` 方法，遵循组件不直接触碰 db 的架构规范。

3. **独立二级页面 (`apps/mobile/app/waiting.tsx`)**：
   - **页面顶栏**：统一左上角「← 返回」按钮（使用 `goBack` 工具函数，对齐二级页面规范）。
   - **列表展示**：
     - 每行展示：事项标题、等待对象（如 `等待: 导师`）、创建时间 / 期望完成时间 `expectedBy`。
     - 若 `expectedBy` 已逾期，展示警示色提示。
     - 包含快捷操作：一键「已得到结果 / 完成」（执行 `trashWaitingForItem` 软删除）。
   - **快速新建卡片 / 弹层**：
     - 支持在页面内直接登记等待事项：标题 `title`（必填）、等待对象 `waitingOn`（必填）、可选期望时间与备注。
   - **空状态**：无等待事项时展示友好 EmptyState。

4. **主界面入口导航**：
   - 在 `apps/mobile/app/(tabs)/inbox.tsx` 顶部（或合适位置）提供「等待中 (N)」胶囊或入口卡片，方便在收件箱中快速跳转。

## Acceptance Criteria

- [ ] `packages/db` 正确导出 `waitingForWatchQuery` 及相应增删改方法，单元测试覆盖。
- [ ] 移动端新增 `useWaitingFor` hook，支持实时响应与增删操作。
- [ ] 移动端新增 `apps/mobile/app/waiting.tsx` 页面，交互体验符合 iOS 简约卡片规范。
- [ ] 在收件箱中能看到等待事项数量并点击跳转。
- [ ] 全量 `pnpm lint`、`pnpm typecheck`、`pnpm test` 测试全绿。
