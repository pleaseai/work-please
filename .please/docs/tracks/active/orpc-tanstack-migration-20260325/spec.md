# Migrate Dashboard API to oRPC + TanStack Query

> Track: orpc-tanstack-migration-20260325

## Overview

Replace the existing Nitro REST API layer (`/api/v1/*`) with oRPC procedures and migrate the dashboard frontend from `useFetch` to `@tanstack/vue-query` via `@orpc/tanstack-query`. Add SSE-based real-time streaming for orchestrator state and agent session events using oRPC event iterators.

## Scope

### Server (oRPC Router)
- Replace all `/api/v1/*` Nitro server routes with oRPC procedures (`@orpc/server`)
- Mount oRPC router via H3 adapter (`@orpc/h3`)
- Define Zod schemas for all procedure inputs/outputs
- Add typed middleware for authentication (better-auth session check)
- Implement event iterator procedures for:
  - Live orchestrator state (`experimental_liveOptions` pattern)
  - Agent session event stream (`experimental_streamedOptions` pattern)
- Use `EventPublisher` for broadcasting orchestrator state changes

### Client (TanStack Query)
- Install `@orpc/tanstack-query` + `@tanstack/vue-query`
- Create oRPC client with `createTanstackQueryUtils`
- Replace all `useFetch` calls with `useQuery`/`useMutation` via oRPC utils
- Implement SSE consumption via `experimental_liveOptions` (orchestrator state) and `experimental_streamedOptions` (session events)
- Remove polling patterns — SSE replaces periodic refetching

### Procedures to Migrate

| Current REST Endpoint | oRPC Procedure | Type |
|---|---|---|
| `GET /api/v1/state` | `orchestrator.state` | query |
| `GET /api/v1/:identifier` | `issues.detail` | query |
| `GET /api/v1/sessions/:id/messages` | `sessions.messages` | query |
| `POST /api/v1/refresh` | `orchestrator.refresh` | mutation |
| (new) | `orchestrator.live` | event iterator (live) |
| (new) | `sessions.events` | event iterator (streamed) |

## Success Criteria

- [ ] SC-1: All existing REST endpoints replaced with oRPC procedures
- [ ] SC-2: Dashboard fully functional with TanStack Query (no `useFetch` remaining)
- [ ] SC-3: Real-time orchestrator state via SSE (no polling)
- [ ] SC-4: Agent session events streamed via SSE
- [ ] SC-5: Type-safe end-to-end — server procedure types flow to client with zero codegen
- [ ] SC-6: All existing tests pass or are migrated to test new API layer
- [ ] SC-7: Auth middleware enforced on all procedures

## Constraints

- No backward compatibility required — full replacement in one pass
- Existing webhook endpoints (`/api/webhooks/*`) and auth endpoints (`/api/auth/*`) are out of scope

## Out of Scope

- Webhook handlers (GitHub, Slack, Asana) — remain as Nitro routes
- Auth endpoints — managed by better-auth, unchanged
- Caching strategy tuning — basic defaults now, optimize later
- Documentation site changes

## Tech Stack Changes

| Addition | Purpose |
|---|---|
| `@orpc/server` | Server-side procedure definitions |
| `@orpc/client` | Client-side type-safe calls |
| `@orpc/tanstack-query` | TanStack Query integration |
| `@orpc/zod` | Zod schema converter |
| `@tanstack/vue-query` | Vue query/mutation/cache layer |
| `zod` | Already installed — used for procedure schemas |
