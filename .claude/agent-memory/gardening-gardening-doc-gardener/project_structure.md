---
name: project-structure
description: Monorepo layout, package names, and structural conventions for doc gardening
type: project
---

Monorepo root: agent-please (Bun + Turborepo)

**Workspaces:**
- `apps/agent-please` — Main Nuxt app (@pleaseai/agent), v0.1.x
- `apps/docs` — Docus documentation site (@pleaseai/docs) — no README
- `apps/relay-worker` — Cloudflare Worker (@pleaseai/relay-worker) — has README
- `packages/core` — Orchestrator logic (@pleaseai/agent-core), v0.1.x — README created 2026-03-26
- `packages/relay-client` — WebSocket relay client (@pleaseai/relay-client) — README created 2026-03-26
- `packages/relay-server` — PartyServer relay server (@pleaseai/relay-server) — README created 2026-03-26

**Documentation conventions:**
- Root READMEs exist in 4 languages: en, ko, ja, zh-CN — keep synchronized
- `.please/` is the project planning workspace (tracks, decisions, research, knowledge)
- `.please/docs/tracks/index.md` must list all active tracks — orphaned tracks indicate gaps
- `ARCHITECTURE.md` is the primary technical reference — track it carefully for drift
- `SPEC.md` is the language-agnostic specification — rarely changes
- Tech stack is documented in `.please/docs/knowledge/tech-stack.md` — kept up to date

**API architecture (as of 2026-03-26):**
- REST `/api/v1/*` routes were removed; replaced by oRPC at `/rpc/*` via `server/orpc/router.ts`
- Webhooks remain as Nitro file routes: `/api/webhooks/{github,slack,asana}`
- Auth routes via Better Auth: `/api/auth/[...all].ts`
- New Nitro plugin: `03.auth.ts` (Better Auth initialization)

**DB layer (as of 2026-03-26):**
- Kysely replaces @libsql/client directly
- Embedded: `bun:sqlite` + `kysely-bun-sqlite`
- Cloud: Turso via `@libsql/kysely-libsql`
