# PRD: 优化推荐理由权重贡献与可信度 (now-rank-and-reasons)

## 背景与问题陈述
在目前的 Now 智能推荐引擎与交互界面中，存在以下四处影响用户可信度与视觉体验的问题：
1. **推荐理由排序脱离权重贡献**：`packages/core/src/engine/rank.ts` 中的 `reasons` 总是按照固定的数组索引（`SCORE_CODES`）顺序输出，而不是按加权得分贡献（`W[code] * signals[code]`）从大到小排列。导致展示的 top-3 理由（Why this?）无法体现真正决定该任务排名第一的核心驱动因素。
2. **缺乏软到期日（`dueDate`）紧急度加分**：`CandidateBase` 包含软到期日 `dueDate`，但评分引擎仅对精确时间戳 `deadline` 赋予 `deadline-urgency` 分数。缺少硬截止但标记了今日/近期软到期日的任务无法获得紧迫度提升。
3. **低价值任务标签失真**：任务或项目的 `value` 仅为 1 或 2（很低价值）时，引擎依然只要 `signals > 0` 就输出 `goal-value`（“价值高”）与 `project-importance`（“支撑一个重要项目”），导致推荐理由与事实脱节。
4. **Now 页面视觉层级过重**：状态行、场景栏、列表过滤器和英雄卡片多层边框叠加，视觉负荷偏高，需要精简视觉层级，突出“当下唯一行动”的核心主角地位。

## 目标与验收标准 (Acceptance Criteria)

### AC1：理由按实际加权得分贡献（Weighted Contribution）降序排列
- 在 `packages/core/src/engine/rank.ts` 中，`reasons` 必须依据 `W[code] * signals[code]` 降序排列。
- 当加权贡献相等时，按 `SCORE_CODES` 原始顺序进行稳定打破决胜，保证确定性。
- Now 页面的 top-3 理由能够真实反映贡献分值最高的前三项动因。

### AC2：支持软到期日（`dueDate`）平滑紧迫度加分
- 当 `candidate.deadline` 未定义但 `candidate.dueDate` 存在时：
  - 若 `dueDate` 已逾期（今天之前），赋予紧迫度信号（如 0.85）；
  - 若 `dueDate` 为今天，赋予紧迫度信号（如 0.75）；
  - 若 `dueDate` 在未来 1~3 天内，赋予紧迫度信号（如 0.5）；
  - 若 `dueDate` 在未来 4~7 天内，赋予紧迫度信号（如 0.25）；
  - 超过 7 天则为 0。
- 当 `deadline` 存在时，优先使用 `deadline` 的精确小时计算。

### AC3：高低价值标签可信度过滤
- 仅当 `candidate.value >= 3` 时，才将 `goal-value` 作为正面理由输出给用户；`value < 3` 虽提供微小加权分，但不生成误导性的“价值高”推荐理由。
- 仅当关联项目的 `project.value >= 3` 时，才将 `project-importance` 作为正面理由输出；避免低权重项目误报为“重要项目”。

### AC4：精简 Now 页面视觉层级
- 优化 Now 页面的布局间距、卡片边框与背景对比，弱化辅助统计栏和过滤器的视觉噪点，强化英雄卡片与开始行动的主视觉流。
