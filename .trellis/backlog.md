# Backlog — 下一任务候选池

> 用途：记录尚未排期的候选任务，供下次会话选任务时参考。
> 选定某项后走 Trellis 正常流程（`task.py create` → brainstorm → …），完成后从本文件移除（来源任务的 archive 里留档即可）。
> 本文件按当前推荐优先级排序；用户可随时重排。

## 当前推荐

1. **Owner token 录入 UI**（新增于 09-23 会话）
   - 现状：app 没有任何入口录入 owner token，同步链路（`fix(sync)` @ `51e29a1`，app 侧按 token 状态 connect/disconnect）永远无法激活。
   - 形态（brainstorm 时细化）：settings/授权屏，输入 token → `setOwnerToken()` 写入 → PowerSync 自动 connect；支持清除（登出）。
   - 来源：09-23 会话走查发现；`.trellis/workspace` journal-1 session 4。

## 候选（来自 09-22-app-ui-screens 的 Deferred）

2. 习惯创建表单（含 21 天挑战启动）
3. 推送通知（expo-notifications + reminder 消费）
4. Clarify 进阶字段（时间窗口、场景绑定）
5. 引擎上下文的 settings 表化（进同步面）
6. 图标资源（scaffold 为纯文字 tab bar）
7. Now 屏矮视口布局打磨（内容溢出时底部 snooze sheet 需滚动，走查观察项，见 `09-22-app-ui-screens/research/manual-verification.md`）
8. 参考资料的展示入口（v1 reference 行只落库无展示屏；需要时加 Inbox 过滤或独立屏）

## 备注

- 09-23 会话另观察到一次工作区改动（删除 `apps/mobile/expo-env.d.ts` + 精简 `apps/mobile/tsconfig.json` include）会破坏 typecheck（TS2882：`global.css` 模块声明经 `expo-env.d.ts` → `expo/types/global.d.ts` 引入），已还原。若后续有意移除 `expo-env.d.ts`，需先补本地 CSS 模块声明。
