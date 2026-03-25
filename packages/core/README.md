# @pleaseai/agent-core

Core orchestrator logic for Agent Please.

Contains all runtime business logic shared across deployment targets:

- **Orchestrator** — poll/dispatch/retry/reconcile loop
- **Config layer** — YAML front matter parsing, `$ENV_VAR` resolution
- **Workflow loader** — `WORKFLOW.md` parser
- **Issue tracker adapters** — GitHub Projects v2 (GraphQL) and Asana (REST)
- **Workspace manager** — per-issue directory lifecycle, git worktrees, hooks
- **Agent runner** — Claude Code session via `@anthropic-ai/claude-agent-sdk`
- **DB layer** — agent run history via Kysely (bun:sqlite embedded or Turso cloud)
- **Relay transport** — WebSocket relay client for cloud webhook delivery
- **HTTP server** — standalone server for use without Nuxt

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full module structure.

## Development

```bash
# Install dependencies (from project root)
bun install

# Test
bun run --filter @pleaseai/agent-core test

# Type check
bun run --filter @pleaseai/agent-core check
```
