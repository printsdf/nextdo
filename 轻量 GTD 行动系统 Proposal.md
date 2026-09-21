# 轻量 GTD 行动系统 Proposal

## 1. 项目概述

本项目计划开发一款面向个人用户的轻量行动管理软件。

产品以 GTD（Getting Things Done）为基础方法论，将用户遇到的事项通过「捕获、明晰、组织、回顾、执行」转化为结构化行动，并进一步加入一个核心能力：

**Next Action Engine。**

传统任务管理软件主要解决：

> 我有哪些事情需要做？

本产品希望进一步解决：

> 在当前时间、环境和状态下，我现在最应该做什么？

产品不以任务完成数量作为主要目标，而强调帮助用户持续完成更有价值、更加接近长期目标的事项，同时减少因为情绪、选择困难、拖延和临时冲动带来的错误决策。

---

# 2. 核心问题

当前个人任务管理主要存在三个问题。

## 2.1 事项混乱

现实中的事情通常不是天然结构化的。

例如：

* 写论文；
* 等导师发送实验数据；
* 下周三交材料；
* 想学习 Rust；
* 有空研究某个工具；
* 今天晚上跑步。

这些内容如果全部进入同一个 Todo List，用户很快就会失去控制。

GTD 的价值在于首先判断：

> 这到底是什么类型的事情？

然后把它放到正确的位置。

---

## 2.2 用户知道要做什么，却不知道先做什么

即使用户已经整理出：

* 修实验代码；
* 回复邮件；
* 阅读论文；
* 跑步；
* 整理数据；

仍然需要再次进行决策：

> 我现在应该做哪一个？

传统 Todo 软件通常把这个决定留给用户。

但人在真实环境中的决策容易受到以下因素影响：

* 喜欢先做简单的事情；
* 回避困难事项；
* 追求快速完成任务带来的满足感；
* 高估或低估任务时间；
* 因临时消息打乱计划；
* 根据当前情绪改变优先级。

因此，即使任务管理本身没有问题，执行阶段仍然可能出现偏差。

---

## 2.3 工具自身变得过于复杂

很多效率软件逐渐加入：

* 项目管理；
* 知识库；
* 日历；
* 时间管理；
* 团队协作；
* AI；
* 文档；
* 白板；
* 复杂统计。

最终用户反而需要花大量时间维护工具。

本产品原则是：

> **工具应该降低管理成本，而不是创造新的管理工作。**

---

# 3. 产品定位

产品定位：

> **一个帮助用户整理所有事情，并决定下一步应该做什么的个人行动系统。**

核心流程：

```text
Capture
↓
Clarify
↓
Organize
↓
Next Action Engine
↓
Focus / Execute
↓
Complete
↓
Review
```

其中：

* GTD 负责把事情整理正确；
* Next Action Engine 负责辅助选择当前行动；
* Focus 负责帮助完成当前任务；
* Review 负责持续修正整个系统。

---

# 4. 核心产品原则

## 4.1 用户负责目标，系统负责减少选择

软件不应该替用户决定人生目标。

用户仍然需要决定：

* 什么事情重要；
* 什么项目值得做；
* Deadline 是什么；
* 哪些事情涉及健康、生活和关系；
* 哪些目标已经不再重要。

但在这些约束确定后，软件可以帮助用户减少执行阶段的临时选择。

即：

```text
用户决定方向
↓
系统组织行动
↓
系统推荐 Next Action
↓
用户执行或否决
```

---

## 4.2 默认只关注一件事情

产品不鼓励用户同时面对几十个任务。

核心执行界面应该尽量回答：

> 现在做什么？

而不是：

> 这里有 30 个任务，请自己挑一个。

系统默认提供一个 Next Action。

用户仍可以：

* 开始；
* 换一个；
* 推迟；
* 查看全部。

但「一个明确行动」应当是主要交互。

---

## 4.3 GTD 流程优先于功能堆叠

软件首先应该实现正确的 GTD 流程，而不是大量效率功能。

核心对象包括：

* Inbox；
* Next Action；
* Project；
* Waiting For；
* Calendar；
* Someday / Maybe；
* Reference；
* Trash。

其中 Reference 第一阶段只需要支持链接外部资料，而无需自行构建完整知识库。

---

## 4.4 所有功能尽可能服务于执行

习惯、提醒、专注计时等功能不应该形成独立的复杂系统。

例如：

```text
Habit
↓
生成可执行的 Next Action
```

```text
Reminder
↓
提醒当前应该执行的 Action
```

```text
Pomodoro
↓
成为执行 Action 时的一种 Focus Mode
```

这样所有能力最终都汇聚到：

> Execute。

---

# 5. GTD 工作流

## 5.1 Capture

用户可以快速记录任何事项。

原则：

> Capture 时不要求分类。

例如：

```text
想到：重新跑一遍 baseline
```

