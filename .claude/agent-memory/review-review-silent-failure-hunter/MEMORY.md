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

## Files of Interest

- `apps/work/src/orchestrator.ts` -- main dispatch/worker loop, many error handling paths
- `apps/work/src/tracker/github-status-update.ts` -- GraphQL status field resolution + update
- `apps/work/src/tracker/github.ts` -- GitHub Projects v2 adapter
- `apps/work/src/tracker/types.ts` -- TrackerError, TrackerAdapter, StatusFieldInfo types
- `apps/work/src/tracker/index.ts` -- createTrackerAdapter factory
