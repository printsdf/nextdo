# App UI: 四 tab 图形化界面功能化（Inbox 捕获+明晰、Now 执行、Projects、Review）

## Goal

将 Nextdo 图形化界面从 scaffold 垂直切片补全为可用产品：Inbox 快速捕获 + Clarify 明晰问答向导、Now 执行屏（开始/稍后计数/今日习惯进度）、Projects 列表 + 行动覆盖率 + 项目详情、Review 日常/周回顾流程 + 历史。共享 Expo 代码库（apps/mobile），验证面默认 Web 浏览器（Tauri 桌面复用同一构建）。不新增后端端点，复用 packages/db 既有查询与变更。

## Background（代码库现状，2026-09-22 核查）

**Scaffold 现状**（4 个 tab 全部只读/最小态）：

| Tab | 现状 | 锚点 |
|-----|------|------|
| Inbox | 仅 InboxItem 列表 + 空态；无捕获输入、无 Clarify | `apps/mobile/app/(tabs)/inbox.tsx` |
| Now | 单条推荐 + Why this?（top-3）+ Skip；引擎上下文硬编码 `contextIds: []`、`availableMinutes: 60` | `apps/mobile/app/(tabs)/now.tsx`、`apps/mobile/hooks/use-now.ts` |
| Projects | 项目列表 + 覆盖率 Tag；无创建、无详情 | `apps/mobile/app/(tabs)/projects.tsx` |
| Review | 仅 review 记录列表；无回顾流程 | `apps/mobile/app/(tabs)/review.tsx` |

**可直接复用的 packages/db 表面**（无后端端点新增）：Inbox CRUD（`queries/inbox.ts`）；`applyClarify`（`queries/inbox.ts:282`，单事务走完 core 决策表，7 种 outcome，Project+首个 NextAction 原子创建）；`reclarifyAction`（`queries/inbox.ts:424`，从问题 2 重入）；`ClarifyTarget` 形状（`queries/inbox.ts:145`）；actions 全套事务（`completeAction`/`skipAction`/`snoozeAction`（`queries/actions.ts:238`，自动落 reminder 行并重置 skips）/`trashAction`；`ACTION_TABLES` 覆盖 next/calendar/habit（`queries/actions.ts:25`））；projects CRUD + `projectActionCoverage`；`listReviewRecords`/`addReviewRecord`；focus 全套（`startFocusSession`/`recordPause`（绝对累计 pausedSec）/`completeFocusSession`/`abandonFocusSession`（不动 action））；contexts、habits、waiting、someday、calendar、reference 各自 list/add/update/trash；engine pool（`queryEnginePool` + `poolWatchQuery`，Now 读路径已验证）。

**core 已定死、UI 不得偏离的契约**：Clarify 决策表（`packages/core/src/domain/clarify.ts` `classifyInboxItem`，Q1–Q5 + 7 outcome）；estMinutes 为 next/calendar/project 路径必填（`requireEstMinutes`），value 默认 3，two-minute 路径 value 固定默认；引擎输出（`recommended` 唯一 / `eligible` 支撑"换一个" / `filtered` 可解释 / `needsReclarify` 阈值 `RECLARIFY_THRESHOLD = 3`，见 `.trellis/spec/domain/next-action-engine.md`）；FocusSession preset ∈ {25,45,60}（`FOCUS_PRESET_MINUTES`）或 free；ReviewRecord daily/weekly 的 snapshot + answers 形状（`packages/core/src/domain/types.ts:190–258`，注释明确 decisions 落地为真实事务）。

**缺口与约束**：schema 无 settings 表 → 引擎上下文持久化走 expo-secure-store（已装，与 owner-token 同模式），不进同步面；`completion_records` 只有写入事务、无列表查询 → 需在 packages/db 增一个只读查询（`listCompletionRecords`）+ 两个 snapshot 组合查询（客户端包内增量，非后端端点）；无 expo-notifications → reminder 行会落但无推送；PowerSync schema/sync-config 零改动；界面文案统一中文（scaffold 现为英文，本任务替换）。

## Requirements

