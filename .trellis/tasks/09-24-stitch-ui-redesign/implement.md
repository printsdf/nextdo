# Implement — 按 Paper Serenity 视觉基线重做四屏 UI

> 顺序 = 依赖顺序（tokens/字体 → ui 组件 → db 查询/种子 → 纯逻辑 →
> 四屏 → 验证 → spec）。每步完成即跑该步验证命令；全部完成后跑 §12 全量验证。
> 设计稿一律以 `stitch_focus_gtd_clarify_app/gtd_*/screen.png` 为准
> （gtd_1/gtd_2 的 html 与 png 对调）。

## 1. tokens + tailwind 换肤

- [x] `packages/ui/src/tokens/colors.json`：按 design §1.1 表替换 11 个键的值
      （含 5 组 `tag-earth-N-bg/-text` 新增键）；`radii.json` 换新值
      （sm6/md8/lg12/xl14/2xl16/full）；`typography.json` 同步 DESIGN 值。
- [x] `apps/mobile/tailwind.config.js`：加 `fontFamily: { sans: ['Plus Jakarta Sans'],
      display: ['Epilogue'] }` + 10 个 tag-earth 颜色映射（colors 映射本身不动）。
      （另修复既有 bug：content glob `'../packages/ui/src/**'` 少一层 `..`，
      指向不存在的 `apps/packages/ui`——packages/ui 组件类此前从未进入 web
      CSS 产物；已改为 `'../../packages/ui/src/**'`。）
 - [x] 验证：`pnpm typecheck` + `pnpm lint`（值层面无逻辑，跑通即可）。

## 2. 字体加载

- [x] `apps/mobile/package.json` 加 `@expo-google-fonts/epilogue`、
      `@expo-google-fonts/plus-jakarta-sans`（精确版本 0.4.2，`pnpm add -E`）；
      `pnpm install`（lockfile 已更新，并顺带清理了陈旧的 RN 0.87.1 peer 变体）。
      另加 `expo-font@57.0.4` 为直接依赖（`useFonts` 加载器；字体包内部依赖
      它，pnpm 严格布局下须显式声明，避免 phantom dependency）。
- [x] `apps/mobile/app/_layout.tsx`：`useFonts` 加载（Epilogue 500/600/700、
      Plus Jakarta Sans 400/500/600/700；另注册真实 family 名
      `Epilogue`→600 / `Plus Jakarta Sans`→400 两个入口，使 tailwind 的
      `display`/`sans` 在三端可解析）；未加载完渲染占位 View（canvas 底 +
      "加载中…"）而非 `<Stack>`；加载失败记 error 日志并回退系统字体
      （不永久卡占位）。
- [x] 全局默认字体：`global.css` 已加 `@layer base { Text { font-family:
      'Plus Jakarta Sans'; } }`；web export 确认规则进入编译 CSS（形态
      `Text{font-family:Plus Jakarta Sans}`）。**native 端是否生效 + 是否需
      退路（机械补 font-sans）= 待主会话手测后决策**（本块未做机械补丁）。
 - [x] 验证：`pnpm --filter @nextdo/mobile typecheck` ✅；`expo export
      --platform web` ✅（dist 含两族全部 ttf 资源、字体 map 键、占位文案；
      CSS 含 base 规则。浏览器目检留给主会话/§12 手测）。

## 3. `@nextdo/ui` 组件重样式 + 新组件

- [x] `button.tsx` 圆角换 DESIGN 档（sm/md → rounded-md，lg → rounded-lg）；
      `tag.tsx` 高 22px（`h-[22px]`）/ 11px 字（`text-[11px]`）/ px-2；
      `card.tsx`、`empty-state.tsx` 类名不变（token 值已换，自动吃新值；
      仅更新过时的 iOS 注释为 Paper Serenity）。
- [x] 新 `context-chip.tsx`（`ContextChip` + `contextTone` 稳定散列 → 5 组土色，
      完整类名字符串表；tone 串同时施加于容器与 Text——native 不级联
      容器文本样式）；新 `progress-bar.tsx`（`ProgressBar`，value 钳制、
      accent 填充 + border 色细轨道、progressbar 角色）；`index.ts` 导出。
 - [x] 验证：`pnpm --filter @nextdo/ui typecheck` ✅（根 typecheck 含）；
      现有消费屏冒烟 = mobile 全部 17 套件 153 测试绿（tabs.smoke +
      Review/Focus/Projects/Now 屏测试，纯换肤无回归）。

## 4. db：projectCards watch 查询 + isStalled 导出

- [x] `packages/db/src/queries/watch-queries.ts`：`ProjectCard` 接口 +
      `projectCardsWatchQuery`（design §4.1 的标量子查询：open_count /
      completed_count / earliest_open_deadline / last_progress_at（join
      completion_records）/ next-action top-1 五连（同一 ORDER BY））。
