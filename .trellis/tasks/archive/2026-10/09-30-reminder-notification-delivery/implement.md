# Implement Plan — 提醒通知投递

> 按序执行；每步完成即跑「验证」列的命令。回滚点见 §4。

## 1. 执行清单

### 阶段 A：db 层（无 UI 依赖，先行）

| # | 步骤 | 验证 |
|---|------|------|
| A1 | `packages/db/src/queries/reminders.ts`：`listScheduledReminders(db)`（design §2.1 的 JOIN 查询，Kysely 写法） | `pnpm --filter @nextdo/db test` |
| A2 | A1 的单测（fixture：scheduled 行 × 行动存活/软删/habit 路径 → title 解析 + 孤儿 null） | 同上 |
| A3 | `actions.ts` `trashAction` 加事务 + cancel 提醒（R8，design §7）+ 单测（trash 后 scheduled 行变 cancelled） | `pnpm --filter @nextdo/db test` |
| A4 | `index.ts` 导出 `listScheduledReminders` | `pnpm --filter @nextdo/db typecheck` |

### 阶段 B：调度纯逻辑（平台无关）

| # | 步骤 | 验证 |
|---|------|------|
| B1 | `apps/mobile/lib/reminders/reminder-scheduler.ts`：`computeReconcile(input)` 纯函数（design §3 全部规则，含 tauri grace 窗口） | `pnpm --filter @nextdo/mobile test` |
| B2 | 单测：补排 / 孤儿 cancel / pending 孤儿 cancel / 过去行不排不补发 / title=null 跳过 / tauri grace 内/外 / firedIds 去重 | 同上 |

### 阶段 C：平台适配器 + 依赖

| # | 步骤 | 验证 |
|---|------|------|
| C1 | 装依赖：`npx expo install expo-notifications`（锁定 57.0.21）+ `@tauri-apps/plugin-notification@2.4.0` + `expo-build-properties`（apps/mobile） | `pnpm typecheck` |
| C2 | `app.json`：expo-notifications plugin（sounds 声明、icon、color）+ build-properties manifestPermissions（`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM`） | `npx expo config --type public` 无错 |
| C3 | 生成 `assets/sounds/important.wav` / `alarm.wav`（≤30s，脚本：sox/ffmpeg 合成两个可区分提示音） | 文件存在 + 时长 < 30s |
| C4 | `adapters/native.ts`（design §4.1：渠道幂等创建、schedule/cancel/listPending、权限、响应 listener） | typecheck |
| C5 | `adapters/tauri.ts`（design §4.2：惰性 import、firedIds、isPermissionGranted only） | typecheck |
| C6 | `adapters/noop.ts` + `adapters/index.ts` 平台选择 | typecheck |
| C7 | **apps/desktop Rust 三处**：Cargo.toml 2.4.0 + lib.rs 注册 + capabilities `notification:default` | `pnpm --filter @nextdo/desktop build`（至少 cargo check） |

### 阶段 D：接线（hook + 屏）

| # | 步骤 | 验证 |
|---|------|------|
| D1 | `hooks/use-reminder-delivery.ts`（design §5：onChange 订阅 + 防抖 + 前台触发 + 冷启动响应 + reconcile 队列） | typecheck + 相关测试 |
| D2 | `app/_layout.tsx` 挂 hook（Provider 内、Stack 外均可——不依赖路由状态，但响应路由需要 router：listener 回调里用 `router`） | `expo export --platform web` 成功 |
| D3 | `use-snooze-action.ts` 成功回调 → `maybeRequestNotificationPermission()`；Clarify 日历提交路径同样调用 | mobile test |
| D4 | 设置页通知状态块（design §6，数据经 hook 暴露；iOS 拒绝 → `openSettings()` 按钮） | mobile test（状态块渲染 + 文案） |
| D5 | 全量质量门：`pnpm test && pnpm typecheck && pnpm lint`（根级）+ `expo export --platform web` + `tauri build`（macOS） | 全绿 |

### 阶段 E：手动验收（PRD AC 对照，用户参与）

| # | 步骤 | AC |
|---|------|---|
| E1 | iOS 模拟器/真机：snooze 10 分钟 → 到点响（±1min）；强杀 app 后仍响 | AC1/AC2 |
| E2 | iOS 冷启动 deep-link：terminated 状态点通知 → 落 Now tab | AC3 |
| E3 | 同设备：snooze → 完成 → 不响；snooze → 删除 → 不响 | AC4/AC5 |
| E4 | 全新设备首 snooze 弹权限；拒绝 → 流程照常 + 设置页「已拒绝」+ 去系统设置 | AC6 |
| E5 | 启动/回前台 ×3 → 无重复通知 | AC7 |
| E6 | 桌面 macOS release 构建：snooze → 到点响（±35s）→ 点击聚焦 app；纯 web 浏览器 no-op | AC1/AC3/AC9/AC10 |
| E7 | （可选，双设备）同一条提醒两台各响一次 | AC8 |

## 2. 验证命令汇总

```sh
pnpm --filter @nextdo/db test && pnpm --filter @nextdo/db typecheck
pnpm --filter @nextdo/mobile test && pnpm --filter @nextdo/mobile typecheck
pnpm test && pnpm typecheck && pnpm lint        # 根级质量门
cd apps/mobile && npx expo export --platform web   # 桌面壳依赖 web 构建
cd apps/desktop && pnpm build                      # tauri build (macOS)
node e2e/sync-roundtrip.ts                          # 回归（预期零改动，可最后跑）
```

## 3. 测试要点

- 纯函数（B2）是单测主体——adapter 全是薄封装，不单测（manual E 段覆盖）。
- db 测试沿用 `packages/db` 既有 harness（in-memory PowerSync + AppSchema）。
- mobile 屏测试注意 testing-guidelines：fake timers 常开、mock 全量 `@nextdo/db` 导出（新增的 `listScheduledReminders` 要进 mock factory）、`usePowerSync` mock 要能响应 `onChange`（返回 dispose 函数）——`use-reminder-delivery` 在挂载 tab 的测试里不能被 mock 漏掉。
- expo-notifications 在 jest 环境需要 mock（`jest-expo` 自带部分 mock；调度/权限 API 按需在测试文件内 `jest.mock`）。

## 4. 回滚点

| 点 | 状态 | 回滚动作 |
|---|------|---------|
| RP1 | A 阶段完（db） | db 无依赖方，git revert A 阶段提交 |
| RP2 | B 阶段完（纯逻辑） | 无接线，revert 即净 |
| RP3 | C 阶段完（依赖 + adapter） | 卸 3 个依赖 + 还原 app.json；Rust 改动独立 revert |
| RP4 | D 阶段完（接线） | 还原 _layout/settings/snooze/clarify 五处接线 |

阶段间代码互不越界：A 只动 packages/db，B 只动 lib/reminders 纯函数，C 只动依赖/adapter/Rust，D 只动接线点。

## 5. start 前检查

- [x] `prd.md` / `design.md` / `implement.md` 齐
- [x] `implement.jsonl` / `check.jsonl` 已填真实条目
- [x] e2e 不受影响（无 schema/同步面/server 变更）
- [x] spec 边界：查询进 packages/db、onChange 走 usePowerSync 先例（Phase 3.3 补 spec）