- **R1 捕获（Inbox）**：顶部低摩擦文本捕获（Enter/按钮即存，无分类无必填）→ `addInboxItem`；列表 oldest-first；点击条目进 Clarify；条目可内联删除（`trashInboxItem`）。
- **R2 Clarify 向导**：逐步问答覆盖 core 决策表全部分支（Q1 可行动？→ 资料/有空再说/删除；Q2 多步骤？→ 项目表单（outcome 必填）；Q3 2 分钟？→ 当场做完（do-now）/转行动；Q4 我的责任？→ 等待表单（waitingOn 必填）；Q5 固定时间？→ 日历表单（startsAt 必填）/普通行动表单）。行动类路径必填 estMinutes（quick chips + 自定义）。提交 = `applyClarify` 单事务，成功后自动返回 Inbox（条目消失）。v1 不问 contextIds/window/category/dueDate/dependsOnId。
- **R3 再明晰**：Now 屏对 `consecutiveSkips ≥ 3` 的推荐项显示横幅（带实际次数）→ reclarify 向导（Q2 起）→ `reclarifyAction`。
- **R4 Now 屏**：引擎上下文条（场景 chips 自 contexts 表 + 快捷新建 + 「任意」；时间 chips 15/30/60/120 + 自定义；持久化 secure-store）；推荐卡（kind/est/项目·截止副题 + Why this? top-3 中文化）；`[开始]` → 专注计时屏；`[换一个]` → skip；`[稍后]` → snooze sheet（10 分钟/30 分钟/今晚 20:00/明天 08:00，本地时间）；「稍后 N 个可执行事项」= eligible 计数（可展开列表）；「今天习惯 done/total」（`listHabitDays` 当日），未完成习惯 chip 一键完成（`completeAction` habit）；空态区分池空/全被过滤（附过滤原因）。
- **R5 专注计时屏**：选 25/45/60/自由 → `startFocusSession`；倒计时（free 正计时）+ 暂停/继续（`recordPause` 绝对累计）+ 时间到横幅（完成/继续）；`[完成]` = `completeFocusSession` → `completeAction`；`[放弃]` = `abandonFocusSession`（action 不变）；重入恢复 active 会话。1s tick 仅用于显示，事务 `now` 一律 `useAppClock`。
- **R6 Projects**：列表（中文 tag + 覆盖率）+ 新建项目（title/outcome/value）；详情页：名下 open actions（客户端过滤 projectId）每行 完成/稍后/删除 + 添加行动表单（title/estMinutes/value/deadline 可选）→ `addNextAction` 带 projectId。项目状态不在此屏编辑。
- **R7 Review**：Review tab = 今日/本周入口 + 历史列表。日常回顾：snapshot（inbox 数/今日完成/未完成/缺行动项目/待跟进/今明日程/反复跳过）+ 重新排期（snooze 到指定日期 08:00）/标记完成/明日必做（明天 08:00）/跳过备注，提交 = 先落地变更事务、最后 `addReviewRecord`（失败停步不写记录）。周回顾：snapshot（inbox/项目表含 lastProgressAt/待跟进/someday 数/停滞项目≥14 天/未来 7 天日程）+ inboxCleared、calendarReasonable 确认 + followUps 勾选 + 项目状态决策（active/on-hold/done/dropped → `updateProject`）+ someday 保留/删除（→ `trashSomedayMaybeItem`），提交同顺序。
- **R8 文案**：全界面中文（tab 标题/空态/按钮/表单/错误提示，NextdoError code → 中文映射表）。

## Acceptance Criteria

