# Conductor

Conductor turns issue tracker tasks into isolated, autonomous implementation runs — managing work
instead of supervising coding agents.

> **Warning**: Conductor is an engineering preview for use in trusted environments.

## Overview

Conductor is a long-running TypeScript service that:

1. Polls an issue tracker (Asana or GitHub Projects v2) for tasks in configured active states.
2. Creates an isolated workspace directory for each eligible issue.
3. Launches a Claude Code agent session inside that workspace with a rendered prompt.
4. Monitors the session, handles retries, and reconciles issue state on each poll cycle.

It is a TypeScript implementation of the [Symphony specification](vendor/symphony/SPEC.md),
adapted for Asana / GitHub Projects v2 and Claude Code instead of Linear and Codex.

For full technical details, see [SPEC.md](SPEC.md).

## Key Differences from Symphony

| | Symphony (reference) | Conductor |
|---|---|---|
| Issue Tracker | Linear | Asana & GitHub Projects v2 |
| Coding Agent | Codex (app-server mode) | Claude Code CLI |
| Language | Elixir/OTP | TypeScript + Bun |
| Tracker Auth | `LINEAR_API_KEY` | `ASANA_ACCESS_TOKEN` or `GITHUB_TOKEN` |
| Project Config | `project_slug` | `project_gid` (Asana) or `owner` + `project_number` (GitHub Projects v2) |
| Issue States | Linear workflow states | Asana sections / GitHub Projects v2 Status field |
| Agent Protocol | JSON-RPC over stdio | Stream-JSON CLI output |
| Permission Model | Codex approval/sandbox policies | Claude Code `--permission-mode` |

## Features

- **Multi-tracker support** — Dispatch work from Asana tasks or GitHub Projects v2 items on a
  fixed cadence.
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
          (Asana REST API or                          per-issue directory
          GitHub GraphQL API,
          polling + reconciliation)
                     |
                     v
               Status Surface (optional HTTP dashboard / structured logs)
```

Components:

- **Workflow Loader** — Parses `WORKFLOW.md` YAML front matter and prompt template body.
- **Config Layer** — Typed getters with env-var indirection and built-in defaults.
- **Issue Tracker Client** — Fetches candidate issues, reconciles running-issue states. Supports
  Asana (REST API) and GitHub Projects v2 (GraphQL API) adapters.
- **Orchestrator** — Owns in-memory state; drives the poll/dispatch/retry loop.
- **Workspace Manager** — Creates, reuses, and cleans per-issue workspaces; runs hooks.
- **Agent Runner** — Launches Claude Code, streams events back to the orchestrator.
- **Status Surface** — Optional terminal view and HTTP API for operator visibility.

See [SPEC.md](SPEC.md) for the full specification.

## Quick Start

### Prerequisites

- **Bun** (see [bun.sh](https://bun.sh) for installation)
- **Claude Code CLI** (`npm install -g @anthropic-ai/claude-code` or follow the
  [official installation guide](https://docs.anthropic.com/en/docs/claude-code))
- **Asana access token** (`ASANA_ACCESS_TOKEN`) **or** **GitHub token** (`GITHUB_TOKEN`) with
  access to the target project

### Install

```bash
git clone https://github.com/chatbot-pf/conductor.git
cd conductor
bun install
bun run build
```

### Configure

Create a `WORKFLOW.md` in your target repository. Two examples are shown below.

#### Asana

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
  root: ~/conductor_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
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
4. Open a pull request and move this task to the review section.
```

#### GitHub Projects v2

```markdown
---
tracker:
  kind: github_projects
  api_key: $GITHUB_TOKEN
  owner: your-org
  project_number: 42
  active_statuses:
    - In Progress
  terminal_statuses:
    - Done
    - Cancelled

polling:
  interval_ms: 30000

workspace:
  root: ~/conductor_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
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
4. Open a pull request and move this issue to the review status.
```

### Run

