# 按 Paper Serenity 视觉基线重做四屏 UI

## Goal

把 Stitch 设计稿（`stitch_focus_gtd_clarify_app/`，gtd_1–gtd_4 +
`paper_serenity/DESIGN.md`）作为视觉基线，重做 App 的四个核心屏：
收集箱（Inbox）、Clarify 向导、项目（Projects）、下一步（Now）。
保留已定的交互决策（记一条问一条、Q2b 项目归属、逐步提问主动权在 App）
与 spec 问题链（Q1/Q1b/Q2/Q2b/Q3/Q3b/Q4/Q5），**不含** AI 澄清建议
（提案"不做"清单明确排除 AI）。

## Decisions（用户已确认）

- **D1 视觉基线 = Paper Serenity 全局替换**：替换 `packages/ui` tokens
  （色板/字体/圆角/间距/分层），全 app 生效；组件按 DESIGN.md 组件规范重样式。
- **D2 Now 屏 = 推荐 hero 优先**：Now 屏顶部保留引擎推荐单条行动 hero
  （大按钮"开始" + 换一个/稍后，Proposal §6 差异化能力不动）；设计稿
  gtd_4 的统计卡、情境过滤 chips、行动列表作为 hero 下方的辅助区
  （基于现有 eligible 列表，不新建数据源）。tab 保持现有 4 个
  （现在/收件箱/项目/回顾），不引入"今日/更多"。
- **D3 情境进 Clarify**：行动/日历表单加情境多选（Context 实体，种子
  家/办公室/电脑/手机/外出，可空 = 随处可执行）。db `ClarifyTarget`
  已支持 `contextIds`，只补表单与提交链路。设计稿 mock 的 chip 集合
  （@等待/@随时 等）不采用——用真实 Context 实体。
- **D4 项目屏按设计稿**：进度条（已完成/总行动数，新增派生查询）、
  项目截止标记（= open 行动中最早 deadline，派生）、"当前下一步行动"
  卡、"缺少下一步"警告 + "澄清下一步"（→ 项目详情）、筛选 chips
  （进行中/无下一步/已归档）。停滞判定复用周回顾 ≥14 天定义。
- **D5 向导三件套**：步骤进度（"步骤 n/m"，m = 该 mode 最长路径题数：
  clarify 7 / re-clarify 6，固定常数）、常驻决策摘要（已答题目+答案一览，
  未答置灰）、存前"决策摘要预览"**独立一步**（行动类结果：action/project/
  calendar/waiting 经预览；reference/someday/trash 直接提交不变）。

## 设计稿解读（已核实）

- 设计系统 `paper_serenity/DESIGN.md`：暖亚麻纸底（canvas `#faf9f6` /
  卡片 `#ffffff` + 1px 微边框 `#e8e5df`）、陶土主色（正文 `#c85a17`，
  YAML 色板 `#9c3f00`——取正文值为准）、炭黑墨文字（`#262320` / 次级
  `#716b64` / 占位 `#a8a299`）、情境 chip 土色系、Epilogue（标题）+
  Plus Jakarta Sans（正文，CJK 回落 PingFang SC）、tonal layering
  代替重阴影（Level 0–3）、圆角 8/12–16/full 三档、按钮/输入/行/checkbox
  组件规范完整。
- 四屏内容（**以各目录 screen.png 为准**：gtd_1=Clarify、gtd_2=Inbox、
  gtd_3=Projects、gtd_4=Next Actions；其中 gtd_1 的 code.html 是 Next
  Actions 的误导出，与 png 不符，其余目录 html 与 png 一致）：
  - **Inbox**：大标题"清空大脑 · GTD 第一步" + 捕获卡 + 待处理列表
    （行内"处理 →"、"优先澄清"标记）+ "GTD 澄清心法"说明卡 + 底部 tab。
  - **Clarify Item**：状态 chips + 条目标题卡 + 进度（步骤 4/8 + 50%）+
    当前问题大卡 + 上一步/下一步 + 常驻"GTD 决策摘要" + "决策摘要预览"。
    （设计稿的 AI 建议卡——**不做**，见 R4。）
  - **Projects**：项目卡（进度条/截止标记/当前下一步行动卡）+ 停滞警告 +
    筛选 chips + "+ 新建项目（明确具体成果）"。
  - **Next Actions**：统计卡（可执行 n/总、预计耗时、认知负荷）+ 情境过滤
    chips + 行动列表（标题 + 项目 chip + 情境 chip + 截止 chip）。
  - 底部导航（设计稿 5 tab → 按 D2 收敛为现有 4 tab，图标/样式按设计稿）。

## 已确认事实（代码侧）

- 现有 tokens：`packages/ui/src/tokens/{colors,radii,spacing,typography}.json`
  + `index.ts`（iOS 简约体系，09-23-app-ui-ios-redesign 刚完成）；
  app 侧经 NativeWind v4 Tailwind 语义类消费（`bg-canvas`、`text-ink`、
  `border-border`、`bg-surface`、`text-accent` 等）——**策略：语义类名
  不动，只换 token 值**，四屏改动面收敛到布局与组件。
- 现有 tab：Now / Inbox / Projects / Review（`apps/mobile/app/(tabs)/`）。
- Now 屏现状：hero（推荐单条）+ 情境/时长 chips + "稍后 N 个可执行事项"
  可展开列表（`useNow` 已返回 eligible 列表，候选带 `contextIds`）。
