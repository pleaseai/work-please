# Plan: Watched States with Auto-Transition

## Overview

- **Source**: Design discussion in session (PR #80 follow-up)
- **Issue**: TBD
- **Created**: 2026-03-14
- **Approach**: Minimal Change

## Purpose

After this change, operators will have items in "Human Review" automatically transition to "Rework" when reviewers request changes or leave unresolved comments, and to "Merging" when the PR is approved. They can verify it works by moving an item to "Human Review" and observing it auto-transition after a PR review is submitted.

## Context

### Problem

The orchestrator currently polls only `active_states` (Todo, In Progress, Merging, Rework) and dispatches agents for them. Items in "Human Review" are invisible to the orchestrator — they sit on the board until a human manually moves them to Rework or Merging. This creates a manual bottleneck: after a reviewer requests changes or approves a PR, someone must remember to drag the card on the board.

The Symphony reference implementation handles this by having the orchestrator poll "Human Review" items and check for external signals (PR review status, comments). When a signal is detected, the orchestrator transitions the item's board status automatically, and the next poll cycle dispatches an agent for the newly-active item.

### Requirements Summary

1. Poll items in `watched_states` without dispatching agents.
2. Detect `CHANGES_REQUESTED` reviewDecision or unresolved review threads → move to Rework.
3. Detect `APPROVED` reviewDecision with no unresolved threads → move to Merging.
4. Config flag `include_bot_reviews` controls whether AI bot comment threads count as unresolved.
5. All auto-transition behavior is opt-in via config with sensible defaults.
6. TrackerAdapter gains a write method to update item status on the board.

### Constraints

Orchestrator remains a scheduler/runner — auto-transition is a board operation, not agent work. Must not break existing active/terminal state behavior. Asana adapter does not need write support in this iteration (returns error).

### Non-Goals

Webhook-based real-time transitions (future work). Merging auto-transition to Done after PR merge (agent handles this). Custom transition rules beyond the three predefined ones.

## Architecture Decision

Insert a new `processWatchedStates(adapter)` phase in the orchestrator's `tick()` method, between config validation and candidate fetch. This phase fetches items in `watched_states`, evaluates transition rules, and calls `adapter.updateItemStatus()` when a transition is needed. The transition is a board-level GraphQL mutation (`updateProjectV2ItemFieldValue`), not an agent dispatch.

The GitHub adapter caches the Status field ID and option IDs on first use (they don't change during a session). The `reviewThreads` field is added to PullRequest GraphQL fragments to detect unresolved comments. Thread author `login` is checked against a `[bot]` suffix pattern to filter bot reviews when `include_bot_reviews` is false.

## Tasks

- [ ] T001 Add watched_states and auto_transitions to config types and parsing (file: apps/work-please/src/types.ts, apps/work-please/src/config.ts)
- [ ] T002 Add has_unresolved_threads and unresolved_thread_authors to Issue type (file: apps/work-please/src/types.ts)
- [ ] T003 Add reviewThreads to GitHub GraphQL queries and normalize into Issue (file: apps/work-please/src/tracker/github.ts) (depends on T002)
- [ ] T004 Add updateItemStatus to TrackerAdapter interface (file: apps/work-please/src/tracker/types.ts)
- [ ] T005 Implement updateItemStatus for GitHub adapter with field/option ID caching (file: apps/work-please/src/tracker/github.ts) (depends on T004)
- [ ] T006 Implement stub updateItemStatus for Asana adapter (file: apps/work-please/src/tracker/asana.ts) (depends on T004)
- [ ] T007 Add getWatchedStates and getAutoTransitions config helpers (file: apps/work-please/src/config.ts) (depends on T001)
- [ ] T008 Implement processWatchedStates in orchestrator tick loop (file: apps/work-please/src/orchestrator.ts) (depends on T003, T005, T007)
- [x] T009 Update generateWorkflow template with watched_states and auto_transitions (file: apps/work-please/src/init.ts) (depends on T001)
- [ ] T010 Update WORKFLOW.md and README.md with new config fields (file: WORKFLOW.md, README.md) (depends on T009)
- [ ] T011 [P] Add config tests for watched_states and auto_transitions parsing (file: apps/work-please/src/config.test.ts) (depends on T001, T007)
- [ ] T012 [P] Add tracker tests for reviewThreads normalization and updateItemStatus (file: apps/work-please/src/tracker/tracker.test.ts) (depends on T003, T005)
- [ ] T013 Add orchestrator tests for processWatchedStates (file: apps/work-please/src/orchestrator.test.ts) (depends on T008)

## Key Files

### Create
(none — all changes are modifications to existing files)

### Modify
- `apps/work-please/src/types.ts` — Add `watched_statuses`, `auto_transitions` to TrackerConfig; add `has_unresolved_threads` to Issue
- `apps/work-please/src/config.ts` — Parse new config fields, add `getWatchedStates()`, `getAutoTransitions()` helpers, add defaults
- `apps/work-please/src/tracker/types.ts` — Add `updateItemStatus()` to TrackerAdapter interface
- `apps/work-please/src/tracker/github.ts` — Add `reviewThreads` to GraphQL fragments, implement `updateItemStatus()` with field/option ID caching
- `apps/work-please/src/tracker/asana.ts` — Add stub `updateItemStatus()` returning error
- `apps/work-please/src/orchestrator.ts` — Add `processWatchedStates()` method in tick loop
- `apps/work-please/src/init.ts` — Update `generateWorkflow()` template, `STATUS_OPTIONS`
- `WORKFLOW.md` — Add `watched_states` and `auto_transitions` config
- `README.md` — Document new config fields and template variables

### Reuse
- `apps/work-please/src/config.ts:normalizeState()` — state comparison
- `apps/work-please/src/config.ts:csvValue()` — parse YAML arrays
- `apps/work-please/src/tracker/github.ts:runGraphql()` — execute GraphQL
- `apps/work-please/src/tracker/github.ts:createAuthenticatedGraphql()` — auth setup

## Verification

### Automated Tests

- [ ] Config parses `watched_states` from YAML array with default `['Human Review']`
- [ ] Config parses `auto_transitions` with all three boolean fields
- [ ] Config defaults: `human_review_to_rework: true`, `human_review_to_merging: true`, `include_bot_reviews: true`
- [ ] `getWatchedStates()` returns correct values for github_projects and asana
- [ ] GitHub adapter normalizes `reviewThreads` into `has_unresolved_threads` boolean
- [ ] GitHub adapter filters bot threads when `include_bot_reviews` is false
- [ ] `updateItemStatus()` calls correct GraphQL mutation
- [ ] `updateItemStatus()` caches field/option IDs after first call
- [ ] Asana `updateItemStatus()` returns appropriate error
- [ ] Orchestrator `processWatchedStates()` transitions CHANGES_REQUESTED → Rework
- [ ] Orchestrator `processWatchedStates()` transitions APPROVED + no unresolved → Merging
- [ ] Orchestrator `processWatchedStates()` does NOT transition when no signals detected
- [ ] Orchestrator `processWatchedStates()` respects `include_bot_reviews: false`
- [ ] `generateWorkflow()` includes `watched_states` and `auto_transitions` in output

### Observable Outcomes

- After setting a PR to "Request Changes" and polling, the board item moves from "Human Review" to "Rework"
- After approving a PR with no unresolved threads, the board item moves to "Merging"
- With `include_bot_reviews: false`, bot-only unresolved threads do not trigger Rework

## Progress

- [x] (2026-03-14 18:47 KST) T001 Add watched_states and auto_transitions to config types and parsing
- [x] (2026-03-14 18:47 KST) T002 Add has_unresolved_threads and unresolved_thread_authors to Issue type
- [x] (2026-03-14 19:10 KST) T003 Add reviewThreads to GitHub GraphQL queries and normalize into Issue
- [x] (2026-03-14 18:44 KST) T004 Add updateItemStatus to TrackerAdapter interface
- [x] (2026-03-14 19:10 KST) T005 Implement updateItemStatus for GitHub adapter with field/option ID caching
- [x] (2026-03-14 18:52 KST) T006 Implement stub updateItemStatus for Asana adapter
- [x] (2026-03-14 18:47 KST) T007 Add getWatchedStates and getAutoTransitions config helpers
- [x] (2026-03-14 19:30 KST) T008 Implement processWatchedStates in orchestrator tick loop
- [x] (2026-03-14 19:45 KST) T009 Update generateWorkflow template with watched_states and auto_transitions
- [x] (2026-03-14 20:00 KST) T010 Update WORKFLOW.md and README.md with new config fields
- [x] (2026-03-14 18:47 KST) T011 Add config tests for watched_states and auto_transitions parsing
- [x] (2026-03-14 19:10 KST) T012 Add tracker tests for reviewThreads normalization and updateItemStatus
- [x] (2026-03-14 20:45 KST) T013 Add orchestrator tests for processWatchedStates

## Decision Log

- Decision: Insert processWatchedStates between config validation and candidate fetch in tick()
  Rationale: Single insertion point, reuses existing adapter instance, doesn't affect dispatch logic
  Date/Author: 2026-03-14 / Claude
- Decision: Cache field/option IDs in adapter closure (not global state)
  Rationale: IDs are stable within a session, cache avoids repeated lookups, adapter already holds config
  Date/Author: 2026-03-14 / Claude
- Decision: Default include_bot_reviews to true
  Rationale: Work-please's value is autonomous code fixing — bot feedback should be auto-addressed by default
  Date/Author: 2026-03-14 / Claude
- Decision: Use -B (force-create) instead of -b for checkoutExistingBranch
  Rationale: -b fails if local branch already exists after worktree cleanup; -B is idempotent
  Date/Author: 2026-03-14 / Claude (from review feedback)
- Decision: Extract evaluateAutoTransition and updateItemStatus to separate modules
  Rationale: orchestrator.ts (713 LOC) and github.ts (574 LOC) exceeded 500 LOC limit
  Date/Author: 2026-03-14 / Claude (from quality review)

## Surprises & Discoveries

- Observation: orchestrator.ts was already over 500 LOC before this PR (pre-existing debt)
  Evidence: 694 LOC even after extracting evaluateAutoTransition (~28 lines)
- Observation: GitHub reviewDecision is only set by formal reviews (Approve/Request Changes), not by comment-only reviews from AI bots
  Evidence: AI bots (gemini-code-assist, cubic-dev-ai) leave comments without formal review decisions
- Observation: git worktree add with -b fails on reopen when the local branch still exists in the shared clone
  Evidence: cubic-dev-ai review comment, confirmed by git documentation

## Outcomes & Retrospective

### What Was Shipped
- Watched states polling (Human Review) without agent dispatch
- Auto-transition rules: CHANGES_REQUESTED/unresolved → Rework, APPROVED → Merging
- Bot review filtering via include_bot_reviews config
- TrackerAdapter write capability with GraphQL field/option ID caching
- PR existing branch checkout with idempotent -B flag

### What Went Well
- Design discussion before implementation caught the bot review edge case early
- Symphony reference implementation provided clear patterns for status map and polling
- Quality review caught file size violations and error handling gaps quickly

### What Could Improve
- orchestrator.ts needs a broader refactor to get under 500 LOC (pre-existing debt)
- Plan could have included the has_unresolved_human_threads field from the start (was added during T003)

### Tech Debt Created
- orchestrator.ts at 694 LOC (limit: 500) — needs extraction of retry/reconciliation logic
