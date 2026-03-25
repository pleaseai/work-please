# Plan: Migrate Dashboard API to oRPC + TanStack Query

> Track: orpc-tanstack-migration-20260325
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/orpc-tanstack-migration-20260325/spec.md
- **Issue**: TBD
- **Created**: 2026-03-25
- **Approach**: Big-Bang Migration (no backward compat required per spec)

## Purpose

After this change, dashboard users will see real-time orchestrator state updates via SSE instead of 3-second polling, with full end-to-end type safety from server to client. They can verify it works by observing live state changes without page refresh and checking that TypeScript catches any API contract mismatches at compile time.

## Context

The dashboard currently uses 4 Nitro REST endpoints (`/api/v1/*`) consumed via Nuxt `useFetch()` with `useIntervalFn` polling (3s/5s intervals). This works but has limitations: no type safety between server and client, polling wastes bandwidth when nothing changes, and adding new endpoints requires manually keeping response types in sync.

oRPC provides end-to-end TypeScript inference without codegen, and its event iterator feature enables SSE streaming natively. Combined with `@tanstack/vue-query` via `@orpc/tanstack-query`, the dashboard gains proper cache management, stale-while-revalidate, and live query options that replace polling entirely.

The server uses Nitro (H3 under the hood). oRPC's `RPCHandler` from `@orpc/server/fetch` works with H3 via `toWebRequest(event)`. No `@orpc/h3` or `@orpc/nuxt` package exists — the Fetch adapter is the canonical approach.

Constraints: webhook routes (`/api/webhooks/*`) and auth routes (`/api/auth/*`) remain as Nitro routes — only `/api/v1/*` is migrated. The orchestrator singleton lives on `nitroApp.orchestrator` and must be passed into the oRPC context.

## Architecture Decision

Full replacement of REST endpoints with oRPC procedures in a single pass, following oRPC's official Nuxt playground patterns:

1. **Server**: Define oRPC router with Zod schemas, mount via `RPCHandler` at `/rpc/[...]` catch-all route. Pass orchestrator + auth session via initial context from H3 event handler.
2. **Client**: Split Nuxt plugins — `.server.ts` uses `createRouterClient` (direct call, no HTTP during SSR), `.client.ts` uses `RPCLink` (HTTP in browser). Both provide `$orpc` TanStack Query utils.
3. **SSE**: `EventPublisher` in orchestrator plugin broadcasts state changes. Event iterator procedures yield updates. Client uses `experimental_liveOptions` (latest state) and `experimental_streamedOptions` (event log).
4. **Auth**: oRPC middleware calls `auth.api.getSession({ headers })` — same logic as current `middleware/auth.ts` but typed and composable.

Rationale: oRPC's Nuxt playground demonstrates this exact pattern. No custom adapters needed. The `createRouterClient` SSR optimization avoids HTTP round-trips during server-side rendering.

## Tasks

### Phase 1: Foundation — oRPC Server Setup

- [x] T001 Install oRPC and TanStack Query dependencies (file: apps/agent-please/package.json)
- [x] T002 Define Zod schemas for all API response types (file: apps/agent-please/server/orpc/schemas.ts) (depends on T001)
- [x] T003 Create oRPC base builder with context type and auth middleware (file: apps/agent-please/server/orpc/middleware.ts) (depends on T001)
- [x] T004 Create oRPC router with query/mutation procedures (file: apps/agent-please/server/orpc/router.ts) (depends on T002, T003)
- [x] T005 Mount oRPC handler as Nitro catch-all route (file: apps/agent-please/server/routes/rpc/[...].ts) (depends on T004)

### Phase 2: SSE Event Iterators

- [x] T006 Add EventPublisher to orchestrator plugin for state change broadcasting (file: apps/agent-please/server/plugins/01.orchestrator.ts) (depends on T005)
- [x] T007 Implement orchestrator.live event iterator procedure (file: apps/agent-please/server/orpc/router.ts) (depends on T006)
- [x] T008 Implement sessions.events event iterator procedure (file: apps/agent-please/server/orpc/router.ts) (depends on T006)

### Phase 3: Client Migration

- [x] T009 Create oRPC server-side Nuxt plugin with createRouterClient (file: apps/agent-please/app/plugins/orpc.server.ts) (depends on T004)
- [x] T010 Create oRPC client-side Nuxt plugin with RPCLink (file: apps/agent-please/app/plugins/orpc.client.ts) (depends on T004)
- [x] T011 Set up VueQueryPlugin in Nuxt plugin (file: apps/agent-please/app/plugins/vue-query.ts) (depends on T001)
- [x] T012 Rewrite useOrchestratorState composable with liveOptions (file: apps/agent-please/app/composables/useOrchestratorState.ts) (depends on T009, T010, T011, T007)
- [x] T013 Rewrite useIssueDetail composable with queryOptions (file: apps/agent-please/app/composables/useIssueDetail.ts) (depends on T009, T010, T011)
- [x] T014 Rewrite useSessionMessages composable with queryOptions (file: apps/agent-please/app/composables/useSessionMessages.ts) (depends on T009, T010, T011)
- [x] T015 Update dashboard page to use new composables and remove polling (file: apps/agent-please/app/pages/index.vue) (depends on T012)
- [x] T016 Update issue detail page (file: apps/agent-please/app/pages/issues/[identifier].vue) (depends on T013)
- [x] T017 Update session page (file: apps/agent-please/app/pages/sessions/[id].vue) (depends on T014)

