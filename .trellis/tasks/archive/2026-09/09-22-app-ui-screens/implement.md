# Implement — App UI 四 tab 功能化

执行清单（任务 09-22-app-ui-screens）。设计依据见 `design.md`，需求与验收见 `prd.md`。
每步自包含、可独立验证；步骤间依赖只沿编号递增。

---

## 步骤

### 0. 前置确认（不动代码）

- [x] `python3 ./.trellis/scripts/task.py current --source` 确认活动任务为本任务（初始未激活，已 `task.py start` 置为本任务）
- [x] 跑一遍根门 `pnpm lint && pnpm typecheck && pnpm test`，记录基线（须绿）— 基线绿：lint ✓、typecheck ✓（6 workspace）、test ✓（server/app 51 + core 153 + db 127 + mobile 4 = 335 passed，0 failed）
- [x] 读 spec（implement.jsonl 清单）：重点 `app/hook-guidelines.md`（Rule 4 `now` 纪律）、`app/state-management.md`、`project/directory-structure.md`（Rule 3 index 导出面）

### 1. packages/db 增量（只增不改）

- [x] `queries/reviews.ts`：`listCompletionRecords(db, { actionIds?, since? })`（空 actionIds 短路返回 []；since 含边界 `>=`）
- [x] `queries/reviews.ts`：`buildDailyReviewSnapshot(db, now)` / `buildWeeklyReviewSnapshot(db, now)`（字段口径按 design.md §3；`RECLARIFY_THRESHOLD` 从 core 引）
- [x] `src/index.ts`：按 design.md §3 的清单扩展导出（含类型导出；另加 `listFocusSessions` — §4.6 重入恢复需要，additive）
- [x] 测试：`src/test/queries.reviews.test.ts` 追加 14 个测试 — snapshot 各字段空/非空/边界（本地日午夜边界、23:59:59 不入今、stall 14 天含边界、repeatedSkips 阈值 = 3 不是 2、过期 waiting 含今日/不含明日、7 天日程窗含头不含尾）
- [x] 验证：`pnpm --filter @nextdo/db test`（141 passed）&& `pnpm --filter @nextdo/db typecheck` ✓；根门全绿

**回滚点 R1**：本步独立可 revert，不影响 app 现有功能。

### 2. apps/mobile 纯逻辑 lib（先单测后 UI）

- [x] `lib/clarify-flow.ts`：向导 reducer（状态机 + 表单字段收集 + 提交前必填校验 + 产出 `ClarifyAnswers`/`ClarifyTarget`）；reclarify 模式从 q2 起步
- [x] `lib/clarify-flow.test.ts`：7 种 outcome 各一条路径 + 每个必填字段缺失拦截 + reclarify 入口
- [x] `lib/snooze-options.ts` + 测试（今晚 20:00 已过 → 明晚；本地日边界）
- [x] `lib/focus-timer.ts`（remaining/elapsed 纯函数：startedAt, plannedMinutes, pausedSec, now）+ 测试（含 free 模式、暂停累计、归零）
- [x] `lib/engine-context.ts`：secure-store 读写 `{ contextIds, availableMinutes }`（默认 `[]`/60）+ `useEngineContextSettings` hook
- [x] 错误文案表：lib 层 NextdoError code → 中文映射（覆盖向导/专注/回顾会触发的校验码）
- [x] 验证：`pnpm --filter @nextdo/mobile test && pnpm --filter @nextdo/mobile typecheck`（64 passed；根门 409 passed 全绿）

**回滚点 R2**。

### 3. Inbox 屏 + Clarify/Reclarify 向导

- [x] Inbox 屏：捕获输入（低摩擦、无必填）+ 列表 + 点击进 clarify + 内联 trash
- [x] `clarify/[inboxId].tsx` + `reclarify/[id].tsx`：共享向导组件（每步一屏、返回回退、提交后摘要 + 自动 back）
- [x] 表单字段按 design.md §4.3（estMinutes chips、value 1–5、可选 deadline 等）
- [x] 组件测试（jest-expo）：向导步进（mock db hook）、必填拦截提示、提交成功/失败路径
- [x] 验证：`pnpm --filter @nextdo/mobile test`（72 passed）；web 手动走查并入步骤 8（AC1/AC2）
  - 注：实现中发现并修复 lib reducer bug —— `done` action 原本只在 form 步生效，do-now 路径（q3b 直接提交）被吞；已加 lib 回归测试锁定

**回滚点 R3**（Inbox 闭环 = 本任务第一个可用里程碑：捕获 + 明晰全通）。

### 4. Now 屏

- [x] `useNow` 扩展：返回 eligible 列表 / needsReclarify / filtered 摘要；`useEngineContextSettings` 接入（替换硬编码 scaffold context）
- [x] 引擎上下文条（场景 chips + ＋建 context；时间 chips + 自定义）
- [x] 推荐卡中文化 + Why this?（top-3 + eligibility 摘要）
- [x] 三主按钮：开始 → focus 路由；换一个 → skip（既有 hook）；稍后 → snooze sheet（`lib/snooze-options` + `snoozeAction`）
- [x] needsReclarify 横幅 → reclarify 路由（文案带实际次数）
- [x] 底部摘要：稍后 N 个可执行（可展开列表）+ 今天习惯 done/total + 习惯 chip 一键完成
- [x] 空态区分（池空 vs 全被过滤 + 过滤原因折叠）
- [x] 组件测试：mock pool 各形态（有推荐/空池/全过滤/needsReclarify 触发）
- [x] 验证：`pnpm --filter @nextdo/mobile test`（77 passed）；web 手动走查并入步骤 8（AC3）

