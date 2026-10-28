# NocoMonitor

[English](../README.md) | 简体中文

NocoMonitor 是基于 [NocoBase 3](https://www.nocobase.com) 构建的开源 AI 原生可用性监控系统。它全天候检查你的服务，一旦失败立即创建事件，并由 Agent 查找原因：你看到的是根本原因，而不只是一个红点。在你允许的范围内，Agent 还可以申请修复。Agent 提建议，探测来验证。

## 功能

- **全天候检查。** 按你设定的频率做 HTTP 状态码、关键字和 JSON 检查，提供响应时间图表和 90 天可用率。
- **事件自动创建。** 连续失败自动创建事件，恢复后自动解决，时间线记录每一次检查和进展。
- **Agent 查找原因。** 阅读检查记录、对比该服务的其他监控项、重新探测并查看服务代码，然后在事件上记录根本原因、置信度和后续步骤。
- **在护栏内修复。** 每个服务列出它允许的固定 HTTP 调用，比如部署钩子或重启接口。每个监控项决定 Agent 能走多远：仅诊断、建议、审批后修复或自动修复。是否修好由探测判断而不是 Agent；无效的修复会交回给人处理。
- **公开状态页。** 公开你选定服务的健康状况，只显示你标记为公开的事件和进展。
- **代码归你。** 开源、自托管，是一个可以让编程 Agent 直接修改的 NocoBase 3 应用。

## 快速开始

### 1. 安装

**交给编程 Agent。** 在要安装 NocoMonitor 的目录打开 Claude Code、Codex 或 Cursor，发给它：

```text
Install NocoMonitor from https://github.com/gchust/NocoMonitor and start it, following its AGENTS.md and README.
```

**手动安装。** 需要 Node.js 24 或更高版本，以及 pnpm 11（`corepack enable`）。默认数据存放在 SQLite 文件中，也支持 PostgreSQL。

```bash
git clone https://github.com/gchust/NocoMonitor.git
cd NocoMonitor
pnpm install
pnpm nocobase config init --dialect sqlite
pnpm dev
```

### 2. 登录

打开 `pnpm dev` 输出的 `Local:` 地址，通常是 `http://127.0.0.1:13000/main/`，用户名 `nocobase`，密码 `admin123`。对外开放前请先修改密码。

### 3. 添加要监控的服务

新安装默认已在监控 [NocoBase 解决方案演示站](https://solutions.nocobase.com/crm/)（NocoCRM、NocoITAM 和 NocoReach），作为示例。在**服务**和**监控项**中添加你自己的服务，在**状态页**中发布公开页面。

### 4. 连接 Agent

AI 诊断运行在运行环境上：一台已登录 Claude Code 或 Codex 的机器。在 **Agent 管理 → 运行环境**中连接，在 **Agent** 中启用一个 Agent，再到 **AI 诊断**中选择它。不连接也能使用其他所有功能。运行环境拥有所在机器的完整权限，请使用专用机器或虚拟机。

## 开发

NocoMonitor 是一个 NocoBase 3 应用：编程 Agent 或你自己，都从 [AGENTS.md](../AGENTS.md) 开始。

## 许可证

[Apache License 2.0](../LICENSE)
