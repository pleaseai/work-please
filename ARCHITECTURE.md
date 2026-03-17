# Architecture

This document provides a bird's-eye view of the Work Please codebase. It is intended to help
contributors (human and AI) orient themselves quickly and understand how the pieces fit together.

For the full specification, see [SPEC.md](SPEC.md). For the upstream reference implementation,
see [vendor/symphony/SPEC.md](vendor/symphony/SPEC.md).

## System Purpose

Work Please is a long-running TypeScript daemon that turns issue tracker tasks into autonomous
Claude Code agent sessions. It continuously polls an issue tracker (GitHub Projects v2 or Asana),
creates an isolated workspace for each eligible issue, renders a Liquid prompt template, and
launches a Claude Code agent session inside that workspace via the
`@anthropic-ai/claude-agent-sdk`.

The service is primarily a **scheduler/runner** — it does not perform full ticket management.
The orchestrator writes only status labels to GitHub issues. All state transitions, PR
creation, and comments are performed by the Claude Code agent using tools available in the
runtime environment.

## Entry Points

| File | Purpose |
|------|---------|
| `apps/work-please/src/index.ts` | Binary entry point — calls `runCli()` |
| `apps/work-please/src/cli.ts` | CLI argument parsing (`run`, `init`, `--port`) and startup sequence |
| `apps/work-please/src/orchestrator.ts` | Core poll/dispatch/retry loop — start reading here for runtime behavior |
| `apps/work-please/src/server.ts` | Optional HTTP dashboard (`/`) and JSON API (`/api/v1/state`, `/api/v1/refresh`, `/api/v1/<identifier>`) |
| `WORKFLOW.md` | User-authored config file in the **target repository** (not this repo) — defines tracker settings, hooks, agent limits, and the Liquid prompt template |

## Module Structure

```
work-please/                      # Monorepo root (Bun + Turborepo)
├── apps/work-please/src/         # Main application (@pleaseai/work)
│   ├── index.ts                  # Binary entry point
│   ├── cli.ts                    # CLI parsing and startup (Commander)
│   ├── orchestrator.ts           # Core loop: poll → reconcile → dispatch → retry
│   ├── config.ts                 # YAML front matter → typed ServiceConfig with env-var resolution
│   ├── workflow.ts               # WORKFLOW.md parser + repo override merge (YAML front matter + Liquid body)
│   ├── prompt-builder.ts         # Liquid template rendering (issue → prompt string)
│   ├── agent-runner.ts           # Claude Code agent session via @anthropic-ai/claude-agent-sdk
│   ├── workspace.ts              # Per-issue directory management, git worktrees, lifecycle hooks
│   ├── server.ts                 # Optional HTTP dashboard (Bun.serve) and JSON API
│   ├── tools.ts                  # MCP tool server (asana_api, github_graphql) injected into agent
│   ├── label.ts                  # GitHub label management (dispatched/done/failed)
│   ├── filter.ts                 # Assignee and label filter matching
│   ├── init.ts                   # `work-please init` — scaffolds GitHub Project + WORKFLOW.md
│   ├── types.ts                  # Shared type definitions (Issue, ServiceConfig, OrchestratorState)
│   └── tracker/                  # Issue tracker adapters
│       ├── index.ts              # Factory: createTrackerAdapter() → GitHub or Asana adapter
│       ├── types.ts              # TrackerAdapter interface and TrackerError union type
│       ├── github.ts             # GitHub Projects v2 adapter (GraphQL pagination + item normalization)
│       ├── github-auth.ts        # GitHub authentication (PAT or GitHub App installation token)
│       ├── github-status-update.ts # GitHub Projects v2 status field mutation
│       └── asana.ts              # Asana adapter (REST API, section-based state mapping)
├── packages/                     # Shared libraries (none yet scaffolded)
├── vendor/symphony/              # Upstream Symphony reference spec (read-only, excluded from lint/TS)
├── turbo.json                    # Turborepo task pipeline
├── eslint.config.ts              # @antfu/eslint-config (2-space, single quotes, no semicolons)
└── tsconfig.json                 # TypeScript strict mode, ESNext target, bundler resolution
```

