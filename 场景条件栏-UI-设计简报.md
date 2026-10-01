# 设计简报：Now 屏「推荐条件栏」重做

> 用途：直接粘贴给设计模型（Gemini）。请它**输出可直接替换的 React Native + NativeWind 代码**，
> 而不是 Figma 稿或文字描述。

---

## 1. 项目背景

Nextdo 是一个 GTD（Getting Things Done）行动管理应用，Expo + React Native + expo-router 写的移动端，
同一份代码用 `expo export --platform web` 导出后被 Tauri 桌面壳加载，所以**必须同时在 iOS / Android / Web 渲染正常**。

- UI 框架：React Native `Pressable` / `Text` / `View` / `TextInput`
- 样式：NativeWind（Tailwind 风格 className），暗色模式用 `dark:` 变体成对出现
- 设计语言：Paper Serenity（暖调、纸感、低饱和）

## 2. 要重做的组件

文件：`apps/mobile/app/(tabs)/now.tsx`
组件：`EngineContextBar`（当前约 130 行）

它是「下一步」屏顶部的**引擎输入条件栏**——决定推荐引擎给你哪一条行动。结构上是一个 `Card`，
里面上下两块：

```
┌─────────────────────────────────────┐
│ 当前场景                              │  ← 多选 · OR
│ [任意] [computer] [home] [office] …  │
│                                      │
│ 可用时间（分钟）                       │  ← 单选
│ [15] [30] [60] [120] [自定义输入框]    │
└─────────────────────────────────────┘
```

### 交互语义（不能改）

| 维度 | 语义 | 说明 |
|---|---|---|
| 当前场景 | **多选 · 匹配任一（OR）** | 空选 = 「任意」= 随处可执行。种子 5 个：`computer` / `home` / `office` / `outside` / `phone`，用户可自建 |
| 可用时间 | **单选** | 预设 15 / 30 / 60 / 120 分钟，另有自定义数字输入 |

「任意」不是一个普通场景 chip，而是「清空选择」这个动作的入口——它与命名场景是**不同的操作**
（一个清空、一个增删），但当前实现把它们放在了同一个 chip 流里。

## 3. 数据契约（绝对不能改）

```ts
const contextIds = settings?.contextIds ?? [];        // string[]
const availableMinutes = settings?.availableMinutes ?? 60;  // number

void update({ contextIds: next });                    // 场景 toggle / 清空
void update({ availableMinutes: minutes });           // 时间选择
const { data: contexts, add } = useContexts();        // add(name) 新建场景
```

`EngineContextBar` 的 settings 实例由 `NowScreen` 持有（`useNow` 的候选池依赖它重算），
所以组件是受控的，不能自己持有 contextIds 的副本状态。

## 4. 已经被否定的设计（重要，请勿重复）

上一版重设计做了这些改动，**用户明确表示"没有之前好看"，已整体回滚**：

- 给条件栏加了一条 `推荐条件` 标题条 + `bg-surface-container` 底
- 场景选择器改用 `packages/ui` 的 `ContextChip`，并在右侧加了 `多选 · 匹配任一` 的 hint 文案
- 「任意」单独用 `bg-secondary-fixed` 配色
- 「＋」新建场景改成虚线边框 pill
- 可用时间改成连体分段控件（radio 感），并让自定义输入在越界时高亮

### 回滚的直接原因：制造了假选中信号

`ContextChip` 会按**场景名的 djb2 哈希**分配 5 组土色（`contextTone(name) = hash % 5`）：

| 场景 | 命中色 | 背景 / 文字 |
|---|---|---|
| computer / home / outside | earth-1 | `#f0eee9` / `#544e47`（中性灰） |
| **office** | **earth-3** | **`#f9ede2` / `#914d1c`（明显偏暖的琥珀）** |
| phone | earth-5 | `#f2eee7` / `#61574b`（中性灰） |

结果 `office` 单独看起来像"被选中了"，其实它根本没被选中——这只是名字哈希的巧合。
**这是一个必须避免的失败模式：条件栏里任何一个场景的外观，都不能取决于它的名字。**
所有场景在任何状态下都必须长得一样，只有"选中"这一个变量可以改变外观。

## 5. 重做时要解决的问题

上一版重设计的**出发点是对的**，别推翻它：

> 条件栏和同屏下方的「列表区筛选 chips」在语义上完全不同——条件栏决定**引擎推荐哪条行动**（影响主推卡片），
> 列表区筛选只**裁剪下方列表**（不影响主推）。上一版两者长得几乎一样，用户分不清这个层级差别。

