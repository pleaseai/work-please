# Plan: Dashboard Authentication

> Track: add-auth-20260321
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/add-auth-20260321/spec.md
- **Issue**: #157
- **Created**: 2026-03-21
- **Approach**: Pragmatic

## Purpose

After this change, admin operators will be able to sign in to the Agent Please dashboard via GitHub OAuth or username/password. They can verify it works by visiting the dashboard URL and being redirected to a login page, then signing in and seeing the orchestrator state.

## Context

The Agent Please Nuxt dashboard currently has no authentication. All pages and API routes are publicly accessible. This track adds Better Auth integration with GitHub OAuth, username/password (via username plugin), and admin role management (via admin plugin). Auth data is stored in the existing libsql database using Better Auth's built-in SQLite adapter with `bun:sqlite`.

Auth configuration follows the existing WORKFLOW.md convention. A new `auth:` section in the YAML front matter holds credentials (secret, GitHub OAuth client ID/secret, admin seed credentials), all supporting `$ENV_VAR` resolution via `resolveEnvValue()`. The config layer parses this into an `AuthConfig` type on `ServiceConfig`, which the Better Auth server instance reads at startup.

The dashboard is a Nuxt 4 app (`apps/agent-please/`) with Nitro server routes (`/api/v1/*`) and webhook handlers (`/api/webhooks/*`). Webhook endpoints must remain unauthenticated (they use HMAC signature verification). The existing `@libsql/client` manages `agent_runs` table; Better Auth tables will be co-located in the same database file via `bun:sqlite` (separate connection, same file).

Key constraints: Bun runtime (not Node.js), Nuxt UI v4 for components, `@antfu/eslint-config` style, no ORM (raw SQL/Kysely via Better Auth internals).

Non-goals: multi-role authorization (viewer vs admin), user management UI, API key auth, rate limiting.

WORKFLOW.md `auth:` section example:

```yaml
auth:
  secret: $BETTER_AUTH_SECRET
  github:
    client_id: $AUTH_GITHUB_CLIENT_ID
    client_secret: $AUTH_GITHUB_CLIENT_SECRET
  admin:
    username: $AUTH_ADMIN_USERNAME
    password: $AUTH_ADMIN_PASSWORD
```

## Architecture Decision

Auth config is added as a new `auth:` section in WORKFLOW.md YAML front matter, parsed by `buildAuthConfig()` in `packages/core/src/config.ts` and stored as `ServiceConfig.auth`. This follows the project's existing pattern where all runtime configuration flows through WORKFLOW.md with `$ENV_VAR` indirection.

Better Auth is integrated as a Nuxt server-side library with a catch-all API route at `/api/auth/[...all].ts`. The `bun:sqlite` driver points to the same database file used by `@libsql/client` for agent runs, keeping all data co-located. A Nitro plugin (`00.auth.ts`) creates the Better Auth instance from `ServiceConfig.auth`, runs migrations, and seeds the initial admin user on startup. Client-side auth uses `better-auth/vue` with `useSession(useFetch)` for SSR-compatible session management. Route protection is split: a global Nuxt middleware handles page redirects, and a Nitro server middleware protects `/api/v1/*` routes while allowing `/api/auth/*` and `/api/webhooks/*` through.

## Tasks

### Phase 1: Config layer (core package)

- [x] T001 Add AuthConfig type and extend ServiceConfig (file: packages/core/src/types.ts)
- [x] T002 Implement buildAuthConfig() parser with $ENV_VAR resolution (file: packages/core/src/config.ts, depends on T001)

### Phase 2: Server-side auth setup

- [x] T003 Install Better Auth and create server instance from ServiceConfig.auth (file: apps/agent-please/server/utils/auth.ts, depends on T002)
- [x] T004 Create auth API catch-all route (file: apps/agent-please/server/api/auth/[...all].ts, depends on T003)
- [x] T005 Create auth startup plugin with migrations and admin seeding (file: apps/agent-please/server/plugins/03.auth.ts, depends on T003)

