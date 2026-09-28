# 实施计划 — owner token 首连自动申领

## 有序清单

### 1. server/app（先做——客户端依赖其 API 行为）

- [ ] `src/owner-token.ts`：
  - `resolveOwnerToken` 第三分支 → `{ token: null, source: 'unclaimed' }`（不写文件）；**删除** `printFirstRunBanner` 与启动时 `randomBytes` 生成路径；`persistToken` / `readExistingToken` 保留（claim 复用）；类型 `OwnerTokenResolution.token: string | null`；
  - 新增 `claimOwnerToken(env?)`：env 显式 → `{claimed:false, reason:'explicit'}`；文件非空 → `{claimed:false, reason:'file'}`；否则生成 64-hex + `persistToken` → `{claimed:true, token}`。
- [ ] `src/index.ts`：unclaimed 时日志「owner token unclaimed — first device to POST /claim mints it (or set NEXTDO_OWNER_TOKEN)」；`createApp` 传 `ownerToken: null` + source。
- [ ] `src/auth.ts`：`requireOwnerToken(expected: string | null)`——`null` → 一律 401（响应形状不变）。
- [ ] `src/app.ts`：`createApp` 参数扩为 `ownerToken: string | null` + `ownerTokenSource`（或等价形状，保持既有测试可调）；内部**闭包变量**持当前 token；新路由 `POST /claim`（无鉴权中间件）：调 `claimOwnerToken()`，成功 → 更新闭包 + `logger.info`（**不含 token**）+ `200 { token }`；失败 → `409 { error: 'owner-token.claimed', code: 'owner-token.claimed', reason }`。
- [ ] `src/logger.ts`：删除「唯一特许例外（首启横幅）」注释段（token 从此不入日志）。
- [ ] 单测：
  - `owner-token.test.ts`：原「无 env 无文件 → 生成 + 写文件 + 横幅」用例改为「→ unclaimed（token null、无文件、无输出）」；新增 `claimOwnerToken` 三态（未申领 200 等价 + 持久化 + 二次调用变 file 409 等价 / 已申领 file / env explicit）；
  - `app` 路由测试（credentials.test.ts 或新 claim.test.ts）：未申领态 `/credentials`、`/upload` 任意 Bearer → 401；`POST /claim` 200（64-hex）→ 同进程内 `/credentials` + 该 token → 200；再次 `/claim` → 409 reason file；env token → 409 reason explicit 且永不返回该 token；CORS preflight 覆盖 `/claim`。

### 2. packages/db

- [ ] `src/powersync.ts`（与 `fetchCredentialsOnce` 同域）：`claimOwnerTokenOnce(config)` → `POST {backendUrl}/claim`；200 body `token` 非空 string → `{ok:true, token}` 否则 `{ok:false, kind:'invalid'}`；409 → `{ok:false, kind:'claimed', reason: body.reason ?? 'file'}`；其余 → `{ok:false, kind:'network'}`。
- [ ] `src/index.ts` 导出 `claimOwnerTokenOnce` + `ClaimOutcome`。
- [ ] 单测（仿 `fetch-credentials-once.test.ts` 的 fetch mock 模式）：200 正常 / 200 畸形（缺 token、空串、非 string）/ 409 带 reason / 409 无 reason / 网络错 / 5xx。

### 3. apps/mobile

- [ ] `hooks/use-cloud-sync.ts`：`connect` 删除「token 不能为空」分支；token trim 后为空 → `claimOwnerTokenOnce(config)`：ok → `setStoredBackendConfig` → `setOwnerToken(claimed.token)`（顺序不变）；`kind:'claimed'` → `{ok:false, message:'服务器已有 token，请手动输入'}`；network → 「连不上服务器，请稍后重试」；token 非空路径零改动。头注释更新。
- [ ] `app/(tabs)/settings.tsx`：`canSubmit` = 两地址 trim 非空 && !submitting（token 不再必填）；token 输入 placeholder 改「owner token（首次连接可留空，自动获取）」；其余两态不变。
- [ ] 测试（settings-screen.test.tsx）：mock 补 `claimOwnerTokenOnce`（可控返回）；
  - 新：地址合法 + token 留空 + claim 200 → config 与 claimed token 双落存储 → 已连接；
  - 新：claim 409 → 内联「服务器已有 token，请手动输入」、存储双空、token 输入仍在；随后手填 token 重提交走 fetchCredentialsOnce 成功；
  - 新：claim network → 「连不上服务器，请稍后重试」；
  - 改：原「token 空提交 → token 不能为空」用例删除/替换（空 token 现在是合法提交，走 claim）；
  - 既有三态/预填/断开用例：给原「只填 token」的用例补地址（canSubmit 变化）。