所以新设计要同时满足：

1. **一眼能看出这是"喂给引擎的条件"，而不是"给列表加的筛选"**（层级区分）
2. **多选-OR 与 单选 的差异不用读说明文字就能看出来**（上一版靠 hint 文案，用户觉得多余）
3. **不产生任何假选中信号**（见第 4 节）
4. 比上一版克制、好看。上一版的问题是元素太多、层级太重（标题条 + hint + 虚线 pill + 连体分段）
5. 保留移动端可点性：视觉高度可以小（chip 22–32px），但可点区域必须 ≥ 44pt（用 `hitSlop` 或 padding 补）

## 6. 硬性工程约束

违反即返工：

- **禁止 raw hex / 魔法数字**。只能用下面的设计 token（NativeWind 类名形式）
- 暗色模式：每个颜色都要有 `dark:` 配对，**包括**背景、边框、文字
- 无障碍：每个可点元素 `accessibilityRole="button"` + `accessibilityLabel`（说明动作和对象）+ `accessibilityState={{ selected }}`
- **颜色不能是唯一的状态信号**（选中态要同时有形状/文字/图标的变化）
- 文字和背景的 class 要**同时**写到 `<Text>` 上（React Native 不从容器级联文字样式）
- NativeWind 只认**完整类名**，不能运行时拼类名片段；要条件样式用 `cn()`（`packages/ui/src/lib/cn.ts`）
- 禁止：`console.*` / `alert()` / 在 render 里做副作用 / 组件里写业务规则
- Web 端要能跑：不要引入只在原生可用的组件

### 可用 token

```
canvas #faf9f6 / canvasDark #171412
surface #ffffff / surfaceDark #211d19
surfaceContainer #f5ece3 / surfaceContainerDark #2a241d
ink #262320 / inkDark #ece7df
muted #716b64 / mutedDark #9b948a
accent #c85a17 / accentDark #e0703a
onAccent #ffffff / onAccentDark #241509
border #e8e5df / borderDark #3a342c
secondaryFixed #ffdcc1 / secondaryFixedDark #402d1a
warning #a35a12 / warningDark #d98e4a
danger #ba1a1a / dangerDark #ff6b60
tag-earth-{1..5}-{bg,text}  ← 仅供 ContextChip 只读行用，条件栏不要用
```

圆角：`rounded-sm 6px` / `rounded-md 8px` / `rounded-lg 12px` / `rounded-xl 14px` / `rounded-2xl 16px` / `rounded-full`

## 7. 可复用的现有组件

- `packages/ui`：`Card` `Button` `Tag` `EmptyState` `ProgressBar` `cn`
- `packages/ui` 的 `ContextChip`：**只读行 chip**用（列表里展示行动所属场景）。
  它的按名配色特性使它**不适合**用在选择器里——这正是第 4 节那个 bug 的来源。
- `Chip` 组件目前定义在 `now.tsx` 文件内部（未导出），是条件栏和列表区筛选共用的中性 chip

## 8. 交付要求

1. **完整可替换的 `EngineContextBar` + 它需要的子组件 TSX 代码**（含 import）
2. 一段不超过 5 行的说明：这套设计如何解决第 5 节的 5 个问题
3. 如果你建议改动 `now.tsx` 之外的文件（例如抽一个 chip 到 `packages/ui`），单独列出来并说明理由
4. 不要输出 Figma、HTML、原型或设计说明文档

## 9. 验收

- [ ] 5 个种子场景在**未选中**时外观完全一致（改名字、换用户自建场景都不能变）
- [ ] 选中 N 个场景时，恰好 N 个 chip 呈现选中态，且都有非颜色的状态信号
- [ ] 「任意」与命名场景在视觉上可区分（因为它们是不同操作），但不像两个平级的筛选维度
- [ ] 单选（时间）与多选（场景）不靠读文字就能分辨
- [ ] 与下方列表区筛选 chips 有明确层级差异
- [ ] 亮色 / 暗色都检查过
- [ ] 可点区域 ≥ 44pt
- [ ] 数据契约（第 3 节）零改动
- [ ] `pnpm --filter @nextdo/mobile exec tsc --noEmit` 与 `jest __tests__/now-screen.test.tsx` 通过
      （该测试文件断言了条件栏的现有文案与行为，改动 UI 时需同步更新断言）
