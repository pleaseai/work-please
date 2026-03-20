# Plan: Platform-Centric Config Structure

> Track: platform-centric-config-20260320
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: [spec.md](./spec.md)
- **Issue**: #151
- **Created**: 2026-03-20
- **Approach**: Minimal Change

## Purpose

After this change, users configuring WORKFLOW.md will define credentials once per platform in a `platforms` registry, then reference that platform from `projects` (polling) and `channels` (chat). They can verify it works by running the orchestrator with the new YAML shape and seeing it poll issues and respond to chat mentions exactly as before.

## Context

The current `ServiceConfig` splits external service integration into `tracker` (single) and `chat` sections. GitHub credentials can appear in both `tracker.api_key` and are implicitly shared with `chat.github`. Slack credentials live only in `chat.slack`. This creates credential duplication, prevents multi-project polling, and makes "where is the GitHub config?" unanswerable with a single location.

The refactor restructures into three sections: `platforms` (credentials registry keyed by service name), `projects` (array of polling targets referencing a platform), and `channels` (array of conversational surfaces referencing a platform). Agent-related config (`agent`, `claude`, `workspace`, `hooks`, `polling`, `env`, `db`, `server`) is unchanged.

This is a breaking change. No backward compatibility is required — the project has no external users yet. The ADR is already approved in `.please/docs/decisions/config-platforms-projects-channels.md`.

### Non-Goals

- Adding new platform integrations (Linear, Asana adapters remain as-is)
- Multi-project polling merge logic (structure supports N projects, but orchestrator can iterate sequentially)
- Migration tooling for existing WORKFLOW.md files

## Architecture Decision

**Chosen approach: Minimal Change** — Replace `tracker: TrackerConfig` + `chat: ChatConfig` with `platforms: Record<string, PlatformConfig>` + `projects: ProjectConfig[]` + `channels: ChannelConfig[]` on `ServiceConfig`. Keep all other sections unchanged. Each `ProjectConfig` and `ChannelConfig` references a platform key. The tracker adapter factory receives a `ProjectConfig` + resolved `PlatformConfig` instead of the full `ServiceConfig`. The chat bot plugin iterates over `channels[]` to initialize adapters. Validation moves from single-tracker checks to per-project and per-channel validation.

## Tasks

### Phase 1: Type Definitions

- [x] (2026-03-20 10:00 KST) T001 Define new config types — PlatformConfig, ProjectConfig, ChannelConfig (file: packages/core/src/types.ts)
- [x] (2026-03-20 10:00 KST) T002 Update ServiceConfig to use platforms/projects/channels (file: packages/core/src/types.ts, depends on T001)

### Phase 2: Config Parser

- [x] (2026-03-20 12:00 KST) T003 Implement buildPlatformsConfig parser (file: packages/core/src/config.ts, depends on T002)
- [x] (2026-03-20 12:00 KST) T004 Implement buildProjectsConfig parser (file: packages/core/src/config.ts, depends on T003)
- [x] (2026-03-20 12:00 KST) T005 Implement buildChannelsConfig parser (file: packages/core/src/config.ts, depends on T003)
- [x] (2026-03-20 12:00 KST) T006 Update buildConfig to use new section parsers (file: packages/core/src/config.ts, depends on T004, T005)
- [x] (2026-03-20 12:00 KST) T007 Update validateConfig for per-project and per-channel validation (file: packages/core/src/config.ts, depends on T006)
- [x] (2026-03-20 12:00 KST) T008 Update getActiveStates, getTerminalStates, getWatchedStates helpers (file: packages/core/src/config.ts, depends on T006)

### Phase 3: Tracker Adapter Updates

- [x] (2026-03-20 14:00 KST) T009 Update createTrackerAdapter to accept ProjectConfig + PlatformConfig (file: packages/core/src/tracker/index.ts, depends on T002)
- [x] (2026-03-20 14:00 KST) T010 Update createGitHubAdapter for new config shape (file: packages/core/src/tracker/github.ts, depends on T009)
- [x] (2026-03-20 14:00 KST) T011 Update createAsanaAdapter for new config shape (file: packages/core/src/tracker/asana.ts, depends on T009)
- [x] (2026-03-20 14:00 KST) T012 Update createAuthenticatedGraphql for PlatformConfig (file: packages/core/src/tracker/github-auth.ts, depends on T010)

### Phase 4: Orchestrator & Runtime Updates