### Phase 3: Middleware and route protection

- [x] T006 Create server-side auth middleware for /api/v1/* routes (file: apps/agent-please/server/middleware/auth.ts, depends on T004)
- [x] T007 Create client-side route middleware for page protection (file: apps/agent-please/app/middleware/auth.global.ts, depends on T003)

### Phase 4: Client-side auth and UI

- [x] T008 Create auth client with plugins (file: apps/agent-please/lib/auth-client.ts, depends on T003)
- [x] T009 Build login page with GitHub OAuth and username/password forms (file: apps/agent-please/app/pages/login.vue, depends on T008)
- [x] T010 Add user menu to dashboard sidebar (file: apps/agent-please/app/layouts/dashboard.vue, depends on T008)

### Phase 5: Configuration and documentation

- [x] T011 Add auth runtime config to nuxt.config.ts (file: apps/agent-please/nuxt.config.ts, depends on T002)

## Key Files

### Create

- `apps/agent-please/lib/auth.ts` -- Better Auth server instance (reads `ServiceConfig.auth`, configures GitHub OAuth, username, admin plugins, bun:sqlite adapter)
- `apps/agent-please/lib/auth-client.ts` -- Better Auth Vue client (admin + username client plugins)
- `apps/agent-please/server/api/auth/[...all].ts` -- Catch-all route delegating to `auth.handler()`
- `apps/agent-please/server/plugins/00.auth.ts` -- Nitro plugin: create auth instance, run migrations, seed admin
- `apps/agent-please/server/middleware/auth.ts` -- Nitro middleware: protect `/api/v1/*`, bypass `/api/auth/*` and `/api/webhooks/*`
- `apps/agent-please/app/middleware/auth.global.ts` -- Nuxt route middleware: redirect unauthenticated users to `/login`
- `apps/agent-please/app/pages/login.vue` -- Login page with GitHub OAuth button and username/password form

### Modify

- `packages/core/src/types.ts` -- Add `AuthConfig` interface + extend `ServiceConfig`
- `packages/core/src/config.ts` -- Add `buildAuthConfig()` + wire into `buildConfig()`
- `apps/agent-please/app/layouts/dashboard.vue` -- Add user menu (avatar, name, sign-out) in sidebar footer
- `apps/agent-please/nuxt.config.ts` -- Add auth-related runtime config keys
- `apps/agent-please/package.json` -- Add `better-auth` dependency

### Reuse

- `packages/core/src/db.ts` -- Reference `resolveDbPath()` pattern; auth DB uses same file path
- `packages/core/src/config.ts` -- Reference `resolveEnvValue()` for `$ENV_VAR` resolution
- `apps/agent-please/server/plugins/01.orchestrator.ts` -- Reference Nitro plugin pattern

## Verification

### Automated Tests

- [ ] `buildAuthConfig()` parses auth section from WORKFLOW.md correctly
- [ ] `buildAuthConfig()` resolves $ENV_VAR values in auth credentials
- [ ] `buildAuthConfig()` returns null/defaults when auth section is missing
- [ ] Auth server instance creates without errors
- [ ] Admin user is seeded when config has admin credentials
- [ ] Server middleware returns 401 for unauthenticated `/api/v1/state` requests
- [ ] Server middleware allows unauthenticated `/api/webhooks/github` requests
- [ ] Server middleware allows unauthenticated `/api/auth/*` requests

### Observable Outcomes

- After configuring `auth:` in WORKFLOW.md and starting the server, the admin user exists in the database
- Running `curl http://localhost:3000/api/v1/state` returns 401
- Running `curl http://localhost:3000/api/auth/ok` returns 200

### Manual Testing

- [ ] Visit dashboard -> redirected to /login
- [ ] Click "Sign in with GitHub" -> GitHub OAuth flow -> dashboard
- [ ] Enter username/password -> dashboard
- [ ] Click sign out in user menu -> redirected to /login
- [ ] POST to /api/webhooks/github with valid signature -> 200

### Acceptance Criteria Check

- [ ] AC-1: Unauthenticated dashboard visit redirects to /login
- [ ] AC-2: GitHub OAuth sign-in works
- [ ] AC-3: Username/password sign-in works
- [ ] AC-4: Unauthenticated /api/v1/* returns 401
- [ ] AC-5: Webhook endpoints remain accessible
- [ ] AC-6: Admin auto-created on startup with auth config
- [ ] AC-7: Sign-out clears session and redirects

## Decision Log

- Decision: Auth config in WORKFLOW.md `auth:` section, not separate env vars
  Rationale: WORKFLOW.md is the single source of truth for all Agent Please configuration. Auth credentials use the same `$ENV_VAR` resolution as tracker credentials.
  Date/Author: 2026-03-21 / Claude

- Decision: Use `bun:sqlite` for Better Auth adapter instead of `@libsql/client`
  Rationale: Better Auth's built-in SQLite adapter requires a raw SQLite driver interface. `bun:sqlite` is native to the Bun runtime and can share the same database file as `@libsql/client`. Two connections to the same SQLite file in WAL mode is safe for concurrent reads.
  Date/Author: 2026-03-21 / Claude

- Decision: Auth plugin numbered `03` to run after orchestrator (`01`) and chat-bot (`02`)
  Rationale: Auth initialization reads config from the orchestrator, which must be started first. Nitro plugins all complete before serving requests, so there is no unprotected window.
  Date/Author: 2026-03-21 / Claude

- Decision: Auth server instance placed in `server/utils/auth.ts` instead of `lib/auth.ts`
  Rationale: Nitro auto-imports from `server/utils/`. Placing it there makes `useAuth()` and `initAuth()` available to all server routes, middleware, and plugins without explicit imports.
  Date/Author: 2026-03-21 / Claude

- Decision: T011 (nuxt.config.ts changes) skipped — no changes needed
  Rationale: Auth config flows through WORKFLOW.md → orchestrator → `initAuth()`. Better Auth reads `BETTER_AUTH_URL` from process.env automatically. No Nuxt runtime config keys required.
  Date/Author: 2026-03-21 / Claude

## Surprises & Discoveries

- Observation: Auth plugin ordering needed to be `03` not `00` because auth config comes from orchestrator
  Evidence: Orchestrator plugin (`01.orchestrator.ts`) must start first to provide `ServiceConfig.auth`
- Observation: Nuxt 4 `~` alias resolves to `app/` directory, not project root
  Evidence: Build failed with ENOENT when `lib/auth-client.ts` was at project root instead of `app/lib/`
- Observation: Better Auth username plugin requires explicit `username` field in `createUser` body
  Evidence: Without it, admin seeded via `auth.api.createUser()` cannot sign in via `signIn.username()`

## Outcomes & Retrospective

### What Was Shipped
- Better Auth integration with GitHub OAuth and username/password sign-in
- Auth config via WORKFLOW.md `auth:` section with `$ENV_VAR` resolution
- Server middleware protecting `/api/v1/*` routes with fail-secure design
- Login page, user menu with sign-out, and client-side route middleware
- Admin user auto-seeding with password length validation

### What Went Well
- Config layer reused existing `resolveEnvValue()` pattern — clean integration
- Silent failure and security review caught critical fail-open middleware bug before merge
- Plugin ordering decision (03) documented early, avoided runtime issues

### What Could Improve
- Nuxt 4 `~` alias behavior should be documented in project knowledge to prevent future path issues
- Server-side integration tests (middleware 401, webhook bypass) are missing — only config-layer tests exist
- `trustedOrigins` / `BETTER_AUTH_URL` configuration should be added for production deployments

### Tech Debt Created
- No `trustedOrigins` or `baseURL` configured in Better Auth (CORS/CSRF risk in non-loopback deployments)
- 5 of 8 planned automated tests are missing (server-side Nitro behavior — requires integration test harness)
- `config.ts` exceeds 500 LOC limit (pre-existing, auth added ~15 lines)