### Phase 4: Cleanup

- [x] T018 Remove old REST API routes and Nitro auth middleware (file: apps/agent-please/server/api/v1/) (depends on T015, T016, T017)
- [x] T019 Remove old response types from utils/types.ts (file: apps/agent-please/app/utils/types.ts) (depends on T018)
- [x] T020 Update tech-stack.md with new dependencies (file: .please/docs/knowledge/tech-stack.md) (depends on T018)

## Key Files

### Create

- `apps/agent-please/server/orpc/schemas.ts` — Zod schemas for all procedure I/O
- `apps/agent-please/server/orpc/middleware.ts` — oRPC base builder, auth middleware, context type
- `apps/agent-please/server/orpc/router.ts` — oRPC router (queries, mutations, event iterators)
- `apps/agent-please/server/orpc/index.ts` — Router re-export
- `apps/agent-please/server/routes/rpc/[...].ts` — H3 catch-all handler for oRPC
- `apps/agent-please/server/routes/rpc/index.ts` — Re-export of catch-all
- `apps/agent-please/app/plugins/orpc.server.ts` — SSR plugin (direct router call)
- `apps/agent-please/app/plugins/orpc.client.ts` — Browser plugin (RPCLink)
- `apps/agent-please/app/plugins/vue-query.ts` — VueQueryPlugin setup

### Modify

- `apps/agent-please/server/plugins/01.orchestrator.ts` — Add EventPublisher
- `apps/agent-please/app/composables/useOrchestratorState.ts` — useFetch → liveOptions
- `apps/agent-please/app/composables/useIssueDetail.ts` — useFetch → queryOptions
- `apps/agent-please/app/composables/useSessionMessages.ts` — useFetch → queryOptions
- `apps/agent-please/app/pages/index.vue` — Remove polling, use TanStack Query
- `apps/agent-please/app/pages/issues/[identifier].vue` — Remove polling
- `apps/agent-please/app/pages/sessions/[id].vue` — Remove polling
- `apps/agent-please/package.json` — Add dependencies
- `.please/docs/knowledge/tech-stack.md` — Document new stack

### Delete

- `apps/agent-please/server/api/v1/state.get.ts`
- `apps/agent-please/server/api/v1/[identifier].get.ts`
- `apps/agent-please/server/api/v1/refresh.post.ts`
- `apps/agent-please/server/api/v1/sessions/[sessionId]/messages.get.ts`
- `apps/agent-please/server/middleware/auth.ts` (replaced by oRPC middleware)
- `apps/agent-please/app/utils/types.ts` (replaced by Zod schema inference)

### Reuse

- `apps/agent-please/server/utils/orchestrator.ts` — useOrchestrator helper (keep, used in oRPC context)
- `apps/agent-please/server/utils/auth.ts` — useAuth/isAuthEnabled (keep, used in oRPC middleware)
- `packages/core/src/orchestrator.ts` — Orchestrator class (unchanged)

## Verification

### Automated Tests

- [ ] oRPC procedures return correct response shapes matching Zod schemas
- [ ] Auth middleware rejects unauthenticated requests with 401
- [ ] Auth middleware allows requests when auth is not configured
- [ ] Event iterator yields state updates when orchestrator state changes
- [ ] TanStack Query composables provide typed data matching procedure outputs

### Observable Outcomes

- After starting the dev server, navigating to `/` shows the dashboard with live-updating metrics via SSE (no 3s polling visible in Network tab)
- Running `bun run check` shows zero type errors across the codebase
- Opening Chrome DevTools Network tab shows an EventStream connection to `/rpc` instead of repeated XHR polls

### Manual Testing

- [ ] Dashboard loads and displays running/retrying counts
- [ ] Clicking refresh triggers orchestrator poll and updates display
- [ ] Issue detail page shows session info and recent events
- [ ] Session page shows message history with text and tool_use blocks
- [ ] Login/logout flow still works (better-auth routes unchanged)

## Decision Log

- Decision: Use `@orpc/server/fetch` RPCHandler with `toWebRequest()` instead of a dedicated H3 adapter
  Rationale: No `@orpc/h3` package exists. This is the official pattern from oRPC's Nuxt playground.
  Date/Author: 2026-03-25 / Claude

- Decision: Split Nuxt plugins into `.server.ts` and `.client.ts` for SSR optimization
  Rationale: `createRouterClient` bypasses HTTP during SSR, reducing latency. Official oRPC Nuxt pattern.
  Date/Author: 2026-03-25 / Claude

- Decision: Use `EventPublisher` (not `MemoryPublisher`) for orchestrator state broadcasting
  Rationale: `EventPublisher` is lightweight with synchronous publishing, sufficient for single-process dashboard. `MemoryPublisher` adds resume support we don't need.
  Date/Author: 2026-03-25 / Claude