- [x] `packages/db/src/queries/reviews.ts`：`isStalled`、`STALL_DAYS` 加 export
      （逻辑不动）。
- [x] `packages/db/src/index.ts` 导出 `projectCardsWatchQuery`、`ProjectCard`、
      `isStalled`（+ STALL_DAYS）。
- [x] 测试：`packages/db/src/test/queries.projects.test.ts` 补 design §4.1 所列
      用例（progress、earliest deadline、next-action 排序、null 边界、lastProgressAt）。
 - [x] 验证：`pnpm --filter @nextdo/db test` + typecheck。

## 5. db：seedDefaultContexts

- [x] `packages/db/src/queries/contexts.ts`：`seedDefaultContexts(db, now)`
      （无未删除行 → 种 5 个 home/office/computer/phone/outside，ulid(now)；
      否则 no-op；返回插入数）；`index.ts` 导出。
- [x] `apps/mobile/app/_layout.tsx` `start()`：init + stream 后调用（try/catch
      非致命，warn 日志）。
- [x] 测试：`packages/db/src/test/`（contexts 测试文件）fresh 库种 5 / 二次 no-op /
      已有情境 no-op。
 - [x] 验证：`pnpm --filter @nextdo/db test`；手测 fresh 启动后 Now 屏情境 chips
      出现 5 个种子。

## 6. 纯逻辑：format helper + 认知负荷

- [x] `apps/mobile/lib/format.ts`：`formatRelativeTime(iso, now)`、
      `formatDueLabel(iso|null, now)`；新 `lib/format.test.ts`。
- [x] 新 `apps/mobile/lib/cognitive-load.ts`：`cognitiveLoadLabel(minutes)`
      （<60 轻 / 60–180 平 / >180 重）+ `cognitive-load.test.ts`。
 - [x] 验证：`pnpm --filter @nextdo/mobile test`（lib 部分）。

## 7. 纯状态机：Clarify 向导（design §3.1）

- [x] `apps/mobile/lib/clarify-flow.ts`：
      - `WizardBase` 加 `depth` + `answered`；前进转移 +1 并追加
        `{ id, question, answer }`（QUESTION_TITLES 常量）；
      - `PROGRESS_MAX = { clarify: 7, reclarify: 6 }` 导出；
      - 新 `preview` 步 + `{ type: 'preview'; submission }` /
        `{ type: 'back-to-form' }`（depth 不变）；`PREVIEW_FORMS` 导出
        （action/project/calendar/waiting）；
      - `FormFields.contextIds: string[]`；field action 重载；
        `createWizardState(mode, defaultTitle, initialContextIds = [])`；
      - `buildFormSubmission`：action/calendar/project 分支写 `target.contextIds`。
- [x] 测试 `lib/clarify-flow.test.ts`：design §3.1 所列（depth/answered 全链、
      preview 往返、contextIds 三分支 × 两 mode、reclarify 预填）+ 原有断言回归。
 - [x] 验证：`pnpm --filter @nextdo/mobile test`（lib 部分）+ typecheck。

## 8. 屏：Inbox（design §2）

- [x] `apps/mobile/app/(tabs)/inbox.tsx`：大标题块（清空大脑 + 副题）、捕获卡
      （占位/提示行 + CTA"记录并澄清"）、待处理计数 Tag、InboxRow 重做
      （`formatRelativeTime` 相对时间 + >24h"优先澄清"（warning 文字信号）+
      "处理 →"（tinted sm → /clarify/<id>）+ 删除保留、整行点按保留）、
      GTD 澄清心法静态卡；`handoffToClarify` / recapture 消费一字未动，
      排序与 modal 行为不动（modal 仅 token 自动换肤）。
- [x] 测试 `__tests__/inbox-screen.test.tsx`：保存→跳转回归（内联卡 + 弹窗）、
      recapture 一次性消费、失败保存留屏、行"处理 →"跳转、>24h 行显示
      "优先澄清"（48h vs 10min 数据对固定渲染时钟，确定性）、≤24h 不显示、
      新文案断言（清空大脑/副题/记录并澄清/待处理 n/GTD 澄清心法）。
 - [x] 验证：`pnpm --filter @nextdo/mobile test` + typecheck。

## 9. 屏：Clarify 向导（design §3.2/§3.3）

- [x] `apps/mobile/hooks/use-action-title.ts`：返回扩展 `contextIds: string[]`
      （同一查询的 next/calendar 行动行取出；habit 无 → []；零额外查询）。
