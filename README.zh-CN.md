# Work Please

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 简体中文

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=bugs)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please)
[![codecov](https://codecov.io/gh/pleaseai/work-please/graph/badge.svg?token=do858Z1lsI)](https://codecov.io/gh/pleaseai/work-please)

Work Please 将问题追踪器中的任务转化为隔离的自主实现运行 —— 管理工作而非监督编码代理。

> **警告**：Work Please 是一个工程预览版，仅适用于受信任的环境。

## 目录

- [概述](#概述)
- [与 Symphony 的主要区别](#与-symphony-的主要区别)
- [功能](#功能)
- [架构](#架构)
- [快速开始](#快速开始)
  - [前置条件](#前置条件)
  - [安装](#安装)
  - [配置](#配置)
  - [运行](#运行)
- [WORKFLOW.md 配置](#workflowmd-配置)
  - [完整 Front Matter 模式](#完整-front-matter-模式)
  - [模板变量](#模板变量)
- [仓库级工作流覆盖](#仓库级工作流覆盖)
  - [工作原理](#工作原理)
  - [覆盖规则](#覆盖规则)
  - [示例](#示例-1)
- [CLI 用法](#cli-用法)
- [GitHub App 认证](#github-app-认证)
  - [设置 GitHub App 凭据](#设置-github-app-凭据)
  - [验证](#验证)
- [信任与安全](#信任与安全)
  - [权限模式](#权限模式)
  - [工作区隔离](#工作区隔离)
  - [建议](#建议)
- [许可证](#许可证)

## 概述

Work Please 是一个长期运行的 TypeScript 服务，它：

1. 从问题追踪器（GitHub Projects v2 或 Asana）中轮询已配置的活跃状态任务。
2. 为每个符合条件的问题创建隔离的工作区目录。
3. 在该工作区中使用渲染后的提示词启动 Claude Code 代理会话。
4. 监控会话，处理重试，并在每个轮询周期中协调问题状态。

它是 [Symphony 规范](vendor/symphony/SPEC.md) 的 TypeScript 实现，
适配了 GitHub Projects v2 / Asana 和 Claude Code（取代 Linear 和 Codex）。

完整技术详情请参阅 [SPEC.md](SPEC.md)。

## 与 Symphony 的主要区别

| | Symphony（参考实现） | Work Please |
|---|---|---|
| 问题追踪器 | Linear | GitHub Projects v2 & Asana（开发中） |
| 编码代理 | Codex（app-server 模式） | Claude Code CLI |
| 语言 | Elixir/OTP | TypeScript + Bun |
| 追踪器认证 | `LINEAR_API_KEY` | `GITHUB_TOKEN`、GitHub App 凭据或 `ASANA_ACCESS_TOKEN` |
| 项目配置 | `project_slug` | `owner` + `project_number`（GitHub Projects v2）或 `project_gid`（Asana） |
| 问题状态 | Linear 工作流状态 | GitHub Projects v2 Status 字段 / Asana 分区 |
| 代理协议 | JSON-RPC over stdio | `@anthropic-ai/claude-agent-sdk` |
| 权限模型 | Codex 审批/沙箱策略 | Claude Code `--permission-mode` |

## 功能

- **多追踪器支持** —— 从 GitHub Projects v2 项目或 Asana 任务（开发中）按固定周期分发工作。
- **GitHub App 认证** —— 使用 GitHub App 安装令牌（`app_id` + `private_key` + `installation_id`）
  代替 PAT 认证 GitHub 追踪器，获得精细的权限控制和更高的 API 速率限制。
- **负责人和标签过滤** —— 按负责人和/或标签过滤符合条件的问题。每个过滤器内的多个值使用
  OR 逻辑；同时指定负责人和标签过滤器时使用 AND 组合。仅在分发时适用——已运行的问题不受影响。
  在 `WORKFLOW.md` 中按追踪器配置。
- **隔离工作区** —— 每个问题使用专用目录；工作区在运行间持久保留。
- **`WORKFLOW.md` 配置** —— 将代理提示词和运行时设置与代码一起进行版本管理。
- **有界并发** —— 支持全局和按状态的并发代理限制。
- **退避重试** —— 失败时使用指数退避；正常退出时执行短暂的继续重试。
- **动态配置重载** —— 编辑 `WORKFLOW.md` 后无需重启服务即可应用更改。
- **工作区钩子** —— 在 `after_create`、`before_run`、`after_run` 和 `before_remove`
  生命周期事件中运行 shell 脚本。
- **仓库级工作流覆盖** —— 目标仓库可以提供自己的 `WORKFLOW.md` 来自定义代理配置和提示词模板。
  在全局工作流中通过 `repo_overrides: true` 启用。服务级别设置（tracker、polling、workspace）
  永远不会被覆盖。
- **结构化日志** —— 提供稳定的 `key=value` 格式的操作员可见日志。
- **可选 HTTP 仪表板** —— 使用 `--port` 启用，查看运行时状态和 JSON API。

## 架构

```
WORKFLOW.md
    |
    v
Config Layer ──> Orchestrator ──> Workspace Manager ──> Agent Runner (Claude Code)
                     |                                         |
                     v                                         v
           Issue Tracker Client                       Isolated workspace/
          (GitHub GraphQL API or                      per-issue directory
          Asana REST API,
          polling + reconciliation)
                     |
                     v
               Status Surface（可选 HTTP 仪表板 / 结构化日志）
```

组件：

- **Workflow Loader** —— 解析 `WORKFLOW.md` YAML front matter 和提示词模板正文。
- **Config Layer** —— 提供带环境变量间接引用和默认值的类型安全 getter。
- **Issue Tracker Client** —— 获取候选问题，协调运行中的问题状态。支持 GitHub
  Projects v2（GraphQL API）和 Asana（REST API）适配器。
- **Orchestrator** —— 拥有内存中状态；驱动轮询/分发/重试循环。
- **Workspace Manager** —— 创建、复用和清理每个问题的工作区；运行钩子。
- **Agent Runner** —— 启动 Claude Code，将事件流式传输回 Orchestrator。
- **Status Surface** —— 用于操作员可见性的可选终端视图和 HTTP API。

完整规范请参阅 [SPEC.md](SPEC.md)。

## 快速开始

### 前置条件

- **Bun**（安装：[bun.sh](https://bun.sh)）
- **Claude Code CLI**（参阅[官方安装指南](https://docs.anthropic.com/en/docs/claude-code)）
- **GitHub 令牌**（`GITHUB_TOKEN`）—— 需要对目标项目有访问权限，**或** **GitHub App 凭据**
  （`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_INSTALLATION_ID`）—— 参阅 [GitHub App 认证](#github-app-认证)，
  **或** **Asana 访问令牌**（`ASANA_ACCESS_TOKEN`）（开发中）

### 安装

```bash
git clone https://github.com/pleaseai/work-please.git
cd work-please
bun install
bun run build
```

### 配置

在目标仓库中创建 `WORKFLOW.md`。以下展示两个示例。
实际使用示例请参阅[示例 WORKFLOW.md](https://github.com/pleaseai/workflow/blob/main/WORKFLOW.md)。

#### GitHub Projects v2（PAT）

实际使用示例请参阅[示例 GitHub Project](https://github.com/orgs/pleaseai/projects/2)。

```markdown
---
tracker:
  kind: github_projects
  api_key: $GITHUB_TOKEN
  owner: your-org
  project_number: 42
  active_statuses:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:
    - Human Review

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 默认: [project, local, user]; SDK 隔离模式设为 []
  turn_timeout_ms: 3600000
---

你正在处理 `your-org/your-repo` 仓库的 GitHub 问题。

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
阻塞项：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
这是第 #{{ attempt }} 次尝试。继续之前请检查工作区中的现有工作。
{% endif %}

你的任务：
1. 理解问题需求。
2. 实现请求的更改。
3. 根据需要编写或更新测试。
4. 创建 Pull Request 并将此问题移至 `Human Review`。
```

#### GitHub Projects v2（GitHub App）

使用 GitHub App 凭据代替 PAT，获得精细的权限控制和更高的 API 速率限制：

```markdown
---
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
  active_statuses:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:
    - Human Review

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 默认: [project, local, user]; SDK 隔离模式设为 []
  turn_timeout_ms: 3600000
---

你正在处理 `your-org/your-repo` 仓库的 GitHub 问题。

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
阻塞项：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
这是第 #{{ attempt }} 次尝试。继续之前请检查工作区中的现有工作。
{% endif %}

你的任务：
1. 理解问题需求。
2. 实现请求的更改。
3. 根据需要编写或更新测试。
4. 创建 Pull Request 并将此问题移至 `Human Review`。
```

#### Asana（开发中）

> **注意**：Asana 支持正在开发中。以下配置为预览版，可能会更改。

```markdown
---
tracker:
  kind: asana
  api_key: $ASANA_ACCESS_TOKEN
  project_gid: "1234567890123456"
  active_sections:
    - In Progress
  terminal_sections:
    - Done
    - Cancelled

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 默认: [project, local, user]; SDK 隔离模式设为 []
  turn_timeout_ms: 3600000
---

你正在处理项目的 Asana 任务。

任务：{{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
阻塞项：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
这是第 #{{ attempt }} 次尝试。继续之前请检查工作区中的现有工作。
{% endif %}

你的任务：
1. 理解任务需求。
2. 实现请求的更改。
3. 根据需要编写或更新测试。
4. 创建 Pull Request 并将此任务移至审查分区（例如 `Human Review`）。
```

### 运行

```bash
# 设置追踪器令牌（GitHub PAT）
export GITHUB_TOKEN=ghp_your_token_here
# 或（GitHub App）
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
# 或（Asana —— 开发中）
export ASANA_ACCESS_TOKEN=your_token_here

# 使用当前目录的 WORKFLOW.md 运行 Work Please
bunx work-please

# 或指定 WORKFLOW.md 路径
bunx work-please /path/to/WORKFLOW.md

# 在端口 3000 启用可选 HTTP 仪表板
bunx work-please --port 3000
```

## WORKFLOW.md 配置

`WORKFLOW.md` 是 Work Please 运行时行为的唯一事实来源。它将 YAML front matter
配置块与 Markdown 提示词模板正文组合在一起。

### 完整 Front Matter 模式

```yaml
---
tracker:
  kind: github_projects               # 必填: "github_projects" 或 "asana"

  # --- GitHub Projects v2 字段（kind == "github_projects" 时） ---
  api_key: $GITHUB_TOKEN              # 必填: 令牌或 $ENV_VAR
  endpoint: https://api.github.com   # 可选: 覆盖 GitHub API 基础 URL
  owner: your-org                     # 必填: GitHub 组织或用户登录名
  project_number: 42                  # 必填: GitHub Projects v2 项目编号
  project_id: PVT_kwDOxxxxx          # 可选: 项目节点 ID（跳过 owner+project_number 查找）
  active_statuses:                    # 可选: 默认 ["Todo", "In Progress", "Merging", "Rework"]
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:                  # 可选: 默认 ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:                   # 可选: 有审查活动时分发代理的状态。默认 ["Human Review"]
    - Human Review
  # GitHub App 认证（api_key 的替代方案 —— 三个字段必须同时提供）：
  # app_id: $GITHUB_APP_ID            # 可选: GitHub App ID（整数或 $ENV_VAR）
  # private_key: $GITHUB_APP_PRIVATE_KEY  # 可选: GitHub App 私钥 PEM 或 $ENV_VAR
  # installation_id: $GITHUB_APP_INSTALLATION_ID  # 可选: 安装 ID（整数或 $ENV_VAR）

  # --- Asana 字段（kind == "asana" 时） --- 开发中
  # api_key: $ASANA_ACCESS_TOKEN      # 必填: 令牌或 $ENV_VAR
  # endpoint: https://app.asana.com/api/1.0  # 可选: 覆盖 Asana API 基础 URL
  # project_gid: "1234567890123456"   # 必填: Asana 项目 GID
  # active_sections:                  # 可选: 默认 ["To Do", "In Progress"]
  #   - In Progress
  # terminal_sections:                # 可选: 默认 ["Done", "Cancelled"]
  #   - Done
  #   - Cancelled

  # --- 共用过滤器字段（两个追踪器通用） ---
  # filter:
  #   assignee: user1, user2          # 可选: CSV 或 YAML 数组；不区分大小写的 OR 匹配
  #                                   # （设置此过滤器时，未分配的问题将被排除）
  #   label: bug, feature             # 可选: CSV 或 YAML 数组；不区分大小写的 OR 匹配
  # 同时指定两个过滤器时使用 AND 组合。仅在分发时适用。

polling:
  interval_ms: 30000                  # 可选: 轮询间隔（ms），默认 30000

workspace:
  root: ~/work-please_workspaces        # 可选: 默认 <tmpdir>/work-please_workspaces

hooks:
  after_create: |                     # 可选: 工作区首次创建时运行一次
    git clone https://github.com/your-org/your-repo.git .
  before_run: |                       # 可选: 每次代理尝试前运行
    git pull --rebase
  after_run: |                        # 可选: 每次代理尝试后运行
    echo "Run completed"
  before_remove: |                    # 可选: 工作区删除前运行
    echo "Cleaning up"
  timeout_ms: 60000                   # 可选: 钩子超时（ms），默认 60000

agent:
  max_concurrent_agents: 10           # 可选: 全局并发限制，默认 10
  max_retry_backoff_ms: 300000        # 可选: 最大重试延迟（ms），默认 300000
  max_concurrent_agents_by_state:     # 可选: 按状态的并发限制
    in progress: 5

claude:
  command: claude                     # 可选: Claude Code CLI 命令，默认 "claude"
  effort: high                        # 可选: 推理深度 —— 'low'、'medium'、'high' 或 'max'。默认 'high'。
  permission_mode: acceptEdits        # 可选: 'default'、'acceptEdits' 或 'bypassPermissions'。默认 'bypassPermissions'。
  allowed_tools:                      # 可选: 限制可用工具
    - Read
    - Write
    - Bash
  setting_sources:                    # 可选: 要加载的文件系统设置。默认: [project, local, user]
    - project                         # 从工作区目录加载 .claude/settings.json + CLAUDE.md
    - local                           # 从工作区目录加载 .claude/settings.local.json
    - user                            # 加载 ~/.claude/settings.json + 全局 CLAUDE.md
                                      # 仅 "project"、"local"、"user" 有效 —— 其他值将被忽略
  turn_timeout_ms: 3600000            # 可选: 每轮超时（ms），默认 3600000
  read_timeout_ms: 5000               # 可选: 初始子进程读取超时（ms），默认 5000
  stall_timeout_ms: 300000            # 可选: 停滞检测超时，默认 300000
  settings:
    attribution:
      commit: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"  # 可选: 附加到 git 提交消息。默认为 Work Please 链接。
      pr: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"      # 可选: 附加到 PR 描述。默认为 Work Please 链接。

repo_overrides: true                  # 可选: 允许目标仓库通过自己的 WORKFLOW.md 覆盖工作流。
                                      # 默认: false（仓库 WORKFLOW.md 文件被忽略）。
                                      # 也可以使用对象进行精细控制:
                                      # repo_overrides:
                                      #   allow: [agent, claude, env, prompt_template]  # 限制仓库可以覆盖的部分

server:
  port: 3000                          # 可选: 在此端口启用 HTTP 仪表板
---

在此处编写提示词模板。可用变量：

- {{ issue.id }}           —— 追踪器内部问题 ID
- {{ issue.identifier }}   —— 人类可读标识符（如 "#42" 或任务 GID）
- {{ issue.title }}        —— 问题标题
- {{ issue.description }}  —— 问题正文/描述
- {{ issue.state }}        —— 当前追踪器状态名
- {{ issue.url }}          —— 问题 URL
- {{ issue.assignees }}     —— 负责人登录名（GitHub）或邮箱（Asana）数组
- {{ issue.labels }}       —— 标签字符串数组（已规范化为小写）
- {{ issue.blocked_by }}   —— 阻塞引用数组（每项包含 id、identifier、state）
- {{ issue.branch_name }}  —— PR 头分支名（PullRequest 项）或 null
- {{ issue.pull_requests }} —— 关联 PR 数组（每项包含 number、title、url、state、branch_name）
- {{ issue.review_decision }} —— PR 审查决定："approved"、"changes_requested"、"commented"、"review_required" 或 null
- {{ issue.priority }}     —— 数字优先级或 null
- {{ issue.created_at }}   —— ISO-8601 创建时间戳
- {{ issue.updated_at }}   —— ISO-8601 最后更新时间戳
- {{ attempt }}            —— 重试次数（首次运行时为 null）
```

### 模板变量

提示词模板使用 Liquid 兼容语法。所有 `issue` 字段均可使用：

```markdown
{{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

状态：{{ issue.state }}

{% if issue.blocked_by.size > 0 %}
阻塞项：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if issue.pull_requests.size > 0 %}
关联 Pull Request：
{% for pr in issue.pull_requests %}
- PR #{{ pr.number }}: {{ pr.title }} ({{ pr.state }}){% if pr.branch_name %} —— 分支: {{ pr.branch_name }}{% endif %}{% if pr.url %} —— {{ pr.url }}{% endif %}

{% endfor %}
{% endif %}

{% if attempt %}
重试次数：{{ attempt }}
{% endif %}
```

## 仓库级工作流覆盖

当管理跨多个仓库的 GitHub Projects v2 项目时，每个目标仓库可以提供自己的 `WORKFLOW.md`
来自定义代理行为 —— 无需更改全局配置。

### 工作原理

1. 运维人员的全局 `WORKFLOW.md` 启动服务并定义服务级别设置（tracker、polling、workspace）。
   必须包含 `repo_overrides: true` 才能启用此功能。
2. 当问题被分发时，Work Please 使用全局配置创建工作区（克隆/工作树）。
3. 工作区就绪后，Work Please 检查仓库根目录中的 `WORKFLOW.md`。
4. 如果找到，仓库的配置部分将深度合并到全局配置中（仅允许的部分），仓库的提示词模板将替换
   全局模板（如果非空）。
5. 有效的（合并后的）工作流用于代理会话。

### 覆盖规则

| 部分 | 可覆盖 | 原因 |
|------|--------|------|
| `tracker` | 否 | 服务凭据 —— 安全边界 |
| `polling` | 否 | 服务级别关注点 |
| `workspace` | 否 | 安全边界（路径遍历） |
| `server` | 否 | 服务级别关注点 |
| `agent` | **是** | `max_turns`、重试、并发 |
| `claude` | **是** | `model`、`effort`、`allowed_tools`、`system_prompt`、`permission_mode` |
| `hooks` | 否 | Shell 脚本执行 —— 安全边界 |
| `env` | **是** | 代理的额外环境变量 |
| 提示词模板 | **是** | 仓库级提示词自定义 |

使用精细形式限制仓库可以覆盖的配置部分。仓库提示词模板在仓库 `WORKFLOW.md` 提供非空内容时仍会应用，除非 `prompt_template` 从 allow 列表中排除:

```yaml
repo_overrides:
  allow: [agent, claude, env, prompt_template]
```

### 示例

**全局 WORKFLOW.md（运维人员）:**

```yaml
---
tracker:
  kind: github_projects
  api_key: $GITHUB_TOKEN
  owner: myorg
  project_number: 5
repo_overrides: true
agent:
  max_turns: 20
claude:
  effort: high
---
所有仓库的默认提示词...
{{ issue.title }}
```

**目标仓库的 WORKFLOW.md（仓库团队）:**

```yaml
---
agent:
  max_turns: 40
claude:
  model: claude-sonnet-4-20250514
  effort: max
env:
  DATABASE_URL: $DATABASE_URL
---
你是一名后端专家，正在处理 {{ issue.identifier }}。

重点关注:
- 数据库迁移
- API 端点实现
{{ issue.description }}
```

**该仓库问题的有效结果:**

- `tracker` —— 来自全局（不可覆盖）
- `agent.max_turns` —— 40（来自仓库）
- `claude.model` —— `claude-sonnet-4-20250514`（来自仓库）
- `claude.effort` —— `max`（来自仓库）
- `env.DATABASE_URL` —— 从 `$DATABASE_URL` 解析（来自仓库）
- 提示词模板 —— 仓库的自定义模板

## CLI 用法

```bash
# 基本用法（从当前目录读取 WORKFLOW.md）
work-please

# 指定 WORKFLOW.md 路径（位置参数）
work-please ./WORKFLOW.md

# 启用 HTTP 仪表板
work-please --port 3000

# 初始化新的 GitHub Projects v2 项目并生成 WORKFLOW.md 脚手架
# （需要设置 GITHUB_TOKEN 环境变量）
work-please init --owner <org-or-user> --title "My Project"

# 或通过标志提供令牌：
work-please init --owner <org-or-user> --title "My Project" --token <your-github-token>

# 显示帮助
work-please --help
```

## GitHub App 认证

`github_projects` 追踪器支持两种认证方式：

| 方式 | 配置字段 | 使用场景 |
|--------|--------------|-------------|
| **PAT** | `api_key` | 个人访问令牌 —— 快速设置 |
| **GitHub App** | `app_id`、`private_key`、`installation_id` | 组织 —— 精细权限，更高速率限制 |

两者同时存在时，`api_key`（PAT）优先。

### 设置 GitHub App 凭据

1. 创建具有以下权限的 GitHub App：
   - **仓库权限**：
     - `Contents`：只读
     - `Issues`：读写
     - `Pull requests`：读写
   - **组织权限**：
     - `Projects`：读写
2. 在组织中安装应用并记下**安装 ID**（可在应用的安装设置 URL 中查看）。
3. 从应用的设置页面生成**私钥**（`.pem` 文件）。
4. 设置环境变量：

```bash
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
```

5. 在 `WORKFLOW.md` 中引用：

```yaml
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
```

也可以直接内联值（不建议用于密钥）：

```yaml
app_id: 12345
private_key: "-----BEGIN RSA PRIVATE KEY-----\n..."
installation_id: 67890
```

### 验证

Work Please 在启动时验证 GitHub App 配置：

| 场景 | 结果 |
|----------|--------|
| 已设置 `api_key` | PAT 认证 —— 忽略 app 字段 |
| 三个字段全部设置（`app_id`、`private_key`、`installation_id`） | App 认证 |
| 仅设置部分 app 字段 | `incomplete_github_app_config` 错误 |
| 未配置认证 | `missing_tracker_api_key` 错误 |

## 信任与安全

Work Please 自主运行 Claude Code。部署前请了解相关的信任影响。

### 权限模式

| 模式 | 行为 | 推荐用于 |
|---|---|---|
| `default` | 敏感操作需交互式审批 | 开发环境、未知仓库 |
| `acceptEdits` | 自动批准文件编辑；shell 命令需提示 | 受信任的代码库 |
| `bypassPermissions` | 自动批准所有操作 | 沙箱 CI 环境 |

除非在完全隔离的环境中运行，否则请从 `default` 或 `acceptEdits` 开始。

### 工作区隔离

- 每个问题在 `workspace.root` 下的专用目录中运行。
- Claude Code 的工作目录在启动前会针对工作区路径进行验证。
- 工作区路径经过清理以防止路径遍历攻击。

### 建议

- 在大多数部署中使用 `acceptEdits` 权限模式作为基准。
- 仅在网络隔离的 CI 运行器或 Docker 容器中使用 `bypassPermissions`。
- 初次测试时保守设置 `agent.max_concurrent_agents`。
- 通过 HTTP 仪表板（`--port`）或结构化日志监控代理运行。
- 将 API 令牌的权限范围设为所需的最小权限。

## 许可证

Functional Source License 1.1, MIT Future License (FSL-1.1-MIT)。详情请参阅 [LICENSE](LICENSE)。

### 第三方许可证

- Work Please 是基于 OpenAI 的 [Symphony 规范](vendor/symphony/SPEC.md)（Apache 2.0）的 TypeScript 实现。
- 本项目使用 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)，受 Anthropic [商业服务条款](https://www.anthropic.com/legal/commercial-terms)约束。
