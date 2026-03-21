# Dashboard Authentication

> Track: add-auth-20260321

## Overview

Add authentication to the Agent Please Nuxt dashboard using Better Auth. Admin operators sign in via GitHub OAuth or username/password to access the orchestrator dashboard. Unauthenticated requests are redirected to a login page. The Better Auth SQLite adapter stores auth data in the existing libsql/Turso database.

## Requirements

### Functional Requirements

- [ ] FR-1: Integrate Better Auth server-side in Nuxt as a custom Nitro plugin and middleware, allowing configuration to flow from the orchestrator.
- [ ] FR-2: Configure GitHub OAuth provider for sign-in (using existing GitHub App or separate OAuth App credentials)
- [ ] FR-3: Enable the username plugin for local username/password accounts
- [ ] FR-4: Enable the admin plugin for role-based access (admin role)
- [ ] FR-5: Use the Better Auth SQLite adapter backed by the existing libsql/Turso database
- [ ] FR-6: Add a login page with GitHub OAuth and username/password sign-in options
- [ ] FR-7: Protect all dashboard pages and API routes (`/api/v1/*`) behind authentication middleware
- [ ] FR-8: Add a user menu (avatar/name) in the dashboard sidebar with sign-out action
- [ ] FR-9: Seed an initial admin account via environment variables (`AUTH_ADMIN_USERNAME`, `AUTH_ADMIN_PASSWORD`) on first startup

### Non-functional Requirements

- [ ] NFR-1: Auth tables are co-located in the existing libsql database (no separate DB file)
- [ ] NFR-2: Session tokens use secure HTTP-only cookies
- [ ] NFR-3: GitHub webhook endpoints (`/api/webhooks/*`) remain unauthenticated (verified by webhook signature instead)

## Acceptance Criteria

- [ ] AC-1: Unauthenticated users visiting the dashboard are redirected to `/login`
- [ ] AC-2: Users can sign in via GitHub OAuth and see the dashboard
- [ ] AC-3: Users can sign in via username/password and see the dashboard
- [ ] AC-4: Unauthenticated `/api/v1/*` requests return 401
- [ ] AC-5: Webhook endpoints (`/api/webhooks/github`, `/api/webhooks/slack`) remain accessible without auth
- [ ] AC-6: Admin user is auto-created on first startup when env vars are set
- [ ] AC-7: Sign-out clears the session and redirects to login

## Out of Scope

- Multi-role authorization (viewer vs admin) — all authenticated users are admins for now
- User management UI — admin accounts managed via env vars or Better Auth admin API
- API key/token authentication for programmatic access
- Rate limiting on auth endpoints

## Assumptions

- GitHub OAuth credentials (client ID/secret) will be provided as environment variables
- The existing libsql database schema can be extended with Better Auth tables
- Better Auth server-side library is compatible with Nuxt 4 Nitro plugins and the Bun runtime
