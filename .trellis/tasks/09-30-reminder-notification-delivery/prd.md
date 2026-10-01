# 提醒通知投递（本地通知消费 reminders 表）

## Goal

闭合 MVP Reminder/Snooze 执行循环：snooze / 日历行动事务已写 reminders 行（`fires_at` / `intensity` / `state`），但 app 侧没有任何投递逻辑——用户点「稍后」后设备永远不会提醒。本任务在客户端接入**本地通知**投递：消费 reminders 表、按平台调度通知、app 重启后补排程，让用户在设定时刻真正收到提醒。

## Background（代码库现状，2026-09-30 核查）

**投递的 source of truth（db 侧基本完整）**：

- `reminders` 表：`action_kind`（next/habit/calendar）/ `action_id` / `fires_at` / `intensity`（normal|important|alarm）/ `state`（scheduled|fired|cancelled），`packages/db/src/schema.ts:221`，类型 `packages/core/src/domain/types.ts:171`。
- 写行入口（均已存在）：
  - snooze 事务（normal）：`packages/db/src/queries/actions.ts:238` `snoozeAction`，同事务把旧 scheduled 行置 cancelled（`:189-192`）；
  - 日历行动创建（important，startsAt 在 60 分钟内时提前 15 分钟）：`packages/db/src/queries/calendar.ts:55` + core `calendarActionReminderSpec`（`packages/core/src/domain/invariants.ts:415`）。
- 取消路径：`completeAction` 会 cancel 该行动全部 scheduled 提醒（`actions.ts` Step 4）；`reclarifyAction` 走 complete 事务（同样 cancel）。**缺口：`trashAction`（`actions.ts:277`）不 cancel 提醒**——删除后的行动到点仍会响（本任务修）。
- core 的 `habitWindowReminderSpec` 存在但 db 层未接线；且 habit day 只能由 `startHabit` 产生（UI 无入口，backlog P1）——v1 实际无 habit 提醒数据，投递侧泛化支持即可。
- **reminders 在 PowerSync 同步流里**（`server/powersync/sync-config.yaml`）——提醒行跨设备共享。
- 本地变更订阅：PowerSync 客户端 2.x 提供 `db.onChange(handler, { tables: [...] })`（sync 流入的行同样触发），`CommonPowerSyncDatabase.d.ts` 确认；app 侧经 `usePowerSync()` 拿实例（`@powersync/react` 边界，`use-action-title.ts` 同模式）。
- app 默认落地路由是 Inbox（`app/index.tsx` → `/inbox`）。

**客户端缺口（本任务范围）**：

- `expo-notifications` 未安装，`app.json` 无通知 plugin 配置；无权限申请、无调度、无 reminders 消费代码。
- 桌面（Tauri v2 壳，`apps/desktop`）无任何通知能力。

**外部库研究结论（`research/` 两份，含出处）**：

- 版本：SDK 57 配套 `expo-notifications@57.0.21`；Tauri 2.11 配套 `tauri-plugin-notification` Rust+JS 均 2.4.0（2.5.0 需要 tauri core 2.12，不兼容当前 2.11）。
- **桌面端三平台（macOS/Windows/Linux）均不能原生调度未来通知**（源码级确认：插件桌面 `show()` 只立即投递，`schedule` 字段从不被读取）→ 桌面端只能靠 app 运行期间的 JS 定时器到点投递；app 关闭期间桌面不响（v1 固有限制）。
- 桌面端插件无点击回调/payload（`onNotificationClick` 不存在）→ 桌面点通知只能聚焦 app，无法 deep-link（macOS release / Windows 安装版可拉起/聚焦；macOS dev 模式通知归属 com.apple.Terminal，验收必须 release 构建）。
- expo 侧：`getAllScheduledNotificationsAsync()` 可列出 pending 通知并拿 `identifier` + `content.data`；`scheduleNotificationAsync` 支持自定义 `identifier` → 用 reminder 行 ID 做 reconcile；iOS/Android 的 scheduled 通知均 OS 层持久化（强杀后仍到点响）；Android 12+ 不加 exact-alarm 权限会静默降级为非精确闹钟（时刻漂移）；iOS 可 per-notification 自定义声音（wav ≤30s，app.json 插件声明），Android 声音/振动只能渠道级。
- 桌面端权限恒 granted、无弹窗；桌面分支只可调 `isPermissionGranted` / `sendNotification`（调 pending/cancel/channels 会 command not found）。

