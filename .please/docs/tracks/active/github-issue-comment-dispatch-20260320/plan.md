# Plan: GitHub Issue Comment Agent Dispatch

> Track: github-issue-comment-dispatch-20260320
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/github-issue-comment-dispatch-20260320/spec.md
- **Created**: 2026-03-20
- **Approach**: Incremental (config first, then webhook handler, then agent dispatch)

## Purpose

After this change, operators can configure `chat.bot_username` in WORKFLOW.md instead of setting env vars. When someone @mentions the bot in a GitHub issue comment, the bot reacts with eyes emoji, runs Claude Code with the comment text, posts the response, and marks completion with a rocket emoji.

## Tasks

### Phase 1: Add `chat` config to types + config builder

- [x] T001 Add `ChatConfig` types to `packages/core/src/types.ts`
- [x] T002 Add `buildChatConfig()` to `packages/core/src/config.ts`
- [x] T003 Add chat config tests to `packages/core/src/config.test.ts`
- [x] T004 Export new types from `packages/core/src/index.ts`

### Phase 2: Update chat bot plugin

- [x] T005 Modify `apps/work-please/server/plugins/02.chat-bot.ts` to use `config.chat`

### Phase 3: Issue comment agent dispatch

- [x] T006 Create `packages/core/src/issue-comment-handler.ts` (GitHub API + agent dispatch combined)
- [x] T007 Wire handler into `apps/work-please/server/api/webhooks/github.post.ts`
- [x] T008 Add `getWorkflow()` method to Orchestrator

### Phase 4: Tests + verification

- [x] T009 Add tests for `issue-comment-handler.ts` (16 tests)
- [x] T010 Verify: `bun run test` (601 pass + 1 pre-existing flaky), `bun run check` (0 errors), `bun run lint` (0 errors)

## Key Files

### Create

| File | Purpose |
|------|---------|
| `packages/core/src/issue-comment-handler.ts` | Issue comment handler: @mention detection, agent dispatch, reaction management |
| `packages/core/src/issue-comment-handler.test.ts` | Tests for extractMentionPrompt, shouldHandleComment, handleIssueCommentMention |

### Modify

| File | Change |
|------|--------|
| `packages/core/src/types.ts` | Add `ChatConfig`, `ChatGitHubConfig`, `ChatSlackConfig`; add `chat` to `ServiceConfig` |
| `packages/core/src/config.ts` | Add `buildChatConfig()`, wire into `buildConfig()` |
| `packages/core/src/config.test.ts` | Add 9 chat config tests |
| `packages/core/src/index.ts` | Export new types + issue-comment-handler |
| `packages/core/src/orchestrator.ts` | Add `getWorkflow()` method |
| `packages/core/src/server.test.ts` | Add `chat` to mock ServiceConfig |
| `packages/core/src/tools.test.ts` | Add `chat` to mock ServiceConfig |
| `packages/core/src/label.test.ts` | Add `chat` to mock ServiceConfig |
| `packages/core/src/tracker/github-auth.test.ts` | Add `chat` to mock ServiceConfig |
| `apps/work-please/server/plugins/02.chat-bot.ts` | Use `config.chat` for bot_username and adapter config |
| `apps/work-please/server/api/webhooks/github.post.ts` | Add plain issue comment agent dispatch routing |

## Verification

1. `bun run check` — 0 type errors
2. `bun run lint` — 0 lint errors
3. `bun run test` — 601 pass, 1 pre-existing flaky (workspace timeout test)

## Progress

- [x] (2026-03-20 12:00 KST) Phase 1 complete: ChatConfig types + buildChatConfig + 9 tests
- [x] (2026-03-20 12:05 KST) Phase 2 complete: chat bot plugin uses config.chat
- [x] (2026-03-20 12:10 KST) Phase 3 complete: issue-comment-handler + webhook wiring
- [x] (2026-03-20 12:15 KST) Phase 4 complete: 16 handler tests + full verification

## Design Decisions

- **Merged github-comments.ts into issue-comment-handler.ts**: The GitHub REST API helpers (reactions, comments) are used only by the issue comment handler, so a separate file was unnecessary. The webhook route creates a `GitHubApi` implementation using raw `fetch` calls.
- **`GitHubApi` interface over direct Octokit**: The handler depends on a `GitHubApi` interface, not a concrete Octokit instance. This allows the webhook route to create a lightweight fetch-based implementation and makes the handler easy to test with mocks.
- **Fire-and-forget dispatch**: The webhook handler returns 202 immediately and dispatches `handleIssueCommentMention()` asynchronously. Errors are caught and reported via confused emoji + error comment on the issue.
- **Fallback chain for bot_username**: `config.chat.bot_username` -> `GITHUB_BOT_USERNAME` env -> `'work-please'` default.
