# Tech Stack — Agent Please

## Runtime & Language

| Technology | Version | Purpose |
|---|---|---|
| Bun | 1.3.10 | Runtime, package manager, bundler, test runner |
| TypeScript | ^5.7.0 | Primary language (strict mode, ESNext target) |

## Build & Tooling

| Technology | Purpose |
|---|---|
| Turborepo | Monorepo task orchestration (`build`, `test`, `lint`, `check`) |
| Nuxt 4 | Full-stack Vue framework (SSR, file-based routing, auto-imports) |
| Nitro | Server engine (Bun preset, server routes, plugins) |
| `bun build` | CLI entry point bundling |
| Bun workspaces | Monorepo package management (`apps/*`, `packages/*`) |

## Code Quality

| Technology | Purpose |
|---|---|
| ESLint + `@antfu/eslint-config` | Linting (2-space indent, single quotes, no semicolons) |
| Husky | Git hooks (pre-commit) |
| Conventional Commits | Commit message convention documented in `CLAUDE.md` |

## Testing

| Technology | Purpose |
|---|---|
| Bun test | Jest-compatible test runner with built-in mocking (`mock()`, `spyOn`) |

## UI

| Technology | Purpose |
|---|---|
| Nuxt UI v4 | Vue component library (125+ components, Reka UI + Tailwind CSS) |
| Tailwind CSS v4 | Utility-first CSS framework |
| Dashboard layout | `UDashboardGroup` + `UDashboardSidebar` + `UDashboardPanel` |
| Docus v4 | Documentation site theme (Nuxt layer, Nuxt Content, auto-nav) |

## Core Dependencies

| Technology | Purpose |
|---|---|
| Better Auth | Dashboard authentication (GitHub OAuth, username/password, admin roles, `bun:sqlite`) |
| `@anthropic-ai/claude-agent-sdk` | Claude Code agent session management (`query()`) |
| `@libsql/client` | Agent run history storage (embedded libsql / Turso cloud) |
| LiquidJS | Prompt template rendering (Liquid-compatible syntax) |
| `@octokit/auth-app` | GitHub App installation token authentication |
| Chat SDK (`chat`) | Unified chat bot framework |
| `@chat-adapter/github` | GitHub issue comment bot adapter |
| `chat-adapter-asana` | Asana task comment bot adapter |
| `@chat-adapter/state-memory` | Default in-memory state for Chat SDK (dev/testing) |
| `@chat-adapter/state-redis` | Optional Redis state adapter for production |
| `@chat-adapter/state-ioredis` | Optional ioredis state adapter (Cluster/Sentinel) |
| `@chat-adapter/state-pg` | Optional PostgreSQL state adapter |
| `@orpc/server` | End-to-end type-safe RPC server (procedures, middleware, event iterators) |
| `@orpc/client` | Type-safe RPC client with RPCLink |
| `@orpc/tanstack-query` | oRPC integration with TanStack Query (queryOptions, liveOptions, streamedOptions) |
| `@orpc/zod` | Zod schema converter for oRPC OpenAPI generation |
| `@tanstack/vue-query` | Async state management with caching, refetching, and SSE support |
| consola | Structured logging |
| `partysocket` | Auto-reconnecting WebSocket client for cloud relay transport |
| `partyserver` | Cloudflare Workers + Durable Objects server framework for relay worker |

## Infrastructure

| Technology | Purpose |
|---|---|
| oRPC + Nitro | Type-safe API via RPCHandler at `/rpc/*` (replaces REST `/api/v1/*`) |
| Nitro server plugins | Orchestrator and Chat SDK lifecycle management |
| Nitro webhooks | GitHub and Asana webhook handling (`/api/webhooks/github`, `/api/webhooks/asana`) |
| YAML front matter | Configuration parsing from WORKFLOW.md |

## Project Structure

```
agent-please/                      # Monorepo root
├── apps/agent-please/             # Nuxt application (@pleaseai/agent)
│   ├── app/                      # Client-side (pages, components, composables)
│   ├── server/                   # Server-side (Nitro routes, plugins)
│   └── src/                      # CLI entry point (Commander.js)
├── apps/docs/                    # Documentation site (@pleaseai/docs)
│   ├── content/                  # Markdown documentation pages
│   └── nuxt.config.ts            # Docus layer configuration
├── packages/core/                # @pleaseai/agent-core (orchestrator business logic)
├── apps/relay-worker/             # @pleaseai/relay-worker (Cloudflare Worker cloud relay)
└── vendor/symphony/              # Upstream reference spec (read-only)
```

## Key Commands

```bash
bun install                       # Install dependencies
bun run dev                       # Development (Nuxt dev server)
bun run build                     # Build all packages (Nuxt + core)
bun run test                      # Run all tests
bun run test:app                  # Run agent-please tests only
bun run check                     # Type-check all workspaces
bun run lint                      # Lint all workspaces
bun run lint:fix                  # Lint with auto-fix
```
