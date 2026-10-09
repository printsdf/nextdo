# Implementation Plan: 零成本多端云同步与免源码极简接入

## 1. 任务清单

- [x] **服务端边缘运行时支持**：
  - [x] 创建 `server/app/src/worker.ts`，导出 Cloudflare Workers fetch 处理函数。
  - [x] 创建 `server/app/src/schema-init.ts`，实现自动创建 14 张核心表与 publication 的幂等迁移。
  - [x] 在 `server/app/src/app.ts` 增加 `/` 和 `/health` 端点，访问时触发建表检查与状态输出。
  - [x] 创建 `server/app/src/init-db.ts` 与 `package.json` 的 `bundle:worker` 命令。
  - [x] 编写 `server/app/test/worker.test.ts` 单元测试。

- [x] **单文件 Worker 发布与分发**：
  - [x] 在 `server/deploy/worker.js` 提供编译打包后的单文件产物。
  - [x] 在 `.github/workflows/release.yml` 增加 `build-worker` 阶段，构建并上传 `worker.js` 至 GitHub Releases。

- [x] **客户端自适应与引导体验**：
  - [x] 在 `apps/mobile/app/(tabs)/settings.tsx` 中增加 `isPlainHttpUrl` 智能网址检测。
  - [x] 在默认配对模式下支持直接粘贴 Workers 网址触发免密认领。
  - [x] 引入 `Linking.openURL` 添加「📖 查看 3 分钟零成本多端云同步教程」直达按钮。
  - [x] 优化 Token 指引文案，消除首台与后续设备的理解门槛。
  - [x] 更新 `apps/mobile/__tests__/settings-screen.test.tsx` 补充测试用例并全部通过。

- [x] **文档保姆级优化（针对纯终端用户）**：
  - [x] 编写主 `README.md`，提供零源码、纯网页 3 分钟免费部署全流程与直链。
  - [x] 更新 `server/deploy/FREE_CLOUD_DEPLOY.md`，将本地命令行收敛为附录，确保纯网页操作闭环。

---

## 2. 验证命令

```bash
# 1. 移动与桌面端测试
pnpm --filter mobile test settings-screen.test.tsx

# 2. 服务端测试
pnpm --filter @nextdo/server test

# 3. 静态类型检查
pnpm --filter mobile typecheck
pnpm --filter @nextdo/server typecheck

# 4. 全局测试验证
pnpm test
```