## Decisions（brainstorm 已收敛，用户拍板 2026-09-30）

- **D1 平台覆盖 = 原生 + 桌面**：iOS/Android 走 `expo-notifications`；桌面（Tauri webview）走 `tauri-plugin-notification`；纯浏览器 web（dev 场景）no-op。
- **D2 通知交互 = 仅 deep-link**：点通知 → 启动/聚焦 app 落到 Now 屏（原生可 deep-link 到 `/now` tab；桌面只能聚焦 app，无 payload）；通知内直接操作（完成/推迟/跳过）不做，列 follow-up。
- **D3 多设备 = 每台都投**：不做设备仲裁，每台设备对自己本地的 scheduled 提醒负责；同一条提醒在多台在线设备各响一次是预期行为。
- **D4 权限 = 情境式 + 设置页状态块**：第一次产生提醒行时（首次 snooze / 首次创建带提醒的日历行动）请求权限；设置页展示通知状态（未请求/已授权/已拒绝，拒绝时 iOS 给「去系统设置」入口）；权限被拒不阻塞业务流程（reminders 行照常写，只是不投递）。

## Requirements

- **R1 调度核心（纯逻辑，平台无关）**：消费本地 `reminders` 表中 `state='scheduled'` 且行动仍存活的行，与 OS 侧 pending 通知做 reconcile——未来行缺调度则补排（native 用 reminder 行 ID 当通知 identifier）、pending 中无对应行的孤儿取消。触发时机：app 启动、回到前台、reminders 相关表本地变更（含 sync 流入，`db.onChange` + 防抖）。
- **R2 原生投递（iOS/Android）**：`expo-notifications@57.0.21`；OS 层持久化调度（强杀后到点仍响）；通知内容 = 类型标题 + 行动标题，`data` 带 reminderId/actionKind/actionId；intensity 映射（iOS per-notification 声音：normal 默认 / important、alarm 自定义 wav；Android 三渠道分级）；Android 12+ exact-alarm 权限（expo-build-properties 注入 manifest）。
- **R3 桌面投递（Tauri）**：`tauri-plugin-notification@2.4.0`（Rust 插件 + capabilities + JS 依赖）；app 运行期间 30s tick 扫描，grace 窗口内到点的行立即 `sendNotification`；fired 记录会话内内存去重；app 关闭期间不响（v1 固有限制，文档注明）；点击 = 聚焦 app（无 deep-link）。
- **R4 deep-link**：原生点通知（含 terminated 冷启动）→ 路由到 Now tab；桌面点通知 → 聚焦 app（D2 的桌面退化形态）。
- **R5 权限流程（D4）**：提醒行首次产生时情境式请求（snooze 成功 / 日历行动创建后）；设置页「通知」状态块（未请求 / 已授权 / 已拒绝 + iOS 拒绝时「去系统设置」按钮）；被拒时提醒行照常写入、投递静默跳过。
- **R6 纯 web（非 Tauri）**：no-op 适配器，snooze/日历流程不受影响，设置页显示「浏览器环境不支持通知」。
- **R7 状态回写（v1 不做 `fired`）**：通知在 app 终止时由 OS 发出，JS 无法在触发时刻写 `state='fired'`；v1 投递层不写 fired，行保持 scheduled 直到业务事务 cancel（complete/reclarify/再 snooze/trash）；reconcile 对已过 `fires_at` 的行永不补排（不重复、不迟到补发）。
- **R8 db 修复**：`trashAction` 事务内 cancel 该行动全部 scheduled 提醒（对齐 `completeAction` Step 4），修孤儿通知的源头。

