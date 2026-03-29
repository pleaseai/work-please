# ETag/Last-Modified Conditional Request Support for Polling Mode

> Track: etag-polling-20260329

## Overview

Add HTTP conditional request support (ETag, Last-Modified, 304 Not Modified) to the polling mode using `make-fetch-happen` as the fetch layer. This reduces API rate limit consumption by avoiding redundant data transfers when tracker data hasn't changed between poll cycles.

For GitHub, a hybrid approach is used: a lightweight REST GET with ETag checks whether project items have changed — if 304 (unchanged), skip the full GraphQL query and return cached results; if 200 (changed), run the existing GraphQL query to fetch complete data including fields only available via GraphQL (`reviewDecision`, `headRefName`, `closedByPullRequestsReferences`). GitHub's GraphQL API uses POST requests which do not support HTTP caching.

For Asana, `make-fetch-happen` replaces the plain `fetch()` calls, providing automatic ETag/Last-Modified caching on all GET requests.

## Requirements

### Functional Requirements

- [ ] FR-1: Introduce `make-fetch-happen` as the cached fetch implementation for REST API calls
- [ ] FR-2: Configure filesystem-based cache storage (`cachePath`) for HTTP response caching
- [ ] FR-3: Add a lightweight REST GET endpoint check for GitHub project items with ETag support — on 304, return cached Issue[] without running GraphQL
- [ ] FR-4: On REST 200 (data changed), run the existing GraphQL query and cache the resulting Issue[]
- [ ] FR-5: Keep GitHub GraphQL for detail fetches (`fetchIssueStatesByIds`) and status updates (`updateItemStatus`) — unchanged
- [ ] FR-6: Add ETag/Last-Modified conditional request support to Asana REST API calls via `make-fetch-happen`
- [ ] FR-7: Return cached data on 304 Not Modified responses transparently to the orchestrator
- [ ] FR-8: Log cache hit/miss statistics per poll cycle (structured `key=value` logs via consola)

### Non-functional Requirements

- [ ] NFR-1: 304 responses from GitHub REST must not count against the REST API rate limit
- [ ] NFR-2: Cache storage path should be configurable via WORKFLOW.md (default: `{workspace.root}/.cache/http`)
- [ ] NFR-3: Cache must be safe for concurrent reads (single orchestrator process)
- [ ] NFR-4: Existing TrackerAdapter interface must remain unchanged — caching is transparent

## Acceptance Criteria

- [ ] AC-1: When polling GitHub with no data changes, the REST check returns 304 and the adapter returns cached items without running GraphQL or consuming a rate limit point
- [ ] AC-2: When polling GitHub with data changes, the REST check returns 200, the adapter runs GraphQL, and caches the result for next cycle
- [ ] AC-3: When polling Asana with no data changes, the adapter receives a 304 and returns cached items
- [ ] AC-4: `make-fetch-happen` is used for all REST HTTP calls (GitHub REST check, Asana API)
- [ ] AC-5: Cache files are stored on the filesystem and persist across orchestrator restarts
- [ ] AC-6: Poll cycle logs include cache hit/miss counts

## Out of Scope

- Webhook mode changes — only polling mode gets caching
- Asana webhook support — Asana caching is REST-only
- Dashboard cache stats UI — no visualization of cache metrics in this track
- Full GitHub GraphQL-to-REST migration — GraphQL remains the primary data source; REST is only used for change detection
- GitHub GraphQL response caching — POST requests are not cacheable via HTTP

## Assumptions

- GitHub REST API `GET /orgs/{org}/projectsV2/{project_number}/items` returns ETag headers suitable for conditional requests
- Asana REST API supports ETag or Last-Modified headers on task listing endpoints
- `make-fetch-happen` is compatible with Bun runtime
- The `TrackerAdapter` interface consumers (orchestrator) do not need to know about caching

## References

- [make-fetch-happen](https://www.npmjs.com/package/make-fetch-happen) — Node.js fetch with HTTP caching
- [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — Conditional requests and rate limiting
- [GitHub Projects V2 REST API](https://docs.github.com/en/rest/projects/items) — REST endpoints for project items
- [Octokit.js](https://github.com/octokit/octokit.js/) — GitHub REST/GraphQL client