直接进入 Inbox。

Capture 必须尽可能低摩擦。

未来可以支持：

* 文本输入；
* 快捷键；
* 手机快捷入口；
* 分享菜单；
* 语音输入。

---

# 5.2 Clarify

Inbox 中的事项需要逐个完成判断。

核心逻辑：

```text
这件事情可以行动吗？
```

如果不能：

```text
Reference
Someday / Maybe
Trash
```

如果可以：

```text
是否需要多个步骤？
```

如果是：

```text
Project
+
定义 Next Action
```

如果不是：

继续判断：

```text
是否可以在约 2 分钟内完成？
```

是：

```text
Do Now
```

否则：

继续判断：

```text
是否应该由我完成？
```

否：

```text
Waiting For
```

是：

继续判断：

```text
是否必须在特定日期或时间执行？
```

是：

```text
Calendar
```

否：

```text
Next Action
```

整个 Clarify 流程应该尽可能通过简单问题完成，而不是要求用户填写复杂表单。

---

# 5.3 Organize

Clarify 后，事项自动进入对应系统。

例如：

```text
Inbox
↓
“完成论文实验”
↓
Project

Project:
论文实验

Next Action:
运行 baseline A
```

产品应该主动避免：

```text
Next Action:
完成论文实验
```

因为这通常不是一个足够明确的单步行动。

---

# 5.4 Review

Review 是整个系统长期有效的关键。

至少包含两个层级。

### Daily Review

主要解决：

* 今天哪些事项完成；
* 哪些事项未完成；
* 哪些事项需要重新安排；
* 哪些任务反复被跳过；
* 明天是否存在必须处理的事项。

Daily Review 应该尽量控制在较短时间内完成。

### Weekly Review

主要检查：

* Inbox 是否清空；
* 每个 Project 是否存在 Next Action；
* Waiting For 是否需要 Follow-up；
* Someday / Maybe 是否需要重新考虑；
* Calendar 是否合理；
* 长期没有进展的事项；
* 项目是否仍然值得继续。

---

# 6. Next Action Engine

Next Action Engine 是本产品相对于普通 GTD 软件最重要的扩展能力。

它的目标不是“替用户决定人生优先级”，而是：

> 在用户已经定义好的目标、任务和约束下，找到当前最适合执行的行动。

核心流程：

```text
Next Action Pool
↓
Hard Filter
↓
Value Ranking
↓
Recommend One
```

---

## 6.1 Hard Filter

首先排除当前无法执行的任务。

主要考虑：

### Context

例如：

* Home；
* Office；
* Computer；
* Phone；
* Outside。

### Available Time

例如：

```text
当前只有 20 min
```

则不会优先推荐预计需要 90 min 的行动。

### Time Window

例如：

```text
只能工作日 09:00–17:00 联系客服
```

### Dependency

如果一个任务依赖尚未完成的事项，则暂时不可执行。

### Calendar Constraint

Calendar 中存在明确时间安排时，应优先尊重硬日程。

---

# 6.2 Value Ranking

过滤以后，对可执行事项进行排序。

第一阶段不使用复杂机器学习，而采用明确、可解释的规则。

可能考虑：

```text
Deadline Urgency
Goal Value
Project Importance
Time Fit
Energy Fit
Waiting Time
Delay Count
Habit Commitment
Health / Life Protection
```

例如：

```text
Task A
回复普通邮件
10 min
无 Deadline

Task B
运行论文实验
40 min
3 天后 Deadline
高价值项目
```

即使 Task A 更容易完成，也不应该仅因为它更容易完成而始终排在前面。

---

# 6.3 Recommendation

用户核心页面只显示一个主要推荐：

```text
NOW

运行 baseline 实验
预计 40 min

原因：
论文实验 3 天后截止
当前有足够时间
当前环境满足执行条件

[开始]
[换一个]
```

用户可以查看：

```text
Why this?
```

保证推荐系统具备可解释性。

---

# 6.4 用户否决权

系统推荐不等于系统强制。

用户永远可以：

* 换一个；
* 稍后再做；
* 今天不做；
* 修改任务信息。

连续多次跳过任务时，系统不应简单提高提醒频率，而应该怀疑任务定义存在问题。

例如：

```text
这个任务已经连续跳过 4 次。

是否需要重新明确下一步？
```

这可以重新触发 Clarify。

---

# 7. Habit / 21-Day Challenge

习惯系统不建立完全独立的任务体系。

Habit 本质是：

> 自动产生重复 Next Action 的规则。

例如：

```text
Habit:
阅读

Duration:
21 Days

Action:
阅读 30 min

Window:
19:00–23:00
```

每天系统生成：

```text
Next Action:
阅读 30 min
```

进入 Next Action Engine。

随着可执行时间窗口结束临近，其紧迫程度可以逐渐提高。

21 天主要作为：

> Challenge Cycle

