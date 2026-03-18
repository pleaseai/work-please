# Error Handling Review Memory

## Project Error Handling Conventions

- Orchestrator uses `console.error` for fatal/blocking errors, `console.warn` for non-fatal warnings
- TrackerError is a discriminated union with `code` field -- always propagate or log, never discard silently
- `createTrackerAdapter` returns `TrackerAdapter | TrackerError` -- callers must check with `isTrackerError()`
- `formatTrackerError()` exists for human-readable error messages in logs
- No formal error ID system (no errorIds.ts / Sentry integration yet)
- No `logError` / `logForDebugging` / `logEvent` functions -- project uses raw `console.error` / `console.warn`

## Known Patterns to Watch

- **TrackerError-to-null conversion**: `resolveStatusField()` in `github-status-update.ts` converts structured errors to null, losing diagnostic info. Flagged in PR #86.
- **Supplementary data fetch killing workers**: Non-essential operations (like project context enrichment) placed inside try blocks without their own error isolation can kill the whole worker on transient failures. Flagged in PR #86.
- **IIFE spread for adapter methods**: `github.ts` uses `...(() => { ... })()` to spread methods from a context object. Harder to debug if construction throws.
- **RefreshButton catch fixed (iter 2)**: iter 1 had no catch at all; iter 2 adds catch + emit. But still no `console.error` -- original error object discarded. Flagged in iter 2 review.
- **Untyped error cast FIXED**: iter 1 used `(e as Error).message`; iter 2 replaced with `toMessage(e)` utility that handles non-Error throws gracefully.
- **Silent fallback to inline HTML in server.ts**: When dashboard dist is missing, server silently degrades to inline HTML with no startup warning and no per-request log. Still present in iter 2. Flagged in iter 2 review.
- **res.json() SyntaxError now wrapped**: iter 2 added `parseJson()` helper that catches SyntaxError and rethrows with better message. Original cause still discarded (not passed as `{ cause }`). Flagged in iter 2.
- **Polling continues after persistent error**: `useIntervalFn` keeps firing even after repeated failures. No backoff, no cap, no overlap guard. Still present in iter 2. Flagged in iter 2 review.
- **refreshError never cleared**: DashboardPage sets refreshError on failure but never clears it on success. Stale error banner persists across successful refreshes. Flagged in iter 2.
- **loading stuck on empty identifier FIXED**: `useIssueDetail` now sets `loading.value = false` before returning when the identifier is empty.
- **No Vue error boundary in App.vue**: Render-time exceptions (e.g. formatDateTime receiving null) produce blank page with no user feedback. Flagged in iter 2.
- **No request timeout on fetch calls**: All three fetch helpers have no AbortSignal timeout, enabling infinite hangs that compound the overlap issue. Flagged in iter 2.

## Files of Interest

- `apps/work-please/src/orchestrator.ts` -- main dispatch/worker loop, many error handling paths
- `apps/work-please/src/tracker/github-status-update.ts` -- GraphQL status field resolution + update
- `apps/work-please/src/tracker/github.ts` -- GitHub Projects v2 adapter
- `apps/work-please/src/tracker/types.ts` -- TrackerError, TrackerAdapter, StatusFieldInfo types
- `apps/work-please/src/tracker/index.ts` -- createTrackerAdapter factory
- `apps/work-please/src/server.ts` -- HTTP server + static file serving (PR #113 modified)
- `apps/dashboard/src/lib/api.ts` -- fetch wrappers (PR #113 added)
- `apps/dashboard/src/composables/useOrchestratorState.ts` -- polling composable (PR #113 added)
- `apps/dashboard/src/composables/useIssueDetail.ts` -- issue fetch composable (PR #113 added)
- `apps/dashboard/src/components/RefreshButton.vue` -- refresh trigger (PR #113 added)
- `apps/dashboard/src/pages/DashboardPage.vue` -- overview page (PR #113 added)
- `apps/dashboard/src/pages/IssuePage.vue` -- issue detail page (PR #113 added)
