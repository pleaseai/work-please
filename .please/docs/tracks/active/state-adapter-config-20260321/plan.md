# Plan: Configurable State Adapter

> Track: state-adapter-config-20260321
> Spec: [spec.md](./spec.md)

## Overview
- **Source**: /please:plan
- **Track**: state-adapter-config-20260321
- **Created**: 2026-03-21
- **Approach**: Config type in `packages/core` + factory with dynamic imports in `packages/core/src/state.ts`

## Purpose

Replace the hardcoded `createMemoryState()` in the Chat bot plugin with a configurable state adapter, enabling production-grade distributed locking and thread subscriptions via Redis, ioredis, or PostgreSQL adapters.

## Context

- Currently `02.chat-bot.ts:80` hardcodes `createMemoryState()`
- `vendor/openreview/lib/bot.ts` shows the redis/memory fallback pattern
- Chat SDK `StateAdapter` interface supports: `acquireLock`, `subscribe`, `get/set`, `connect/disconnect`
- 4 official adapter packages: `@chat-adapter/state-memory`, `state-redis`, `state-ioredis`, `state-pg`
- Config parsing follows `sectionMap()` + helper function pattern (see `buildDbConfig()`)

## Architecture Decision

**Single approach — Config in core + dynamic import factory**

- `StateConfig` type added to `packages/core/src/types.ts` as peer to `DbConfig`
- `buildStateConfig()` added to `packages/core/src/config.ts` following `buildDbConfig()` pattern
- `createStateFromConfig()` factory in new `packages/core/src/state.ts` using `await import()` for optional adapters
- `apps/agent-please/server/plugins/02.chat-bot.ts` calls factory instead of `createMemoryState()`
- Only `@chat-adapter/state-memory` remains a direct dependency; others are optional peer deps

## Tasks

### Phase 1: Type definition and config parsing

- [x] T-1: Add `StateAdapterKind` type and `StateConfig` interface to `packages/core/src/types.ts`
  - `StateAdapterKind = 'memory' | 'redis' | 'ioredis' | 'postgres'`
  - `StateConfig = { adapter: StateAdapterKind, url: string | null, key_prefix: string, on_lock_conflict: 'force' | 'drop' }`
  - Add `state: StateConfig` to `ServiceConfig`
  - Export `StateAdapterKind` and `StateConfig` from `index.ts`

- [x] T-2: Add `buildStateConfig()` to `packages/core/src/config.ts`
  - Extract `state` section via `sectionMap(raw, 'state')`
  - Validate `adapter` field against allowed kinds, default `'memory'`
  - Resolve `url` via `resolveEnvValue()` with env fallbacks: `REDIS_URL` for redis/ioredis, `POSTGRES_URL`/`DATABASE_URL` for postgres
  - Parse `key_prefix` (default `'chat-sdk'`) and `on_lock_conflict` (default `'drop'`)
  - Wire into `buildConfig()` return object

- [x] T-3: Add unit tests for `buildStateConfig()` in `packages/core/src/config.test.ts`
  - Default: no state config → `{ adapter: 'memory', url: null, key_prefix: 'chat-sdk', on_lock_conflict: 'drop' }`
  - Explicit redis config with `$REDIS_URL` env var resolution
  - Explicit postgres config with `$POSTGRES_URL` env var resolution
  - Invalid adapter kind → defaults to `'memory'`
  - `key_prefix` and `on_lock_conflict` override

### Phase 2: State adapter factory

- [x] T-4: Create `packages/core/src/state.ts` with `createStateFromConfig()` factory
  - Accept `StateConfig` parameter
  - For `'memory'`: static import `@chat-adapter/state-memory`, call `createMemoryState()`
  - For `'redis'`: dynamic `await import('@chat-adapter/state-redis')`, call `createRedisState({ url, keyPrefix })`
  - For `'ioredis'`: dynamic `await import('@chat-adapter/state-ioredis')`, call `createIORedisState({ url, keyPrefix })`
  - For `'postgres'`: dynamic `await import('@chat-adapter/state-pg')`, call `createPostgresState({ url, keyPrefix })`
  - Wrap dynamic imports in try/catch: on `MODULE_NOT_FOUND`/`ERR_MODULE_NOT_FOUND`, throw descriptive error: `"State adapter '${kind}' requires package '@chat-adapter/state-${kind}'. Install it with: bun add @chat-adapter/state-${kind}"`
  - Export from `packages/core/src/index.ts`

- [x] T-5: Add unit tests for `createStateFromConfig()` in `packages/core/src/state.test.ts`
  - Memory adapter: returns successfully with default config
  - Redis/ioredis/postgres: mock dynamic imports, verify correct factory called with correct options
  - Missing package: mock import to throw, verify descriptive error message

### Phase 3: Integration

- [x] T-6: Update `apps/agent-please/server/plugins/02.chat-bot.ts` to use factory
  - Replace `import { createMemoryState } from '@chat-adapter/state-memory'` with `import { createStateFromConfig } from '@pleaseai/agent-core'`
  - Replace `state: createMemoryState()` with `state: await createStateFromConfig(config.state)`
  - Pass `config.state.on_lock_conflict` to `Chat` constructor if not `'drop'`
  - Handle async: the plugin callback may need to be adjusted for the async factory

- [x] T-7: Add `@chat-adapter/state-redis`, `@chat-adapter/state-ioredis`, `@chat-adapter/state-pg` as optional peer dependencies in `packages/core/package.json`

- [x] T-8: Verify all existing tests pass, run lint and type-check

## Key Files

| File | Action |
|------|--------|
| `packages/core/src/types.ts` | Add `StateAdapterKind`, `StateConfig`, update `ServiceConfig` |
| `packages/core/src/config.ts` | Add `buildStateConfig()`, wire into `buildConfig()` |
| `packages/core/src/config.test.ts` | Add state config tests |
| `packages/core/src/state.ts` | New — factory function |
| `packages/core/src/state.test.ts` | New — factory tests |
| `packages/core/src/index.ts` | Export new types and factory |
| `packages/core/package.json` | Add optional peer deps |
| `apps/agent-please/server/plugins/02.chat-bot.ts` | Replace hardcoded state with factory |

## Verification

1. `bun run test` — all existing + new tests pass
2. `bun run check` — type-check passes
3. `bun run lint` — no lint errors
4. Manual: start with no `state` config → memory adapter used (backward compatible)
5. Manual: start with `state.adapter: redis` + `REDIS_URL` → redis adapter created

## Progress

- 2026-03-21: Phase 1 complete (types, config parsing, tests) — ba6a73c
- 2026-03-21: Phase 2 complete (factory function, tests) — d21b5a7
- 2026-03-21: Phase 3 complete (integration, peer deps, verification) — 2a1fb8f

## Decision Log

- State config type lives in `packages/core` alongside all other config types
- Factory uses dynamic `import()` for optional adapters to avoid hard dependencies
- Only `@chat-adapter/state-memory` is a direct dependency; others are optional peer deps
- `on_lock_conflict` is parsed in config but applied at `Chat` constructor level

## Surprises & Discoveries

- Bun's dynamic import throws `ResolveMessage` (not `instanceof Error`) — needed duck-typed message check for `isModuleNotFound`
- `packages/core` doesn't have `@chat-adapter/state-memory` in its deps, so all adapters use dynamic imports (including memory)
- Nitro plugin callback is synchronous — used `.then()` pattern for async state adapter creation
