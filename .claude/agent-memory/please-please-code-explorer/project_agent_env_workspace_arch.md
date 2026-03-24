---
name: agent-env-workspace-architecture
description: Orchestrator → resolveAgentEnv → agent-runner execution flow, workspace lifecycle hooks, and integration points for SSH key and commit signing
type: project
---

Core execution path: `Orchestrator.executeAgentRun()` (orchestrator.ts:349) calls `createWorkspace()`, then `resolveAgentEnv()`, then `client.setAgentEnv()` before `client.startSession()` and `client.runTurn()`.

`resolveAgentEnv()` (agent-env.ts:22) builds env as: `process.env` base + defaults (GH_TOKEN/GITHUB_TOKEN/GIT_AUTHOR_*/GIT_COMMITTER_*) + user-defined config.env overlay.

`GIT_AUTHOR_*/GIT_COMMITTER_*` are injected as defaults via `buildDefaults()` using the `TokenProvider.botIdentity()` callback. Only set if GitHub credentials will be available and keys not user-defined.

`GIT_CONFIG_COUNT/GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_*` for commit signing are **not yet present** — would be injected in `buildDefaults()` or alongside identity injection in agent-env.ts.

Workspace creation path (workspace.ts): `createWorkspace()` → `ensureSharedClone()` (git clone/fetch) → `createWorktree()` or `checkoutExistingBranch()` → `after_create` hook → `ensureClaudeSettings()`.

SSH key writing integration point: either in `ensureSharedClone()` before the git clone/fetch, or in an `after_create` hook via `runHook()`. The `_git.spawnSync` wrapper in workspace.ts does not pass custom env — only inherits `process.env`. SSH key would need to be written to filesystem before git ops or the env/ssh config injected into `_git.spawnSync`.

Git remote URL rewriting: `ensureSharedClone()` runs `git clone repoUrl repoDir` (workspace.ts:85) and `git fetch origin` (workspace.ts:92). URL rewriting would happen by modifying `repoUrl` before passing to these functions, in `createWorkspace()` (workspace.ts:237).

Orchestrator shutdown (`stop()`, orchestrator.ts:94): stops poll timer, file watcher, terminates running agents, flushes DB writes, closes DB. No cleanup hook for ephemeral resources (e.g., SSH key files) currently exists.

Startup hook: `start()` (orchestrator.ts:63) runs `startupTerminalWorkspaceCleanup()`, then `startFileWatcher()`, then `scheduleTick(0)`. SSH key setup would slot in between DB migration and first tick.

**Why:** Understanding this flow is prerequisite for adding SSH key injection and commit signing (GIT_CONFIG_COUNT pattern) to agent runs.

**How to apply:** When adding SSH or signing features, modify agent-env.ts `buildDefaults()` for env vars; modify workspace.ts `ensureSharedClone()` or `createWorkspace()` for filesystem operations; add cleanup in orchestrator.ts `stop()`.
