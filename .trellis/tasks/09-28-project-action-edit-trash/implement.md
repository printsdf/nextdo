# Implement — 项目与行动的编辑/归档操作

> 工件：prd.md（需求/验收）、design.md（设计）。平台：Cursor（sub-agent 派发：trellis-implement / trellis-check）。

## 执行顺序

### Step 0 — 分支（gate：分支就位后才开始改码）

- [ ] 新分支：`git checkout -b feature/project-action-edit-archive`（基于当前 `feature/prod-deploy-connect` HEAD；该分支领先 main 未合并，延续既有特性链模式）
- [ ] `python3 ./.trellis/scripts/task.py set-branch feature/project-action-edit-archive`
- [ ] `python3 ./.trellis/scripts/task.py set-base-branch feature/prod-deploy-connect`

### Step 1 — R5 池子过滤（packages/db）

- [ ] `packages/db/src/queries/pool.ts` `queryEnginePool`：复用 `projectRows` 构建 active 项目 id 集；Open NextActions 段跳过 `project_id` 非空且不在集中的行；文件头 docblock 的池子契约注释同步加一条
- [ ] `packages/db/src/test/queries.pool.test.ts`：design §2 的 5 个用例
- [ ] 验证：`pnpm --filter @nextdo/db test`（该包测试脚本名以 package.json 为准）

### Step 2 — mobile hooks（apps/mobile/hooks）

- [ ] `use-update-project.ts`（design §3.2：patch 式整行更新，now 取 useAppClock）
- [ ] `use-update-next-action.ts`（同上，字段 title/estMinutes/value/deadline）
- [ ] 不改动 `use-project-status.ts`（周回顾继续用它）

### Step 3 — 项目详情屏（apps/mobile/app/projects/[id].tsx）

- [ ] 头部卡：active → [编辑][归档]；on-hold → [编辑][恢复]；done/dropped 无按钮（design §3.1）
- [ ] `EditProjectForm` 内联组件（预填 title/outcome/value，空值不可提交）
- [ ] `EditActionForm` 内联组件 + `editingActionId` 状态（同一时刻一个；截止沿用 `endOfLocalDayIso` 约定）
- [ ] 行动行按钮：[完成][稍后][编辑][删除]
- [ ] 更新文件头 docblock（作废 "status is not editable here" 表述）

### Step 4 — mobile 测试（apps/mobile/__tests__）

- [ ] `projects-screen.test.tsx`（或详情路由所属测试文件，实现时确认）新增：
  - R1 编辑保存后头部更新；空标题/空结果不可提交
  - R2 归档：Tag 变「搁置」、按钮变 [恢复]、无确认弹窗
  - R3 恢复：on-hold → active 按钮切换
  - R4 行动编辑保存后行更新
  - done/dropped 项目无 编辑/状态 按钮
- [ ] `now-screen.test.tsx` / `tabs.smoke.test.tsx`：确认 R5 不破坏既有用例（池子由 db 测试锁定，UI 层若直接 mock pool 数据则无需改；改动了 mock 形态才补）

### Step 5 — 质量门（全量）

- [ ] `pnpm -r typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm -r test`（core + db + mobile 全绿）
- [ ] web 冒烟（手动）：`pnpm --filter @nextdo/mobile web` + 浏览器走一遍 prd Acceptance 最后一行：
  建项目 → 加行动 → Now 有推荐 → 归档 → Now 消失 → 恢复 → Now 回来 → 编辑项目标题/价值 → 编辑行动预估 → 完成一条行动
- [ ] （可选，按需）`node e2e/sync-roundtrip.ts`：本任务无 server/schema 改动，e2e 非必须；仅在怀疑同步面时跑

### Step 6 — Spec 更新（Phase 3.3，trellis-update-spec）

- [ ] `next-action-engine.md` Pool contract 加 R5 条款
- [ ] `domain-model.md` Project 节补 active↔on-hold 快捷切换说明
- [ ] `app/` 层记录 hook 先例与状态入口修订

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|------|------|------|
| `packages/db/src/queries/pool.ts` | 唯一语义变化；过滤条件写错会让行动凭空消失/不回来 | Step 1 单独提交，`git revert` 即回现状 |
| `apps/mobile/app/projects/[id].tsx` | 该屏已有较多交互（AddActionForm/SnoozeSheet）；编辑态与 snooze 弹层状态相互干扰 | Step 3 单独提交 |
| `apps/mobile/__tests__/projects-screen.test.tsx` | 断言依赖既有按钮布局 | 随 Step 4 提交 |

提交切分建议：`feat(db): exclude non-active project actions from the engine pool` → `feat(mobile): project edit + archive/resume on detail` → `feat(mobile): edit form for project actions` → `docs(spec): ...` → `docs(trellis): task artifacts`。

## task.py start 前检查（已完成）

- [x] prd.md 收敛（无阻塞 open questions；D1–D3 用户拍板）
- [x] design.md / implement.md 就绪
- [ ] implement.jsonl / check.jsonl 至少各一条真实 spec 条目（派发 sub-agent 前必须）
- [ ] 用户明确批准最终规划摘要后才 `task.py start`