## Acceptance Criteria

- [ ] **AC1 到点响（核心闭环）**：iOS（模拟器/真机）与桌面（macOS release 构建）各走一遍：snooze「10 分钟后」→ 到点 OS 通知出现（原生 ±1 分钟、桌面 ±35 秒 tick 精度），body 含行动标题。
- [ ] **AC2 OS 持久化**：调度后强杀 app → 通知仍到点响（iOS/Android 各验一次）。
- [ ] **AC3 deep-link**：app 处于 terminated 状态，点通知 → 冷启动落到 Now tab（原生）；桌面点通知 → 聚焦 app。
- [ ] **AC4 业务取消**：snooze 后完成该行动 → 通知不再出现；跨设备版（设备 A snooze、设备 B 完成并让 B 过一遍 reconcile）→ A 的 pending 被清。
- [ ] **AC5 删除取消（R8）**：snooze 后删除该行动（trash）→ 通知不再出现（db cancel + reconcile 双保险）。
- [ ] **AC6 权限（D4）**：全新设备首次 snooze 弹系统权限框；拒绝后 snooze 流程照常（reminders 行存在、无投递）；设置页状态块正确显示「已拒绝」，iOS 点「去系统设置」能进系统设置页。
- [ ] **AC7 reconcile 幂等**：反复 启动/回前台 3 次 → pending 通知数不增（无重复调度）；另一设备产生的孤儿 pending 行在本设备 reconcile 后被取消（单测覆盖纯函数；手动验跨设备）。
- [ ] **AC8 多设备各投一次（D3）**：两台设备在线，同一条提醒各响一次（手动，记录即可）。
- [ ] **AC9 质量门**：纯 reconcile 函数单测（补排/孤儿取消/过去行/tauri grace 窗口）+ `trashAction` cancel 单测 + 权限状态助手单测；根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿；`expo export --platform web` 成功（桌面壳依赖）；`tauri build`（macOS）成功。
- [ ] **AC10 纯 web no-op**：浏览器 dev 环境 snooze 全流程无报错、无通知副作用（R6）。

## Out of Scope

- 通知内直接操作（完成/推迟/跳过按钮）——桌面插件不支持、handler 竞态复杂，follow-up。
- 多设备单响仲裁（last active device）——D3 已定每台都投，follow-up。
- `state='fired'` 回写（触发时刻 app 通常已终止）——follow-up。
- habit 提醒的写行（无数据来源，归习惯表单任务，backlog P1）。
- 服务器推送（APNs/FCM）、Android 后台同步收提醒行（app 关闭期间的跨设备提醒）——离线优先架构下本地通知即够，post-MVP。
- 桌面端 app 关闭期间的提醒（插件不能原生调度，v1 固有限制）。
- iOS 分发流水线本身（backlog P0-2，独立任务）。
- 版本号 bump / 发布（发布任务负责）。

## Risks & Mitigations

- **Android 12+ exact-alarm**：无权限时静默降级非精确（时刻漂移）。mitigation：expo-build-properties 注入 `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`；最坏情况用户被系统询问、拒绝则漂移（可接受）。
- **macOS dev 模式**：tauri dev 通知归属 com.apple.Terminal（点击拉起 Terminal）。mitigation：桌面验收一律用 release 构建（AC1/AC3/AC9 已写明）。
- **expo-notifications 57 API 改名**（`getScheduledNotificationsAsync` → `getAllScheduledNotificationsAsync` 等）：research 已确认新名；实现时以装到的 57.0.21 类型为准。
- **reconcile 并发**：onChange 事件密集。mitigation：reconcile 走单条 promise 链 + 1s 防抖，操作幂等（先查 pending 再排程）。
- **声音资源**：iOS 要求 wav ≤30s 且 app.json 声明。mitigation：脚本生成两个简单提示音，纳入 assets。
