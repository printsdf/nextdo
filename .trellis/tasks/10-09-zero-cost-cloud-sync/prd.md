# PRD: 零成本多端云同步与免源码极简接入

## 背景与问题

Nextdo 定位为 Local-First 的个人 GTD 与习惯管理工具，支持多端数据实时双向同步。在之前的部署方案中，用户需要具备自建 VPS、Docker 容器或本地 Node.js 开发环境，并通过命令行执行迁移和启动。

然而，真实的终端用户行为模式是：
1. **只下载安装包**：在 macOS 上安装 `.dmg`，在 Android 手机上安装 `.apk`。
2. **本地无开发环境**：没有 Git、Node.js、pnpm 或 Docker，也不会克隆源代码仓库。
3. **获取信息渠道单一**：仅阅读 GitHub 首页的 `README.md` 或 App 设置页内的说明。

若要求用户下载源码、配置本地环境变量或在数据库 SQL 编辑器中手动跑 DDL 建表，会导致极高的流失率。

---

## 目标与交付物

为普通用户提供一个**“零成本、纯网页、免源码、零终端”**的多端云同步闭环：

1. **零成本纯网页云架构**：
   - 数据库：Neon 免费 PostgreSQL 实例（500MB，支持逻辑复制）。
   - 同步流引擎：PowerSync Cloud 免费套餐（每月 2GB 同步流量，50 并发连接）。
   - 后端 API：Cloudflare Workers 免费套餐（每天 10 万次请求，Serverless 边缘部署）。

2. **数据库全自动建表自举**：
   - 用户无需在 Neon SQL Editor 执行任何建表 SQL。
   - Cloudflare Worker 接收到首次 HTTP 请求时，自动执行 DDL 迁移创建全部 14 张核心业务表、索引及逻辑复制 Publication。

3. **首台设备免密自动认领 (Auto-Claim)**：
   - 服务端首次部署处于未认领状态；
   - 客户端（DMG 或 APK）直接在主输入框填入 Worker 网址并点击连接；
   - 客户端自动向 `/claim/claim` 发起免密握手，由服务端生成高强度令牌并持久化，客户端自动存储令牌并获取 PowerSync 同步端点。

4. **单文件代码极简分发**：
   - 在仓库提供独立单文件脚本 [`server/deploy/worker.js`](./server/deploy/worker.js)，用户在 GitHub 网页右上角点击「Copy raw file」即可一键复制。
   - 在 `.github/workflows/release.yml` 发布流水线中增加 `build-worker` 任务，自动打包生成 `worker.js` 并作为 Release 附件随 DMG/APK 同步发布。

5. **App 客户端沉浸式引导**：
   - 在 App 设置页的「云同步」卡片中提供「📖 查看 3 分钟零成本多端云同步教程」直达链接，一键唤起系统默认浏览器。
   - 针对首台设备与多端扫码配对提供傻瓜式引导，消除 Token 认知门槛。

---

## 验收标准

1. **自动化建表与就绪**：直接在浏览器访问部署好的 Worker URL，返回 200 JSON 状态面板，数据库 14 张表已初始化。
2. **客户端自适应接入**：用户在默认「连接串配对」输入框直接粘贴 Worker URL，连接按钮即时启用，点击后自动免密认领并进入「已连接」状态。
3. **多端扫码配对**：首台设备连接后展示「扫码配对」二维码与「复制连接串」按钮；第二台设备扫码或粘贴即可直接连接。
4. **单文件随版本发布**：Release 流水线自动生成 `worker.js` 资产，与桌面安装包和 Android APK 共同发布。
5. **测试与质量**：
   - `server/app` 单元测试全部通过（含 `worker.test.ts`、`claim.test.ts`、`upload.test.ts`）。
   - `apps/mobile` 设置页测试全部通过（42/42 通过）。
   - 全工作区类型检查与代码检查无报错。
