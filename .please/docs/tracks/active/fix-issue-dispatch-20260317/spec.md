# Bug Fix: watched_states dispatch never triggers for Issue-type project items

> Track: fix-issue-dispatch-20260317
> Investigation: [investigation.md](./investigation.md)

## Overview

`dispatchWatchedIssues()` in `orchestrator.ts` never dispatches agents for GitHub Project items that are Issue type. The top-level `review_decision` is always `null` for Issues because the GraphQL `... on Issue` fragment lacks the `reviewDecision` field. The dispatch guard `if (!issue.review_decision) continue` then silently skips all Issue-type items.

## Reproduction

1. Configure `watched_states: ["Human Review"]` in WORKFLOW.md
2. Place a GitHub Issue (not a PR) in "Human Review" status on the project board
3. Link a PR with a review decision (e.g., `APPROVED`)
4. Observe that the orchestrator never emits `dispatching watched issue` for this item

**Expected**: Issue-type items in watched states are dispatched when their linked PR has a review decision
**Actual**: Issue-type items are silently skipped because `review_decision` is always `null`

## Root Cause

In `normalizeProjectItem()` (`tracker/github.ts:415`), `review_decision` is derived from `content?.reviewDecision`, which is always `undefined` for Issue-type GraphQL nodes. The linked PR review decisions are available in `pull_requests[*].review_decision` but never promoted to the issue level. The dispatch guard at `orchestrator.ts:606` then skips all items with `null` review decision. See [investigation.md](./investigation.md) Section 2.

## Requirements

### Functional Requirements

- [ ] FR-1: In `normalizeProjectItem()`, fall back to the first open linked PR's `review_decision` when the content is Issue-type and `content.reviewDecision` is absent
- [ ] FR-2: Ensure Issue-type items with no linked PRs retain `review_decision: null` (no false dispatch)

### Testing Requirements

- [ ] TR-1: Unit test — `normalizeProjectItem()` promotes `review_decision` from linked open PR for Issue-type content
- [ ] TR-2: Unit test — `normalizeProjectItem()` returns `null` for Issue-type with no linked PRs
- [ ] TR-3: Unit test — `normalizeProjectItem()` ignores closed linked PRs when promoting
- [ ] TR-4: Unit test — `dispatchWatchedIssues` dispatches Issue-type item with promoted `review_decision`
- [ ] TR-5: Regression test — PR-type items continue using direct `reviewDecision` unchanged

## Acceptance Criteria

- [ ] AC-1: Issue-type items in watched states dispatch when their linked open PR has a review decision
- [ ] AC-2: All existing tests continue to pass
- [ ] AC-3: New tests cover the bug scenario, edge cases (no linked PRs, closed PRs only), and regression

## Out of Scope

- Review decision priority ordering across multiple linked PRs (use first open PR with a decision)
- Broader refactoring of `isWatchedUnchanged()` dedup logic
- Adding `reviewDecision` to the GraphQL `... on Issue` fragment (not available in GitHub's schema)