## Data Flow

```
                    WORKFLOW.md (target repo)
                         │
                    ┌────▼────┐
                    │ Workflow │  Parse YAML front matter
                    │ Loader   │  + Liquid prompt body
                    └────┬────┘
                         │
                    ┌────▼────┐
                    │ Config   │  Typed ServiceConfig with
                    │ Layer    │  env-var ($VAR) resolution
                    └────┬────┘
                         │
          ┌──────────────▼──────────────┐
          │        Orchestrator         │
          │  poll → reconcile → dispatch│
          │  → retry (exponential)      │
          └──┬────────┬────────┬───────┘
             │        │        │
     ┌───────▼──┐ ┌───▼───┐ ┌─▼──────────┐
     │ Tracker  │ │Workspace│ │ Agent      │
     │ Client   │ │Manager │ │ Runner     │
     │(GitHub/  │ │(create,│ │(claude-    │
     │ Asana)   │ │ hooks, │ │ agent-sdk) │
     └──────────┘ │worktree│ └────────────┘
                  └────────┘
```

### Startup

Before the first tick, `start()` calls `startupTerminalWorkspaceCleanup()`, which fetches all
issues in terminal states and removes their local workspaces. This keeps the workspace root clean
after a service restart.

### Orchestrator Tick Cycle

Each poll tick executes in order:

1. **Reconcile** — Refresh running issue states from the tracker; terminate workers for
   terminal/non-active issues; detect stalled agents.
2. **Validate** — Re-check config validity (supports live reload via file watcher).
3. **Create tracker adapter** — Instantiate a `TrackerAdapter` from config. On adapter error,
   log and skip remaining steps.
4. **Process watched states** — Dispatch agents for watched-state issues (e.g. `Human Review`)
   that have review activity (review decision or unresolved threads).
5. **Fetch candidates** — Poll active issues from the tracker with optional assignee/label filters.
6. **Sort and dispatch** — Priority ascending, then oldest first. Check global and per-state
   concurrency limits. Create workspace, run hooks, start agent session.
7. **Schedule next tick** — Wait `polling.interval_ms` before repeating.

### Agent Session Lifecycle

1. `createWorkspace()` — Creates or reuses a per-issue directory (or git worktree if issue URL
   points to a GitHub repo). Runs `after_create` hook on first creation.
2. `runBeforeRunHook()` — Executes the optional `before_run` shell hook.
3. `AppServerClient.startSession()` — Validates workspace path against `workspace.root`
   (path traversal prevention) and assigns a local session UUID. No SDK communication occurs
   yet — the real session is established when `runTurn()` receives a `system/init` event.
4. `AppServerClient.runTurn()` — Calls `query()` from `@anthropic-ai/claude-agent-sdk` with the
   rendered prompt. Translates SDK messages into orchestrator events (`session_started`,
   `turn_completed`, `turn_failed`, `notification`).
   Supports multi-turn: after each turn, refreshes issue state; continues if still active and
   under `max_turns`.
5. `runAfterRunHook()` — Executes the optional `after_run` shell hook.
6. On exit — normal exits schedule a 1s continuation retry; failures schedule exponential backoff
   retries up to `max_retry_backoff_ms`.

## Architecture Invariants

These constraints must hold across the codebase. Violating them is a bug.

1. **Minimal tracker writes** — The orchestrator does not write to the issue tracker except for
   the `LabelService` (`label.ts`) which applies `dispatched`/`done`/`failed` labels to GitHub
   issues. All state transitions, PR operations, and comments are performed by the agent.

2. **Workspace path validation** — Every workspace path must be validated against
   `config.workspace.root` before any agent launch. The path must be a strict child of the root
   (not equal to it), and symlink traversal is checked. See `validateWorkspacePath()` and
   `AppServerClient.validateWorkspaceCwd()`.

