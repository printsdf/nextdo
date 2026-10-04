# 习惯创建表单与 21 天挑战启动

## 背景

数据层已就绪：`packages/db/src/queries/habits.ts` 的 `startHabit` 是「插 Habit + 播今天 HabitDay」的原子事务，`addHabit` 是纯插入，`updateHabit` 支持 `broken → active` 重启。`Habit` 领域模型字段齐备（`title` / `actionTitle` / `estMinutes` / `value` 1–5 / `windowStart` / `windowEnd` / `windowDays?` / `cycleDays` 默认 21 / `startedAt` / `status`），引擎 `queryEnginePool` 已经消费习惯候选（`value`、时间窗口、`cycleDay` / `cycleDays` 的 habit-commitment 信号）。

缺口在 UI：`apps/mobile/hooks/use-habit-days.ts` 只读不写，`Now` 屏底部的「今天习惯 n/m」条在没有习惯时**整体不渲染**（`days.length > 0` 才挂载），所以永远是 0/0。Proposal §7「Habit / 21-Day Challenge」是产品差异化能力之一，backlog 记为 P1 未排期项。

## 目标

用户能在 app 内创建一个带 21 天挑战周期的习惯，立刻在 Now 屏看到它并一键完成；能看到每个习惯走到第几天。

## 非目标（本任务明确不做）

- 不新增 tab（习惯屏是独立路由，从设置页和 Now 屏进入）
- 不做「每周哪几天」（`windowDays`）选择 —— 留空即每天
- 不做自定义挑战周期天数 —— 固定 21 天
- 不做习惯编辑 / 暂停 / 手动标记完成挑战 / 重启 `broken` 挑战
- 不做习惯历史（已结束周期的回看）
- 不做 `category` 字段
- 不做习惯窗口的提醒（`Reminder` 表的「习惯窗口关闭前 30 分钟」规则已定义但未接线，不在本任务）

## 用户故事

1. 我在习惯屏填「阅读」，每日行动「阅读 30 min」，30 分钟，价值 4，晚间窗口 19:00–23:00，点「开始 21 天挑战」——回到 Now 屏，「今天习惯」条里就有它了。
2. 「喝水」这种没有时段的习惯，我不开窗口直接创建。
3. 我能看到每个习惯现在是第 N/21 天、窗口时段、预计时长、价值。
4. 我不要的习惯能删掉。

## 功能需求

### F1 习惯屏（`apps/mobile/app/habits.tsx`）

独立路由（不在 `(tabs)` 下），标题「习惯」，副标题点明挑战周期语义。页面结构：进行中的习惯列表 → 新建表单（表单始终可见还是折叠由实现决定，倾向前者，省一次点击）。列表为空时先显示空态，再显示表单。

### F2 创建表单字段

| 字段 | 必填 | 说明 |
|---|---|---|
| 习惯名 `title` | ✅ | 如「阅读」 |
| 每日行动 `actionTitle` | ❌ | 留空时继承 `title`，是每天生成的那条 Next Action 的标题 |
| 预计分钟 `estMinutes` | ✅ | 正整数 |
| 价值 `value` | ✅ | 1–5 单选 chip，与项目创建表单的 `VALUE_CHIPS` 同一形态，默认 3 |
| 时间窗口 `windowStart` / `windowEnd` | ❌ | 关闭时为 `undefined`（全天可执行）；开启时两个时间都必须有值，且 `windowStart < windowEnd` |

`cycleDays` 固定 21，`status` 固定 `active`，`startedAt` 取 app clock。

### F3 挑战启动

提交走 `startHabit`（不是 `addHabit`），保证「插入 + 播今天」原子。`windowDays` 不写。因为周期第 1 天就是今天，播种必定成功（`seedTodayHabitDay` 只在 weekday mask 与 cycle 范围外返回 `null`，此处两者都不受限），所以「今天没出现」不是预期路径；若真发生需要报错而不是静默。

### F4 习惯列表与进度

每条展示：习惯名、每日行动标题、`N/21 天`、价值、预计分钟、窗口时段（无窗口时显示「全天」）。`N` 由 `habitCycleDay(habit.startedAt, habit.cycleDays, today)` 得出（该函数当前**未**从 `packages/db` 导出，实现时需补导出，不在 app 层复刻算法）。已完成的 HabitDay 数从 `listHabitDays` 统计，用于「本期已完成 x 天」。

### F5 删除

复用 `trashHabit`（软删除）。删除后该习惯的 HabitDay 行保留（pool 查询忽略已删习惯），无需额外处理。

### F6 入口

- 设置页新增一张卡片「习惯」，一行说明 + 一个「管理习惯」按钮，`router.push('/habits')`。
- Now 屏习惯条：非空时右上角一个「管理」入口；空时改为渲染空态引导（「还没有习惯 · 去创建一个」），因为当前空态整块不渲染，用户无从发现这个功能。

### F7 习惯条刷新

`useHabitDays` 目前只在 mount 与本地日期翻转时重读。习惯屏创建后返回 Now 屏，Now tab 是挂载态不会重新 mount，习惯条会停留在旧数据。本任务必须解决（方案见 `design.md`）。

## 验收标准

- [ ] 习惯屏可创建带窗口的习惯，提交后 `startHabit` 被调用且 `cycleDays === 21`、`status === 'active'`
- [ ] 不填每日行动时，`actionTitle` 等于习惯名
- [ ] 不开启窗口时，`windowStart` / `windowEnd` 均为 `undefined`
- [ ] 开启窗口但只填了起始或终止时间时，创建按钮禁用
- [ ] `windowStart >= windowEnd` 时创建按钮禁用
- [ ] 价值 chip 可选 1–5，默认 3
- [ ] 习惯列表展示 `N/21 天`、窗口（或「全天」）、预计分钟、价值
- [ ] 删除一个习惯后它从列表消失，且不再出现在 Now 屏习惯条
- [ ] 零习惯时 Now 屏渲染引导入口，点击可到达习惯屏
- [ ] 从习惯屏创建后返回 Now 屏，习惯条立即显示新习惯（无需重启 app）
- [ ] 设置页「管理习惯」入口可达习惯屏
- [ ] 亮色 / 暗色都检查过；可点区域 ≥ 44pt；每个可点元素有 `accessibilityLabel` 与 `accessibilityState.selected`（单选/多选控件）
- [ ] 文案不承诺「21 天一定能养成习惯」（领域模型明确禁止），只描述为挑战周期
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm test` 全绿
- [ ] `expo export --platform web` 通过（桌面壳依赖）
- [ ] 新增 `apps/mobile/__tests__/habits-screen.test.tsx` 覆盖创建、禁用校验、删除、空态

## 约束

- 习惯屏是普通路由，走 `KeyboardAvoidingView` + `ScrollView`（与 `settings.tsx` / `projects.tsx` 同形）
- 组件不直接碰 db，mutation 走 `apps/mobile/hooks` 下的 hook
- 样式只用 `@nextdo/ui` 的 token 类名，禁止 raw hex
- 时间输入复用现有跨平台 `datetime-picker` 或纯文本 `HH:mm` 输入，不引入只在原生可用的控件（Web 要能跑）
