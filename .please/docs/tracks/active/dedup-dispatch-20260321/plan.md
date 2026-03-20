# Plan: Deduplicate agent dispatch with Chat SDK state lock

> Track: dedup-dispatch-20260321
> Spec: (conversation-derived — no formal spec file)

## Overview

- **Source**: Conversation analysis of duplicate dispatch between polling and comment @mention paths
- **Issue**: TBD
- **Created**: 2026-03-21
- **Approach**: Pragmatic — inject Chat SDK `StateAdapter` as shared lock layer across all dispatch paths

## Purpose

After this change, when a GitHub issue is both in a project (polling dispatch) and receives a comment @mention, only one agent run will execute. Operators can verify it works by triggering both paths simultaneously and observing that only one agent is dispatched, with the second path logging a skip.

## Context

Agent Please has two independent agent dispatch paths that can fire concurrently for the same issue without deduplication:

1. **Polling dispatch** — `Orchestrator.tick()` fetches candidate issues from GitHub Projects v2, checks `state.running`/`state.claimed` maps, and calls `dispatchIssue()`. This path has in-memory dedup.

2. **Comment @mention dispatch** — `handleIssueCommentMention()` in `issue-comment-handler.ts` is called fire-and-forget from `github.post.ts` webhook handler. It creates a workspace and runs an agent independently, with no awareness of orchestrator state.

3. **Chat SDK path** — `bot.onNewMention()` currently only returns orchestrator status, but could dispatch agents in the future. Note: the Chat SDK GitHub adapter only handles PR comments (checks `issue.pull_request` field) — plain issue comments fall through to the `handleIssueCommentMention` path.

The three paths use incompatible ID formats:
- Orchestrator: GraphQL ProjectV2Item node ID (`PVTI_kwDO...`)
- Issue comment handler: `owner/repo#number`
- Chat SDK GitHub adapter threadId: `github:{owner}/{repo}:{prNumber}` (PR-only, no issue-level format)

Chat SDK's thread model is platform-specific. While GitHub is PR-only today, other adapters already handle issue-level threads natively:

| Platform | Thread = | threadId format |
|---|---|---|
| GitHub | PR (Conversation / Files Changed) | `github:{owner}/{repo}:{prNumber}[:rc:{commentId}]` |
| Linear | Issue | `linear:{issueId}` |
| Asana | Task | `asana:{taskGid}` |
| Slack | Channel message thread | `slack:{channelId}:{ts}` |

The lock key should align with Chat SDK's threadId convention so that when other adapters process @mentions, the same lock naturally prevents duplicate dispatch. For GitHub issues specifically (no adapter threadId exists), we define a consistent extension: `github:{owner}/{repo}:issue:{number}`.

The Chat SDK's `StateAdapter` (memory for dev, Redis/PG for production) provides `acquireLock(threadId, ttlMs)` / `extendLock(lock, ttlMs)` / `releaseLock(lock)` — this scales from single-process to distributed when the state adapter is swapped.

**Non-goals:**
- Replacing orchestrator's `running`/`claimed` state — those remain for status tracking, UI, and reconciliation
- Distributed orchestrator state — only the lock layer is shared
- Modifying Chat SDK's GitHub adapter to support issue threads (we generate compatible keys ourselves)

## Architecture Decision

**Chosen approach: Chat SDK StateAdapter as shared dispatch lock**

The `Chat` instance already exists in the Nitro app (`02.chat-bot.ts`) and exposes `getState(): StateAdapter`. We pass this `StateAdapter` to the orchestrator and issue comment handler. Before dispatching an agent, each path calls `acquireLock(canonicalKey, ttlMs)`. If the lock is already held, the dispatch is skipped.

**Why not just share orchestrator's `running` map?**
- Only works in-process — doesn't scale to multi-instance
- Requires coupling `handleIssueCommentMention` to the orchestrator class
- Doesn't handle crash recovery (stale locks auto-expire with `acquireLock`)

**Why not `setIfNotExists` instead of `acquireLock`?**
- `acquireLock` has built-in TTL, token-based ownership, and `extendLock` for long-running agents
- `setIfNotExists` would require manual TTL management and no extend mechanism

**Lock key format**: Aligned with Chat SDK threadId convention per platform:
- GitHub issues: `github:{owner}/{repo}:issue:{number}` (new — extends adapter pattern)
- GitHub PRs: `github:{owner}/{repo}:{prNumber}` (matches existing adapter threadId)
- Asana tasks: `asana:{taskGid}` (matches future adapter pattern)
- Linear issues: `linear:{issueId}` (matches future adapter pattern)

Derivation:
- Orchestrator: parse `issue.url` (`https://github.com/{owner}/{repo}/issues/{number}`) or use `issue.project.owner` + `issue.identifier`
- Issue comment handler: `payload.repository.full_name` + `payload.issue.number`
- Chat SDK handlers: use adapter's `thread.id` directly (already a threadId)

**Lock TTL strategy**:
- Initial TTL: 5 minutes (300,000 ms)
- Extend interval: every 2 minutes during agent execution
- On agent exit (normal or error): explicit `releaseLock()`
- On crash: lock auto-expires after TTL, allowing re-dispatch on next tick

## Tasks

- [x] T001 Create canonical lock key utility (file: packages/core/src/dispatch-lock.ts)
- [x] T002 Integrate StateAdapter into Orchestrator constructor and dispatchIssue (file: packages/core/src/orchestrator.ts) (depends on T001)
- [x] T003 Add lock extend loop in executeAgentRun and release in onWorkerExit (file: packages/core/src/orchestrator.ts) (depends on T002)
- [x] T004 Integrate StateAdapter into handleIssueCommentMention (file: packages/core/src/issue-comment-handler.ts) (depends on T001)
- [x] T005 Pass StateAdapter from Chat bot plugin to orchestrator and webhook handler (file: apps/agent-please/server/plugins/02.chat-bot.ts) (depends on T002, T004)
- [x] T006 Add fallback no-op StateAdapter when Chat SDK is not configured (file: packages/core/src/dispatch-lock.ts) (depends on T001)