3. **Config immutability during tick** — The config object is replaced atomically on reload, never
   mutated in place. The orchestrator reads config at the start of each tick.

4. **Concurrency limits are hard** — `max_concurrent_agents` and per-state limits
   (`max_concurrent_agents_by_state`) are checked before every dispatch. A dispatch never exceeds
   these limits.

5. **Error types, not exceptions** — Tracker operations, config validation, and workflow parsing
   return discriminated union error types (e.g., `TrackerError`, `ValidationError`,
   `WorkflowError`) instead of throwing. Check for `'code' in result` before proceeding.

6. **Env-var indirection** — Config values matching `$ENV_VAR` are resolved from `process.env` at
   config build time. The resolved values (including secrets) are stored in the `ServiceConfig`
   object — `$ENV_VAR` references do not persist past startup.

7. **No vendor modifications** — `vendor/symphony/` is a read-only submodule. It is excluded from
   linting, type-checking, and builds.

## Cross-Cutting Concerns

### Error Handling

The codebase uses discriminated union types for expected errors rather than exceptions:

- `TrackerError` — Network failures, API errors, unexpected payloads from GitHub/Asana
- `ValidationError` — Missing or invalid config fields
- `WorkflowError` — YAML parse errors, missing files, invalid front matter
- `PromptBuildError` — Liquid template parse/render failures
- `InitError` — GitHub API failures during `work-please init`

Each error type has a `code` field for programmatic matching. The `isTrackerError()`,
`isWorkflowError()`, `isPromptBuildError()`, and `isInitError()` type guards are used
for narrowing.

### Testing

- **Runner:** Bun test (Jest-compatible API)
- **Pattern:** Unit tests co-located with source files (`*.test.ts` alongside `*.ts`)
- **Mocking:** `AppServerClient` accepts an injectable `queryFn` for testing without the real
  Claude CLI. Tracker adapters are tested against mock GraphQL/REST responses. Workspace operations
  use `spyOn(_git, 'spawnSync')` to mock git commands.
- **Commands:** `bun run test` (all), `bun run test:app` (work-please only)

### Logging

Structured `key=value` format on stderr via `console.warn()` and `console.error()`. All log lines
are prefixed with `[work-please]` or `[orchestrator]`. No log framework — kept intentionally
simple for daemon operation.

### Configuration

Two-layer configuration via `WORKFLOW.md`:

- **Global WORKFLOW.md** (operator) — Defines service-level settings (tracker, polling, workspace)
  and default agent config. Read at startup and watched for live reload.
- **Repo WORKFLOW.md** (target repository, optional) — Overrides selected agent-level settings and
  the prompt template for issues from that repo. Only read when `repo_overrides: true` is set in
  the global workflow. Service-level sections are never overridable (security boundary).
- **Merge semantics** — Allowed config sections are deep-merged (repo values win); prompt template
  is replaced if repo provides a non-empty one. Merge happens per-issue at dispatch time via
  `resolveEffectiveWorkflow()` in the orchestrator.
- **Live reload** — File watcher triggers re-parse of the global workflow; invalid configs are
  rejected with the last known-good config retained.

### Authentication

| Tracker | Method | Config |
|---------|--------|--------|
| GitHub Projects v2 | PAT | `tracker.api_key` or `$GITHUB_TOKEN` |
| GitHub Projects v2 | GitHub App | `tracker.app_id` + `tracker.private_key` + `tracker.installation_id` |
| Asana | PAT | `tracker.api_key` or `$ASANA_ACCESS_TOKEN` |

GitHub App auth uses `@octokit/auth-app` to generate installation tokens. When both PAT and App
credentials are present, PAT takes precedence.

### MCP Tool Injection

The agent runner injects tracker-specific MCP tools into each Claude Code session:

- `github_graphql` — Raw GraphQL queries/mutations using the service's authenticated Octokit
- `asana_api` — Raw REST API calls using the service's Bearer token

These allow the agent to perform tracker writes (state transitions, comments) without needing
separate credentials.