而不是宣传为“21 天一定可以形成习惯”。

---

# 8. Reminder / Alarm

提醒是执行系统的重要组成部分。

建议分成不同强度：

```text
Normal Reminder
Important Reminder
Alarm-like Reminder
```

通知应该尽量支持直接操作：

```text
完成
推迟
跳过
```

Snooze 是核心能力之一。

例如：

```text
10 min
30 min
1 hour
Tonight
Tomorrow
```

目标是：

> 用户无需频繁打开 App 才能管理自己的行动。

---

# 9. Focus / Pomodoro

产品保留番茄钟能力，但不建设独立番茄钟系统。

流程：

```text
Next Action
↓
Start
↓
Focus Session
```

用户可以选择：

```text
25 min
45 min
60 min
Free Timer
```

Focus 页面只关注：

```text
当前任务
剩余时间
暂停
完成
```

不需要复杂的番茄统计、等级、排行榜和激励体系。

---

# 10. 多端同步

产品计划支持：

* 手机端；
* 电脑端。

优先考虑：

> Local-first + Cloud Sync。

即：

```text
Device Local Database
↕
Sync Layer
↕
Other Devices
```

目标：

* 离线仍然可以正常使用；
* 联网后自动同步；
* 同步行为对用户基本无感；
* 不依赖持续网络连接。

同步主要覆盖：

```text
Tasks
Projects
Habits
Review Records
Completion Records
Settings
```

第一阶段不考虑：

* 多人共享；
* 团队权限；
* 评论；
* 实时协作。

---

# 11. MVP 范围

第一版本核心能力：

| 模块                 | MVP |
| ------------------ | --- |
| Inbox              | 必须  |
| Clarify 流程         | 必须  |
| Next Action        | 必须  |
| Project            | 必须  |
| Waiting For        | 必须  |
| Calendar Action    | 必须  |
| Someday / Maybe    | 必须  |
| Trash              | 必须  |
| Next Action Engine | 必须  |
| Reminder           | 必须  |
| Snooze             | 必须  |
| Daily Review       | 必须  |
| Weekly Review      | 必须  |
| 多端同步               | 必须  |
| Habit / 21 Days    | 建议  |
| Focus Timer        | 建议  |
| 外部 Reference Link  | 建议  |

明确不进入第一阶段：

```text
团队协作
完整知识库
复杂日历系统
复杂数据分析
社交功能
排行榜
复杂 AI Agent
项目甘特图
文档编辑器
白板
```

---

# 12. 产品主界面初步设想

产品一级界面尽量控制数量。

初步可以考虑：

```text
Now
Inbox
Projects
Review
```

其中默认首页不是传统的任务列表，而是：

```text
NOW

修复实验代码
约 35 min

论文实验 · 3 天后截止

[开始]

────────────

稍后
3 个可执行事项

今天习惯
2 / 3
```

用户仍然可以进入完整列表。

但默认体验始终围绕：

> 下一件事情。

---

# 13. 产品差异化

本产品不是：

> 又一个 Todo List。

也不是：

> GTD + 番茄钟 + Habit 的功能合集。

真正的差异化来自三个部分。

### ① Structured GTD

严格通过 GTD 将混乱事项转化为可执行结构。

### ② Next Action Engine

在 GTD 已经整理好的事项中，根据当前条件和目标价值推荐下一步行动。

### ③ Execution Loop

通过：

```text
Recommendation
→ Focus
→ Reminder
→ Complete
→ Review
```

让 GTD 从「任务整理方法」真正进入「行动执行系统」。

---

# 14. 核心成功标准

产品第一阶段不应该主要关注：

```text
用户每天完成多少 Task
```

更值得关注：

### Inbox Processing Rate

用户是否能够持续清空和处理 Inbox。

### Project Action Coverage

有多少活跃 Project 存在明确 Next Action。

### Recommendation Acceptance Rate

Next Action Engine 推荐的任务，有多少直接被用户接受。

### Repeated Skip Rate

用户是否频繁跳过推荐。

### Review Completion

用户是否真正进行 Daily / Weekly Review。

### Important Task Completion

高价值任务是否相比普通任务获得更稳定的执行。

长期目标是：

> 用户不再需要每天维护复杂的优先级列表，也不需要频繁思考“下一步应该做什么”。

---

# 15. 产品愿景

最终希望建立的是一个：

> **Personal Action Operating System**

用户把需要处理的事情交给系统。

系统负责：

```text
记录
↓
整理
↓
保持可信
↓
根据环境和目标筛选
↓
给出下一行动
↓
帮助执行
↓
持续复盘
```

用户的主要责任则从：

> 管理 Todo List

转变为：

> 定义自己真正重视的事情，并执行当前最合适的行动。

产品最终追求的不是让用户“做更多”，而是：

> **用尽可能低的管理成本，持续完成真正有价值的事情。**
