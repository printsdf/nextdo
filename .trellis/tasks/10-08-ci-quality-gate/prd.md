# 自动化 CI 质量门禁与工程规范

## Goal

为 Nextdo 项目配置 GitHub Actions 持续集成（CI）自动化质量门禁，覆盖全 monorepo 的 ESLint、TypeScript 类型检查和单元测试；并理顺主干分支同步流程，杜绝未经验证的代码合入。

## Requirements

1. **GitHub Actions CI 工作流 (`.github/workflows/ci.yml`)**：
   - 触发条件：
     - `push` 到 `main` 分支
     - `pull_request` 目标为 `main` 分支
     - 允许手动 `workflow_dispatch` 触发
   - 环境版本对齐：
     - Node.js 22（与 `package.json` engines 以及 `release.yml` 对齐）
     - pnpm 12.5.1（与 `packageManager` 及 `release.yml` 对齐）
   - 门禁步骤（支持并行化或清晰分区）：
     - `pnpm lint`（代码风格与 ESLint）
     - `pnpm typecheck`（各 package 及 mobile/server 的严格 TypeScript 检查）
     - `pnpm test`（全量近 900 个 Jest 单元测试）
   - 缓存加速：开启 `pnpm store` 缓存机制，避免重复全量下载。

2. **主干分支状态核验与对齐规范**：
   - 核验当前 `release/v0.1.3-beta.2` 上的提交与 `main` 的差异。
   - 保证主干可以平滑快进或通过标准 PR 合入，更新 backlog 标记。

## Acceptance Criteria

- [x] `.github/workflows/ci.yml` 创建完成，语法及 Action 配置有效。
- [x] CI 配置中的 Node 及 pnpm 版本与现有 `package.json` / `release.yml` 完全一致。
- [x] 本地预演 `pnpm lint`、`pnpm typecheck`、`pnpm test` 全部通过，无破损。
- [x] `.trellis/backlog.md` 中对应的待办条目状态完成更新。
