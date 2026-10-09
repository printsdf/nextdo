# Nextdo

> **行动先于计划，清空大脑，进入心流。**  
> 一款以 GTD（Getting Things Done）心流哲学与执行力为核心的开源个人任务与习惯助手，支持 macOS、Android、iOS、Windows 与 Web。

---

## 快速下载与安装

无需编译源码，直接前往 [GitHub Releases](https://github.com/printsdf/Nextdo/releases) 下载对应平台的安装包：

| 平台 | 下载文件 | 说明 |
| :--- | :--- | :--- |
| **macOS** | `Nextdo-x.x.x.dmg` | 支持 Apple Silicon (M系列) 与 Intel 架构 |
| **Android** | `Nextdo-x.x.x.apk` | 适用于 Android 8.0 及以上版本手机与平板 |
| **Windows / Web** | 见 Releases 列表 | 即开即用 |

---

## 核心特色

- 🧠 **清空大脑 (Inbox)**：随时捕获灵感与杂务，无需立即分类，保留心流状态。
- ⚡ **下一步行动 (Next Actions)**：将模糊的目标分解为最小可执行的物理动作。
- 🎯 **聚焦与专注 (Focus Mode)**：全屏极简专注倒计时，排除一切干扰。
- 🔄 **循环习惯 (Habits)**：培养 21 天微习惯，记录执行轨迹。
- 📅 **日历与提醒 (Calendar & Reminders)**：智能时间窗与系统级通知，到时精准触发。
- 🛡️ **本地优先 (Local-First)**：离线秒开，数据始终存储于你的本地设备。

---

## 多端云同步（零成本·纯网页搭建·无需下载源码）

Nextdo 支持多设备之间实时自动双向同步。我们设计了**极简云同步架构**，利用各大云平台的永久免费套餐，普通用户在**网页浏览器中点几下即可完成搭建**：

> **✨ 为什么极简？**
> 1. **无需下载源代码**：全部在云平台网页控制台中操作，无需安装 Node.js、Git 或在本地打开终端。
> 2. **数据库全自动建表**：无需在数据库 SQL Editor 中复制执行任何建表脚本，服务首次启动自动初始化全部 14 张表与索引。
> 3. **客户端只需填写 Workers 网址**：打开 App「设置」粘贴你的 Workers 网址点击连接，系统自动免密绑定并下发同步端点，无需寻找 Token，无需手动填写 PowerSync 地址！
> 4. **多端扫码即连**：首台设备连接后，手机直接扫码电脑屏幕即可一键加入同步。

### 极简搭建三步走（总耗时约 3~5 分钟）

```
[免费 PostgreSQL (Neon)]  +  [免费流引擎 (PowerSync)]  +  [免费 API (Cloudflare Workers)]
         └──────────────────────────┬────────────────────────────┘
                                    ▼
                   在 Nextdo App 中仅需填写 Workers 网址！
```

#### 第一步：创建免费数据库（推荐 Neon，无需建表）
1. 访问 [Neon 官网](https://neon.tech/)，使用 GitHub 登录并创建免费项目。
2. 在 **Project Settings** 中，开启 **Logical Replication**（勾选开启即可）。
3. 复制连接字符串（格式形如 `postgresql://user:pass@ep-xyz.aws.neon.tech/neondb?sslmode=require`）。
> 💡 *无需在数据库中执行任何建表 SQL！后续步骤中后端会自动建表。*

#### 第二步：创建免费 PowerSync 同步流引擎
1. 访问 [PowerSync 官网](https://powersync.com/) 注册并创建免费实例（Free Plan）。
2. **连接数据库**：粘贴第一步获取的 Neon 连接字符串，测试连接。
3. **部署同步规则 (Sync Rules)**：在左侧进入 **Sync Rules**，将下方规则复制粘贴进去，点击 **Deploy**：
   ```yaml
   config:
     edition: 3
   streams:
     all:
       auto_subscribe: true
       queries:
         - SELECT id, created_at, updated_at, deleted_at, title, captured_at FROM inbox_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, outcome, value, status FROM projects WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, project_id, context_ids, est_minutes, value, category, due_date, deadline, depends_on_id, window_start, window_end, window_days, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at, status, source_inbox_id, replaces_action_id FROM next_actions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, waiting_on, expected_by, follow_up_at FROM waiting_for_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, starts_at, context_ids, est_minutes, value, category, deadline, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at, status, source_inbox_id, replaces_action_id FROM calendar_actions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, note FROM someday_maybe_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, url, note FROM reference_items WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, name FROM contexts WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, title, action_title, est_minutes, value, category, project_id, window_start, window_end, window_days, cycle_days, started_at, status FROM habits WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, habit_id, local_date, status, snoozed_until, last_snoozed_at, consecutive_skips, last_skipped_at FROM habit_days WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_kind, action_id, fires_at, intensity, state FROM reminders WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_id, action_kind, mode, planned_minutes, started_at, paused_sec, ended_at, status FROM focus_sessions WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, kind, at, snapshot, answers FROM review_records WHERE deleted_at IS NULL
         - SELECT id, created_at, updated_at, deleted_at, action_kind, action_id, completed_at, est_minutes FROM completion_records WHERE deleted_at IS NULL
   ```
4. **设置 JWT 认证**：在控制台的 **Authentication** 中选择 **HS256**，随便输入一串自定义密钥（例如 32 位随机字符），保存。
5. **记录 Instance URL**：复制分配给你的端点（例如 `https://xxxx.powersync.journeyapps.com`）。

#### 第三步：部署 Cloudflare Workers 后端（纯网页在线粘贴，无需安装任何工具）
1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/)，在 **Workers & Pages** 中点击 **Create application** -> **Create Worker**（名称可填 `nextdo-server`，点击 **Deploy**）。
2. 在该 Worker 详情页进入 **Settings** -> **Variables and Secrets**，添加以下 3 个变量（点击 **Add**，类型选择 Secret 或 Text）：
   - `DATABASE_URL`：步骤一中获取的 Neon 数据库连接串（类型选 **Secret**）
   - `JWT_SECRET`：步骤二中填写的 JWT 密钥（类型选 **Secret**）
   - `NEXTDO_SYNC_ENDPOINT`：步骤二中复制的 PowerSync Instance URL（类型选 **Text**）
3. **复制代码并一键部署**：
   - 在 Worker 页面右上角点击 **Edit Code**（进入 Cloudflare 在线网页代码编辑器）；
   - 点击打开 [👉 **server/deploy/worker.js**](https://github.com/printsdf/Nextdo/blob/main/server/deploy/worker.js)（或在 [Releases](https://github.com/printsdf/Nextdo/releases) 附件中下载 `worker.js`），在页面右上角点击 **Copy raw file** 按钮复制全部代码；
   - 切换回 Cloudflare 网页编辑器，全选覆盖并粘贴，点击右上角 **Deploy**！
4. 复制分配给你的 Worker 网址（形如 `https://nextdo-server.<你的用户名>.workers.dev`）。

> 💡 **无需手动建表**：在浏览器中直接访问该 Worker 网址，系统将自动连接 Neon 完成全部 14 张表的创建，并展示漂亮的就绪状态面板！

> 📖 想要查看更详细的图文部署指南与高级技巧？请参阅 [零成本免费云同步完整部署指南](./server/deploy/FREE_CLOUD_DEPLOY.md)。
> 🖥️ 如果你拥有一台 Linux VPS 并喜欢 Docker，可直接使用单机一键式 Docker 部署：[Docker 部署文档](./server/deploy/README.md)。

---

## 在 Nextdo App 中开启同步

当你完成上述步骤得到 Worker 网址后，即可在已安装的应用中开启多端同步：

### 1. 首台设备连接（如 Mac 电脑上的 dmg 应用）
1. 打开 Nextdo 应用，点击底部导航栏的 **设置**。
2. 在 **云同步** 区域的输入框中，直接填入你的 **Workers 网址**（例如 `https://nextdo-server.xyz.workers.dev`）。
3. 点击 **连接**：
   - 系统将自动与服务器握手并完成首台设备免密绑定；
   - 自动获取流端点并开启实时数据同步，界面显示 **已连接**！

### 2. 后续设备配对（如手机上的 apk 应用）
1. 在已连接的首台设备（Mac 电脑）上，点击 **扫码配对** 或 **复制连接串**。
2. 在第二台设备（手机）打开 Nextdo 设置：
   - 用手机摄像头扫码，或直接粘贴连接串，点击 **连接** 即可瞬间加入同一数据账本！

---

## 常见问题

<details>
<summary><b>Q: 我需要付费吗？</b></summary>
完全不需要。Neon、PowerSync Cloud 和 Cloudflare Workers 均提供非常充裕的永久免费配额（每天 10 万次请求、每月 2GB 同步流量），对个人或家庭日常 GTD 使用绰绰有余。
</details>

<details>
<summary><b>Q: 为什么我不需要在数据库里建表？</b></summary>
Nextdo 服务端内置了自动迁移机制。当 Worker 首次接收到连接请求时，会自动执行建表逻辑，创建所需的 14 张业务表和相关索引。
</details>

<details>
<summary><b>Q: 数据是安全的吗？</b></summary>
数据完全存储在你自己的私有 PostgreSQL 数据库和你的本地设备上，没有任何第三方中心服务器收集你的任务或个人隐私。
</details>

---

## License

[MIT License](./LICENSE)
