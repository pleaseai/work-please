# Configurable State Adapter

> Track: state-adapter-config-20260321

## Overview

The Chat SDK state adapter is currently hardcoded to `createMemoryState()` in `02.chat-bot.ts`. This feature adds a new top-level `state` key to the WORKFLOW.md YAML front matter config, allowing users to select and configure their preferred state adapter (memory, redis, ioredis, or postgres). This enables production-grade distributed locking, thread subscriptions, and caching.

## Requirements

### Functional Requirements

- [ ] FR-1: Add a `state` key to `ServiceConfig` type with adapter kind and options
- [ ] FR-2: Parse `state` config from WORKFLOW.md YAML front matter via `buildConfig()`
- [ ] FR-3: Support 4 adapter kinds: `memory`, `redis`, `ioredis`, `postgres`
- [ ] FR-4: Create a factory function `createStateAdapter(config)` that returns the appropriate Chat SDK state adapter
- [ ] FR-5: Replace hardcoded `createMemoryState()` in `02.chat-bot.ts` with factory-based creation
- [ ] FR-6: Support `$ENV_VAR` syntax for credential fields (`url`) consistent with existing platform config
- [ ] FR-7: Support `keyPrefix` option for all adapters (default: `"chat-sdk"`)
- [ ] FR-8: Support `onLockConflict` option at Chat level (`"force"` | `"drop"`)
- [ ] FR-9: Default to `memory` when no `state` config is specified (backward compatible)

### Non-functional Requirements

- [ ] NFR-1: Only `@chat-adapter/state-memory` is bundled as a direct dependency; redis/ioredis/postgres are optional peer dependencies installed by the user
- [ ] NFR-2: Clear error message when a configured adapter package is not installed
- [ ] NFR-3: Config validation at startup — fail fast on invalid adapter kind or missing required fields

## Config Schema

```yaml
# WORKFLOW.md front matter
state:
  adapter: redis          # "memory" | "redis" | "ioredis" | "postgres"
  url: $REDIS_URL         # connection URL (supports $ENV_VAR syntax)
  key_prefix: my-bot      # optional, default: "chat-sdk"
  on_lock_conflict: force  # optional, "force" | "drop", default: "drop"
```

### Adapter-specific fields

| Adapter    | Required fields | Optional fields          |
|------------|----------------|--------------------------|
| `memory`   | (none)         | (none)                   |
| `redis`    | `url` or env `REDIS_URL` | `key_prefix`    |
| `ioredis`  | `url` or env `REDIS_URL` | `key_prefix`             |
| `postgres` | `url` or env `POSTGRES_URL` / `DATABASE_URL` | `key_prefix` |

## Acceptance Criteria

- [ ] AC-1: With no `state` config in WORKFLOW.md, the bot uses memory adapter (no breaking change)
- [ ] AC-2: Setting `state.adapter: redis` with a valid `url` creates a Redis state adapter
- [ ] AC-3: `$ENV_VAR` references in `state.url` are resolved at startup
- [ ] AC-4: Configuring an adapter whose package is not installed produces a clear error message
- [ ] AC-5: Existing tests continue to pass without modification
- [ ] AC-6: Unit tests cover factory function for all 4 adapter kinds

## Out of Scope

- Custom/third-party state adapter plugins
- Runtime adapter switching (restart required)
- Exposing `client` option (pre-connected client instances) — only URL-based config

## Assumptions

- Users who need redis/ioredis/postgres will install the corresponding `@chat-adapter/state-*` package themselves
- The `state` config key does not conflict with any existing WORKFLOW.md fields
- The `onLockConflict` setting applies at the Chat instance level, not per-adapter