```bash
# Set your tracker token
export ASANA_ACCESS_TOKEN=your_token_here
# or
export GITHUB_TOKEN=ghp_your_token_here

# Run Conductor against a WORKFLOW.md in the current directory
bunx conductor

# Or specify a WORKFLOW.md path
bunx conductor --workflow /path/to/WORKFLOW.md

# Enable the optional HTTP dashboard on port 3000
bunx conductor --port 3000
```

## WORKFLOW.md Configuration

`WORKFLOW.md` is the single source of truth for Conductor's runtime behavior. It combines a YAML
front matter configuration block with a Markdown prompt template body.

### Full Front Matter Schema

```yaml
---
tracker:
  kind: asana                         # Required: "asana" or "github_projects"

  # --- Asana fields (when kind == "asana") ---
  api_key: $ASANA_ACCESS_TOKEN        # Required: token or $ENV_VAR
  endpoint: https://app.asana.com/api/1.0  # Optional: override Asana API base URL
  project_gid: "1234567890123456"     # Required: Asana project GID
  active_sections:                    # Optional: default ["To Do", "In Progress"]
    - In Progress
  terminal_sections:                  # Optional: default ["Done", "Cancelled"]
    - Done
    - Cancelled

  # --- GitHub Projects v2 fields (when kind == "github_projects") ---
  # api_key: $GITHUB_TOKEN            # Required: token or $ENV_VAR
  # endpoint: https://api.github.com  # Optional: override GitHub API base URL
  # owner: your-org                   # Required: GitHub organization or user login
  # project_number: 42                # Required: GitHub Projects v2 project number
  # active_statuses:                  # Optional: default ["Todo", "In Progress"]
  #   - In Progress
  # terminal_statuses:                # Optional: default ["Done", "Cancelled"]
  #   - Done
  #   - Cancelled

polling:
  interval_ms: 30000                  # Optional: poll cadence in ms, default 30000

workspace:
  root: ~/conductor_workspaces        # Optional: default <tmpdir>/conductor_workspaces

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
  max_retry_backoff_ms: 300000        # Optional: max retry delay in ms, default 300000
  max_concurrent_agents_by_state:     # Optional: per-state concurrency limits
    in progress: 5

claude:
  command: claude                     # Optional: Claude Code CLI command, default "claude"
  permission_mode: acceptEdits        # Optional: default|acceptEdits|bypassPermissions
  allowed_tools:                      # Optional: restrict available tools
    - Read
    - Write
    - Bash
  turn_timeout_ms: 3600000            # Optional: per-turn timeout in ms, default 3600000
  stall_timeout_ms: 300000            # Optional: stall detection timeout, default 300000

server:
  port: 3000                          # Optional: enable HTTP dashboard on this port
---

Your prompt template goes here. Available variables:

- {{ issue.id }}           — Tracker-internal issue ID
- {{ issue.identifier }}   — Human-readable identifier (e.g. "#42" or task GID)
- {{ issue.title }}        — Issue title
- {{ issue.description }}  — Issue body/description
- {{ issue.state }}        — Current tracker state name
- {{ issue.url }}          — Issue URL
- {{ issue.labels }}       — Array of label strings (normalized to lowercase)
- {{ issue.blocked_by }}   — Array of blocker refs (each has id, identifier, state)
- {{ issue.priority }}     — Numeric priority or null
- {{ issue.created_at }}   — ISO-8601 creation timestamp
- {{ issue.updated_at }}   — ISO-8601 last-updated timestamp
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

{% if attempt %}
Retry attempt: {{ attempt }}
{% endif %}
```

## CLI Usage

```bash
# Basic usage
conductor

# Specify WORKFLOW.md path
conductor --workflow ./WORKFLOW.md

# Enable HTTP dashboard
conductor --port 3000

# Show help
conductor --help
```

## Trust and Safety

Conductor runs Claude Code autonomously. Understand the trust implications before deploying.

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

Apache License 2.0. See [LICENSE](vendor/symphony/LICENSE) for details.

Conductor is a TypeScript implementation based on the
[Symphony specification](vendor/symphony/SPEC.md) by OpenAI (Apache 2.0).
