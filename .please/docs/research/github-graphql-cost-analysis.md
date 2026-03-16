# GitHub GraphQL API Cost Analysis

> Research date: 2026-03-15
> Reference: https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api

## Cost Calculation Formula

1. Count the number of requests needed to fulfill each unique **connection** (paginated field with `first`/`last`)
2. Multiply connections hierarchically (parent count x child `first` value)
3. Divide total by **100**, round to nearest whole number
4. **Minimum cost = 1 point**

## Rate Limits

| Auth method | Primary limit |
|-------------|---------------|
| PAT / user | 5,000 pts/hr |
| GitHub App (non-GHEC) | 5,000–12,500 pts/hr |
| GitHub App (GHEC) | 10,000 pts/hr |
| GITHUB_TOKEN (Actions) | 1,000 pts/hr |

Secondary rate limit: max **2,000 points/minute** for GraphQL. Mutations cost **5 points** (secondary).

---

## Per-Query Cost Breakdown

### PROJECT_ITEMS_QUERY / PROJECT_BY_ID_QUERY (per page, PAGE_SIZE=50)

Used by: `fetchCandidateIssues()`, `fetchIssuesByStates()`

```
Connection tree:
items(first: 50)                                         →     1
├── fieldValues(first: 20)                               →    50
├── [Issue] labels(first: 20)                            →    50
├── [Issue] assignees(first: 10)                         →    50
├── [Issue] closedByPullRequestsReferences(first: 10)    →    50
├── [PR] labels(first: 20)                               →    50
├── [PR] assignees(first: 10)                            →    50
                                                         ───────
                                               Total   =   301
                                               / 100   =   4 points
```

**Cost: ~4 points per page** (after O1: reviewThreads removed)

- `PROJECT_ITEMS_QUERY` has dual `... on Organization` / `... on User` branches — may double to ~8 points.
- `PROJECT_BY_ID_QUERY` has single path — stays at ~4 points.
- Previously `reviewThreads(first: 100)` + `comments(first: 1)` = 5,000 requests = 93% of cost. Now removed.

### ITEMS_BY_IDS_QUERY (per call)

Used by: `fetchIssueStatesByIds()` (reconciliation + turn refresh)

```
nodes(ids: $ids)  — N items
├── fieldValues(first: 20)              → N
                                        ─────────
                          Total = 1 + N x 2
                          / 100 = ceil(N x 0.02)
```

| N (items) | Requests | Cost (points) |
|-----------|----------|---------------|
| 1         | 3        | 1             |
| 3         | 7        | 1             |
| 5         | 11       | 1             |
| 10        | 21       | 1             |

### RESOLVE_PROJECT_ID_QUERY

Used by: `ensureProjectId()` — cached after first call.

No connections. **Cost: 1 point.**

### STATUS_FIELD_QUERY

Used by: `ensureStatusField()` — cached after first call.

No connections (`options` is a plain list). **Cost: 1 point.**

### UPDATE_ITEM_STATUS_MUTATION

