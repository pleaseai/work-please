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
| consola | Structured logging |

## Infrastructure

| Technology | Purpose |
|---|---|
| Nitro server routes | REST API (`/api/v1/state`, `/api/v1/refresh`, `/api/v1/:id`) |
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
├── packages/core/                # @pleaseai/agent-core (orchestrator business logic)
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
