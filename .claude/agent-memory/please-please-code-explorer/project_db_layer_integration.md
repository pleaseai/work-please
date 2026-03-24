---
name: db-layer-integration
description: Database layer architecture — Kysely typed query builder with LibsqlDialect, createKyselyDb, insertRun, queryRuns integration points from config through orchestrator to HTTP API
type: project
---

## DB Layer: Full Integration Map

### Types (`packages/core/src/types.ts:160-193`)

`DbConfig` (line 160):
- `path: string` — relative or absolute path for embedded SQLite file; default `.agent-please/agent_runs.db`
- `turso_url: string | null` — Turso/libSQL remote URL (`libsql:`, `libsqls:`, `https:` schemes only)
- `turso_auth_token: string | null` — auth token for Turso

`AgentRunStatus` (line 175): union `'success' | 'failure' | 'terminated'`

`AgentRunRecord` (line 177): all fields of the `agent_runs` table as TypeScript, with `id: number` (AUTOINCREMENT), dates stored as ISO strings, and nullable `session_id`, `error`, `retry_attempt`.

### DB types (`packages/core/src/db-types.ts`)

`AppDatabase` interface defines the typed schema for Kysely:
- `agent_runs` table type with all columns typed

### Config layer (`packages/core/src/config.ts:265-271`)

`buildDbConfig(db: Record<string,unknown>)` at line 265:
- Reads `db.path` → `resolvePathValue()` (supports `~` expansion and `$ENV_VAR` syntax); falls back to `DEFAULT_DB_PATH = '.agent-please/agent_runs.db'`
- Reads `db.turso_url` → `resolveEnvValue()` with env fallback `process.env.TURSO_DATABASE_URL`
- Reads `db.turso_auth_token` → `resolveEnvValue()` with env fallback `process.env.TURSO_AUTH_TOKEN`

Called from `buildConfig()` at line 83: `db: buildDbConfig(db)` where `db = sectionMap(raw, 'db')`.

### DB implementation (`packages/core/src/db.ts`)

Uses **Kysely** typed query builder with `@libsql/kysely-libsql` (`LibsqlDialect`).

`resolveDbPath(dbPath, workspaceRoot)` (line 12): path traversal guard — returns null if resolved path escapes workspace root.

`createKyselyDb(config, workspaceRoot)` (line 22):
- Branch 1: `config.turso_url` present → validate URL scheme → `new LibsqlDialect({ url, authToken })` → `new Kysely<AppDatabase>({ dialect })`
- Branch 2: embedded file → `resolveDbPath()` → `mkdirSync(dirname(...), { recursive: true })` → `new LibsqlDialect({ url: 'file:...' })` → `new Kysely<AppDatabase>({ dialect })`
- Returns `Kysely<AppDatabase> | null`; null means DB is disabled (all subsequent DB calls are no-ops)

`runMigrations(db)` (line 75): uses Kysely `Migrator` with inline migration provider. Migrations are in `src/migrations/001_create_agent_runs.ts` (typed `up`/`down` functions using Kysely schema builder). Idempotent via `ifNotExists`/`ifExists`.

`insertRun(db, params)` (line 118): typed INSERT via `db.insertInto('agent_runs').values({...}).execute()`; silently no-ops if `db` is null.

`queryRuns(db, options)` (line 153): typed SELECT with optional `.where('identifier', '=', ...)` and/or `.where('status', '=', ...)`; `.orderBy('id', 'desc')`; default limit 50 / offset 0. Maps rows → `AgentRunRecord[]`.

### Migrations (`packages/core/src/migrations/`)

`001_create_agent_runs.ts`:
- `up(db)`: creates `agent_runs` table + `idx_agent_runs_identifier` index
- `down(db)`: drops index first, then table (correct order for dialect portability)

### Orchestrator integration (`packages/core/src/orchestrator.ts`)

`private db: Kysely<AppDatabase> | null = null` and `private pendingDbWrites: Promise<void>[] = []`.

**Initialization** in `start()`:
```
this.db = createKyselyDb(this.config.db, this.config.workspace.root)
if (this.db) { await runMigrations(this.db) }
```
Migration failure → `this.db = null` (run history disabled, no crash).

**`insertRun` call site 1**: `onWorkerExit()` — called when a worker completes normally or fails.

**`insertRun` call site 2**: `terminateRunningIssue()` — called when reconciliation stops an agent.

Both sites push the resulting promise into `pendingDbWrites[]` and remove it on settle.

**Shutdown** in `stop()`:
```
await Promise.allSettled(this.pendingDbWrites)
await this.db.destroy()
```

**Accessor** `getDb(): Kysely<AppDatabase> | null` — exposes the typed DB instance to server routes and auth.

### Auth integration

`initAuth(authConfig, db)` in `apps/agent-please/server/utils/auth.ts` receives the shared `Kysely<any>` instance and passes it to better-auth as `{ db, type: 'sqlite' }`. Auth no longer creates its own SQLite connection.

### Data flow summary

```
WORKFLOW.md (YAML)
  → buildConfig() → buildDbConfig()
  → DbConfig { path, turso_url, turso_auth_token }
  → createKyselyDb()  [on orchestrator.start()]
  → Kysely<AppDatabase> | null (stored in Orchestrator.db)
  → runMigrations()   [Kysely Migrator with typed up/down]
  → (agent run completes/terminates)
  → insertRun(db, params)  [typed Kysely insert]
  → agent_runs row written
  → GET /api/v1/runs
  → orchestrator.getDb() → queryRuns(db, filters)
  → AgentRunRecord[] JSON response
```

**Why:** Understanding this is needed to add new DB-backed features, new migrations, or new endpoints.

**How to apply:** DB is always nullable — guard with `if (!db) return []` / `if (!db) return` pattern throughout. Path traversal guard is mandatory for embedded mode. Turso remote mode requires URL scheme validation. All queries use Kysely typed builder — no raw SQL needed for CRUD.
