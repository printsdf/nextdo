# Implement — 捕获后即时澄清 + 问题链内置项目归属

> 顺序 = 依赖顺序（core → db → app 纯逻辑 → app 组件 → 捕获交接 → 验证 → spec）。
> 每步完成即跑该步的验证命令；全部完成后跑 §9 全量验证。

## 1. core：Clarify 契约扩展

- [x] `packages/core/src/domain/clarify.ts`：
  - `ClarifyAnswers` 加 `projectId?: string`（Q2b 注释）；
  - `ClarifyOutcome` 加 `{ kind: 'next-action'; source: 'project-attach' }`；
  - `classifyInboxItem`：`multipleSteps` 之后、`twoMinutes` 之前插入挂接判定
    （非空 string 命中；null/undefined 落空走常规链）。
- [x] `packages/core/src/domain/clarify.test.ts`：挂接命中 / 优先级两条 /
  null+undefined 回归。
 - [x] 验证：`pnpm --filter @nextdo/core test` + `pnpm --filter @nextdo/core typecheck`。

## 2. db：applyClarify / reclarifyAction 挂接路径

- [x] `packages/db/src/queries/inbox.ts`：
  - `ReclarifyAnswers` 加 `projectId?: string | null`（三态注释）；
  - 新 helper `loadAttachableProject`（not-found / not-active 两个错误码）；
  - `applyClarify` case 'next-action'：project-attach 分支（keptValue = 项目 value）;
  - `reclarifyAction` case 'next-action'：三态处理（string / null / undefined）。
- [x] `packages/db/src/test/queries.inbox.test.ts`：§3 design 所列全部用例
  （成功、两类错误、re-clarify 三态、原分支回归）。
 - [x] 验证：`pnpm --filter @nextdo/db test` + typecheck。

## 3. app 纯状态机

- [x] `apps/mobile/lib/clarify-flow.ts`：
  - 步骤联合 + `q2b`；form 步骤 + `projectId/projectTitle`；
  - `answer-q2b` 三向（none / new-project / attach 带 payload）；
  - `q2` 否 → `q2b`（原 → q3）；
  - `buildFormSubmission` action 分支的 projectId 三态语义。
- [x] `apps/mobile/lib/clarify-flow.test.ts`：转移矩阵 + submission 三态。
 - [x] 验证：`pnpm --filter @nextdo/mobile test`（lib 部分）+ typecheck。

## 4. app 组件（向导）

- [x] `apps/mobile/hooks/use-action-title.ts`：返回值扩展 `projectId`。
- [x] `apps/mobile/components/clarify-wizard.tsx`：
  - `WizardBody` 接入 `useProjects()`（过滤 active）；
  - `QuestionCard` 新 `q2b` 分支（项目行 + 两按钮 + re-clarify"当前"标记）;
  - `FormCard` action 表单"所属项目：X"只读行；
  - 完成步：删自动 back 计时器 → "再记一条 / 完成" 两按钮
    （`router.navigate('/(tabs)/inbox', { recapture: '1' })` / `router.back()`）。
- [ ] 测试：`apps/mobile/__tests__/clarify-wizard.test.tsx` 补 q2b 渲染（有/无项目、
  re-clarify 当前标记）、完成步两按钮行为；mock `useProjects`。
 - [x] 验证：`pnpm --filter @nextdo/mobile test` + typecheck。

## 5. app 捕获交接

- [x] `apps/mobile/hooks/use-add-inbox-item.ts`：`add` → `Promise<InboxItem | null>`。
- [x] `apps/mobile/components/quick-capture-modal.tsx`：`onAdd` 类型 +
  `onCaptured` prop（成功后重置并回调）。
- [x] `apps/mobile/app/(tabs)/inbox.tsx`：统一 `handoffToClarify(item)`
  （关弹窗 + `router.push('/clarify/<id>')`），弹窗与内联条共用；
  `recapture` 路由参数一次性消费（开弹窗 + setParams 清理）。
- [ ] 测试：`quick-capture-modal.test.tsx` 补 onCaptured 交接；
  Inbox 屏测试补"保存→跳转"与"recapture=1→弹窗打开且参数被清"。
 - [x] 验证：`pnpm --filter @nextdo/mobile test` + typecheck。

## 6. 错误文案

- [x] `apps/mobile/lib/error-messages.ts`：`clarify.project-not-found` /
  `clarify.project-not-active` 两条中文映射。

## 7. 手测冒烟（web 平台，`expo start --web` 或现有等价命令）

- [ ] 启动 → 弹窗记一条 → 立即进入提问 → Q2b 选已有项目 → 表单 value 预填 →
  保存 → 完成步 → "再记一条"循环一次 → "完成"。
- [ ] 内联条记一条 → 同样立即进入提问。
- [ ] Inbox 列表行点进 → 提问（入口未失效）。
- [ ] Now 屏连续跳过 3 次 → re-clarify → Q2b 改挂 / 解除各走一遍。
- [ ] 项目详情：挂接后的行动出现在列表。

## 8. 风险文件与回滚点

- 高风险：`packages/db/src/queries/inbox.ts`（事务语义，re-clarify 三态）、
  `apps/mobile/lib/clarify-flow.ts`（状态机穷举）、
  `packages/core/src/domain/clarify.ts`（契约 + 穷举 switch 下游）。
- 每步独立可回滚（git revert 单 commit）；无 schema/迁移，整体回滚 = 分支回退。

## 9. 全量验证（完成前必跑）

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## 10. 收尾（Phase 3）

- [ ] spec 更新（Phase 3.3，必做）：`.trellis/spec/domain/domain-model.md`
  Clarify 决策表补 Q2b 分支 + "挂接跳过 Q3–Q5（v1 互斥）"规则 + re-clarify
  经 Q2b 改挂/解除；`NextAction` 的 value 继承注明覆盖挂接路径。
- [ ] commit（PRD/design 工件 + 代码 + spec）。
- [ ] `task.py` 归档前 validate。