- [ ] **AC1 捕获**：Inbox 输入文本保存 → 新条目出现在列表；删除 → 消失。
- [ ] **AC2 明晰**：7 种 outcome 分支各走一遍 → 对应行创建（reference/someday/waiting/project+首个行动/calendar/next-action/do-now 当场完成），Inbox 条目消失；缺必填（如 project 无 outcome、waiting 无 waitingOn）→ 被拦截并中文提示，不落行。
- [ ] **AC3 Now 推荐**：切换上下文/可用时间 → 推荐随引擎重算变化；「换一个」→ 推荐变化且该行动 consecutiveSkips +1；连跳 3 次 → 出现再明晰横幅（文案含次数）；「稍后」→ 该行动退出推荐池且 reminders 表新增一行。
- [ ] **AC4 专注**：开始 → 25 分钟倒计时；暂停停止/继续恢复（累计正确）；完成 → 行动完成（退出池 + completion_records 有行）；放弃 → 行动未完成、session 行状态 abandoned。
- [ ] **AC5 项目**：新建项目 → 列表出现（no open action 红 tag）；详情添加行动 → tag 翻 has open action；完成该行动 → 回红。
- [ ] **AC6 日常回顾**：把一条未完成行动排到明天 → 该行动 snoozedUntil = 明天 08:00（当日推荐池不出现）；勾选已完成 → completion 存在；提交 → review_records 新增 daily 记录并在历史列表可见；变更中途失败 → 不写记录。
- [ ] **AC7 周回顾**：项目置 done → 项目 status 更新；someday 删一条 → 条目消失；提交 → weekly 记录入库且可见。
- [ ] **AC8 门**：根门 `pnpm lint && pnpm typecheck && pnpm test` 全绿；`pnpm --filter @nextdo/mobile web` 可启动，AC1–AC7 在浏览器逐条走查通过，记录入 `research/manual-verification.md`。

## Decisions（用户已拍板，2026-09-22）

1. **Now 屏「开始」= 进入专注计时屏**（25/45/60/自由、暂停、完成/放弃；db focus 事务全套现成）。
2. **Review 深度 = 务实落地**：日常回顾落地重新排期/完成/明日必做；周回顾落地项目状态决策 + someday 保留/删除；Someday→项目/行动转化不做。
3. **Habit = 只读进度 + 完成**：Now 屏显示今日习惯 done/total、可一键完成今日习惯日；习惯创建/管理表单留后续任务。

## Out of Scope

- 习惯创建/编辑/挑战启动（`addHabit`/`startHabit` 有 db 支持，UI 不做）
- Someday → 项目/行动的转化流程
- 推送通知（reminder 行落库但无 push；expo-notifications 不装）
- Clarify 向导的 context/window/category/dueDate/dependsOnId 字段（空 contextIds = 处处可执行）
- 引擎上下文的多设备同步（secure-store 本地持久化）
- 项目状态在详情页的编辑（集中在周回顾）
- 多设备同步链路验证（已由 09-22-e2e-sync-roundtrip 任务覆盖）
- Tauri 桌面端构建（复用 web 构建，本任务不碰 Rust 面）

## Deferred（后续任务候选）

- 习惯创建表单（含 21 天挑战启动）
- 推送通知（expo-notifications + reminder 消费）
- Clarify 进阶字段（时间窗口、场景绑定）
- 引擎上下文的 settings 表化（进同步面）
- 图标资源（scaffold 为纯文字 tab bar）
- Now 屏矮视口布局打磨（内容溢出时底部 snooze sheet 需滚动，走查观察项，见 research/manual-verification.md）
- 参考资料的展示入口（v1 reference 行只落库无展示屏，走查已验证行创建；需要时加 Inbox 过滤或独立屏）

## 技术决策摘要（详见 design.md）

- packages/db 只增不改：`listCompletionRecords` + `buildDaily/WeeklyReviewSnapshot` + index.ts 导出面扩展（Rule 3）；core/ui 不动、server 零改动、schema 零改动。
- 向导 = 纯 reducer（`lib/clarify-flow.ts`，单测覆盖 7 outcome）；专注计时 = 纯函数 `lib/focus-timer.ts`；snooze 选项 = 纯函数 `lib/snooze-options.ts`。
- 新路由：`clarify/[id]`、`reclarify/[id]?kind=`、`focus/[id]?kind=`、`projects/[id]`、`review/daily`、`review/weekly`。
- 无新增依赖、无新增全局状态；回顾提交顺序 = 变更先、记录后。

## Open Questions

（无 — 3 项用户决策已收口，技术缺口均已在 design.md 定解）
