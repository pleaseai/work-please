# Nuxt + Chat SDK Migration

> Track: nuxt-chat-sdk-migration-20260319

## Overview

Restructure Work Please from a two-workspace monorepo (`apps/work-please` CLI + `apps/dashboard` Vue/Vite SPA) into a single Nuxt application that unifies the orchestrator daemon, dashboard UI, and a Chat SDK-powered GitHub issue comment bot. The Nuxt app uses Nuxt UI's Dashboard layout for the admin interface, Nitro server routes for the webhook endpoint, and Chat SDK's `@chat-adapter/github` for responding to issue comments with status updates, agent progress, or AI-generated answers.

## Requirements

### Functional Requirements

- [ ] FR-1: Single Nuxt app replaces both `apps/work-please` (CLI daemon) and `apps/dashboard` (Vue/Vite SPA)
- [ ] FR-2: CLI entry point (`work-please run`, `work-please init`) starts the Nuxt server programmatically via a separate entry point
- [ ] FR-3: Chat SDK GitHub adapter handles incoming issue/PR comment webhooks at `server/api/webhooks/[platform].post.ts`
- [ ] FR-4: Bot responds to @mentions in issue/PR comments with status updates, agent progress, or AI-generated answers
- [ ] FR-5: GitHub authentication supports both PAT (`$GITHUB_TOKEN`) and GitHub App (`app_id` + `private_key` + `installation_id`), reusing existing auth logic
- [ ] FR-6: Chat SDK uses in-memory state adapter (`@chat-adapter/state-memory`) for MVP
- [ ] FR-7: Dashboard UI uses Nuxt UI's Dashboard layout (resizable sidebar + panels) to display orchestrator state
- [ ] FR-8: Existing orchestrator logic (poll/dispatch/retry loop) is preserved and runs within the Nuxt server context
- [ ] FR-9: Existing HTTP API endpoints (`/api/v1/state`, `/api/v1/refresh`, `/api/v1/<identifier>`) are migrated to Nitro server routes

### Non-functional Requirements

- [ ] NFR-1: All existing tests continue to pass after migration
- [ ] NFR-2: Bun runtime compatibility maintained (Nuxt + Nitro with Bun preset)
- [ ] NFR-3: Monorepo structure preserved (Turborepo, `packages/*` for shared libraries)

## Acceptance Criteria

- [ ] AC-1: `work-please run` starts the Nuxt server and orchestrator loop
- [ ] AC-2: Dashboard is accessible at `/` with Nuxt UI Dashboard layout
- [ ] AC-3: GitHub webhook at `POST /api/webhooks/github` processes issue comment events via Chat SDK
- [ ] AC-4: Bot responds to @mentions with agent status for the relevant issue
- [ ] AC-5: Existing API endpoints respond correctly under new Nitro routes
- [ ] AC-6: `bun run build` produces a deployable bundle

## Out of Scope

- Production state adapters (Redis/PostgreSQL) — MVP uses in-memory state
- Streaming responses via Chat SDK (GitHub adapter doesn't support streaming)
- Other chat platform adapters (Slack, Discord, Teams) — GitHub only for this track
- Redesigning the orchestrator's core poll/dispatch/retry logic
- Migration of the `vendor/symphony/` submodule

## Assumptions

- Nuxt 3.x with Nitro can run on the Bun runtime
- The existing `@octokit/auth-app` auth logic can be shared between the orchestrator and Chat SDK's GitHub adapter
- Chat SDK's GitHub adapter can coexist with the existing webhook handler in `webhook.ts`
