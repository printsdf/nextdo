# iOS 简约风 UI 重新设计与重构 — 执行计划 (implement.md)

## Ordered Implementation Plan

### Step 1: Design Tokens 与基础组件升级
- [x] 1.1 更新 `packages/ui/src/tokens/colors.json` 与 `radii.json`（对接 iOS Grouped 浅灰/纯黑纯白分层与微细边框）。
- [x] 1.2 重构 `packages/ui/src/components/button.tsx`：支持大中小尺寸、大圆角、突出主按钮层级与触控反馈。
- [x] 1.3 重构 `packages/ui/src/components/card.tsx` 与 `tag.tsx`：去除生硬黑边框，采用 Inset Grouped 圆角卡片与精致胶囊标签。
- [x] 1.4 运行 `pnpm --filter @nextdo/ui typecheck` 与 `test`，确保组件库导出与测试正常。

### Step 2: Tab 导航重排与开屏极速捕获弹窗
- [x] 2.1 调整 `apps/mobile/app/(tabs)/_layout.tsx`：将「收件箱 (inbox)」设为首个 Tab，重排 Tab 顺序，优化 Tab 栏样式。
- [x] 2.2 实现 `apps/mobile/components/quick-capture-modal.tsx`：开屏居中/底部弹窗、自动聚焦、Enter 快速保存入收件箱、支持 ESC / 遮罩点击关闭。
- [x] 2.3 在 Tab 布局或收件箱中集成弹窗，支持开屏自动弹出与随时重开。

### Step 3: 核心屏幕视觉与按钮布局重构
- [x] 3.1 重构【现在 (now.tsx)】执行屏：
  - 核心主按钮升级：`[开始专注]` 全宽醒目大按钮，视觉绝对重心。
  - 次要操作下沉：`[换一个]` 与 `[稍后]` 并列于次要操作栏，空间开阔不再拥挤。
  - 场景与时间选择器：从厚重的大 Card 中拆出，改为 iOS 风格灵动轻盈的胶囊 Pills。
- [x] 3.2 优化【收件箱 (inbox.tsx)】界面：iOS 大标题、输入框优化、条目卡片 Inset 质感。
- [x] 3.3 优化【项目 (projects.tsx)】与【回顾 (review.tsx)】界面：卡片质感对齐统一、状态圆点指示灯。

### Step 4: 完整验证与走查
- [x] 4.1 运行完整质量门禁：`pnpm lint && pnpm typecheck && pnpm test`。
- [x] 4.2 Web 浏览器（`http://localhost:8081`）走查：
  - 开屏极速捕获弹窗自动弹出与保存。
  - Tab 顺序为收件箱居首。
  - 现在屏大按钮与操作栏呼吸感与触控热区。
  - iOS 简约风格浅色与深色色彩质感。
