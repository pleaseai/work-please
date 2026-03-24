# Plan: Commit Signing & Authenticated Remote

> Track: commit-signing-20260324
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/commit-signing-20260324/spec.md
- **Issue**: TBD
- **Created**: 2026-03-24
- **Approach**: Layered Integration

## Purpose

After this change, bot-created commits in agent workspaces will show as "Verified" on GitHub. Operators can enable commit signing by adding a `commit_signing` section to WORKFLOW.md and providing an SSH signing key or selecting API commit mode.

## Context

Agent Please currently injects `GIT_AUTHOR_*` / `GIT_COMMITTER_*` environment variables via `agent-env.ts` so that bot commits have the correct identity. However, commits lack cryptographic signatures and appear as "Unverified" on GitHub. This undermines trust in automated commits and may conflict with branch protection rules requiring signed commits.

The feature adds two signing strategies — SSH signing key (persistent at workspace root, injected via `GIT_CONFIG_*` env vars) and GitHub API commits (auto-verified by GitHub). Configuration lives in WORKFLOW.md YAML front matter. Additionally, authenticated remote URLs are configured so agents can push without relying solely on `GH_TOKEN` env var passthrough.

The implementation follows the established config → agent-env → workspace → orchestrator layering. Each layer handles its own concern: types define the shape, config parses YAML, agent-env injects env vars, workspace handles git remote setup, and orchestrator manages SSH key lifecycle.

Non-goals: GPG signing, per-issue key rotation, non-GitHub platforms.

## Architecture Decision

The layered integration approach was chosen because it follows the existing codebase pattern exactly. Each new concern maps to a single existing module:

- Config parsing: `buildCommitSigningConfig()` follows the same `sectionMap()` + coercion helper pattern as all other config sections.
- SSH signing key injection: `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` env vars in `buildDefaults()` avoid modifying git config files directly — the agent subprocess inherits signing config through its environment.
- Remote auth: A `configureRemoteAuth()` function in workspace.ts rewrites the git origin URL after worktree creation, using the same `_git.spawnSync` pattern.
- SSH key lifecycle: Write at orchestrator `start()`, delete at `stop()` — minimal surface area.

Alternative considered: writing `.gitconfig` files per workspace. Rejected because env var injection is simpler, already proven by `GIT_AUTHOR_*` identity injection, and doesn't leave config files that could leak.

## Tasks

- [x] T001 Add CommitSigningConfig type and extend ServiceConfig (file: packages/core/src/types.ts)
- [x] T002 Add buildCommitSigningConfig parser with $ENV_VAR resolution (file: packages/core/src/config.ts) (depends on T001)
- [x] T003 [P] Add commit signing config parsing tests (file: packages/core/src/config.test.ts) (depends on T001)
- [x] T004 Inject GIT_CONFIG_* env vars for SSH signing mode in buildDefaults (file: packages/core/src/agent-env.ts) (depends on T001)
- [x] T005 [P] Add agent-env signing injection tests (file: packages/core/src/agent-env.test.ts) (depends on T004)
- [x] T006 Add configureRemoteAuth helper for authenticated git remote URL (file: packages/core/src/workspace.ts) (depends on T001)
- [x] T007 [P] Add workspace remote auth tests (file: packages/core/src/workspace.test.ts) (depends on T006)
- [x] T008 Add SSH key setup at startup and cleanup at shutdown in orchestrator (file: packages/core/src/orchestrator.ts) (depends on T002, T004, T006)
- [x] T009 Add orchestrator commit signing lifecycle tests (file: packages/core/src/orchestrator.test.ts) (depends on T008)
- [x] T010 Wire configureRemoteAuth into executeAgentRun after workspace creation (file: packages/core/src/orchestrator.ts) (depends on T006, T008)

## Key Files

### Create

_(none — all changes modify existing files)_

### Modify

- `packages/core/src/types.ts` — Add `CommitSigningMode` type, `CommitSigningConfig` interface, extend `ServiceConfig`
- `packages/core/src/config.ts` — Add `buildCommitSigningConfig()`, wire into `buildConfig()` return
- `packages/core/src/config.test.ts` — Tests for commit signing config parsing, $ENV_VAR resolution, defaults
- `packages/core/src/agent-env.ts` — Extend `buildDefaults()` to inject `GIT_CONFIG_COUNT/KEY_*/VALUE_*` when SSH mode
- `packages/core/src/agent-env.test.ts` — Tests for signing env var injection
- `packages/core/src/workspace.ts` — Add `configureRemoteAuth()` function
- `packages/core/src/workspace.test.ts` — Tests for remote auth URL rewriting
- `packages/core/src/orchestrator.ts` — SSH key write in `start()`, cleanup in `stop()`, call `configureRemoteAuth` in `executeAgentRun()`
- `packages/core/src/orchestrator.test.ts` — Tests for signing lifecycle