- [x] `apps/mobile/components/clarify-wizard.tsx`：
      - 头部行：状态 Tag（正在澄清/重新明晰）+ "← 返回"保留；
      - 条目标题卡（font-display 标题 + meta：clarify "收录于 {formatLocalDate(capturedAt)} · 收集箱"、reclarify "已有行动"）；
      - 进度行：`步骤 {min(depth+1,m)}/{m}` + `ProgressBar` + `{pct}%`；preview 步显示 "决策摘要预览" + 100%；
      - "GTD 决策摘要"常驻卡（问题卡下方）：clarify 8 题 / reclarify 6 题（无 q1/q1b）逐行——已答 = accent 高亮 + 所点按钮文案，未答 = muted 置灰（未走分支同置灰）；
      - FormCard 情境多选区（action/calendar/project：标题"在哪里做？（可多选，不选 = 随处可执行）"+ `ContextChip` 可点选组，数据 `useContexts()`，选中 = fields.contextIds 含该 id，dispatch `field: 'contextIds'`）；
      - 保存分叉：`PREVIEW_FORMS` → validateForm 通过后 dispatch preview（不写库）；reference/someday/trash 原路直接提交；
      - 预览卡："决策摘要预览 · 归位就绪" + 所属项目（attach: state.projectTitle / project 表单: fields.projectTitle）/ 标题（action/project: actionTitle；waiting/calendar: title）/ 执行情境（ContextChip 只读组，空 = "随处可执行"）/ 预计耗时 / 价值（action 非 twoMinute·calendar·project）/ 截止（如有，`formatDueLabel`）；按钮 `确认保存`（submit(state.preview.submission) → done 步）+ `上一步修改`（back-to-form，字段保留）；
      - WizardBody 接 `initialContextIds` + `capturedAt`（ClarifyWizard 透传：reclarify = action.contextIds、clarify = []）；done 步两按钮一字不动（R3），问题题面/按钮文案/顺序一字不动（R3）。
- [x] 测试 `__tests__/clarify-wizard.test.tsx`：design §3.4 全部——
      进度（答 q1 后 步骤 2/7；reclarify 入口 步骤 1/6；全链表单步 7/7）、
      决策摘要（已答含答案/未答在列；reclarify 无 q1/q1b 行）、
      预览（action 保存 → 预览卡出现且 applyClarify 未调用 → 确认保存恰好一次 → done；上一步修改回表单且字段保留（含 est 选中态）再确认提交一次；reference/trash 直接提交无预览）、
      情境多选（勾 2 chip → 预览 2 chip + submission contextIds；不勾 → "随处可执行"；reclarify 经 ClarifyWizard + useActionTitle 预填 → 表单 chip 预选中 → 预览/提交）、
      回归（q2b 三向含 attach 预览流、完成步两按钮、do-now 直提、失败事务中文错误）。
 - [x] 验证：`pnpm --filter @nextdo/mobile test`（19 套件 204 测试全绿）+ typecheck。

## 10. 屏：Projects（design §4.2）

- [x] `apps/mobile/hooks/use-project-cards.ts`（watch 查询 + useAppClock；
      导出纯 helper `isProjectStalled(card, now)`）。
- [x] `apps/mobile/app/(tabs)/projects.tsx`：头部 + 筛选 chips（进行中/无下一步/
      已归档，计数派生）+ ProjectCardRow（截止 chip / 进度条 / 当前下一步子卡 /
      缺少下一步警告 + 澄清下一步 → 项目详情 / 停滞灰标）+ 新建按钮文案
      "＋ 新建项目（明确具体成果）"；NewProjectForm 仅换肤
      （**不加情境字段**——该内联表单只建项目不建首行动，情境多选取在向导
      项目表单，见 design §4.2 更正）。
- [x] `apps/mobile/app/projects/[id].tsx`：行动行加 ContextChip 只读组
      （useContexts 解析 id→name，未知 id 回退原 id）。
- [x] 测试 `__tests__/projects-screen.test.tsx`：三筛选、进度条数值、
      缺少下一步 CTA 跳转、停滞标（相对 Date.now() 的 5d/30d 数据对，
      同 Inbox 24h 测试的确定性模式）、next-action 子卡、详情行情境 chip；
      mock `projectCardsWatchQuery` + `isStalled`（纯谓词镜像）。
 - [x] 验证：`pnpm --filter @nextdo/mobile test` + typecheck。

## 11. 屏：Now（design §5）

- [x] `apps/mobile/app/(tabs)/now.tsx`：统计行（可执行 n/总、Σ est 分钟、
      认知负荷档）+ 情境过滤 chips（本地 state，独立于引擎 context——
      无情境行动随处可执行，穿过任何过滤；**纯名称无计数**——2026-09-24
      用户决定去掉 `全部 {n}`/`{name} {n}` 的计数，design §5 同步更正）+
      EligibleList 常展开化（行 = 标题 + 项目 chip + 情境 chips + 截止 chip /
      "随时" + 稍后/删除）+ 过滤空态；hero / re-clarify 横幅 / 习惯条 /
      SnoozeSheet 行为不动，仅换肤。