- [ ] 其余 mock `@nextdo/db` 的测试文件：`claimOwnerTokenOnce` 非 provider/预校验路径所读，无需补（grep 确认无引用即可）。

### 4. 文档与规范

- [ ] `server/deploy/.env.example`：`NEXTDO_OWNER_TOKEN` 注释改两条路——A) 显式；B) 留空 → 首台设备连接时经 `POST /claim` 自动申领（**不再打印日志**）；已连接设备后建议改 A。
- [ ] `server/deploy/README.md`：「The owner token — two ways」重写（显式 / 首连自动申领；删「docker compose logs api 看横幅」段）；Operations 加「**现有部署迁移到新流程**：清空 env + `rm ./data/owner-token` + 重启（服务器需先部署含 claim 的代码）」。
- [ ] `.trellis/spec/`：grep「banner / FIRST RUN / 一次性日志」相关描述并更新（logger 例外已删）；`database-guidelines` 若无存储变化则不动（同一 key/文件，确认即可）。

### 5. 回归

- [ ] 根级 `pnpm test && pnpm typecheck && pnpm lint` 全绿。
- [ ] `node e2e/sync-roundtrip.ts` 7/7（env 路径，预期零改动）。
- [ ] `pnpm --filter @nextdo/desktop run build` 成功。
- [ ] 本机 docker 实跑（可选但推荐，同上次 R7 验证手法）：空 token 起生产 compose → `curl -X POST 127.0.0.1:8787/claim` → 200 64-hex；二次 409；`/credentials` + token → 200；重启 api → 文件复用、claim 409。验证后拆栈清现场。
- [ ] 实机（用户 Mac，交付提示）：重置后的服务器 + 新构建 → 设置页只填地址、token 留空 → 连接成功。

## 验证命令

```bash
pnpm test && pnpm typecheck && pnpm lint
node e2e/sync-roundtrip.ts
pnpm --filter @nextdo/desktop run build
grep -rn "FIRST RUN\|AUTO-GENERATED" server/ .trellis/spec/ || echo "banner gone"
```

## 风险文件与回滚点

| 文件 | 风险 | 回滚点 |
| ---- | ---- | ------ |
| `server/app/src/owner-token.ts` | R7 行为变更（启动不再生成）+ claim 新逻辑，单测面大 | 步骤 1 独立提交，可单独 revert（客户端未接前无外部影响） |
| `server/app/src/app.ts` | createApp 签名扩展 + 闭包可变 token，既有路由测试依赖 | 签名保持向后兼容（string \| null），测试调整随本步 |
| `use-cloud-sync.ts` | connect 流程分叉（claim vs credentials），文案先例敏感 | 与 settings 测试同提交；回滚 = 该提交 revert |

提交拆分（conventional commits，中间态全绿）：
1. `feat(server): one-time owner-token claim endpoint (POST /claim) + unclaimed boot`
2. `feat(db): claimOwnerTokenOnce — one-time token bootstrap call`
3. `feat(mobile): optional token in Settings — auto-claim on first connect`
4. `docs: first-connect token claim (env.example, README, spec cleanup)`
5. `docs(trellis): claim-owner-token task artifacts`（任务目录 + 如有 spec 更新并入 4）

## task.py start 前检查

- [ ] implement.jsonl / check.jsonl 已注入真实条目；
- [ ] 根级 gate 绿基线确认；
- [ ] 用户批准最新规划摘要。