- 项目派生：`projectActionCoverage()` 只派生"有无 open 行动"；
  周回顾 `stalledProjects`（项目行动 ≥14 天无完成）定义可复用；
  "已完成/总行动数""最早 open deadline""项目下一步行动"**不存在**，
  需新增一个派生查询（`packages/db`，见 design.md）。
- Clarify 向导：`clarify-wizard.tsx` + 纯状态机 `clarify-flow.ts`
  （含 q2b）；完成步"再记一条/完成"；无进度/摘要/预览。
  `ClarifyTarget.contextIds` 已存在（`buildNextAction`/`buildCalendarAction`
  读 `target.contextIds ?? []`）——只差表单 UI 与提交链路。
- Context：spec（domain-model.md）声明种子 `home`/`office`/`computer`/
  `phone`/`outside`，但**代码里没有种子逻辑**（`use-contexts.ts` 只有
  quick-create）——fresh DB 上情境 chips 会是空的；本次新增
  `seedDefaultContexts`（幂等，见 design §6）+ 根 layout 调用。
- 字体：新增 `@expo-google-fonts/epilogue` + `@expo-google-fonts/plus-jakarta-sans`
  （expo 官方字体包），根 layout `useFonts` 加载；CJK 走系统回落
  （fontFamily token 写回落栈）。

## Requirements

- **R1 全局视觉替换（Paper Serenity）**：替换 `packages/ui` tokens
  与 Tailwind 主题映射（语义类名不变）；`@nextdo/ui` 组件
  （Button/Card/Tag/EmptyState 等）按 DESIGN.md 组件规范重样式；
  加载 Epilogue/Plus Jakarta Sans；全 app 生效（含 Review/Focus/Trash
  等屏，仅换肤不改结构）。
- **R2 四屏按设计稿信息架构重做**（布局/卡片/chips/统计区按 gtd 各屏，
  交互按 R3）：
  - Inbox：捕获卡 + 待处理列表（行保留点行进向导 + 行内"处理"按钮；
    捕获超 24h 未澄清标"优先澄清"）+ "GTD 澄清心法"说明卡；
    **去掉**设计稿的"快速流程"/"清空预览" chips（与 D1 一条一条流程冲突）；
    捕获卡 CTA 文案体现"保存即开始澄清"（不用"加入收集箱"——会误导）。
  - Clarify：状态 chips + 条目卡 + 进度 + 当前问题 + 决策摘要 + 预览步
    （D5）；问题链内容/顺序 = spec 决策表（Q2b 含项目归属）。
  - Projects：D4 所列全部。
  - Now：hero 不变 + 下方统计行（可执行 n / 预计耗时 = eligible estMinutes
    求和）+ 情境过滤 chips（按真实 Context 实体过滤 eligible 列表；
    "认知负荷"标签 = 预计耗时的三档：<60 轻 / 60–180 平 / >180 重）。
- **R3 交互保留（不可回归）**：捕获保存后立即提问 + 完成步"再记一条/
  完成"（09-23-capture-clarify-flow 的 D1）；问题链 = spec 决策表；
  Q2b 项目归属；re-clarify 路径同构。
- **R4 不含 AI**：无 AI 建议/拆解/换一条（提案边界）。
- **R5 情境收集**：行动/日历表单加情境多选（D3）；re-clarify 可改；
  提交写 `contextIds`（可空）。

## Acceptance Criteria

- [ ] `packages/ui` tokens 替换为 Paper Serenity 值，全 app 换肤生效
      （Now/Inbox/Projects/Review/Focus/弹窗），`pnpm typecheck/lint/test`
      全绿；语义类名（bg-canvas 等）不变。
- [ ] 字体：标题 Epilogue、正文 Plus Jakarta Sans，中文回落系统字体不出现
      方块/错位；未加载完成前不闪白屏（占位）。
- [ ] Now 屏：hero（推荐/开始/换一个/稍后）保持原有行为；下方新增统计行
      与情境过滤 chips，过滤只影响列表区、不影响 hero 推荐。
- [ ] Inbox：捕获卡保存后立即进提问（不回归）；列表行点入与行内"处理"
      均进向导；>24h 未澄清条目显示"优先澄清"。
- [ ] Clarify：进度（步骤 n/m）、决策摘要（已答/未答）、行动类结果存前
      预览步（确认后才写库）；Q2b 项目归属与"再记一条/完成"保持。
- [ ] 行动/日历表单可多选情境（种子 5 个，可空），保存后 `contextIds`
      正确入库并显示在 Now 列表与项目详情行内 chips；re-clarify 可改。
- [ ] Projects：进度条（done/total）、最早 open deadline 标记、当前下一步
      行动卡、无 open 行动项目显示"缺少下一步"警告 + 按钮进项目详情、
      筛选 chips（进行中/无下一步/已归档）；≥14 天无进展项目显示停滞标记。
- [ ] 现有全部流程测试回归全绿（受文案/结构影响的测试同步更新）。

## Out of Scope

- AI 澄清建议（提案"不做"清单）。
- 桌面三栏布局（Navigation Rail + Canvas + Clarify Inspector）——v1
  移动/单栏优先，桌面另议。
- "今日"（Today）/"更多"（More）两个新 tab（D2 收敛为现有 4 tab）。
- 情境的自动识别（位置辅助等，提案已列为 post-MVP）。
- 设计稿"认知负荷"的复杂模型（用预计耗时三档近似，见 R2）。
