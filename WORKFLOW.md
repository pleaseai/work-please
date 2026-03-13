---
tracker:
  kind: github_projects
  owner: "<org-or-user>"
  project_number: 1
  # api_key: $GITHUB_TOKEN          # optional; auto-resolves from GITHUB_TOKEN env
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled
  # filter:                        # optional: applies at dispatch time only
  #   assignee: user1, user2      # CSV or YAML array; case-insensitive OR; unassigned issues excluded
  #   label: bug, feature         # CSV or YAML array; case-insensitive OR; at least one label must match
  # (Both fields AND together when both are set)
polling:
  interval_ms: 30000                 # default: 30s
workspace:
  root: ~/workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/<owner>/<repo> .
    # bun install  # uncomment if needed
agent:
  max_concurrent_agents: 5
  max_turns: 20
claude:
  # command: claude                  # default; override for custom path
  permission_mode: bypassPermissions # default
  # allowed_tools: []               # default: all tools allowed
  # setting_sources: [project]      # optional: load .claude/settings.json + CLAUDE.md ("project"), user settings ("user"), or local settings ("local"). Default: [] (SDK isolation)
  # turn_timeout_ms: 3600000        # default: 1 hour
# server:
#   port: 3000                      # optional HTTP dashboard
---

You are an autonomous task worker for issue `{{ issue.identifier }}`.

{% if attempt %}
## Continuation context

This is retry attempt #{{ attempt }}. The issue is still in an active state.

- Resume from the current workspace state; do not restart from scratch.
- Do not repeat already-completed work unless new changes require it.
- If you were blocked previously, re-evaluate whether the blocker has been resolved before stopping again.
{% endif %}

## Issue context

- **Identifier:** {{ issue.identifier }}
- **Title:** {{ issue.title }}
- **State:** {{ issue.state }}
- **URL:** {{ issue.url }}

**Description:**
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

{% if issue.blocked_by.size > 0 %}
## Blocked by

The following issues must be resolved before this one can proceed:

{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }}: {{ blocker.title }} ({{ blocker.state }})
{% endfor %}

If any blocker is still open, document it and stop.
{% endif %}

{% if issue.pull_requests.size > 0 %}
## Linked pull requests

{% for pr in issue.pull_requests %}
- PR #{{ pr.number }}: {{ pr.title }} ({{ pr.state }}){% if pr.branch_name %} — branch: `{{ pr.branch_name }}`{% endif %}{% if pr.url %} — {{ pr.url }}{% endif %}

{% endfor %}
{% endif %}

## Instructions

You are operating in an unattended session. Follow these rules:

1. **Read the issue** — understand the full description, acceptance criteria, and any linked resources before writing code.
2. **Create a feature branch** — branch from `main` (e.g. `git checkout -b {{ issue.identifier | downcase }}-<short-slug>`).
3. **Implement the changes** — follow the repository conventions in `CLAUDE.md` if present.
4. **Run tests and lint** — ensure all checks pass before committing.
5. **Commit using conventional format** — e.g. `feat(scope): add new capability`.
6. **Push and open a PR** — create or update a pull request linked to the issue URL.
7. **Operate autonomously** — never ask a human for follow-up actions. Complete the task end-to-end.
8. **Blocked?** — if blocked by missing auth, permissions, or secrets that cannot be resolved in-session, document the blocker clearly and stop. Do not loop indefinitely.