Used by: `updateItemStatus()` — available on the tracker adapter for agents to call via WORKFLOW.md.
Not used by the orchestrator directly (auto-transitions were removed in #97).

No connections. **Primary: 1 point. Secondary: 5 points** (mutation).

---

## Orchestrator Per-Tick Cost

Each `tick()` triggers:

| Step | Method | Query | Cost |
|------|--------|-------|------|
| Reconcile | `fetchIssueStatesByIds(N)` | ITEMS_BY_IDS_QUERY | ceil((1 + 2N) / 100) = 1 |
| Candidates + watched (combined) | `fetchCandidateAndWatchedIssues()` | PROJECT_ITEMS/BY_ID_QUERY | ~4/page (no filter) or ~8/page (with filter, 2 parallel calls) |

Per-agent-turn costs (async, not per-tick):

| Step | Method | Query | Cost |
|------|--------|-------|------|
| Turn refresh (per agent per turn) | `fetchIssueStatesByIds([1])` | ITEMS_BY_IDS_QUERY | 1 |

Since #103, candidates and watched states are fetched in a single combined call
(`fetchCandidateAndWatchedIssues`). When no filter is configured, one `fetchAllItems()` call
fetches the union of active + watched statuses and splits results client-side.
When a filter **is** configured, two parallel calls are made (server-side search for candidates,
unfiltered for watched) — costing ~8 pts/page.

### Typical tick (5 running, 1 page, no filter)

```
Reconcile:                         1 pt   (N=5, ceil((1+10)/100) = 1)
Candidates + watched (combined):   4 pts  (1 page)
                                 ────────
Tick total:                        5 pts/tick

+ Agent turns:                     5 pts  (5 running agents x 1 pt each, async)
                                 ────────
Combined:                         10 pts/tick (worst case)
```

At 30s polling → ~20 pts/min → **~1,200 pts/hr** (well within 5,000 limit).

### Typical tick (5 running, 1 page, with filter)

```
Reconcile:                         1 pt
Candidates (filtered):             4 pts  (1 page)
Watched (unfiltered, parallel):    4 pts  (1 page)
                                 ────────
Tick total:                        9 pts/tick

+ Agent turns:                     5 pts
                                 ────────
Combined:                         14 pts/tick (worst case)
```

At 30s polling → ~28 pts/min → **~1,680 pts/hr**.

---

## Optimization Opportunities

### O1. Remove reviewThreads entirely (HIGH IMPACT) — APPLIED

~~`reviewThreads(first: 100)` → `reviewThreads(first: 10)`.~~

**Decision (2026-03-15):** Remove `reviewThreads` from all queries entirely.

- `has_unresolved_threads` / `has_unresolved_human_threads` were only used by `evaluateAutoTransition()`, which was removed in #97.
- The dispatch gate in `processWatchedStates()` now uses `review_decision` alone — sufficient to detect review activity.
- Agents can check thread details via `gh api graphql` at runtime if needed (already documented in WORKFLOW.md).
- `first: 0` + `totalCount` was considered but rejected: `totalCount` doesn't distinguish resolved vs unresolved threads.

Drops `comments` + `reviewThreads` requests from 5,050 → 0 per page.
Per-page cost: ~54 → ~4 points. **~93% reduction.**

### O2. Prefer project_id over owner+number (MEDIUM IMPACT)

`PROJECT_BY_ID_QUERY` has single branch (54 pts).
`PROJECT_ITEMS_QUERY` has dual Org/User branch (potentially 108 pts).
Already supported — just document the preference.

### O3. Skip watched-states fetch when no auto-transitions (LOW IMPACT)

`processWatchedStates()` already short-circuits when no auto-transitions configured,
but `fetchIssuesByStates()` is called before checking adapter support.
Save 54 pts/tick when feature is unused.

### O4. Add rateLimit field to queries (OBSERVABILITY)

Add `rateLimit { cost remaining resetAt }` to each query.
Enables dynamic backoff and accurate cost tracking.

### O5. Merge candidate + watched-state fetches (MEDIUM IMPACT) — APPLIED

**Applied in #103** (`fetchCandidateAndWatchedIssues`). When no filter is configured,
a single `fetchAllItems()` call uses a union of statuses and splits results client-side.
When a filter is active, two parallel calls are made (server-side search for candidates,
unfiltered for watched) to avoid missing issues whose labels/assignees exceed pagination limits.
Saves ~4 pts/tick in the no-filter case.

### O6. Increase polling interval (SIMPLE)

Double interval from 30s to 60s halves hourly cost.

---

## Projected Cost After Optimizations

| Scenario | Before | After O1 (remove reviewThreads) | After O1+O5 (current) |
|----------|--------|--------------------------------|----------------------|
| Per page | 54 pts | 4 pts | 4 pts |
| Per tick (5 running, no filter) | 114 pts | 14 pts | 10 pts |
| Per tick (5 running, with filter) | 114 pts | 14 pts | 14 pts |
| Per hour (30s poll, no filter) | 13,680 pts | 1,680 pts | 1,200 pts |
| Per hour (30s poll, with filter) | 13,680 pts | 1,680 pts | 1,680 pts |
| Per hour (60s poll, no filter) | 6,840 pts | 840 pts | 600 pts |

O1 and O5 are both applied as of 2026-03-15.
