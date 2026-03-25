# Relay Package Split

> Track: relay-package-split-20260326

## Overview

Extract the relay transport client from `@pleaseai/agent-core` and the relay server logic from `apps/relay-worker` into two new publishable packages: `@pleaseai/relay-client` and `@pleaseai/relay-server`. This allows external applications to use the relay client without depending on the full core package, and enables the relay server logic to be reused outside the Cloudflare Worker deployment.

## Scope

### `@pleaseai/relay-client` (new package)

- Move `RelayTransport` class from `packages/core/src/relay-transport.ts`
- Move `RelayConfig` and `RelayEnvelope` types
- Move existing tests from `relay-transport.test.ts`
- Dependency: `partysocket` only (plus `consola` for logging or accept a logger interface)
- Published to npm (not private)

### `@pleaseai/relay-server` (new package)

- Move `RelayParty` class from `apps/relay-worker/src/relay-party.ts`
- Move `Env` interface and signature verification logic
- Dependency: `partyserver` only
- Published to npm (not private)

### `apps/relay-worker` (existing, updated)

- Import `RelayParty` from `@pleaseai/relay-server` instead of local source
- Remains `private: true` — a thin Cloudflare Worker entry point only

### `@pleaseai/agent-core` (existing, updated)

- Add `@pleaseai/relay-client` as a dependency
- Re-export `RelayTransport` and `RelayConfig` for backward compatibility
- Orchestrator imports from `@pleaseai/relay-client`

## Success Criteria

- [ ] SC-1: `@pleaseai/relay-client` is a standalone package with `partysocket` as its only runtime dependency
- [ ] SC-2: `@pleaseai/relay-server` is a standalone package with `partyserver` as its only runtime dependency
- [ ] SC-3: Existing imports from `@pleaseai/agent-core` (`RelayTransport`, `RelayConfig`) continue to work via re-exports
- [ ] SC-4: `apps/relay-worker` uses `@pleaseai/relay-server` and deploys successfully
- [ ] SC-5: All existing relay transport tests pass in the new package location
- [ ] SC-6: `bun run check` and `bun run test` pass across all workspaces

## Constraints

- Backward compatibility: `@pleaseai/agent-core` must re-export relay client types so existing consumers are unaffected
- No behavioral changes: relay functionality must work identically after the split
- Logger: replace direct `createLogger` import with `consola` (already a dependency) or accept a logger parameter to avoid coupling to core's logger

## Out of Scope

- Adding new relay features or protocol changes
- Changing the WebSocket message envelope format
- Modifying the Cloudflare Worker deployment configuration
- Publishing workflow or CI/CD pipeline setup
