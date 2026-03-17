## Bug Investigation Report

### 1. Reproduction Status

**Reproduced** — Always reproducible when an Issue-type item is placed in a watched state.

**Reproduction Path:**
1. `orchestrator.ts:130` — `adapter.fetchCandidateAndWatchedIssues(watchedStates)` polls tracker, calls `normalizeProjectItem()` for each node
2. `tracker/github.ts:415` — `normalizeProjectItem()` reads `content?.reviewDecision` — always `undefined` for Issue-type content
3. `tracker/github.ts:58-65` — GraphQL `... on Issue` fragment does NOT include `reviewDecision` (only `... on PullRequest` does at line 73)
4. `orchestrator.ts:606` — **failure point** — `if (!issue.review_decision) continue` silently skips all Issue-type items

### 2. Root Cause Analysis

**Problem Location:**
- File: `apps/work-please/src/orchestrator.ts`
- Function: `dispatchWatchedIssues()`
- Line: `606`
- Secondary: `apps/work-please/src/tracker/github.ts`, `normalizeProjectItem()`, line `415`

**Root Cause:**
The `dispatchWatchedIssues()` guard at line 606 (`if (!issue.review_decision) continue`) unconditionally skips any project item whose top-level `review_decision` is `null`. For GitHub Issue-type content, `review_decision` is always `null` because the GraphQL `... on Issue` fragment does not include the `reviewDecision` field — it only exists on the `PullRequest` type in GitHub's schema. The linked PR review decisions ARE available in `pull_requests[*].review_decision` (populated from `closedByPullRequestsReferences` at line 409), but this data is never promoted to the issue-level `review_decision`.

**Introduction:** The guard was added in commit `804936c` (2026-03-15) as part of duplicate-dispatch prevention work, designed with PR-type items in mind.

**Code Context:**
```typescript
// orchestrator.ts:606 — the hard gate
if (!issue.review_decision)   // always null for Issue-type → always skipped
  continue
```

```typescript
// tracker/github.ts:415 — always null for Issue-type
const reviewDecision = normalizeReviewDecision(content?.reviewDecision)
// pull_requests array IS populated with review_decision from closedByPullRequestsReferences
```

### 3. Proposed Solutions

#### Solution A: Promote linked PR review decision in `normalizeProjectItem()` (Recommended)

In `tracker/github.ts`, after building the `pullRequests` array, derive the issue-level `review_decision` from the linked PRs when the content is an Issue:

```typescript
// tracker/github.ts ~line 415
const reviewDecision = normalizeReviewDecision(content?.reviewDecision)
  ?? pullRequests.find(pr => pr.state === 'open' && pr.review_decision)?.review_decision
  ?? null
```

**Pros:**
- Fixes data at the source; all downstream logic (dispatch guard, `isWatchedUnchanged`, prompt templates, logging) works correctly without further changes
- The `Issue` type gains a meaningful `review_decision`, useful for `{{ issue.review_decision }}` in prompts
- Issues with no linked PRs remain `null` (correct — no PR to review)

**Cons:**
- Introduces a policy decision into the normalization layer (which linked PR to pick)

#### Solution B: Widen the dispatch guard to also check linked PRs

```typescript
// orchestrator.ts ~line 606
const hasReviewSignal = issue.review_decision
  || issue.pull_requests.some(pr => pr.review_decision != null)
if (!hasReviewSignal)
  continue
```

**Pros:** Minimal change, isolated to dispatch logic
**Cons:** `isWatchedUnchanged()` still compares `issue.review_decision` (null for Issues) causing potential dedup issues; every consumer of `review_decision` needs to also check `pull_requests`

#### Solution C: Treat Issue-type items as always dispatchable

**Pros:** Simplest change
**Cons:** Removes duplicate-dispatch protection for Issues entirely; weak heuristic for distinguishing Issue vs PR type

### 4. Testing Requirements

1. **Bug Scenario:** `normalizeProjectItem()` with Issue-type node having linked PR with `reviewDecision: "APPROVED"` — verify `review_decision` is promoted
2. **Edge Cases:**
   - Multiple linked PRs with different review decisions
   - Issue with no linked PRs (should remain `null`)
   - Issue with only closed linked PRs (should not promote from closed PRs)
3. **Regression:** PR-type items continue to use their direct `reviewDecision` unchanged
4. **Dispatch integration:** `dispatchWatchedIssues` with Issue-type item having promoted `review_decision` dispatches correctly
5. **Dedup:** `isWatchedUnchanged` correctly detects changes in promoted `review_decision`

### 5. Similar Code Patterns

- `orchestrator.test.ts:855` — Test "skips issue with no review decision" explicitly asserts the buggy behavior as correct
- `orchestrator.ts:749-750` — `isWatchedUnchanged` has comment "For PR-type project items" but is reached by Issue-type items too
- `tracker/tracker.test.ts:1364` — Covers Issue-type normalization but only asserts `review_decision: null`; does not test linked PR review decision promotion