### Reuse

- `packages/core/src/config.ts` — `sectionMap()`, `stringValue()`, `resolveEnvValue()`, `resolvePathValue()`
- `packages/core/src/workspace.ts` — `_git.spawnSync()` for git remote set-url
- `packages/core/src/agent-env.ts` — `TokenProvider`, `BotIdentity`, `RUNTIME_VAR_RE`

## Verification

### Automated Tests

- [ ] Config parses `commit_signing.mode` as `ssh`, `api`, `none`, defaults to `none` when absent
- [ ] Config resolves `$SSH_SIGNING_KEY` env var reference for ssh_signing_key field
- [ ] Config rejects invalid mode values
- [ ] agent-env injects GIT_CONFIG_COUNT=3, GIT_CONFIG_KEY_0=gpg.format, GIT_CONFIG_VALUE_0=ssh, etc. when mode=ssh
- [ ] agent-env does NOT inject GIT_CONFIG_* when mode=none
- [ ] agent-env does NOT inject GIT_CONFIG_* when mode=api
- [ ] configureRemoteAuth rewrites origin URL with token
- [ ] configureRemoteAuth is a no-op when no token available
- [ ] Orchestrator writes SSH key file with 0o600 permissions on start()
- [ ] Orchestrator deletes SSH key file on stop()
- [ ] All existing tests continue to pass

### Observable Outcomes

- After configuring `commit_signing: { mode: ssh }` in WORKFLOW.md, running `env | grep GIT_CONFIG` in the agent workspace shows signing-related config entries
- Running `git config --list` inside agent workspace shows `gpg.format=ssh`, `user.signingkey=...`, `commit.gpgsign=true`

### Acceptance Criteria Check

- [ ] AC-1: SSH mode commits show "Verified" on GitHub
- [ ] AC-2: API mode agents use GitHub API for commits (auto-verified)
- [ ] AC-3: Omitted config preserves current behavior
- [ ] AC-4: Authenticated remote URL enables git push
- [ ] AC-5: SSH key cleaned up on shutdown
- [ ] AC-6: All existing tests pass

## Decision Log

- Decision: Use GIT_CONFIG_COUNT/KEY_*/VALUE_* env vars instead of git config files
  Rationale: Env var injection is already proven (GIT_AUTHOR_*), avoids leftover config files, and is inherited by all git subprocesses.
  Date/Author: 2026-03-24 / Claude

- Decision: Persistent SSH key at workspace root instead of per-run inject/cleanup
  Rationale: User chose persistent mode — simpler lifecycle, single write at startup. Key path: `{workspace.root}/.ssh/agent_signing_key`.
  Date/Author: 2026-03-24 / Minsu Lee

- Decision: Top-level `commit_signing` field in ServiceConfig (not nested under workspace)
  Rationale: Signing affects git operations broadly, not just workspace creation. Parallel to existing top-level sections.
  Date/Author: 2026-03-24 / Claude

## Progress

- [x] (2026-03-24 10:00 KST) T001 Add CommitSigningConfig type and extend ServiceConfig
- [x] (2026-03-24 10:00 KST) T002 Add buildCommitSigningConfig parser with $ENV_VAR resolution
- [x] (2026-03-24 10:10 KST) T003 Add commit signing config parsing tests
  Evidence: `bun test packages/core/src/config.test.ts` → 8 new tests passed
- [x] (2026-03-24 10:10 KST) T004 Inject GIT_CONFIG_* env vars for SSH signing mode
- [x] (2026-03-24 10:10 KST) T005 Add agent-env signing injection tests
  Evidence: `bun test packages/core/src/agent-env.test.ts` → 4 new tests passed
- [x] (2026-03-24 10:10 KST) T006 Add configureRemoteAuth helper
- [x] (2026-03-24 10:10 KST) T007 Add workspace remote auth tests
  Evidence: `bun test packages/core/src/workspace.test.ts` → 4 new tests passed
- [x] (2026-03-24 10:20 KST) T008 Add SSH key setup/cleanup in orchestrator
- [x] (2026-03-24 10:20 KST) T009 Add orchestrator commit signing lifecycle tests
  Evidence: `bun test packages/core/src/orchestrator.test.ts` → 4 new tests passed
- [x] (2026-03-24 10:20 KST) T010 Wire configureRemoteAuth into executeAgentRun

## Surprises & Discoveries

- Observation: ESLint rule `e18e/prefer-static-regex` requires all regex literals to be at module scope
  Evidence: `configureRemoteAuth` inline regex caused lint failure; moved to `GITHUB_HTTPS_URL_RE` constant
