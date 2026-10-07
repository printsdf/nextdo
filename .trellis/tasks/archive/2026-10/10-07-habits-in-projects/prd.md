# 习惯归属项目（Habits in Projects）

## Goal

让习惯可以归属到某个项目，并在项目详情页内完成「建习惯 + 看打卡」的闭环：一个「21 天晨读」这类习惯，用户应当能在它服务的项目里直接创建和打卡，而不必切到独立的习惯页去找。

## Background & Pain Points

1. **习惯与项目在数据层是两套平行实体，UI 层也是两张皮**
   - `Habit` 已有 `title` / `value` / 生命周期状态 / 会生成行动，从用户视角它就是一个「自带节奏的小项目」；但它没有 `projectId`，无法表达「这个习惯是为哪个项目做的」。
   - 结果：想为「论文答辩」这个项目建立「每天读文献」的习惯，只能去 `/habits` 页建一个游离的习惯，项目详情页对此一无所知。
2. **打卡反馈离现场太远**
   - 打卡（完成 HabitDay）目前只在 Now 屏的习惯条和 `/habits` 页发生。项目详情页看不到自己名下习惯的挑战进度，用户在项目语境里无法判断「这个项目离完成还差多少」。
3. **引擎的项目信号够不到习惯**
   - `scoreCandidate` 的 `project-importance` 信号依赖 `candidate.projectId`（`packages/core/src/engine/rank.ts`）。习惯生成的 HabitDay 目前恒为 projectless，所以为高价值项目做的习惯拿不到项目权重——与用户直觉相反。

## Requirements

### 1. 数据层：`habits.project_id`（可空）

- `packages/core` 的 `Habit` 增加可选字段 `projectId?: string`。
- `packages/db/src/schema.ts` 的 `habits` 表增加 `project_id` 列；`habitFromRow` / `habitToRow` 同步映射（`null` ↔ `undefined`）。
- 该列必须**可空且向后兼容**：既有设备上的既有习惯行没有这个值，读出来是 projectless，行为与今天完全一致（database-guidelines.md「Schema Changes：无客户端迁移，改动必须向后兼容，优先 additive」）。
- 服务端列目录（`server/app/src/db.ts` 的 `MUTABLE_TABLES.habits`）、Postgres 初始化 DDL（`server/powersync/init/02-nextdo-schema.sql`）、同步流 SELECT 列表（`server/powersync/sync-config.yaml`）三处必须同步更新——它们与 `schema.ts` 是同一个 change unit（database-guidelines.md）。

### 2. 引擎：习惯继承项目信号

- `queryEnginePool` 在为 HabitDay 构造 candidate 时，把父习惯的 `project_id` 透传为 candidate 的 `projectId`。
- 绑定到非 active / 已删除项目的习惯，其 HabitDay **不进候选池**——与 `NextAction` 的 R5 规则完全一致（pool.ts 已有 `activeProjectIds` 集合，复用它，不新增第二套判断）。

### 3. 查询层

- `listHabits` 增加可选 `projectId` 过滤参数。
- `startHabit` 接受携带 `projectId` 的 Habit（写入由调用方构造的实体承担，`startHabit` 不额外校验项目存在性——与 `addNextAction` 的 projectId 处理保持同一档复杂度）。

### 4. UI：项目详情页的习惯区块

- 项目详情页在「进行中的行动」之下新增「项目习惯」区块：
  - 列表：该项目下所有未删除的习惯，每行显示习惯名、挑战进度（第 N/21 天）、当前周期的完成格。
  - 打卡：今天的开放 HabitDay 提供一键打卡，复用 `completeAction(db, { actionKind: 'habit', actionId })` 这条既有事务（与 Now 屏习惯条同一条路径，不新写完成逻辑）。
  - 创建：内嵌精简表单（习惯名 / 每日行动 / 预计分钟 / 价值），`projectId` 由所在页面隐式携带，`cycleDays` 固定 21、`status` 固定 `active`（与 `/habits` 页同一套固定决策）。
- `/habits` 页保持现状（创建表单不带项目归属，列出全部习惯），不因本次改动而退化。

## Acceptance Criteria

- [ ] **AC-1（schema 变更单元完整）**：`habits.project_id` 在 `packages/db/src/schema.ts`、`server/app/src/db.ts`、`server/powersync/init/02-nextdo-schema.sql`、`server/powersync/sync-config.yaml` 四处一致；服务端目录一致性测试仍绿。
- [ ] **AC-2（向后兼容）**：一条没有 `project_id` 的既有习惯行，读出来 `projectId === undefined`，其 HabitDay 仍照常进入候选池（无行为变化）。
- [ ] **AC-3（引擎继承项目信号）**：绑定到 active 项目的习惯，其 HabitDay candidate 携带该 `projectId`；绑定到 on-hold / 已删除项目的习惯，其 HabitDay **不出现**在 `queryEnginePool` 的 actions 里。
- [ ] **AC-4（按项目查询）**：`listHabits(db, { projectId })` 只返回该项目的习惯；不带参数时行为不变。
- [ ] **AC-5（项目详情页闭环）**：项目详情页渲染该项目下的习惯（含挑战进度与当前周期打卡格）；今日开放的打卡格可一键完成，走既有 `completeAction` 事务。
- [ ] **AC-6（项目内建习惯）**：在项目详情页创建的习惯带上了该项目 id，落库后立即出现在该项目的习惯列表里。
- [ ] **AC-7（全量测试通过）**：`pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿；新增/改造逻辑均有单测覆盖。

## Out of Scope

- 习惯的 `outcome` 字段（不与项目合表——见 design.md §2 的判断）
- 每周回顾对习惯归属的呈现（Weekly Review snapshot 本次不动）
- 习惯的重新归属（把已有习惯改挂到另一个项目）——创建时决定，之后不可改
- 习惯页按项目分组 / 过滤