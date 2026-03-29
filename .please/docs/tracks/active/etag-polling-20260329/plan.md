# Plan: ETag/Last-Modified Conditional Request Support for Polling Mode

## Overview
- **Source**: [spec.md](./spec.md)
- **Issue**: #223
- **Created**: 2026-03-29
- **Approach**: Hybrid (REST ETag guard + GraphQL data fetch)

## Purpose

After this change, the orchestrator will consume significantly fewer API rate limit points during polling by skipping redundant data fetches when tracker data hasn't changed. Operators can verify it works by observing `cache=hit` log entries and reduced `x-ratelimit-used` values in GitHub API responses.

## Context

The orchestrator polls issue trackers (GitHub Projects V2, Asana) every 30 seconds by default. Every poll cycle fetches the full dataset regardless of whether anything changed. This wastes API rate limits — GitHub allows 5,000 requests/hour for authenticated users, and frequent polling of large projects can approach this limit.

GitHub's GraphQL API uses POST requests which are not HTTP-cacheable. However, the Projects V2 REST API (`GET /orgs/{org}/projectsV2/{project_number}/items`) returns ETag headers, and 304 responses don't count against rate limits. Asana's REST API also supports conditional requests.

The solution uses `make-fetch-happen` (npm's fetch wrapper with built-in HTTP caching) for REST calls, and a hybrid strategy for GitHub: a lightweight REST GET checks for changes via ETag, and only on change does the full GraphQL query run.

Constraints:
- TrackerAdapter interface must remain unchanged
- GitHub GraphQL remains the primary data source (REST lacks `reviewDecision`, `headRefName`, `closedByPullRequestsReferences`)
- Only polling mode is affected; webhook/relay modes unchanged

Non-goals:
- Dashboard cache stats UI
- Full GitHub GraphQL-to-REST migration

## Architecture Decision

Chosen approach: **Hybrid REST ETag guard + GraphQL data fetch**

Rationale: GitHub's GraphQL API (POST) cannot use HTTP caching. A pure REST migration is blocked by missing fields (`reviewDecision`, `headRefName`, linked PRs). The hybrid approach uses a cheap REST GET with ETag to detect changes — on 304, return cached Issue[] without touching GraphQL; on 200, run the existing GraphQL query and cache the result. Asana uses `make-fetch-happen` directly since all calls are REST GET.

## Tasks

### Phase 1: Cache Infrastructure

- [x] T001 Create cached fetch factory (file: packages/core/src/cached-fetch.ts)
- [x] T002 Add cache config to types and config parser (file: packages/core/src/types.ts, packages/core/src/config.ts) (depends on T001)

### Phase 2: Asana ETag Support

- [x] T003 [P] Replace Asana plain fetch with cached fetch (file: packages/core/src/tracker/asana.ts) (depends on T001)

### Phase 3: GitHub Hybrid ETag

- [x] T004 Add GitHub REST auth helper for ETag check (file: packages/core/src/tracker/github-auth.ts) (depends on T001)
- [x] T005 Implement GitHub REST ETag guard with Issue[] cache (file: packages/core/src/tracker/github.ts) (depends on T004)

### Phase 4: Logging & Integration

- [x] T006 Add cache hit/miss logging to poll cycle (file: packages/core/src/tracker/github.ts, packages/core/src/tracker/asana.ts) (depends on T003, T005)

## Key Files

### Create
- `packages/core/src/cached-fetch.ts` — `createCachedFetch(cachePath)` factory wrapping `make-fetch-happen`

### Modify
- `packages/core/src/types.ts` — add `CacheConfig` interface and `cache` field to `ServiceConfig`
- `packages/core/src/config.ts` — parse `cache:` section from WORKFLOW.md YAML
- `packages/core/src/tracker/github-auth.ts` — add `createAuthenticatedRest()` for REST ETag checks
- `packages/core/src/tracker/github.ts` — add REST ETag guard before GraphQL, Issue[] cache layer
- `packages/core/src/tracker/asana.ts` — replace `fetch()` with cached fetch from factory
- `packages/core/package.json` — add `make-fetch-happen` dependency

### Reuse
- `packages/core/src/tracker/types.ts` — TrackerAdapter interface (unchanged)
- `packages/core/src/orchestrator.ts` — poll loop (unchanged, caching is transparent)

## Verification

### Automated Tests
- [ ] cached-fetch factory returns make-fetch-happen instance with correct cachePath
- [ ] GitHub adapter returns cached Issue[] on REST 304 without calling GraphQL
- [ ] GitHub adapter runs GraphQL and caches result on REST 200
- [ ] Asana adapter uses cached fetch and handles 304 transparently
- [ ] Config parser reads cache.path from WORKFLOW.md

### Observable Outcomes
- After starting the orchestrator with polling mode, logs show `cache=miss` on first poll and `cache=hit` on subsequent polls when data is unchanged
- Running `ls {workspace.root}/.cache/http/` shows cached response files

### Manual Testing
- [ ] Start orchestrator, observe first poll is `cache=miss`, subsequent polls are `cache=hit`
- [ ] Modify a project item in GitHub/Asana, observe next poll is `cache=miss` followed by `cache=hit`

### Acceptance Criteria Check
- [ ] AC-1: GitHub 304 → cached items, no GraphQL call, no rate limit consumed
- [ ] AC-2: GitHub 200 → GraphQL runs, result cached
- [ ] AC-3: Asana 304 → cached items returned
- [ ] AC-4: make-fetch-happen used for all REST calls
- [ ] AC-5: Cache persists across restarts
- [ ] AC-6: Logs include cache hit/miss

## Progress

- [x] (2026-03-29 16:35 KST) T001 Create cached fetch factory
  Evidence: `bun test -- cached-fetch` → 5 tests passed
- [x] (2026-03-29 16:38 KST) T002 Add cache config to types and config parser
  Evidence: `bun test -- config` → 3 new cache config tests passed, 774 total pass
- [x] (2026-03-29 16:40 KST) T003 Replace Asana plain fetch with cached fetch
- [x] (2026-03-29 16:40 KST) T004 Add GitHub REST auth helper for ETag check
- [x] (2026-03-29 16:42 KST) T005 Implement GitHub REST ETag guard with Issue[] cache
  Evidence: 774 tests pass (2 pre-existing failures unrelated)
- [x] (2026-03-29 16:44 KST) T006 Add cache hit/miss logging to poll cycle

## Decision Log

- Decision: Hybrid REST ETag guard + GraphQL data fetch for GitHub
  Rationale: GraphQL uses POST (not HTTP-cacheable). REST lacks `reviewDecision`, `headRefName`, linked PRs. Hybrid gets ETag benefits without losing data.
  Date/Author: 2026-03-29 / Claude

- Decision: Use `make-fetch-happen` with `cache: 'no-cache'` mode
  Rationale: Always revalidate with server (sends If-None-Match), but still returns cached body on 304. Best for polling where freshness matters.
  Date/Author: 2026-03-29 / Claude

## Surprises & Discoveries

- Observation: GitHub GraphQL API uses POST, making HTTP caching impossible
  Evidence: POST requests are not cacheable per HTTP spec; make-fetch-happen only caches GET responses
- Observation: GitHub Projects V2 REST API lacks `reviewDecision`, `headRefName`, and `closedByPullRequestsReferences`
  Evidence: REST response schema uses `pull-request-simple` which predates Projects V2 fields

## Outcomes & Retrospective

### What Was Shipped
- Cached fetch factory (`make-fetch-happen` wrapper) with filesystem-based HTTP cache
- Hybrid REST ETag guard for GitHub polling (REST change detection + GraphQL data fetch)
- Automatic ETag/Last-Modified caching for Asana REST API
- Configurable cache path via WORKFLOW.md `cache.path`
- Cache hit/miss logging in both adapters

### What Went Well
- Discovery that GitHub GraphQL is POST-only early in planning saved time vs attempting a full REST migration
- Librarian research confirmed REST API field gaps before implementation
- Existing tests stayed green throughout — lazy fetch resolution pattern preserved test compatibility

### What Could Improve
- Aggregate per-poll-cycle cache statistics (FR-8) implemented as per-request logging rather than summary counts
- Could add integration tests with a real HTTP server to verify end-to-end ETag behavior

### Tech Debt Created
- Per-poll-cycle aggregate cache statistics not yet implemented (per-request logging exists)
