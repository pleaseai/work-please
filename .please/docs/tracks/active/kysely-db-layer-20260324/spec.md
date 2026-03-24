# Kysely DB Layer Integration

> Track: kysely-db-layer-20260324

## Overview

Replace the current raw `@libsql/client` usage in `packages/core/src/db.ts` with Kysely as the unified database layer. Share a single Kysely instance between application queries (agent run history) and Better Auth (dashboard authentication). Maintain local libsql as default with optional Turso cloud connectivity.

This track supersedes `libsql-turso-20260317` (run history) and `add-auth-20260321` (dashboard auth).

## Requirements

### Functional Requirements

- [ ] FR-1: Create a Kysely database module that initializes a single `Kysely<DB>` instance with the libsql dialect (`kysely-libsql`)
- [ ] FR-2: Support local embedded libsql (file path) as default and optional Turso cloud connection (URL + auth token) via `DbConfig`
- [ ] FR-3: Implement Kysely migrations for the `agent_runs` table (replacing raw `CREATE TABLE IF NOT EXISTS` SQL)
- [ ] FR-4: Convert all `agent_runs` queries (`insertRun`, `queryRuns`) from raw `@libsql/client` SQL to Kysely typed query builder
- [ ] FR-5: Integrate Better Auth server using the shared Kysely instance (inject Kysely dialect into Better Auth config)
- [ ] FR-6: Configure Better Auth with GitHub OAuth provider and username plugin for dashboard authentication
- [ ] FR-7: Add `auth` section to WORKFLOW.md YAML front matter config (`secret`, `github.client_id`, `github.client_secret`, `admin.username`, `admin.password`) with `$ENV_VAR` resolution
- [ ] FR-8: Protect dashboard pages and `/api/v1/*` routes behind Better Auth session middleware; keep `/api/auth/*` and `/api/webhooks/*` unauthenticated
- [ ] FR-9: Add login page with GitHub OAuth and username/password sign-in options
- [ ] FR-10: Seed initial admin account from environment variables on first startup
- [ ] FR-11: Retain existing `resolveDbPath()` workspace path traversal validation
- [ ] FR-12: Run Kysely migrations on startup (auto-migrate both `agent_runs` and Better Auth tables)

### Non-functional Requirements

- [ ] NFR-1: DB writes for run history must remain asynchronous and non-blocking (fire-and-forget with error logging)
- [ ] NFR-2: DB connection failure must not prevent service startup (warn and continue without DB)
- [ ] NFR-3: Single Kysely instance shared across application and Better Auth — no duplicate connections to the same file
- [ ] NFR-4: Webhook endpoints remain unauthenticated (verified by HMAC signature)
- [ ] NFR-5: Auth session uses secure HTTP-only cookies

## Acceptance Criteria

- [ ] AC-1: `@libsql/client` direct usage removed from `db.ts`; all queries go through Kysely
- [ ] AC-2: Better Auth and agent_runs share the same Kysely instance and DB file
- [ ] AC-3: Existing `/api/v1/runs` endpoint returns identical data format after migration
- [ ] AC-4: Dashboard redirects unauthenticated users to login page
- [ ] AC-5: GitHub OAuth and username/password login both work
- [ ] AC-6: Turso cloud connection works when configured (URL + auth token in WORKFLOW.md)
- [ ] AC-7: All existing `db.test.ts` tests pass with Kysely backend (or are updated accordingly)

## Out of Scope

- Multi-role authorization (viewer vs admin) — single admin role only
- User management UI
- API key authentication
- Rate limiting
- PostgreSQL/MySQL dialect support (libsql/SQLite only for now)
- Drizzle ORM migration (future consideration if tables grow significantly)

## Assumptions

- `kysely-libsql` package provides a Kysely dialect for `@libsql/client` that supports both local file and Turso cloud URLs
- Better Auth can accept an external Kysely dialect/instance for its internal database operations
- The existing `bun:sqlite` approach in the `add-auth` track is replaced by sharing the Kysely libsql connection
