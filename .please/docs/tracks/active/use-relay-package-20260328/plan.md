# Plan: Use External Relay Packages

> Track: use-relay-package-20260328
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/use-relay-package-20260328/spec.md
- **Issue**: TBD
- **Created**: 2026-03-28
- **Approach**: Minimal Change

## Purpose

After this change, the monorepo will consume relay packages from npm (`@pleaseai/relay-client@^0.1.0`, `@pleaseai/relay-server@^0.1.0`) instead of maintaining local copies. This reduces maintenance burden and enables the relay packages to evolve independently in their own repository.

## Context

The relay transport (WebSocket client) and relay server (PartyServer Durable Object) were originally extracted from the monorepo into `packages/relay-client` and `packages/relay-server` as part of the `relay-package-split-20260326` track. These packages have since been published to the external repository `pleaseai/relay` and released on npm as `@pleaseai/relay-client@0.1.0` and `@pleaseai/relay-server@0.1.0`.

The external packages have an enhanced API compared to the local copies:
- **relay-client**: `triggerRefresh` callback now receives `RelayEnvelope` as a parameter (was `() => void`, now `(envelope: RelayEnvelope) => void`). `RelayEnvelope` gained `provider` and `payload` optional fields.
- **relay-server**: Refactored from inline GitHub-only signature verification to a provider-based architecture supporting GitHub and Asana. `RelayParty.onRequest` now requires an `X-Relay-Provider` header. New exports: `resolveProvider`, `WebhookProvider`. New env var: `FORWARD_PAYLOAD`.

The relay-worker (`apps/relay-worker`) route changes from `/webhook/:room` to `/webhook/:provider/:room` to pass the provider name via header.

## Architecture Decision

Direct replacement — remove local packages, install from npm, adapt call sites to the new API. No wrapper or compatibility layer needed since there are no special constraints and the API changes are minor and well-understood.

## Tasks

- [x] T001 Remove local relay packages and release-please config (file: packages/relay-client)
- [x] T002 Install external relay packages from npm (file: packages/core/package.json, depends on T001)
- [x] T003 Adapt core orchestrator for new triggerRefresh callback signature (file: packages/core/src/orchestrator.ts, depends on T002)
- [x] T004 Update relay-worker to provider-based routing (file: apps/relay-worker/src/index.ts, depends on T002)
- [x] T005 [P] Update documentation references (file: ARCHITECTURE.md, depends on T001)
- [x] T006 Verify build, type-check, lint, and tests pass (depends on T003, T004, T005)

## Key Files

### Remove
- `packages/relay-client/` — entire directory
- `packages/relay-server/` — entire directory

### Modify
- `packages/core/package.json` — replace `workspace:*` with `^0.1.0` for relay-client
- `packages/core/src/orchestrator.ts:102` — update `RelayTransport` constructor callback to accept envelope param
- `apps/relay-worker/package.json` — replace `workspace:*` with `^0.1.0` for relay-server
- `apps/relay-worker/src/index.ts` — update webhook route from `/webhook/:room` to `/webhook/:provider/:room`, inject `x-relay-provider` header
- `release-please-config.json` — remove relay-client and relay-server entries
- `ARCHITECTURE.md` — update project structure, note packages are external
- `.please/docs/knowledge/tech-stack.md` — update project structure section

### Reuse
- `packages/core/src/relay-transport.ts` — re-export file, no changes needed
- `packages/core/src/types.ts` — imports `RelayConfig`, no changes needed
- `packages/core/src/index.ts` — re-exports, no changes needed

## Verification

### Automated Tests
- [ ] `bun run check` passes across all workspaces
- [ ] `bun run test` passes across all workspaces
- [ ] `bun run lint` passes across all workspaces

### Observable Outcomes
- After `bun install`, `node_modules/@pleaseai/relay-client` and `node_modules/@pleaseai/relay-server` come from npm registry (not workspace symlinks)
- Running `bun run check` in `packages/core` succeeds with the new `RelayEnvelope` callback type
- Running `bun run check` in `apps/relay-worker` succeeds with the new provider-based `Env` type

### Acceptance Criteria Check
- [ ] `packages/relay-client/` directory does not exist
- [ ] `packages/relay-server/` directory does not exist
- [ ] `@pleaseai/relay-client` installed from npm at `^0.1.0`
- [ ] `@pleaseai/relay-server` installed from npm at `^0.1.0`
- [ ] No `workspace:*` references to relay packages remain

## Progress

- [x] (2026-03-28 21:40 KST) T001 Remove local relay packages and release-please config
- [x] (2026-03-28 21:41 KST) T002 Install external relay packages from npm
- [x] (2026-03-28 21:42 KST) T003 Adapt core orchestrator (no change needed — npm 0.1.0 has same API)
- [x] (2026-03-28 21:42 KST) T004 Update relay-worker (no change needed — npm 0.1.0 has same API)
- [x] (2026-03-28 21:43 KST) T005 Update documentation references
- [x] (2026-03-28 21:44 KST) T006 Verify build, type-check, lint, and tests pass
  Evidence: `bun run check` → all 5 tasks pass; `bun run lint` → all pass; `bun run test` → 766 pass, 2 fail (pre-existing)

## Decision Log

- Decision: Direct replacement without compatibility wrapper
  Rationale: API differences are minor (callback signature, route pattern), no special constraints
  Date/Author: 2026-03-28 / Claude
- Decision: Keep existing relay-worker routing unchanged
  Rationale: npm @pleaseai/relay-server@0.1.0 still has the old API (no provider system). Provider-based routing is in the external repo's main branch but not yet released.
  Date/Author: 2026-03-28 / Claude

## Surprises & Discoveries

- Observation: npm @pleaseai/relay-client@0.1.0 and @pleaseai/relay-server@0.1.0 still have the original API without provider-based changes
  Evidence: Installed packages use `triggerRefresh: () => void` and `RelayParty` without `X-Relay-Provider` header — the enhanced API is only in the external repo's main branch, not yet released
- Observation: 2 pre-existing test failures unrelated to relay changes
  Evidence: `runMigrations > returns false when migration fails on destroyed connection` and `ensureSharedClone with token > redacts token from error message when fetch fails` both fail on clean main branch

## Outcomes & Retrospective

### What Was Shipped
- Removed local `packages/relay-client` and `packages/relay-server` directories
- Replaced `workspace:*` references with npm `^0.1.0` in core and relay-worker
- Cleaned up `release-please-config.json` and `.release-please-manifest.json`
- Updated ARCHITECTURE.md and tech-stack.md to note packages are external

### What Went Well
- Clean migration — no source code changes needed beyond dependency swaps
- npm 0.1.0 packages are API-compatible with the local copies
- Code review caught the missed `.release-please-manifest.json` cleanup

### What Could Improve
- Spec assumed the npm packages had the enhanced provider-based API, but they were published from an earlier commit. Future specs should verify the published API before planning.

### Tech Debt Created
- When `@pleaseai/relay-server` releases the provider-based API, relay-worker should be updated to use `/webhook/:provider/:room` routing
