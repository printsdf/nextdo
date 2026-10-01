# Backlog — 下一任务候选池

> 用途：记录尚未排期的候选任务，供下次会话选任务时参考。
> 选定某项后走 Trellis 正常流程（`task.py create` → brainstorm → …），完成后从本文件移除（来源任务的 archive 里留档即可）。
> 本文件按当前推荐优先级排序；用户可随时重排。
> 09-30 会话按「上线前必须 / 上线前建议 / 长期候选」重排（对照 Proposal MVP 表逐项核查）。

## 当前推荐（P0 — 公开发布前必须关闭）

1. **提醒通知投递**（09-30 升为 P0；原候选「推送通知」）
   - 现状：snooze 事务已写 `reminders` 行（`packages/db/src/queries/actions.ts`，`fires_at` / `intensity` 齐备），但 app 侧**没有任何投递逻辑** —— `expo-notifications` 未安装、无本地通知调度、无权限申请、无客户端代码读 reminders 表。用户点「稍后」后手机永远不会提醒。
   - 形态（brainstorm 时细化）：expo-notifications + 本地通知调度（消费 reminders 行，app 重启后补排程）；提醒三档强度映射；通知内直接「完成 / 推迟 / 跳过」操作（Proposal §8）。
   - 依据：Proposal MVP 表 Reminder 与 Snooze 均为「必须」；09-30 核查。
2. **iOS 分发**（09-30 新增）
   - 现状：`.github/workflows/release.yml` 覆盖桌面三平台 + Android 按 ABI 拆 APK（EAS）；iOS 被明确排除在流水线外（需 Apple 签名凭证）。主力机是 iPhone 的话这是发布阻断项。
   - 形态：EAS iOS 构建（App Store Connect / 至少 TestFlight），接入 release 流水线。
   - 依据：release.yml 注释「iOS is NOT part of this pipeline」；09-30 核查。
3. **核心对象展示/管理入口**（09-30 合并原候选「参考资料的展示入口」+ 新发现）
   - 现状：Clarify 流程能把事项落进 Waiting For / Someday / Reference（功能通），之后无专屏 —— 仅 Weekly Review 的 snapshot 计数 + follow-up 勾选；**Reference 落库后完全无展示入口**，用户存的资料再也看不到；Waiting For 无跟进管理屏。
   - 形态（brainstorm 时细化）：最低限度入口 —— 独立屏或 Inbox 内过滤视图（资料 / 等待 / 有空再说）。
   - 依据：Proposal MVP 核心对象列表（Waiting For / Someday/Maybe / Reference）；09-22-app-ui-screens Deferred #8；09-30 核查。

## 上线前建议（P1）

4. **习惯创建表单（含 21 天挑战启动）**（原候选 #2）
   - db 层 `addHabit` / `startHabit` 已就绪（`packages/db/src/queries/habits.ts`），UI 无入口；Now 屏「今天习惯」永远 0/0；21 天 Challenge Cycle 是 Proposal 差异化能力。
5. **回收站（软删除的恢复 / 硬删入口）**（journal-1 session 10 Next Steps）
   - 行动 / 项目删除均为软删除，无恢复入口，误删不可找回。
6. **同步服务器产品定位（决策项）**（09-30 新增）
   - 现状：用户自行部署 Postgres + PowerSync 栈，在设置页填两地址 + token（09-28 任务拍板「用户自选」）。自用可行；公开发布门槛过高。
   - 需拍板：v1 同步定位 = 个人服务器模式 + 文档说明，还是官方公共同步服务器（后者此前定为 post-MVP）。

## 候选（长期）

7. Clarify 进阶字段（时间窗口、场景绑定）（原候选 #4）
8. 引擎上下文的 settings 表化（进同步面）（原候选 #5）
9. PR 级 CI 质量门（lint / typecheck / test；当前仅本地执行，仓库只有 release 流水线）（09-30 新增）
10. CalendarAction 支持 projectId（journal-1 session 10 Next Steps）
11. 商店素材与版本细节：splash 屏（`app.json` 无 splash 配置）、EAS `submit` 配置为空、版本号不齐（mobile 0.1.2 / desktop 0.1.1 / 根 0.1.1）（09-30 新增）

## 09-30 清理的过时条目

- ~~Owner token 录入 UI~~（原 #1）：已由 09-28-oss-sync-options 交付 —— 设置页已有「后端地址 + 同步流地址 + token」三输入 + 连接/断开（`apps/mobile/app/(tabs)/settings.tsx`）。
- ~~图标资源（scaffold 为纯文字 tab bar）~~（原 #6）：已由 09-29-mobile-ui-optimization 交付（tab bar 矢量图标 R5）+ app 图标为真实设计稿（`apps/mobile/assets/icon.png`）。
- ~~Now 屏矮视口布局打磨~~（原 #7）：已由 09-29-mobile-ui-optimization 交付（NowScreen 改 ScrollView，R2）。

## 备注

- 09-23 会话另观察到一次工作区改动（删除 `apps/mobile/expo-env.d.ts` + 精简 `apps/mobile/tsconfig.json` include）会破坏 typecheck（TS2882：`global.css` 模块声明经 `expo-env.d.ts` → `expo/types/global.d.ts` 引入），已还原。若后续有意移除 `expo-env.d.ts`，需先补本地 CSS 模块声明。
