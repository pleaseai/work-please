---
name: nitro-server-architecture
description: Nitro/Nuxt server architecture: plugins, middleware, utils, API routes, auth integration
type: project
---

Nuxt 4 app with Nitro preset `bun`. Server layer is entirely in `apps/agent-please/server/`.

**Plugin initialization order (numbered prefixes enforce order):**
1. `server/plugins/01.orchestrator.ts` — creates `Orchestrator`, stores on `nitroApp.orchestrator`, calls `orchestrator.start()`, registers `close` hook for graceful shutdown. Reads `workflowPath` from `runtimeConfig`.
2. `server/plugins/02.chat-bot.ts` — reads `nitroApp.orchestrator`, builds chat adapters (GitHub/Slack/Asana), creates `Chat` SDK instance, stores on `nitroApp.chatBot` and `nitroApp.chatStateAdapter`. Registers `close` hook.
3. `server/plugins/03.auth.ts` — reads `nitroApp.orchestrator` config, conditionally calls `initAuth()` + runs DB migrations + seeds admin user. Skips entirely if `config.auth.secret` is absent (auth disabled by design).

**Middleware:**
- `server/middleware/auth.ts` — runs on every request, skips `/api/auth/*`, `/api/webhooks/*`, `/api/_health`. Only enforces auth on `/api/v1/*`. Calls `isAuthEnabled()` guard so unauthenticated deployments are unaffected.

**Server utils:**
- `server/utils/orchestrator.ts` — `useOrchestrator(event)` retrieves `nitroApp.orchestrator` via `useNitroApp()`, throws HTTP 503 if not initialized.
- `server/utils/auth.ts` — module-level singletons `_auth` and `_authEnabled`. Exports `initAuth()`, `useAuth()`, `isAuthEnabled()`, `resetAuth()`. Uses `better-auth` with `bun:sqlite`, supports GitHub OAuth + email/password + `admin` + `username` plugins.

**API route structure:**
- `server/api/auth/[...all].ts` — catch-all for better-auth; calls `auth.handler(toWebRequest(event))`
- `server/api/v1/state.get.ts` — returns orchestrator state snapshot
- `server/api/v1/[identifier].get.ts` — per-issue state
- `server/api/v1/refresh.post.ts` — trigger poll refresh
- `server/api/v1/sessions/[sessionId]/messages.get.ts` — agent session messages
- `server/api/webhooks/{github,slack,asana}.post.ts` — webhook endpoints (auth-exempt)

**Frontend auth:**
- `app/lib/auth-client.ts` — `createAuthClient` from `better-auth/vue` with `adminClient` + `usernameClient` plugins
- `app/layouts/dashboard.vue` — calls `authClient.useSession(useFetch)` to show user info + sign-out button
- `app/pages/login.vue` — supports GitHub OAuth (`authClient.signIn.social`) and username/password (`authClient.signIn.username`)

**runtimeConfig** (nuxt.config.ts): only `workflowPath` — auth config comes from WORKFLOW.md via orchestrator, not from Nuxt runtimeConfig.

**Why:** Auth is optional/progressive — the entire auth stack is disabled unless `config.auth.secret` is set in WORKFLOW.md. This keeps single-user/private deployments simple.
