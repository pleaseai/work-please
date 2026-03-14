# Work Please

English | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=bugs)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please)
[![codecov](https://codecov.io/gh/pleaseai/work-please/graph/badge.svg?token=do858Z1lsI)](https://codecov.io/gh/pleaseai/work-please)

Work Please turns issue tracker tasks into isolated, autonomous implementation runs — managing work
instead of supervising coding agents.

> **Warning**: Work Please is an engineering preview for use in trusted environments.

## Table of Contents

- [Overview](#overview)
- [Key Differences from Symphony](#key-differences-from-symphony)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Configure](#configure)
  - [Run](#run)
- [WORKFLOW.md Configuration](#workflowmd-configuration)
  - [Full Front Matter Schema](#full-front-matter-schema)
  - [Template Variables](#template-variables)
- [CLI Usage](#cli-usage)
- [GitHub App Authentication](#github-app-authentication)
  - [Setting up GitHub App credentials](#setting-up-github-app-credentials)
  - [Validation](#validation)
- [Trust and Safety](#trust-and-safety)
  - [Permission Modes](#permission-modes)
  - [Workspace Isolation](#workspace-isolation)
  - [Recommendations](#recommendations)
- [License](#license)

## Overview

Work Please is a long-running TypeScript service that:

1. Polls an issue tracker (GitHub Projects v2 or Asana) for tasks in configured active states.
2. Creates an isolated workspace directory for each eligible issue.
3. Launches a Claude Code agent session inside that workspace with a rendered prompt.
4. Monitors the session, handles retries, and reconciles issue state on each poll cycle.

It is a TypeScript implementation of the [Symphony specification](vendor/symphony/SPEC.md),
adapted for GitHub Projects v2 / Asana and Claude Code instead of Linear and Codex.

For full technical details, see [SPEC.md](SPEC.md).

## Key Differences from Symphony

| | Symphony (reference) | Work Please |
|---|---|---|
| Issue Tracker | Linear | GitHub Projects v2 & Asana (under development) |
| Coding Agent | Codex (app-server mode) | Claude Code CLI |
| Language | Elixir/OTP | TypeScript + Bun |
| Tracker Auth | `LINEAR_API_KEY` | `GITHUB_TOKEN`, GitHub App credentials, or `ASANA_ACCESS_TOKEN` |
| Project Config | `project_slug` | `owner` + `project_number` (GitHub Projects v2) or `project_gid` (Asana) |
| Issue States | Linear workflow states | GitHub Projects v2 Status field / Asana sections |
| Agent Protocol | JSON-RPC over stdio | `@anthropic-ai/claude-agent-sdk` |
| Permission Model | Codex approval/sandbox policies | Claude Code `--permission-mode` |

## Features

- **Multi-tracker support** — Dispatch work from GitHub Projects v2 items or Asana tasks (under development) on a
  fixed cadence.
- **GitHub App authentication** — Authenticate the GitHub tracker with a GitHub App installation
  token (`app_id` + `private_key` + `installation_id`) instead of a PAT, for fine-grained
  permissions and higher API rate limits.
- **Assignee & label filters** — Filter eligible issues by assignee and/or label. Multiple values
  within each filter use OR logic; assignee and label filters are ANDed when both are specified.
  Applies at dispatch time only — already-running issues are unaffected. Configured per-tracker
  in `WORKFLOW.md`.
- **Isolated workspaces** — Each issue gets a dedicated directory; workspaces persist across runs.
- **`WORKFLOW.md` config** — Version agent prompt and runtime settings alongside your code.
- **Bounded concurrency** — Global and per-state concurrent agent limits.
- **Retry with backoff** — Exponential backoff on failures; short continuation retry on clean exit.
- **Dynamic config reload** — Edit `WORKFLOW.md` and changes apply without restarting the service.
- **Workspace hooks** — Shell scripts run at `after_create`, `before_run`, `after_run`, and
  `before_remove` lifecycle events.
- **Structured logging** — Operator-visible logs with stable `key=value` format.
- **Optional HTTP dashboard** — Enable with `--port` for runtime status and JSON API.

## Architecture

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
               Status Surface (optional HTTP dashboard / structured logs)
```

Components:

- **Workflow Loader** — Parses `WORKFLOW.md` YAML front matter and prompt template body.
- **Config Layer** — Typed getters with env-var indirection and built-in defaults.
- **Issue Tracker Client** — Fetches candidate issues, reconciles running-issue states. Supports
  GitHub Projects v2 (GraphQL API) and Asana (REST API) adapters.
- **Orchestrator** — Owns in-memory state; drives the poll/dispatch/retry loop.
- **Workspace Manager** — Creates, reuses, and cleans per-issue workspaces; runs hooks.
- **Agent Runner** — Launches Claude Code, streams events back to the orchestrator.
- **Status Surface** — Optional terminal view and HTTP API for operator visibility.

See [SPEC.md](SPEC.md) for the full specification.

## Quick Start

### Prerequisites

- **Bun** (see [bun.sh](https://bun.sh) for installation)
- **Claude Code CLI** (see the [official installation guide](https://docs.anthropic.com/en/docs/claude-code))
- **GitHub token** (`GITHUB_TOKEN`) with access to the target project, **or** **GitHub App credentials**
  (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`) — see [GitHub App Authentication](#github-app-authentication),
  **or** **Asana access token** (`ASANA_ACCESS_TOKEN`) (under development)

### Install

```bash
git clone https://github.com/pleaseai/work-please.git
cd work-please
bun install
bun run build
```

### Configure

Create a `WORKFLOW.md` in your target repository. Two examples are shown below.
See also the [example WORKFLOW.md](https://github.com/pleaseai/workflow/blob/main/WORKFLOW.md) for a real-world reference.

#### GitHub Projects v2 (PAT)

See also the [example GitHub Project](https://github.com/orgs/pleaseai/projects/2) for a real-world reference.

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
  auto_transitions:
    human_review_to_rework: true
    human_review_to_merging: true
    include_bot_reviews: true

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
  # setting_sources: []               # default: [project, local, user]; set [] for SDK isolation mode
  turn_timeout_ms: 3600000
---

You are working on a GitHub issue for the repository `your-org/your-repo`.

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
Blocked by:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
This is attempt #{{ attempt }}. Review any prior work in the workspace before continuing.
{% endif %}

Your task:
1. Understand the issue requirements.
2. Implement the requested changes.
3. Write or update tests as needed.
4. Open a pull request and move this issue to `Human Review`.
```

#### GitHub Projects v2 (GitHub App)

Use GitHub App credentials instead of a PAT for fine-grained permissions and higher API rate limits:

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
  auto_transitions:
    human_review_to_rework: true
    human_review_to_merging: true
    include_bot_reviews: true

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
  # setting_sources: []               # default: [project, local, user]; set [] for SDK isolation mode
  turn_timeout_ms: 3600000
---

You are working on a GitHub issue for the repository `your-org/your-repo`.

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
Blocked by:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
This is attempt #{{ attempt }}. Review any prior work in the workspace before continuing.
{% endif %}

Your task:
1. Understand the issue requirements.
2. Implement the requested changes.
3. Write or update tests as needed.
4. Open a pull request and move this issue to `Human Review`.
```

#### Asana (under development)

> **Note**: Asana support is under development. The configuration below is a preview and may change.

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
  # setting_sources: []               # default: [project, local, user]; set [] for SDK isolation mode
  turn_timeout_ms: 3600000
---

You are working on an Asana task for the project.

Task: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
Blocked by:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
This is attempt #{{ attempt }}. Review any prior work in the workspace before continuing.
{% endif %}

Your task:
1. Understand the task requirements.
2. Implement the requested changes.
3. Write or update tests as needed.
4. Open a pull request and move this task to the review section (e.g. `Human Review`).
```

### Run

```bash
# Set your tracker token (GitHub PAT)
export GITHUB_TOKEN=ghp_your_token_here
# or (GitHub App)
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
# or (Asana — under development)
export ASANA_ACCESS_TOKEN=your_token_here

# Run Work Please against a WORKFLOW.md in the current directory
bunx work-please

# Or specify a WORKFLOW.md path
bunx work-please /path/to/WORKFLOW.md

# Enable the optional HTTP dashboard on port 3000
bunx work-please --port 3000
```

## WORKFLOW.md Configuration

`WORKFLOW.md` is the single source of truth for Work Please's runtime behavior. It combines a YAML
front matter configuration block with a Markdown prompt template body.

### Full Front Matter Schema

```yaml
---
tracker:
  kind: github_projects               # Required: "github_projects" or "asana"

  # --- GitHub Projects v2 fields (when kind == "github_projects") ---
  api_key: $GITHUB_TOKEN              # Required: token or $ENV_VAR
  endpoint: https://api.github.com   # Optional: override GitHub API base URL
  owner: your-org                     # Required: GitHub organization or user login
  project_number: 42                  # Required: GitHub Projects v2 project number
  project_id: PVT_kwDOxxxxx          # Optional: project node ID (bypasses owner+project_number lookup)
  active_statuses:                    # Optional: default ["Todo", "In Progress", "Merging", "Rework"]
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:                  # Optional: default ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:                   # Optional: states polled but not dispatched. Default ["Human Review"]
    - Human Review
  auto_transitions:                   # Optional: auto-transition rules for watched states
    human_review_to_rework: true      # Move to Rework on CHANGES_REQUESTED or unresolved threads. Default true
    human_review_to_merging: true     # Move to Merging on APPROVED + no unresolved threads. Default true
    include_bot_reviews: true         # Whether bot comment threads count as unresolved. Default true
  # GitHub App authentication (alternative to api_key — all three required together):
  # app_id: $GITHUB_APP_ID            # Optional: GitHub App ID (integer or $ENV_VAR)
  # private_key: $GITHUB_APP_PRIVATE_KEY  # Optional: GitHub App private key PEM or $ENV_VAR
  # installation_id: $GITHUB_APP_INSTALLATION_ID  # Optional: installation ID (integer or $ENV_VAR)

  # --- Asana fields (when kind == "asana") --- UNDER DEVELOPMENT
  # api_key: $ASANA_ACCESS_TOKEN      # Required: token or $ENV_VAR
  # endpoint: https://app.asana.com/api/1.0  # Optional: override Asana API base URL
  # project_gid: "1234567890123456"   # Required: Asana project GID
  # active_sections:                  # Optional: default ["To Do", "In Progress"]
  #   - In Progress
  # terminal_sections:                # Optional: default ["Done", "Cancelled"]
  #   - Done
  #   - Cancelled

  # --- Shared filter fields (both trackers) ---
  # filter:
  #   assignee: user1, user2          # Optional: CSV or YAML array; case-insensitive OR match
  #                                   # (unassigned issues are excluded when this filter is set)
  #   label: bug, feature             # Optional: CSV or YAML array; case-insensitive OR match
  # Both filters AND together when both are specified. Applies at dispatch time only.

polling:
  interval_ms: 30000                  # Optional: poll cadence in ms, default 30000

workspace:
  root: ~/work-please_workspaces        # Optional: default <tmpdir>/work-please_workspaces

hooks:
  after_create: |                     # Optional: run once when workspace is first created
    git clone https://github.com/your-org/your-repo.git .
  before_run: |                       # Optional: run before each agent attempt
    git pull --rebase
  after_run: |                        # Optional: run after each agent attempt
    echo "Run completed"
  before_remove: |                    # Optional: run before workspace deletion
    echo "Cleaning up"
  timeout_ms: 60000                   # Optional: hook timeout in ms, default 60000

agent:
  max_concurrent_agents: 10           # Optional: global concurrency limit, default 10
  max_turns: 20                       # Optional: max turns per agent run, default 20
  max_retry_backoff_ms: 300000        # Optional: max retry delay in ms, default 300000
  max_concurrent_agents_by_state:     # Optional: per-state concurrency limits
    in progress: 5

claude:
  command: claude                     # Optional: Claude Code CLI command, default "claude"
  model: claude-sonnet-4-5-20250514   # Optional: override Claude model. Default: CLI default
  effort: high                        # Optional: reasoning depth — 'low', 'medium', 'high', or 'max'. Default 'high'.
  permission_mode: acceptEdits        # Optional: one of 'default', 'acceptEdits', 'bypassPermissions'. Defaults to 'bypassPermissions'.
  allowed_tools:                      # Optional: restrict available tools
    - Read
    - Write
    - Bash
  setting_sources:                    # Optional: filesystem settings to load. Default: [project, local, user]
    - project                         # load .claude/settings.json + CLAUDE.md from the workspace directory
    - local                           # load .claude/settings.local.json from the workspace directory
    - user                            # load ~/.claude/settings.json + global CLAUDE.md
                                      # Only "project", "local", and "user" are valid — other values are ignored
  turn_timeout_ms: 3600000            # Optional: per-turn timeout in ms, default 3600000
  read_timeout_ms: 5000               # Optional: initial subprocess read timeout in ms, default 5000
  stall_timeout_ms: 300000            # Optional: stall detection timeout, default 300000
  system_prompt: "custom prompt"      # Optional: custom system prompt string. Default: built-in claude_code preset
  settings:
    attribution:
      commit: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"  # Optional: appended to git commit messages. Defaults to Work Please link.
      pr: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"      # Optional: appended to PR descriptions. Defaults to Work Please link.

# worker:                              # Optional: SSH worker support (experimental)
#   ssh_hosts:                         # List of SSH host aliases for remote execution
#     - worker-1
#     - worker-2
#   max_concurrent_agents_per_host: 5  # Max agents per SSH host

# observability:                       # Optional: TUI dashboard settings
#   dashboard_enabled: true            # Enable TUI dashboard, default true
#   refresh_ms: 1000                   # Dashboard data refresh interval, default 1000
#   render_interval_ms: 16             # TUI render interval, default 16

server:
  port: 3000                          # Optional: enable HTTP dashboard on this port
  host: "127.0.0.1"                   # Optional: bind address, default "127.0.0.1"
---

Your prompt template goes here. Available variables:

- {{ issue.id }}           — Tracker-internal issue ID
- {{ issue.identifier }}   — Human-readable identifier (e.g. "#42" or task GID)
- {{ issue.title }}        — Issue title
- {{ issue.description }}  — Issue body/description
- {{ issue.state }}        — Current tracker state name
- {{ issue.url }}          — Issue URL
- {{ issue.assignees }}     — Array of assignee logins (GitHub) or emails (Asana)
- {{ issue.labels }}       — Array of label strings (normalized to lowercase)
- {{ issue.blocked_by }}   — Array of blocker refs (each has id, identifier, state)
- {{ issue.branch_name }}  — PR head branch name (for PullRequest items) or null
- {{ issue.pull_requests }} — Array of linked PRs (each has number, title, url, state, branch_name)
- {{ issue.review_decision }} — PR review decision: "approved", "changes_requested", "commented", "review_required", or null
- {{ issue.has_unresolved_threads }} — Whether the PR has unresolved review threads
- {{ issue.has_unresolved_human_threads }} — Whether the PR has unresolved non-bot review threads
- {{ issue.priority }}     — Numeric priority or null
- {{ issue.created_at }}   — ISO-8601 creation timestamp
- {{ issue.updated_at }}   — ISO-8601 last-updated timestamp
- {{ issue.project }}      — GitHub Projects v2 context (null for Asana):
  - {{ issue.project.owner }}          — Project owner login
  - {{ issue.project.number }}         — Project number
  - {{ issue.project.project_id }}     — Project GraphQL node ID (resolved at runtime)
  - {{ issue.project.item_id }}        — Project item GraphQL node ID
  - {{ issue.project.field_id }}       — Status field GraphQL node ID (resolved at runtime)
  - {{ issue.project.status_options }} — Array of { name, id } for status field options
- {{ attempt }}            — Retry attempt number (null on first run)
```

### Template Variables

The prompt template uses Liquid-compatible syntax. All `issue` fields are available:

```markdown
{{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

State: {{ issue.state }}

{% if issue.blocked_by.size > 0 %}
Blocked by:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if issue.pull_requests.size > 0 %}
Linked pull requests:
{% for pr in issue.pull_requests %}
- PR #{{ pr.number }}: {{ pr.title }} ({{ pr.state }}){% if pr.branch_name %} — branch: {{ pr.branch_name }}{% endif %}{% if pr.url %} — {{ pr.url }}{% endif %}

{% endfor %}
{% endif %}

{% if attempt %}
Retry attempt: {{ attempt }}
{% endif %}
```

## CLI Usage

```bash
# Basic usage (reads WORKFLOW.md from current directory)
work-please

# Specify WORKFLOW.md path (positional argument)
work-please ./WORKFLOW.md

# Enable HTTP dashboard
work-please --port 3000

# Initialize a new GitHub Projects v2 project and scaffold WORKFLOW.md
# (Requires GITHUB_TOKEN environment variable to be set)
work-please init --owner <org-or-user> --title "My Project"

# Alternatively, provide the token via a flag:
work-please init --owner <org-or-user> --title "My Project" --token <your-github-token>

# Show help
work-please --help
```

## GitHub App Authentication

The `github_projects` tracker supports two authentication methods:

| Method | Config fields | When to use |
|--------|--------------|-------------|
| **PAT** | `api_key` | Personal access tokens — quick setup |
| **GitHub App** | `app_id`, `private_key`, `installation_id` | Organizations — fine-grained permissions, higher rate limits |

When both are present, `api_key` (PAT) takes precedence.

### Setting up GitHub App credentials

1. Create a GitHub App with the following permissions:
   - **Repository permissions**:
     - `Contents`: Read-only
     - `Issues`: Read & write
     - `Pull requests`: Read & write
   - **Organization permissions**:
     - `Projects`: Read & write
2. Install the app on your organization and note the **installation ID** (visible in the app's
   installation settings URL).
3. Generate a **private key** (`.pem` file) from the app's settings page.
4. Set the environment variables:

```bash
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
```

5. Reference them in `WORKFLOW.md`:

```yaml
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
```

The values can also be inlined directly (not recommended for secrets):

```yaml
app_id: 12345
private_key: "-----BEGIN RSA PRIVATE KEY-----\n..."
installation_id: 67890
```

### Validation

Work Please validates GitHub App config at startup:

| Scenario | Result |
|----------|--------|
| `api_key` set | PAT auth — app fields ignored |
| All three app fields set (`app_id`, `private_key`, `installation_id`) | App auth |
| Only some app fields set | `incomplete_github_app_config` error |
| No auth configured | `missing_tracker_api_key` error |

## Trust and Safety

Work Please runs Claude Code autonomously. Understand the trust implications before deploying.

### Permission Modes

| Mode | Behavior | Recommended For |
|---|---|---|
| `default` | Interactive approval for sensitive operations | Development, unknown repositories |
| `acceptEdits` | Auto-approve file edits; prompt for shell commands | Trusted codebases |
| `bypassPermissions` | Auto-approve all operations | Sandboxed CI environments |

Start with `default` or `acceptEdits` unless you are running in a fully isolated environment.

### Workspace Isolation

- Each issue runs in a dedicated directory under `workspace.root`.
- Claude Code's working directory is validated against the workspace path before launch.
- Workspace paths are sanitized to prevent path traversal attacks.

### Recommendations

- Use `acceptEdits` permission mode as a baseline for most deployments.
- Use `bypassPermissions` only in network-isolated CI runners or Docker containers.
- Set `agent.max_concurrent_agents` conservatively when first testing.
- Monitor agent runs via the HTTP dashboard (`--port`) or structured logs.
- Keep API tokens scoped to the minimum required permissions.

## License

Functional Source License 1.1, MIT Future License (FSL-1.1-MIT). See [LICENSE](LICENSE) for details.

Work Please is a TypeScript implementation based on the
[Symphony specification](vendor/symphony/SPEC.md) by OpenAI (Apache 2.0).
