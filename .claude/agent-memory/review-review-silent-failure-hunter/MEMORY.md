# Error Handling Review Memory

## Project Error Handling Conventions

- Orchestrator uses `console.error` for fatal/blocking errors, `console.warn` for non-fatal warnings
- `createLogger('scope')` from `@pleaseai/agent-core` returns a consola logger; use `.error`/`.warn`/`.info`
- TrackerError is a discriminated union with `code` field -- always propagate or log, never discard silently
- `createTrackerAdapter` returns `TrackerAdapter | TrackerError` -- callers must check with `isTrackerError()`
- `formatTrackerError()` exists for human-readable error messages in logs
- No formal error ID system (no errorIds.ts / Sentry integration yet)
- No `logError` / `logForDebugging` / `logEvent` functions -- project uses raw `console.error` / `console.warn` (or consola via `createLogger`)

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

## Patterns from amondnet/session-chat-view

- **sessionPageResponse: non-ENOENT errors silently produce 200 + empty page**: catch at server.ts:292-296 logs but still returns HTML with zero messages and HTTP 200. Callers (browser user) get a blank "No messages found" page with no indication of the real failure. Confidence 82.
- **useSessionMessages: no AbortSignal/timeout**: same pattern as prior composables -- fetch can hang indefinitely, compounding polling overlap. Confidence 80.
- **useSessionMessages: polling continues unconditionally on repeated fetch errors**: `useIntervalFn` keeps firing on every error; no backoff, no cap, no user-visible indication after the first poll fails. Same pattern flagged in iter 2. Confidence 80.
- **sessionMessagesResponse ENOENT -> 200+[]**: silently returns 200 empty array for a session file that does not exist; caller cannot distinguish "exists, 0 messages" from "not found". Borderline intentional (confidence ~75, not flagged).

## Patterns from state-adapter-config (branch amondnet/melbourne)

- **Async plugin startup with .then()/.catch() — bot silently not registered on failure**: Nitro plugins are synchronous; `createStateFromConfig` is async, so `.then()/.catch()` is used. The `.catch()` logs the error but `nitroApp.chatBot` is never set. Any downstream webhook handler reading `nitroApp.chatBot` gets `undefined` and silently drops all messages. The server starts healthy. Confidence 92 — flagged.
- **Silent fallback to memory for unknown adapter kind**: `createStateFromConfig` falls back to memory (with hardcoded `'chat-sdk'` key prefix, dropping user config) when `ADAPTER_PACKAGES[adapter]` is undefined. This branch is unreachable given `buildStateConfig()` validation, but if ever reached, would silently remove distributed locking. Should throw instead of fall back. Confidence 90 — flagged.
- **`isModuleNotFound` duck-typing GOOD pattern**: Correctly handles Bun's `ResolveMessage` (not `instanceof Error`) by checking `.message` text. Propagates all non-MODULE_NOT_FOUND errors. Good model for dynamic import error handling in Bun projects.
- **`buildStateConfig()` validation before factory**: Config layer validates adapter kind and defaults to memory; factory therefore always receives a valid adapter. This two-layer validation is the right architecture but creates a dead code branch in the factory that should be an invariant throw, not a warn+fallback.

## Files of Interest

- `apps/agent-please/src/orchestrator.ts` -- main dispatch/worker loop, many error handling paths
- `apps/agent-please/src/tracker/github-status-update.ts` -- GraphQL status field resolution + update
- `apps/agent-please/src/tracker/github.ts` -- GitHub Projects v2 adapter
- `apps/agent-please/src/tracker/types.ts` -- TrackerError, TrackerAdapter, StatusFieldInfo types
- `apps/agent-please/src/tracker/index.ts` -- createTrackerAdapter factory
- `apps/agent-please/src/server.ts` -- HTTP server + static file serving (PR #113 modified)
- `apps/dashboard/src/lib/api.ts` -- fetch wrappers (PR #113 added)
- `apps/dashboard/src/composables/useOrchestratorState.ts` -- polling composable (PR #113 added)
- `apps/dashboard/src/composables/useIssueDetail.ts` -- issue fetch composable (PR #113 added)
- `apps/dashboard/src/components/RefreshButton.vue` -- refresh trigger (PR #113 added)
- `apps/dashboard/src/pages/DashboardPage.vue` -- overview page (PR #113 added)
- `apps/dashboard/src/pages/IssuePage.vue` -- issue detail page (PR #113 added)
- `apps/agent-please/server/plugins/02.chat-bot.ts` -- Nitro plugin for chat bot; async init via .then()/.catch()
- `packages/core/src/state.ts` -- dynamic import factory for state adapters (new in state-adapter-config track)
- `packages/core/src/config.ts` -- buildStateConfig() validates adapter kind before factory is called
