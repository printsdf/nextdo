# 捕获后即时澄清 + 问题链内置项目归属

## Goal

让捕获（Inbox）之后的整理由 App 主导、一条一条走完：

1. 捕获保存后**立即**对该条开始逐步提问（Clarify 向导），不再静默入列表等用户自己点开；
2. 提问链中内置**项目归属选项**：可以把这条挂到**已有项目**下（与"新建项目"、"不属于项目"并列），而不是让用户离开收件箱流程去 Projects 页面手动加行动；
3. 全程逐步提问（一次一题），主动权在 App，不交给用户自由导航。

## Decisions（用户已确认）

- **D1 捕获后交互 — 记一条问一条**：任一处捕获（快速捕获弹窗 / Inbox 内联输入条）
  保存成功后立即进入该条的 Clarify 逐步提问；提问结束后回到捕获输入并问
  "再记一条？/完成"，循环直到用户选完成。快速捕获弹窗原有的"连记多条再完成"
  语义被此循环取代。
- **D2 项目归属问题的位置**：在 Q2"需要多个步骤吗？"= 否 之后插入新一步 Q2b
  "它属于哪个项目？"：已有项目列表 + "新建项目" + "不属于项目"。Q2=是 仍走
  新建项目表单（不变）。re-clarify 从 Q2 重入，自动带上 Q2b（可改挂/解除项目）。
- **D3 挂到已有项目后的链路 — 直接进表单**：选完已有项目直接进行动表单
  （预估/价值/截止，价值默认继承项目价值、可改），跳过 Q3（2 分钟）/Q4（我的
  责任）/Q5（固定时间）。依据：v1 中 `CalendarAction` 没有 `projectId`，
  "固定时间"与"项目归属"互斥；自己项目下的行动再问"由我完成吗"是冗余。

## Background（现状，已核实）

- 捕获入口两处，行为一致：
  - 快速捕获弹窗 `apps/mobile/components/quick-capture-modal.tsx`（现状支持一次会话
    连记多条，按"完成"关闭）；
  - Inbox tab 内联输入条 `apps/mobile/app/(tabs)/inbox.tsx`（`capture()`）。
  - 两者保存后都只调用 `add(title)` 静默入库（`use-add-inbox-item.ts`，返回
    `Promise<void>`，**不返回新条目 id**），不触发任何后续提问。
- 进入 Clarify 的唯一路径是用户自己点 Inbox 列表行（`inbox.tsx` `InboxRow` →
  `router.push(/clarify/<id>)`）。
- Clarify 向导 `apps/mobile/components/clarify-wizard.tsx` + 纯状态机
  `apps/mobile/lib/clarify-flow.ts` 已是"一次一题"：Q1 → (Q1b) → Q2 → Q3 →
  (Q3b) → Q4 → Q5。
- 问题链中唯一与项目相关的分支：Q2=是 → **新建**项目表单（`clarify-flow.ts`
  `q2 → toForm('project')`）。Clarify 创建的 `NextAction.projectId` 恒为 null。
- 挂到已有项目目前只有一条独立路径：Projects tab → 项目详情 → AddActionForm
  （`apps/mobile/app/projects/[id].tsx`），与收件箱流程割裂。
- core 契约 `packages/core/src/domain/clarify.ts`：`ClarifyAnswers` 无 `projectId`；
  `classifyInboxItem` 无"挂已有项目"outcome。
- db 层 `packages/db/src/queries/inbox.ts`：`buildNextAction` 已接受
  `base.projectId`（'project' 分支传新建项目 id）；`ReclarifyAnswers` 是显式字段
  的接口（Q2 起），`reclarifyAction` 经 `classifyInboxItem({ actionable: true,
  ...answers })` 复用同一判定表。
- 向导所需的项目列表数据源已存在：`apps/mobile/hooks/use-projects.ts`
  （`useProjects()` → 带派生覆盖标志的未删除项目，watched 实时）。
- spec 已规定：`NextAction.value` "defaults to the parent project's value when
  created from one"（`.trellis/spec/domain/domain-model.md`）。

## Requirements

- **R1 捕获后即时提问（记一条问一条）**：任一处捕获保存成功后立即对该条新记录进入
  Clarify 逐步提问；提问结束后提供"再记一条 / 完成"两个显式出口：
  - "再记一条" → 回到收件箱并重新打开快速捕获弹窗（自动聚焦）；
  - "完成" → 返回进入向导前的界面。
  Inbox 列表行点开进向导的入口保留（补充路径，不删除）；向导中途返回（← 返回）
  时该条留在收件箱（现状"中止则 InboxItem 保留"语义不变）。
- **R2 问题链内置项目归属（Q2b）**：Q2=否 之后出现"它属于哪个项目？"，选项 =
  已有（active）项目列表 + "新建项目" + "不属于项目"；没有项目时只出现后两个。
  - 选已有项目 → 直接进行动表单（D3）：`projectId` = 该项目；价值默认继承项目
    价值（可改）；保存后该行动出现在项目详情行动列表里；
  - 选"新建项目" → 现有项目表单（项目 + 首个行动原子创建，不变）；
  - 选"不属于项目" → 现有 Q3/Q4/Q5 路径，`projectId` = null。
  re-clarify 同路径：Q2b 展示当前项目为现状（可保持/改挂/解除）。
- **R3 契约扩展**：core `ClarifyAnswers` / `classifyInboxItem` 与 db
  `ReclarifyAnswers` / `applyClarify` / `reclarifyAction` 支持"挂已有项目"：
  项目存在性/active 校验（带错误码）、re-clarify 解除挂接时新行 `projectId`
  为 null。
- **R4 逐步提问主导**：提问链每步只展示一题与有限选项；"再记一条 / 完成"循环中
  不存在"让用户自由挑下一步"的导航式 UI。

## Acceptance Criteria

- [ ] 快速捕获弹窗 / Inbox 输入条保存成功后，Clarify 向导立即针对该条开始提问
      （无需用户点开列表行）。
- [ ] 向导完成步出现"再记一条 / 完成"两个按钮；"再记一条"回到收件箱并自动打开
      快速捕获弹窗，"完成"返回原界面。
- [ ] 问题链出现 Q2b：展示已有（active）项目 + 新建项目 + 不属于项目；无项目时
      只有后两个选项。
- [ ] 选已有项目后直接进行动表单（无 Q3–Q5）；创建的 `NextAction.projectId`
      指向该项目、出现在项目详情列表，value 默认为项目 value（表单可改）。
- [ ] 选"不属于项目"后走 Q3–Q5，行为与现状一致（`projectId` = null）。
- [ ] re-clarify 可改挂项目、可解除挂接（新行 `projectId` = null）、可保持不变。
- [ ] 挂到不存在/已删/非 active 项目时，db 事务抛带错误码的 `NextdoError`，
      UI 显示对应中文提示，事务内无任何脏写。
- [ ] 现有 Clarify 各分支（reference/someday/trash/do-now/project/waiting/
      calendar/next-action）与 re-clarify 回归测试全绿；
      `pnpm typecheck` / `pnpm lint` / `pnpm test` 全绿。

## Out of Scope

- Inbox 列表行点开进向导的入口保留（不删除）。
- `CalendarAction` 增加 `projectId`（"固定时间 + 项目归属"并存）— v1 不做。
- 系统日历导入、多设备同步行为、desktop 差异 — 不动。
- 行动的 context（执行场景）选择 — 现状 Clarify 表单就没有，不扩。
- 引擎（`next-action-engine.md`）— 不受影响（`project-importance` 信号已读
  `projectId`）。