- [x] 测试 `__tests__/now-screen.test.tsx`：统计数值（2/2·55 轻、2/3·80 平、
      4/4·200 重）、chip 过滤（选中/并集/全部复位/空态 + hero 不动断言）、
      行内容（项目 chip/情境 chip/明天/随时）、hero 回归（换一个轮换、
      时间 chip 重算 AC3）。**注意**：引擎 context-mismatch 规则（spec）=
      引擎情境未含行动情境 id 即排除——测试里带情境的行动需经
      `presetEngineContext`（假 store）预置引擎情境，与列表过滤 chip 独立。
 - [x] 验证：`pnpm --filter @nextdo/mobile test`（19 套件 214 测试全绿）+ typecheck。

## 12. 手测冒烟（web 平台 + system dark 各一遍）

- [x] web 浏览器冒烟（IDE 浏览器，`expo export` 产物静态服务，fresh 本地模式）：
      fresh 启动 → Now 屏 5 个种子情境出现 → 快速捕获"整理实验数据" →
      **立即进提问**（Q1→Q1b→Q2→Q2b 项目选项在链内→Q3→Q4→Q5）→ 表单勾
      computer+phone 情境 → 保存 → **决策摘要预览步**（情境 chip 对勾、
      30 分钟、价值 3）→ 确认保存 → 完成步"再记一条/完成" → 完成回 Inbox
      （条目已消费，收件箱空）→ Now 屏：统计行 1/1·30 分钟·轻、hero 正常、
      过滤 chips 计数（computer 1 / phone 1）、列表行 computer+phone 土色 chip
      + "随时"；Projects 屏：头部/副题/筛选 chips/空态正确（期间还观察到
      历史遗留项目的"缺少下一步"警告卡 + "澄清下一步"按钮渲染正确）。
- [ ] system dark 各一遍（桌面 Tauri 壳手测，留给主会话/用户）。
- 已知行为提示（**非回归**，引擎 spec 既有语义）：引擎情境选"任意"（空）时，
      带情境标记的行动被 context-mismatch 排除（spec 规则表原文），列表与
      hero 均看不到——需选中匹配场景才出现。
      2026-09-24 主会话截图复核（IDE 浏览器，8091 静态服务）：
      (a) 空态渲染正确——"任意"选中时被过滤列表显示"整理实验数据 —
      与当前场景不匹配"，统计行 0/1 · 0 分钟 · 轻与数据自洽；
      (b) 选中 computer 后 hero 态正确——统计行 1/1 · 30 分钟 · 轻，
      hero（下一步+30 分钟 Tag、"为什么是它？"= 价值高/正好匹配你现有的
      时间/已经等了一阵子 三条 score 理由按 W×signal 降序）、开始/换一个/
      稍后、过滤 chips 计数（全部 1·computer 1·phone 1·余 0）、列表行
      （computer+phone 土色 chip + 随时 + 稍后/删除）全对。截图存档
      `now-hero-settled.png`。注：设计稿 gtd_1 中"任意"高亮且同时显示带
      情境行动（mock 状态与 spec 规则矛盾）——实现从 spec（"任意" = 空
      场景，非通配）；如需通配语义属引擎变更，另开任务（用户已拍板维持
      spec）。另：复核发现 8091 原服务的是本任务中途的旧导出（tab 栏隐藏
      icon 槽残留 ⏷⏷ 字形），已按当前工作树重新 `expo export --platform
      web` 覆盖 dist，静态服务现与源码同步。

## 13. 全量验证（完成前必跑）

```bash
pnpm typecheck
pnpm lint
pnpm test
```

另：`expo export --platform web` 成功（桌面壳依赖 web 构建）。

- [x] 2026-09-24 首跑全绿：typecheck（core/db/ui/mobile）、eslint 无告警、
      test（core 157 / db 167 / server 51 / mobile 214 全过）、
      `expo export --platform web` 成功（dist 产物已在浏览器冒烟）。

## 14. 收尾（Phase 3）

- [ ] spec 更新（必做）：
      - `.trellis/spec/domain/domain-model.md`：Context "Seeded" 补实现事实
        （`seedDefaultContexts`，无未删除行时种 5 个，幂等）；
      - `.trellis/spec/app/component-guidelines.md` 或 app/index：新增
        `ContextChip`/`ProgressBar` 于 packages/ui 的记录（如惯例要求）；
      - `.trellis/spec/app/hook-guidelines.md`：`useProjectCards`（watch 查询 +
        时间敏感派生留在 UI 层的先例补充，如适用）。
- [ ] commit（PRD/design 工件 + 代码 + spec）。
- [ ] `task.py` 归档前 validate。
