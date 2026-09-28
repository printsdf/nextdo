# 项目与行动的编辑/归档操作

## Goal

给项目和它的进行中行动补上"编辑"与"移出工作面"的 UI 入口：

- 项目：编辑（标题/结果/价值）+ 归档（搁置，可恢复）
- 行动：编辑（标题/预估/价值/截止）
- 引擎池加一条过滤：项目非 active 时，它的行动不进 Now

用户价值：项目做不下去时可以不丢数据地停掉它并清理 Now 屏；字段写错了可以就地改，不用绕周回顾。

## Background（确认事实）

- db 层函数均已存在：`updateProject`（整行更新 + `assertTransition` 状态机校验，`packages/db/src/queries/projects.ts:62`）、`trashProject`（同文件 `:78`）、`updateNextAction`（`packages/db/src/queries/actions.ts:91`，title/estMinutes 变化时重置 `consecutiveSkips=0`，引擎 spec "Skip & Re-clarify"）、`trashAction`（`actions.ts:277`）。
- 项目状态机（`packages/core/src/domain/state.ts:37`）：`active → on-hold/done/dropped`；`on-hold → active/done/dropped`；`done`/`dropped` 为终态。
- 项目 tab 的"已归档"筛选已显示 `status !== 'active'` 的项目（`apps/mobile/app/(tabs)/projects.tsx`）；`useProjectCards` 的 watch 已含 projects 表，状态变化自动刷新。
- 引擎池不按项目状态过滤：`queryEnginePool`（`packages/db/src/queries/pool.ts`）只按 open + 未删除取 `next_actions`；on-hold 项目的行动仍进 Now，仅 project-importance 分数为 0（`packages/core/src/engine/rank.ts:55-60` + 测试锁定"on-hold 贡献 0"）。
- `CalendarAction` v1 无 `projectId`（与固定时间互斥，domain-model.md）；`HabitDay` 不挂项目 —— 池子过滤只影响 `next_actions` 表。
- `poolWatchQuery` 的 union 已含 projects 表：项目状态变化会触发 Now 屏重算，无需改订阅。
- Trash 屏（恢复/硬删）未实现，本次范围外（用户在范围选择时明确排除）。
- 原 app-ui 任务 design.md §4.4 规定"项目状态不可在详情编辑，状态决策在周回顾"——本任务**有意修订**该决策：详情获得 归档/恢复 快捷动作；done/dropped 仍只经周回顾。

## Requirements

- **R1 项目编辑**：项目详情增加"编辑"入口，内联表单（沿用 Card + chips 模式，参考 `NewProjectForm`）编辑 `title` / `outcome` / `value`，经 `updateProject` 保存；状态不在可编辑字段内。空标题/空结果不可提交。
- **R2 项目归档**：详情中 active 项目提供"归档"动作 → `active → on-hold`（`updateProject`）。无确认弹窗（可逆）。归档后项目从"进行中"列表消失、出现在"已归档"。
- **R3 项目恢复**：详情中 on-hold 项目提供"恢复"动作 → `on-hold → active`。done/dropped（终态）详情不显示状态动作。
- **R4 行动编辑**：项目详情的行动行增加"编辑"入口，内联表单编辑 `title` / `estMinutes` / `value` / `deadline`（与 `AddActionForm` 字段集对齐），经 `updateNextAction` 保存。db 层既有行为（改 title/est 重置 consecutiveSkips）保持。
- **R5 池子过滤**：`queryEnginePool` 中，`project_id` 指向非 active（或已删除/不存在）项目的 `next_actions` 不进候选集；无项目的行动、今日 HabitDay、CalendarAction 不受影响。引擎（core）不改——过滤属池子契约，由 db 层执行。
- **R6 归档后详情仍可用**：on-hold 项目详情中，其行动仍可完成/稍后/删除/编辑（db 事务不校验项目状态，天然成立；作为验收行为固定下来）。

## Acceptance Criteria

- [ ] (R1) 详情点"编辑"→ 表单预填当前值 → 改标题/结果/价值保存后头部即时更新；标题或结果为空时不可提交。
- [ ] (R2) 归档 active 项目：无确认弹窗；"进行中"列表消失、"已归档"出现；状态 Tag 显示"搁置"。
- [ ] (R3) 从"已归档"打开 on-hold 项目 → 点"恢复"→ 回到"进行中"。done/dropped 项目详情无 归档/恢复 按钮。
- [ ] (R4) 行动行点"编辑"→ 改字段保存后行显示新值；改 title 或 estMinutes 后该行动 `consecutiveSkips` 归 0（db 测试覆盖）。
- [ ] (R5) 归档项目后，其 open 行动不再出现在 Now（hero + eligible 列表均无）；恢复项目后自动回来；无项目行动不受影响（`queries.pool.test.ts` 新增用例）。
- [ ] (R6) 归档后在详情内仍可完成/稍后/删除/编辑该项目的行动。
- [ ] 全量测试绿（core + db + mobile），web 冒烟通过：建项目→加行动→Now 有推荐→归档→Now 消失→恢复→Now 回来→编辑项目/行动字段生效。

## Out of Scope

- Trash 屏（恢复/硬删）与项目"删除"（软删除）入口 —— 留给回收站页面任务，届时有恢复路径
- 项目转 Someday（单向转换，周回顾"提升"是新建项目，原项目行与行动不会回来）
- CalendarAction / HabitDay / 等待 / 待启动 / 参考 / 习惯 / 情境实体的编辑与删除
- 状态机改动（done/dropped 保持终态，仍由周回顾决策）
- 归档对提醒的联动（该项目行动已排期的 Reminder 照常触发；点按钮仍走既有 complete/snooze/skip 事务）

## Key Decisions（用户拍板）

- **D1** "项目删除"改为"归档（on-hold）"，可逆；本次不加软删除入口（当前无恢复 UI 路径，删了是黑洞）
- **D2** 不做项目转 Someday：单向 + 设计给未开始的收件箱条目，不适合有进展历史的项目
- **D3** 池子加项目状态过滤：归档后行动拉出 Now，恢复自动回来（纯派生，不搬数据）

## Design Defaults（评审时可改）

- 行动"编辑"入口只放项目详情（Now 行不加编辑；Now 行保持 完成/稍后/跳过/删除）
- 归档无确认弹窗（可逆操作；与现有行动"删除"按钮直接生效的风格一致）
- 编辑表单字段集与对应"新建"表单对齐（项目：title/outcome/value；行动：title/est/value/deadline）
- R5 对 done/dropped 项目同样生效（其 open 行动也不进 Now）——周回顾"每个 Project 是否有 Next Action"红灯机制覆盖遗留清理

## Risks / Deferred Items

- R5 的副作用：周回顾把项目设为 done/dropped 时若有遗留 open 行动，这些行动会从 Now 消失（项目详情仍可见可处理）。已知行为，接受。
- 归档项目的行动若被 snooze，Reminder 仍会触发但行动不在 Now 列表（Out of Scope 已声明）。
- 修订了 app-ui design.md §4.4 的"状态只经周回顾"决策 —— Phase 3.3 需同步 spec（`next-action-engine.md` 池子契约 + app 层页面约定）。
