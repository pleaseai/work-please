# Plan: Relay Package Split

> Track: relay-package-split-20260326
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: [spec.md](./spec.md)
- **Issue**: TBD
- **Created**: 2026-03-26
- **Approach**: Minimal Change

## Purpose

After this change, external applications will be able to install `@pleaseai/relay-client` to connect to the relay without depending on the full `@pleaseai/agent-core` package. Similarly, `@pleaseai/relay-server` can be used to build custom relay workers without copying code from `apps/relay-worker`.

## Context

The relay transport client (`RelayTransport`) currently lives inside `@pleaseai/agent-core`, which carries heavy dependencies (claude-agent-sdk, kysely, octokit, liquidjs). Any consumer that only needs relay connectivity must pull in the entire core package. The relay server logic (`RelayParty`) lives in `apps/relay-worker` as a private Cloudflare Worker app and cannot be reused.

The extraction is straightforward because `RelayTransport` depends only on `partysocket` and `consola` (via the logger wrapper), and `RelayParty` depends only on `partyserver`. Neither has deep coupling to core internals.

Constraints: backward compatibility must be maintained — `@pleaseai/agent-core` will re-export relay-client types so existing consumers are unaffected. No behavioral changes.

## Architecture Decision

Extract into two sibling packages under `packages/`. Each package uses `consola` directly for logging (same underlying library as core's `createLogger`). Core adds `@pleaseai/relay-client` as a workspace dependency and re-exports its public API. `apps/relay-worker` adds `@pleaseai/relay-server` as a workspace dependency and imports `RelayParty` from it.

## Tasks

- [x] T001 [P] Scaffold `@pleaseai/relay-client` package (file: packages/relay-client/package.json)
- [x] T002 [P] Scaffold `@pleaseai/relay-server` package (file: packages/relay-server/package.json)
- [x] T003 Move RelayTransport and types to relay-client (file: packages/relay-client/src/index.ts, depends on T001)
- [x] T004 Move RelayParty and verification logic to relay-server (file: packages/relay-server/src/index.ts, depends on T002)
- [x] T005 Update core to import from relay-client and re-export (file: packages/core/src/relay-transport.ts, depends on T003)
- [x] T006 Update relay-worker to import from relay-server (file: apps/relay-worker/src/index.ts, depends on T004)
- [x] T007 Run full workspace verification (depends on T005, T006)

## Key Files

### Create

- `packages/relay-client/package.json` — package manifest with `partysocket` + `consola` dependencies
- `packages/relay-client/tsconfig.json` — TypeScript config
- `packages/relay-client/src/index.ts` — re-exports RelayTransport, types
- `packages/relay-client/src/relay-transport.ts` — moved from core
- `packages/relay-client/src/types.ts` — RelayConfig, RelayEnvelope
- `packages/relay-client/src/relay-transport.test.ts` — moved from core
- `packages/relay-server/package.json` — package manifest with `partyserver` dependency
- `packages/relay-server/tsconfig.json` — TypeScript config
- `packages/relay-server/src/index.ts` — re-exports RelayParty, Env
- `packages/relay-server/src/relay-party.ts` — moved from relay-worker

### Modify

- `packages/core/package.json` — add `@pleaseai/relay-client` dependency, remove `partysocket`
- `packages/core/src/relay-transport.ts` — replace implementation with re-export from `@pleaseai/relay-client`
- `packages/core/src/index.ts` — update relay exports
- `packages/core/src/types.ts` — remove `RelayConfig` (now in relay-client)
- `packages/core/src/orchestrator.ts` — import from `@pleaseai/relay-client`
- `apps/relay-worker/package.json` — add `@pleaseai/relay-server` dependency
- `apps/relay-worker/src/index.ts` — import from `@pleaseai/relay-server`
- `apps/relay-worker/src/relay-party.ts` — remove (moved to relay-server)

### Reuse

- `packages/core/src/logger.ts` — pattern reference for consola usage

## Verification

### Automated Tests

- [ ] `bun test --filter relay-client` passes all relay transport tests
- [ ] `bun run test` passes across all workspaces
- [ ] `bun run check` type-checks across all workspaces

### Observable Outcomes

- Running `bun run check` shows no type errors in any workspace
- After `bun install`, `packages/relay-client` and `packages/relay-server` appear in workspace list
- Importing `{ RelayTransport }` from `@pleaseai/agent-core` still resolves correctly

### Manual Testing

- [ ] Verify `@pleaseai/relay-client` has no dependency on core internals (only `partysocket`, `consola`)
- [ ] Verify `@pleaseai/relay-server` has no dependency on core internals (only `partyserver`)

## Decision Log

- Decision: Use `consola` directly in relay-client instead of re-creating the `createLogger` wrapper
  Rationale: `createLogger` is a 1-line wrapper (`consola.withTag(tag)`). Duplicating it adds no value; using `consola` directly keeps the package simpler.
  Date/Author: 2026-03-26 / Claude

## Outcomes & Retrospective

### What Was Shipped
- `@pleaseai/relay-client` package with RelayTransport, RelayConfig, RelayEnvelope
- `@pleaseai/relay-server` package with RelayParty, Env, signature verification
- Backward-compatible re-exports from `@pleaseai/agent-core`
- relay-worker updated to import from relay-server

### What Went Well
- Clean extraction with minimal coupling — both packages have only 1-2 runtime dependencies
- All 10 relay transport tests passed immediately in the new package
- Type re-export pattern (`import + export type`) worked cleanly for backward compat

### What Could Improve
- The unparseable message test in the original core package had an incorrect assertion (expected triggerRefresh to be called on parse failure) — caught and fixed during extraction

### Tech Debt Created
- relay-server has no test suite (Cloudflare Workers tests require vitest + miniflare setup)
