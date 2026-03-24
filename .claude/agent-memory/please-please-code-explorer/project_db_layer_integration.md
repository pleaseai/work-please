---
name: db-layer-integration
description: Database layer architecture — DbConfig, createDbClient, insertRun, queryRuns integration points from config through orchestrator to HTTP API
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

### Config layer (`packages/core/src/config.ts:265-271`)

`buildDbConfig(db: Record<string,unknown>)` at line 265:
- Reads `db.path` → `resolvePathValue()` (supports `~` expansion and `$ENV_VAR` syntax); falls back to `DEFAULT_DB_PATH = '.agent-please/agent_runs.db'`
- Reads `db.turso_url` → `resolveEnvValue()` with env fallback `process.env.TURSO_DATABASE_URL`
- Reads `db.turso_auth_token` → `resolveEnvValue()` with env fallback `process.env.TURSO_AUTH_TOKEN`

Called from `buildConfig()` at line 83: `db: buildDbConfig(db)` where `db = sectionMap(raw, 'db')`.

### DB implementation (`packages/core/src/db.ts`)

`resolveDbPath(dbPath, workspaceRoot)` (line 31): path traversal guard — returns null if resolved path escapes workspace root.

`createDbClient(config, workspaceRoot)` (line 41):
- Branch 1: `config.turso_url` present → validate URL scheme → `createClient({ url, authToken })` from `@libsql/client`
- Branch 2: embedded file → `resolveDbPath()` → `mkdirSync(dirname(...), { recursive: true })` → `createClient({ url: 'file:...' })`
- Returns `Client | null`; null means DB is disabled (all subsequent DB calls are no-ops)

`runMigrations(client)` (line 94): calls `client.migrate([CREATE_AGENT_RUNS_TABLE, CREATE_AGENT_RUNS_IDX])` — idempotent (`CREATE TABLE IF NOT EXISTS`).

`insertRun(client, params)` (line 123): parameterized INSERT via `client.execute({sql, args})`; silently no-ops if `client` is null.

`queryRuns(client, options)` (line 162): SELECT with optional `WHERE identifier = ?` and/or `WHERE status = ?`; ORDER BY id DESC; default limit 50 / offset 0. Maps raw rows → `AgentRunRecord[]`.

### Orchestrator integration (`packages/core/src/orchestrator.ts`)

`private db: Client | null = null` (line 35) and `private pendingDbWrites: Promise<void>[] = []` (line 36).

**Initialization** in `start()` (line 73):
```
this.db = createDbClient(this.config.db, this.config.workspace.root)
if (this.db) { await runMigrations(this.db) }
```
Migration failure → `this.db = null` (run history disabled, no crash).

**`insertRun` call site 1**: `onWorkerExit()` (line 578) — called when a worker completes normally or fails. Status is `'success'` if `reason === 'normal'`, else `'failure'`.

**`insertRun` call site 2**: `terminateRunningIssue()` (line 792) — called when reconciliation stops an agent (terminal state or staleness). Status is `'terminated'`.

Both sites push the resulting promise into `pendingDbWrites[]` and remove it on settle (self-cleaning array, no unbounded growth).

**Shutdown** in `stop()` (line 120):
```
await Promise.allSettled(this.pendingDbWrites)
this.db.close()
```
Ensures all in-flight writes complete before DB handle is closed.

**Accessor** `getDb(): Client | null` (line 155) — exposes the client to server routes.

### HTTP API (`packages/core/src/server.ts`)

`GET /api/v1/runs` (line 116) → `runsResponse(orchestrator, url.searchParams)` (line 350):
- Gets `db` via `orchestrator.getDb()`
- Parses query params: `identifier` (≤256 chars), `status` (enum-validated), `limit` (1–200, default 50), `offset` (0–100000, default 0)
- Calls `queryRuns(db, { identifier, status, limit, offset })`
- Returns JSON array of `AgentRunRecord`

No `/api/v1/runs` route exists in the Nitro (`apps/agent-please/server/`) layer — the Nitro app has separate equivalent routes but `queryRuns` is only used by the Bun-native `HttpServer` in `packages/core/src/server.ts`.

### Nitro server layer (`apps/agent-please/server/`)

The Nitro routes (`server/api/v1/state.get.ts`, `server/api/v1/[identifier].get.ts`) read only from in-memory `OrchestratorState` via `useOrchestrator(event)`. They do NOT query the DB directly. The runs history endpoint is not present in the Nitro layer — it exists only in the core `HttpServer`.

`useOrchestrator()` (`server/utils/orchestrator.ts:4`) reads `nitroApp.orchestrator` injected by plugin `server/plugins/01.orchestrator.ts`.

### Data flow summary

```
WORKFLOW.md (YAML)
  → buildConfig() → buildDbConfig()
  → DbConfig { path, turso_url, turso_auth_token }
  → createDbClient()  [on orchestrator.start()]
  → Client | null (stored in Orchestrator.db)
  → runMigrations()   [creates agent_runs table + index]
  → (agent run completes/terminates)
  → insertRun(db, params)  [in onWorkerExit or terminateRunningIssue]
  → agent_runs row written
  → GET /api/v1/runs
  → orchestrator.getDb() → queryRuns(db, filters)
  → AgentRunRecord[] JSON response
```

**Why:** Understanding this is needed to add Kysely typed query builder (active track: `kysely-db-layer-20260324`) or add new DB-backed endpoints.

**How to apply:** DB is always nullable — guard with `if (!client) return []` / `if (!client) return` pattern throughout. Path traversal guard is mandatory for embedded mode. Turso remote mode requires URL scheme validation.
