# Plan: Kysely DB Layer Integration

> Track: kysely-db-layer-20260324
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: kysely-db-layer-20260324
- **Created**: 2026-03-24
- **Approach**: Incremental replacement — swap DB layer first, then update auth

## Purpose

After this change, Agent Please will use Kysely as its unified database layer. The existing `@libsql/client` raw SQL in `db.ts` will be replaced with Kysely typed queries. Better Auth will share the same Kysely instance instead of using a separate `bun:sqlite` connection. Both agent run history and auth tables will co-exist in a single libsql database.

## Context

The current DB layer (`packages/core/src/db.ts`) uses `@libsql/client` directly with hand-written SQL strings. Better Auth is already integrated (`server/plugins/03.auth.ts`, `server/utils/auth.ts`) but uses a separate `bun:sqlite` `Database` connection to the same file. This creates two independent connections and prevents sharing transactions or connection state.

Key discovery: Better Auth accepts `{ db: Kysely<any>, type: 'sqlite' }` to use an externally-managed Kysely instance. The `@libsql/kysely-libsql` package provides a `LibsqlDialect` that supports both local file and Turso cloud URLs with the same `@libsql/client` config options.

## Architecture Decision

**Single Kysely instance shared between app and auth.**

```
packages/core/src/db.ts
  createKyselyDb(config, workspaceRoot)
    → Kysely<AppDatabase> via LibsqlDialect
    → local file:path OR libsql://turso-url
    → resolveDbPath() guard retained

orchestrator.start()
  → createKyselyDb() → runMigrations()
  → this.db = kyselyInstance

server/utils/auth.ts
  initAuth(authConfig, kyselyDb)
    → betterAuth({ database: { db: kyselyDb, type: 'sqlite' } })
```

**Key changes from current implementation:**
- `@libsql/client` Client → `Kysely<AppDatabase>` (via `@libsql/kysely-libsql`)
- Raw SQL strings → Kysely typed query builder
- `bun:sqlite Database` in auth → shared Kysely instance
- Inline `CREATE TABLE` → Kysely `Migrator` with migration files

## Tasks

### Phase 1: Kysely DB Foundation (core package)

- [x] (2026-03-24 KST) T001: Add `kysely` and `@libsql/kysely-libsql` dependencies to `packages/core`
  - `bun add kysely @libsql/kysely-libsql` in `packages/core`
  - **Files**: `packages/core/package.json`

- [x] (2026-03-24 KST) T002: Define `AppDatabase` type interface (depends on T001)
  - Create `packages/core/src/db-types.ts` with `AgentRunsTable` and `AppDatabase` interfaces
  - Map existing `agent_runs` columns to Kysely `ColumnType` definitions
  - **Files**: `packages/core/src/db-types.ts`

- [x] (2026-03-24 KST) T003: Create Kysely migration for `agent_runs` table (depends on T001)
  - Create `packages/core/src/migrations/001_create_agent_runs.ts`
  - Use Kysely schema builder (`db.schema.createTable(...)`) instead of raw SQL
  - Include the `idx_agent_runs_identifier` index
  - **Files**: `packages/core/src/migrations/001_create_agent_runs.ts`

- [x] (2026-03-24 KST) T004: Rewrite `db.ts` with Kysely (depends on T002, T003)
  - Replace `createDbClient()` → `createKyselyDb()` returning `Kysely<AppDatabase> | null`
  - Use `LibsqlDialect` with local file or Turso cloud URL
  - Replace `runMigrations()` with Kysely `Migrator`
  - Rewrite `insertRun()` using `db.insertInto('agent_runs').values(...).execute()`
  - Rewrite `queryRuns()` using `db.selectFrom('agent_runs').where(...).execute()`
  - Keep `resolveDbPath()` unchanged
  - Keep graceful degradation (null DB = no-op)
  - **Files**: `packages/core/src/db.ts`, `packages/core/src/types.ts`

- [x] (2026-03-24 KST) T005: Update `db.test.ts` for Kysely (depends on T004)
  - Update all tests to use `Kysely<AppDatabase>` instead of `Client`
  - Keep same test scenarios and assertions
  - **Files**: `packages/core/src/db.test.ts`

### Phase 2: Orchestrator Integration (core package)

- [x] (2026-03-24 KST) T006: Update orchestrator to use Kysely DB (depends on T004)
  - Change `private db: Client | null` → `private db: Kysely<AppDatabase> | null`
  - Update `start()`, `stop()`, `getDb()`, `insertRun` call sites
  - `stop()`: call `db.destroy()` instead of `db.close()`
  - **Files**: `packages/core/src/orchestrator.ts`