- [x] (2026-03-20 15:00 KST) T013 Update orchestrator to iterate over projects[] (file: packages/core/src/orchestrator.ts, depends on T008, T009)
- [x] (2026-03-20 15:00 KST) T014 Update workspace functions for new config shape (file: packages/core/src/workspace.ts, depends on T002)
- [x] (2026-03-20 15:00 KST) T015 Update agent-runner and agent-env for new config shape (file: packages/core/src/agent-runner.ts, depends on T002)
- [x] (2026-03-20 15:00 KST) T016 Update agent-env resolveAgentEnv (file: packages/core/src/agent-env.ts, depends on T002)
- [x] (2026-03-20 15:00 KST) T017 Update label service for new config shape (file: packages/core/src/label.ts, depends on T002)
- [x] (2026-03-20 15:00 KST) T018 Update tools module for new config shape (file: packages/core/src/tools.ts, depends on T002)
- [x] (2026-03-20 15:00 KST) T019 Update issue-comment-handler for channels config (file: packages/core/src/issue-comment-handler.ts, depends on T002)

### Phase 5: App Layer Updates

- [ ] T020 Update chat bot plugin to iterate channels[] (file: apps/agent-please/server/plugins/02.chat-bot.ts, depends on T005, T019)
- [ ] T021 Update GitHub webhook handler for new config shape (file: apps/agent-please/server/api/webhooks/github.post.ts, depends on T020)
- [ ] T022 Update Slack webhook handler for new config shape (file: apps/agent-please/server/api/webhooks/slack.post.ts, depends on T020)

### Phase 6: Tests & Documentation

- [ ] T023 Update config.test.ts for new YAML structure (file: packages/core/src/config.test.ts, depends on T007)
- [ ] T024 Update orchestrator.test.ts for projects[] iteration (file: packages/core/src/orchestrator.test.ts, depends on T013)
- [ ] T025 Update tracker tests for new adapter signatures (file: packages/core/src/tracker/tracker.test.ts, depends on T010, T011)
- [ ] T026 Update remaining test files — workspace, agent-env, label, tools, issue-comment-handler (depends on T014, T015, T016, T017, T018, T019)
- [ ] T027 Update WORKFLOW.md documentation examples (depends on T006)

## Key Files

### Create

_(none — this refactor modifies existing files only)_

### Modify

- `packages/core/src/types.ts` — Replace TrackerConfig + ChatConfig with PlatformConfig, ProjectConfig, ChannelConfig
- `packages/core/src/config.ts` — New section parsers, updated buildConfig, updated validateConfig
- `packages/core/src/tracker/index.ts` — Adapter factory signature change
- `packages/core/src/tracker/github.ts` — Accept PlatformConfig + ProjectConfig
- `packages/core/src/tracker/asana.ts` — Accept PlatformConfig + ProjectConfig
- `packages/core/src/tracker/github-auth.ts` — Accept PlatformConfig
- `packages/core/src/orchestrator.ts` — Iterate projects[], resolve platform per project
- `packages/core/src/workspace.ts` — Config access pattern update
- `packages/core/src/agent-runner.ts` — Config access pattern update
- `packages/core/src/agent-env.ts` — Config access pattern update
- `packages/core/src/label.ts` — Config access pattern update
- `packages/core/src/tools.ts` — Config access pattern update
- `packages/core/src/issue-comment-handler.ts` — Use channels config
- `apps/agent-please/server/plugins/02.chat-bot.ts` — Iterate channels[]
- `apps/agent-please/server/api/webhooks/github.post.ts` — New config access
- `apps/agent-please/server/api/webhooks/slack.post.ts` — New config access

### Reuse

- `packages/core/src/config.ts` — All helper functions (resolveEnvValue, csvValue, sectionMap, etc.)
- `packages/core/src/prompt-builder.ts` — Unchanged
- `packages/core/src/workflow.ts` — Unchanged (raw YAML parsing)

## Verification

### Automated Tests

- [ ] config.test.ts: new YAML shape parses to correct typed ServiceConfig
- [ ] config.test.ts: $ENV_VAR resolution works for platform credentials
- [ ] config.test.ts: validateConfig rejects missing platform references in projects/channels
- [ ] config.test.ts: validateConfig accepts valid multi-project config
- [ ] orchestrator.test.ts: orchestrator dispatches from projects[] correctly
- [ ] tracker.test.ts: adapter factory accepts ProjectConfig + PlatformConfig
- [ ] issue-comment-handler.test.ts: uses channels config for bot username and associations

### Observable Outcomes

- Running `bun run check` shows zero type errors after all changes
- Running `bun run test` shows all tests pass with new config shape
- Running `bun run lint` shows no lint errors

### Manual Testing

- [ ] Create a WORKFLOW.md with the new platforms/projects/channels format and verify the orchestrator starts and polls

## Decision Log

- Decision: Use Minimal Change approach — modify existing files rather than creating new modules
  Rationale: The refactor is a type/shape change, not an architectural change. Keeping files in place minimizes import churn and git blame disruption.
  Date/Author: 2026-03-20 / Claude
