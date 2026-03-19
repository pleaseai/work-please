# Plan: Nuxt + Chat SDK Migration

> Track: nuxt-chat-sdk-migration-20260319
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/nuxt-chat-sdk-migration-20260319/spec.md
- **Issue**: TBD
- **Created**: 2026-03-19
- **Approach**: Incremental Migration

## Purpose

After this change, the Work Please monorepo will be a unified Nuxt application where the orchestrator daemon, dashboard UI, and GitHub issue comment bot all run in a single process. Operators can verify it works by running `work-please run WORKFLOW.md --port 3000` and seeing the Nuxt UI dashboard at `http://localhost:3000` with live orchestrator state, while @mentioning the bot in a GitHub issue comment triggers an automated status response.

## Context

Work Please currently has two separate workspaces: `apps/work-please` (a CLI daemon using Commander.js + `Bun.serve` for the HTTP server) and `apps/dashboard` (a Vue 3 SPA using shadcn-vue/Reka UI + Tailwind CSS v4 that polls the daemon's JSON API). The dashboard is served as static files from the daemon's HTTP server, requiring a separate build step and a fragile `DASHBOARD_DIST` path resolution.

The migration merges both into a single Nuxt 3 application with Nuxt UI for the dashboard components, Nitro server routes replacing the hand-rolled `Bun.serve` HTTP handler, and Chat SDK's `@chat-adapter/github` for responding to GitHub issue comment @mentions. The orchestrator's core logic (poll/dispatch/retry loop, tracker adapters, agent runner, workspace management) is extracted into `packages/core` as a pure TypeScript package with no framework dependency, then imported by the Nuxt app.

Key constraints: the orchestrator's in-memory state model and discriminated union error types must be preserved unchanged; all existing unit tests must continue to pass; the CLI entry point (`work-please run`, `work-please init`) must remain functional; and the Bun runtime must be supported via Nitro's `bun` preset.

Non-goals: production state adapters (Redis/PostgreSQL) for Chat SDK, other chat platform adapters (Slack, Discord), streaming responses, and redesigning the orchestrator's core logic.

## Architecture Decision

The chosen approach is **incremental in-place migration** across 6 phases, each producing a working system.

Phase 1 extracts all orchestrator logic into `packages/core` — a pure structural change with zero behavior modification. This creates a clean boundary between framework-agnostic business logic and the Nuxt application layer.

Phase 2 transforms `apps/work-please` into a Nuxt app by adding `nuxt.config.ts`, creating a Nitro server plugin that instantiates the Orchestrator at startup, and migrating the 4 API routes from the monolithic `server.ts` into individual Nitro route handlers.

Phase 3 migrates the dashboard UI from `apps/dashboard` (shadcn-vue) into the Nuxt app using Nuxt UI's Dashboard layout, then deletes the old dashboard workspace.

Phase 4 rewires the CLI entry point to start the Nuxt server programmatically instead of calling `Bun.serve` directly.

Phase 5 adds Chat SDK with the GitHub adapter as a second Nitro plugin, sharing the orchestrator reference for status lookups.

Phase 6 cleans up legacy code and updates documentation.

This was preferred over a "big-bang" rewrite because each phase can be validated independently, and the `packages/core` extraction ensures the most critical code (orchestrator logic) is never modified — only moved.

## Tasks

### Phase 1: Extract `packages/core`

- [ ] T001 Create `packages/core` package scaffold (file: packages/core/package.json)
- [ ] T002 [P] Move orchestrator source files to `packages/core/src/` (file: packages/core/src/index.ts) (depends on T001)
- [ ] T003 [P] Move co-located test files to `packages/core/` (depends on T001)
- [ ] T004 Create barrel export `packages/core/src/index.ts` (depends on T002)
- [ ] T005 Update `apps/work-please/src/` imports to use `@pleaseai/core` (file: apps/work-please/src/cli.ts) (depends on T004)
- [ ] T006 Verify: all tests pass, build passes, type-check passes (depends on T005)

### Phase 2: Initialize Nuxt in `apps/work-please`

- [ ] T007 Add Nuxt, Nuxt UI, and Nitro dependencies (file: apps/work-please/package.json) (depends on T006)
- [ ] T008 Create `nuxt.config.ts` with Bun preset and Nuxt UI module (file: apps/work-please/nuxt.config.ts) (depends on T007)
- [ ] T009 Create minimal `app/app.vue` with `<UApp>` wrapper (file: apps/work-please/app/app.vue) (depends on T008)
- [ ] T010 Create Nitro server plugin for orchestrator lifecycle (file: apps/work-please/server/plugins/orchestrator.ts) (depends on T008)
- [ ] T011 Create `server/utils/orchestrator.ts` helper (file: apps/work-please/server/utils/orchestrator.ts) (depends on T010)
- [ ] T012 [P] Migrate GET `/api/v1/state` to Nitro route (file: apps/work-please/server/api/v1/state.get.ts) (depends on T011)
- [ ] T013 [P] Migrate POST `/api/v1/refresh` to Nitro route (file: apps/work-please/server/api/v1/refresh.post.ts) (depends on T011)
- [ ] T014 [P] Migrate GET `/api/v1/:identifier` to Nitro route (file: apps/work-please/server/api/v1/[identifier].get.ts) (depends on T011)
- [ ] T015 [P] Migrate POST webhook to Nitro route (file: apps/work-please/server/api/webhooks/github.post.ts) (depends on T011)
- [ ] T016 Verify: `nuxt dev` starts, API routes respond correctly (depends on T012, T013, T014, T015)

### Phase 3: Migrate Dashboard UI

- [ ] T017 Create dashboard layout with `UDashboardLayout` (file: apps/work-please/app/layouts/dashboard.vue) (depends on T016)
- [ ] T018 [P] Migrate `useOrchestratorState` composable to `useFetch` (file: apps/work-please/app/composables/useOrchestratorState.ts) (depends on T017)
- [ ] T019 [P] Migrate `useIssueDetail` composable to `useFetch` (file: apps/work-please/app/composables/useIssueDetail.ts) (depends on T017)
- [ ] T020 Migrate DashboardPage to `pages/index.vue` with Nuxt UI components (file: apps/work-please/app/pages/index.vue) (depends on T018)
- [ ] T021 Migrate IssuePage to `pages/issues/[identifier].vue` (file: apps/work-please/app/pages/issues/[identifier].vue) (depends on T019)
- [ ] T022 [P] Migrate domain components (MetricCard, RunningTable, RetryTable, StateBadge, RefreshButton) (depends on T017)
- [ ] T023 Delete `apps/dashboard/` workspace and remove dashboard scripts from root package.json (depends on T020, T021, T022)
- [ ] T024 Verify: dashboard accessible at `/`, issue detail at `/issues/:id` (depends on T023)

### Phase 4: CLI Integration

- [ ] T025 Rewrite CLI to start Nuxt server programmatically (file: apps/work-please/src/cli.ts) (depends on T024)
- [ ] T026 Update build script for Nuxt build + CLI bundling (file: apps/work-please/package.json) (depends on T025)
- [ ] T027 Delete old `server.ts` and `server.test.ts` (depends on T025)
- [ ] T028 Verify: `work-please run WORKFLOW.md --port 3000` starts Nuxt + orchestrator (depends on T026, T027)

### Phase 5: Chat SDK Integration

- [ ] T029 Add Chat SDK dependencies (`chat`, `@chat-adapter/github`, `@chat-adapter/state-memory`) (file: apps/work-please/package.json) (depends on T028)
- [ ] T030 Create Chat SDK Nitro plugin with GitHub adapter (file: apps/work-please/server/plugins/chat-bot.ts) (depends on T029)
- [ ] T031 Wire Chat SDK webhook handler into existing webhook route (file: apps/work-please/server/api/webhooks/github.post.ts) (depends on T030)
- [ ] T032 Implement status lookup handler (query orchestrator state for mentioned issue) (depends on T031)
- [ ] T033 Verify: @mention in GitHub issue comment triggers bot response (depends on T032)

### Phase 6: Cleanup

- [ ] T034 Update `ARCHITECTURE.md`, `CLAUDE.md`, tech-stack docs (depends on T033)
- [ ] T035 Update `turbo.json` task pipeline for Nuxt build outputs (depends on T033)
- [ ] T036 Final verification: full test suite, build, lint, type-check (depends on T034, T035)

## Key Files

### Create

| File | Purpose |
|------|---------|
| `packages/core/package.json` | Core package manifest (`@pleaseai/core`) |
| `packages/core/src/index.ts` | Barrel export for all orchestrator logic |
| `packages/core/tsconfig.json` | TypeScript config for core package |
| `apps/work-please/nuxt.config.ts` | Nuxt configuration (Bun preset, Nuxt UI, runtime config) |
| `apps/work-please/app.config.ts` | Nuxt UI theme configuration |
| `apps/work-please/app/app.vue` | Root Nuxt component with `<UApp>` |
| `apps/work-please/app/layouts/dashboard.vue` | Nuxt UI Dashboard layout |
| `apps/work-please/app/pages/index.vue` | Dashboard page |
| `apps/work-please/app/pages/issues/[identifier].vue` | Issue detail page |
| `apps/work-please/app/composables/useOrchestratorState.ts` | Polling composable (useFetch-based) |
| `apps/work-please/app/composables/useIssueDetail.ts` | Issue detail composable (useFetch-based) |
| `apps/work-please/server/plugins/orchestrator.ts` | Nitro plugin: Orchestrator lifecycle |
| `apps/work-please/server/plugins/chat-bot.ts` | Nitro plugin: Chat SDK bot |
| `apps/work-please/server/utils/orchestrator.ts` | `useOrchestrator()` helper |
| `apps/work-please/server/api/v1/state.get.ts` | GET /api/v1/state |
| `apps/work-please/server/api/v1/refresh.post.ts` | POST /api/v1/refresh |
| `apps/work-please/server/api/v1/[identifier].get.ts` | GET /api/v1/:identifier |
| `apps/work-please/server/api/webhooks/github.post.ts` | POST /api/webhooks/github |

### Modify

| File | Purpose |
|------|---------|
| `apps/work-please/src/cli.ts` | Rewrite to start Nuxt server programmatically |
| `apps/work-please/package.json` | Add Nuxt/Nuxt UI/Chat SDK deps, update build scripts |
| `turbo.json` | Update build outputs for Nuxt `.output/` |
| `package.json` (root) | Remove dashboard workspace scripts |
| `ARCHITECTURE.md` | Update architecture documentation |
| `CLAUDE.md` | Update development commands |

### Reuse

| File | Purpose |
|------|---------|
| `apps/work-please/src/orchestrator.ts` -> `packages/core/src/orchestrator.ts` | Core poll/dispatch/retry loop (moved, not modified) |
| `apps/work-please/src/types.ts` -> `packages/core/src/types.ts` | All shared types (moved, not modified) |
| `apps/work-please/src/config.ts` -> `packages/core/src/config.ts` | Config building (moved, not modified) |
| `apps/work-please/src/webhook.ts` -> `packages/core/src/webhook.ts` | Webhook verification (moved, not modified) |
| `apps/work-please/src/server.ts` | Response shaping functions extracted into Nitro route handlers |
| `apps/dashboard/src/lib/format.ts` | `formatDateTime()`, `formatTokens()` utilities reused in Nuxt app |

### Delete

| File | Purpose |
|------|---------|
| `apps/dashboard/` | Entire dashboard workspace (replaced by Nuxt app) |
| `apps/work-please/src/server.ts` | Old Bun.serve HTTP handler (replaced by Nitro) |
| `apps/work-please/src/server.test.ts` | Tests for old server (replaced by Nitro route tests) |

## Verification

### Automated Tests

- [ ] All existing `packages/core` tests pass after extraction (zero logic changes)
- [ ] Nitro route tests verify API response shapes match current format
- [ ] Chat SDK handler test verifies @mention triggers status response

### Observable Outcomes

- After running `work-please run WORKFLOW.md --port 3000`, the Nuxt UI dashboard is accessible at `http://localhost:3000`
- Running `curl http://localhost:3000/api/v1/state` returns the same JSON shape as before migration
- After @mentioning the bot in a GitHub issue comment, a reply appears with the issue's agent status

### Manual Testing

- [ ] Dashboard shows running/retrying issues with live updates
- [ ] Issue detail page shows session info, retry info, and recent events
- [ ] Refresh button triggers immediate orchestrator poll
- [ ] Theme toggle (light/dark) works

### Acceptance Criteria Check

- [ ] AC-1: `work-please run` starts the Nuxt server and orchestrator loop
- [ ] AC-2: Dashboard accessible at `/` with Nuxt UI Dashboard layout
- [ ] AC-3: GitHub webhook at `POST /api/webhooks/github` processes events via Chat SDK
- [ ] AC-4: Bot responds to @mentions with agent status
- [ ] AC-5: Existing API endpoints respond correctly under Nitro routes
- [ ] AC-6: `bun run build` produces a deployable bundle

## Decision Log

- Decision: Extract orchestrator to `packages/core` before Nuxt migration
  Rationale: Creates clean boundary between framework-agnostic business logic and Nuxt app layer; enables zero-logic-change migration with full test coverage as validation gate
  Date/Author: 2026-03-19 / Claude

- Decision: Use Nitro server plugins for orchestrator and Chat SDK lifecycle
  Rationale: Nitro plugins run once at server startup and support shutdown hooks via `nitroApp.hooks.hook('close', ...)`, matching the orchestrator's start/stop lifecycle perfectly
  Date/Author: 2026-03-19 / Claude

- Decision: In-memory state adapter for Chat SDK MVP
  Rationale: Simplest integration for MVP; production state adapters (Redis/PostgreSQL) can be added later without architectural changes
  Date/Author: 2026-03-19 / Claude

- Decision: CLI entry point starts Nuxt server programmatically (Option A)
  Rationale: Preserves npm `bin` distribution as `@pleaseai/work`, keeps CLI UX (Commander.js `--port`, `--verbose`), and allows fast error handling before Nuxt boot
  Date/Author: 2026-03-19 / User + Claude