**回滚点 R4**。

### 5. Focus 专注计时屏

- [x] `focus/[id].tsx?kind=`：选时长（25/45/60/free）→ `startFocusSession` → 计时中（屏内 1s tick 仅显示；db 变更 `now` 一律 `useAppClock`）
- [x] 暂停/继续（`recordPause` 绝对累计）；时间到横幅（完成/继续）；完成（`completeFocusSession` → `completeAction`）；放弃（`abandonFocusSession`，不动 action）
- [x] 重入恢复：查该 action 的 active 会话恢复显示
- [x] 组件测试：mock 会话行各状态（active/paused/terminal/无会话）
- [x] 验证：`pnpm --filter @nextdo/mobile test`（85 passed）；web 手动走查并入步骤 8（AC4）

**回滚点 R5**（Now 闭环 = 核心执行环可用）。

### 6. Projects 屏 + 详情

- [x] Projects 屏：中文 tag + `[＋ 新项目]` 表单（title/outcome/value）
- [x] `projects/[id].tsx`：头部 + 名下 open actions（客户端过滤 projectId）每行 完成/稍后/删除 + `[＋ 添加行动]` 表单
- [x] 组件测试：列表/详情渲染 + 添加行动后覆盖率 tag 翻转（mock hooks）
- [x] 验证：`pnpm --filter @nextdo/mobile test`；web 手动：建项目（no open action 红 tag）→ 详情加行动（tag 翻绿）→ 完成行动（回红）

**回滚点 R6**。

### 7. Review 屏 + daily/weekly

- [x] Review tab：入口卡 + 历史列表
- [x] `review/daily.tsx`：snapshot 展示 + 重新排期/已完成勾选/明日必做/反复跳过只读 + 提交（先落地变更事务，最后 `addReviewRecord`；失败停步不写记录）
- [x] `review/weekly.tsx`：snapshot 展示 + inboxCleared/calendarReasonable 确认 + followUps 勾选 + 项目状态决策 + someday 保留/删除 + 提交（同顺序）
- [x] 组件测试：mock snapshot 各形态；提交顺序（变更失败 → 无记录）
- [x] 验证：`pnpm --filter @nextdo/mobile test`；web 手动：daily 把一条行动排到明天（明天 08:00 生效、推荐池当天不出现）；weekly 把项目置 done + 删一条 someday（各屏状态翻转）+ 历史记录出现

**回滚点 R7**（四 tab 全闭环）。

### 8. 收尾

- [x] 全界面文案中文化过一遍（tab 标题、空态、按钮、错误提示）— app/**.tsx 无英文 JSX 文本/placeholder/label；`lib/error-messages.ts` 全量中文映射
- [x] 根门：`pnpm lint && pnpm typecheck && pnpm test` — 2026-09-23 复跑全绿（最终检查 pass：470 passed = server 51 + core 153 + db 141 + mobile 125；明细见 research/manual-verification.md）
- [x] `pnpm --filter @nextdo/mobile web` 启动，浏览器按 prd.md AC1–AC8 逐条走查，截图/记录入 `research/manual-verification.md` — 两轮走查（第二轮补 AC2 全 7 分支 / AC4 放弃 / AC6 勾选+排期 / AC7 删 someday）
- [x] 检查 `implement.md` 勾选状态与本文件一致；遗留项写入 prd.md Deferred — 观察项 2 条已入 Deferred

---

## 验证命令（每步末跑对应粒度，收尾跑全套）

```sh
pnpm lint                      # 根 ESLint（flat config）
pnpm typecheck                 # pnpm -r tsc --noEmit
pnpm test                      # pnpm -r jest
pnpm --filter @nextdo/mobile web   # web 手动走查（验证面，Tauri 复用同构建）
```

## 风险文件 / 注意点

| 文件 | 风险 |
|------|------|
| `packages/db/src/index.ts` | Rule 3 导出面 — 只增不改，别动既有导出顺序/注释 |
| `packages/db/src/queries/reviews.ts` | snapshot 日期口径（本地日 vs UTC ISO）— 用 core time 助手，测试锁本地日边界 |
| `apps/mobile/hooks/use-now.ts` | 既有 vertical slice 扩展 — 保持纯计算（Rule 5：引擎输出不落库） |
| `apps/mobile/app/_layout.tsx` | 根布局（PowerSync provider）— 不动，除非路由组需要 |
| 专注屏 `now` 来源 | 1s tick 只进渲染；所有事务 `now` 必须 `useAppClock`（hook-guidelines Rule 4） |
| 回顾提交顺序 | 变更先、记录后；中途失败不写 review record |

## start 前检查

- [x] 根门绿（基线记录）
- [x] prd.md 收敛（无未决 open question）
- [x] implement.jsonl / check.jsonl 已 curation（真实 spec 条目）
- [x] 用户已批准最终 planning summary
