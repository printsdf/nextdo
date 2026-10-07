# 实施计划：习惯归属项目

## 顺序（每步一个可验证单元）

### 1. core 类型
- [x] `packages/core/src/domain/types.ts`：`Habit` 增加 `projectId?: string`（带注释说明「至多一个项目，可空 = 不归属」，与 `NextAction.projectId` 措辞对齐）
- 验证：`pnpm --filter @nextdo/core typecheck`

### 2. db schema 与映射
- [x] `packages/db/src/schema.ts`：`habits` 表加 `project_id: column.text`
- [x] `habitFromRow` / `habitToRow` 双向映射
- 验证：`pnpm --filter @nextdo/db typecheck`

### 3. schema 变更单元的另外三处
- [x] `server/app/src/db.ts` → `MUTABLE_TABLES.habits` 加 `'project_id'`
- [x] `server/app/test/upload.test.ts` → `EXPECTED_CLIENT_SCHEMA.habits` 同步
- [x] `server/powersync/init/02-nextdo-schema.sql` → `CREATE TABLE habits` 加 `project_id TEXT`
- [x] `server/powersync/sync-config.yaml` → habits SELECT 列表加 `project_id`
- 验证：`pnpm --filter @nextdo/server-app test`（目录一致性测试红绿即验证）

### 4. 查询层
- [x] `packages/db/src/queries/habits.ts` → `listHabits(db, { projectId? })`
- 验证：`packages/db/src/test/queries.habits.test.ts` 增「按 projectId 过滤」用例

### 5. 引擎
- [x] `packages/db/src/queries/pool.ts` → HabitDay candidate 透传父习惯 `project_id`
- [x] 同处追加 R5 过滤：`habit.project_id !== null && !activeProjectIds.has(...)` → skip
- 验证：`packages/db/src/test/queries.pool.test.ts` 增三条（active 项目继承 projectId、on-hold 不进池、projectless 行为不变）

### 6. fixtures
- [x] `packages/db/src/test/fixtures.ts` → 至少一条习惯带 `projectId`，一条保持 projectless（覆盖两条路径）
- 验证：`pnpm --filter @nextdo/db test`

### 7. app hooks
- [x] `apps/mobile/hooks/use-start-habit.ts` → `StartHabitArgs` 增加 `projectId?`，写入实体
- [x] 新增 `apps/mobile/hooks/use-project-habits.ts`（对齐 `use-project-actions.ts` 的形状：`data` / `error` / `reload`；派生 `cycleDay` 与当前周期 21 格）

### 8. 项目详情页
- [x] `apps/mobile/app/projects/[id].tsx` → 新增「项目习惯」区块（列表 + 打卡格 + 内嵌创建表单 + 空态）
- 验证：`apps/mobile/__tests__/projects-screen.test.tsx` 增用例：区块渲染、今日格可打卡（断言 `completeAction` 收到 `actionKind: 'habit'`）、创建后列表出现

### 9. 全量门禁
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`

## Review gates

- **G1（第 1–3 步后）**：四处 schema 声明必须一致 —— `git diff` 逐个确认 `project_id` 出现在 4 个文件里，缺一处同步即停。
- **G2（第 5 步后）**：确认没有第二套项目有效性判断（`activeProjectIds` 是唯一来源）。
- **G3（第 8 步后）**：确认 UI 没有重写周期规则（`habitCycleDay` 必须来自 `@nextdo/db` 的导出）。

## 回滚点

- 步骤 1–6 为纯增量（可空列 + 可选过滤 + 引擎两行），任一步失败可单独 revert，不影响存量数据。
- 步骤 7–8 为 UI 层，revert 后 `/habits` 页与项目页行为回到今天。
- 已部署的 Postgres 列**不要**回滚（旧客户端忽略未知列）；DDL 回滚只在确认无新版本客户端后才做。