## Key Files

### Create
- `packages/core/src/dispatch-lock.ts` — canonical key derivation, lock acquire/extend/release helpers, no-op fallback adapter

### Modify
- `packages/core/src/orchestrator.ts` — accept `StateAdapter?`, acquire lock in `dispatchIssue()`, extend in `executeAgentRun()`, release in `onWorkerExit()`/`terminateRunningIssue()`
- `packages/core/src/issue-comment-handler.ts` — accept `StateAdapter?` in deps, acquire lock before agent run, release on exit
- `packages/core/src/types.ts` — add `StateAdapter` type re-export or minimal interface
- `apps/agent-please/server/plugins/02.chat-bot.ts` — expose `StateAdapter` to orchestrator
- `apps/agent-please/server/api/webhooks/github.post.ts` — pass `StateAdapter` to `handleIssueCommentMention`
- `packages/core/src/index.ts` — export new dispatch-lock utilities

### Reuse
- `node_modules/chat/dist/index.d.ts` — `StateAdapter`, `Lock` interfaces
- `node_modules/@chat-adapter/state-memory` — `createMemoryState()` for fallback

## Verification

### Automated Tests

- [ ] `dispatch-lock.test.ts`: `toDispatchLockKey()` derives `github:{owner}/{repo}:issue:{number}` from issue URL, identifier, and webhook payload formats
- [ ] `dispatch-lock.test.ts`: `acquireDispatchLock()` returns lock on first call, returns null on second call with same key
- [ ] `dispatch-lock.test.ts`: lock is released and re-acquirable after `releaseDispatchLock()`
- [ ] `dispatch-lock.test.ts`: no-op adapter always returns a synthetic lock (never blocks)
- [ ] `orchestrator.test.ts`: `dispatchIssue()` skips dispatch when lock already held
- [ ] `orchestrator.test.ts`: lock is released when worker exits (normal and error paths)
- [ ] `orchestrator.test.ts`: lock is released when `terminateRunningIssue()` is called
- [ ] `issue-comment-handler.test.ts`: handler skips when lock already held, logs warning

### Observable Outcomes

- After dispatching an issue via polling, a simultaneous @mention comment for the same issue is skipped with log: `dispatch lock held — skipping`
- After agent completes, the same issue can be re-dispatched by either path
- Running with `createMemoryState()` (default) works identically to no-adapter mode for single-process

### Manual Testing

- [ ] Create a GitHub issue in a project (active status) and immediately post an @mention comment — verify only one agent runs
- [ ] Verify existing polling dispatch still works when no StateAdapter is provided (fallback)

## Progress

- [x] (2026-03-21 04:30 KST) T001 Create canonical lock key utility
  Evidence: `bun test dispatch-lock.test.ts` → 10 tests passed (17ms)
- [x] (2026-03-21 04:45 KST) T002 Integrate StateAdapter into Orchestrator constructor and dispatchIssue
  Evidence: `bun test orchestrator.test.ts` → 80 tests passed (1.3s)
- [x] (2026-03-21 05:00 KST) T003 Add lock extend loop in executeAgentRun and release in onWorkerExit
  Evidence: `bun run test` → all workspaces pass, 4/4 tasks successful
- [x] (2026-03-21 05:15 KST) T004 Integrate StateAdapter into handleIssueCommentMention
  Evidence: `bun test issue-comment-handler.test.ts` → 22 tests passed (136ms)
- [x] (2026-03-21 05:20 KST) T005 Pass StateAdapter from Chat bot plugin to orchestrator and webhook handler
  Evidence: `bun run check` → 3/3 tasks successful
- [x] (2026-03-21 05:20 KST) T006 Add fallback no-op StateAdapter (already implemented in T001)
  Evidence: `bun test dispatch-lock.test.ts` → noop adapter tests pass

## Decision Log

- Decision: Use `acquireLock/extendLock/releaseLock` over `setIfNotExists/delete`
  Rationale: Built-in TTL expiry handles crash recovery; extend mechanism supports long-running agents; semantically matches exclusive dispatch
  Date/Author: 2026-03-21 / Claude

- Decision: Lock key follows Chat SDK threadId convention (`github:{owner}/{repo}:issue:{number}`) instead of custom format
  Rationale: Aligns with Chat SDK's per-platform threadId pattern; when Linear/Asana adapters handle @mentions, their `thread.id` can be used as lock key directly without translation; extends GitHub adapter convention naturally for issues
  Date/Author: 2026-03-21 / Claude (revised)

- Decision: StateAdapter is optional (nullable) in orchestrator and comment handler
  Rationale: Preserves backward compatibility when Chat SDK is not configured; no-op fallback ensures existing behavior unchanged
  Date/Author: 2026-03-21 / Claude

## Surprises & Discoveries

- Observation: Chat SDK GitHub adapter only processes PR comments, not plain issue comments
  Evidence: `handleWebhook()` checks `issuePayload.issue.pull_request` and skips if absent — plain issue @mentions bypass Chat SDK entirely and go to `handleIssueCommentMention`
- Observation: Chat SDK threadId format is PR-centric (`github:owner/repo:prNumber`), not issue-centric
  Evidence: `encodeThreadId()` in `@chat-adapter/github` source uses `prNumber` field exclusively; no issue-level threadId format exists