- [x] (2026-03-24 KST) T007: Update `server.ts` runs endpoint (depends on T004)
  - Update `/api/v1/runs` handler to work with new `queryRuns()` signature
  - **Files**: `packages/core/src/server.ts`

- [x] (2026-03-24 KST) T008: Remove `@libsql/client` direct dependency from core (depends on T006, T007)
  - `@libsql/client` remains as transitive dep (via `@libsql/kysely-libsql`)
  - Remove direct import of `createClient` from `db.ts`
  - **Files**: `packages/core/package.json`

### Phase 3: Auth Integration (app package)

- [x] (2026-03-24 KST) T009: Update `initAuth()` to accept Kysely instance (depends on T004)
  - Change signature: `initAuth(authConfig, kyselyDb)` instead of `initAuth(authConfig, dbPath)`
  - Use `betterAuth({ database: { db: kyselyDb, type: 'sqlite' } })`
  - Remove `import { Database } from 'bun:sqlite'`
  - **Files**: `apps/agent-please/server/utils/auth.ts`

- [x] (2026-03-24 KST) T010: Update `03.auth.ts` plugin to pass Kysely instance (depends on T009)
  - Get Kysely instance from `orchestrator.getDb()`
  - Pass it to `initAuth(config.auth, kyselyDb)`
  - Remove `resolve(config.workspace.root, config.db.path)` dbPath construction
  - Better Auth migrations run via `getMigrations(auth.options).runMigrations()` (unchanged)
  - **Files**: `apps/agent-please/server/plugins/03.auth.ts`

### Phase 4: Cleanup & Verification

- [x] (2026-03-24 KST) T011: Update barrel exports and types (depends on T008)
  - Update `packages/core/src/index.ts` to export new types
  - Ensure `Kysely<AppDatabase>` is accessible from app package
  - **Files**: `packages/core/src/index.ts`

- [ ] T012: Run full test suite and fix regressions (depends on all)
  - `bun run test` — all tests pass
  - `bun run check` — type check passes
  - `bun run lint` — lint passes
  - **Verification**: AC-1 through AC-7

## Key Files

| File | Change Type |
|---|---|
| `packages/core/src/db.ts` | Major rewrite |
| `packages/core/src/db-types.ts` | New file |
| `packages/core/src/migrations/001_create_agent_runs.ts` | New file |
| `packages/core/src/db.test.ts` | Update |
| `packages/core/src/orchestrator.ts` | Update (type change) |
| `packages/core/src/server.ts` | Update (minor) |
| `packages/core/src/types.ts` | Update (re-export) |
| `packages/core/src/index.ts` | Update (exports) |
| `packages/core/package.json` | Update (deps) |
| `apps/agent-please/server/utils/auth.ts` | Update (Kysely injection) |
| `apps/agent-please/server/plugins/03.auth.ts` | Update (pass Kysely) |

## Verification

- [ ] `bun run test` passes
- [ ] `bun run check` passes
- [ ] `bun run lint` passes
- [ ] Local libsql file DB works
- [ ] Better Auth login works with shared Kysely instance
- [ ] Agent run history is persisted and queryable

## Progress

| Phase | Status |
|---|---|
| Phase 1: Kysely DB Foundation | Not started |
| Phase 2: Orchestrator Integration | Not started |
| Phase 3: Auth Integration | Not started |
| Phase 4: Cleanup & Verification | Not started |

## Decision Log

| Decision | Rationale |
|---|---|
| Kysely over Drizzle | Better Auth uses Kysely internally; single dialect swap for multi-DB; schema 1벌 |
| LibsqlDialect | Supports both local file and Turso cloud with same @libsql/client options |
| Shared Kysely instance | Better Auth `{ db, type }` pattern allows direct instance sharing; no duplicate connections |
| Kysely Migrator | Replaces inline CREATE TABLE; proper migration tracking via `kysely_migration` table |

## Surprises & Discoveries

- Auth infrastructure (login page, middleware, plugin, utils) is already fully implemented — this track only needs to swap the DB connection from `bun:sqlite` to shared Kysely
- Better Auth's `createKyselyAdapter` returns the injected `db` instance verbatim (no cloning)
- `@libsql/kysely-libsql` passes all config options directly to `@libsql/client`, so Turso URL/authToken work unchanged
- T007: `server.ts` was already compatible with the Kysely `queryRuns()` signature — no `Client` imports existed and the call site used untyped `db` variable passed directly to `queryRuns()`, so no code changes were required
