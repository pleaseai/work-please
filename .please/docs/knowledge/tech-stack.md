# Tech Stack — Work Please

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
| `@anthropic-ai/claude-agent-sdk` | Claude Code agent session management (`query()`) |
| LiquidJS | Prompt template rendering (Liquid-compatible syntax) |
| `@octokit/auth-app` | GitHub App installation token authentication |
| Chat SDK (`chat`) | Unified chat bot framework |
| `@chat-adapter/github` | GitHub issue comment bot adapter |
| `@chat-adapter/state-memory` | In-memory state for Chat SDK (MVP) |
| consola | Structured logging |

## Infrastructure

| Technology | Purpose |
|---|---|
| Nitro server routes | REST API (`/api/v1/state`, `/api/v1/refresh`, `/api/v1/:id`) |
| Nitro server plugins | Orchestrator and Chat SDK lifecycle management |
| Nitro webhooks | GitHub webhook handling (`/api/webhooks/github`) |
| YAML front matter | Configuration parsing from WORKFLOW.md |

## Project Structure

```
work-please/                      # Monorepo root
├── apps/work-please/             # Nuxt application (@pleaseai/work)
│   ├── app/                      # Client-side (pages, components, composables)
│   ├── server/                   # Server-side (Nitro routes, plugins)
│   └── src/                      # CLI entry point (Commander.js)
├── packages/core/                # @pleaseai/core (orchestrator business logic)
└── vendor/symphony/              # Upstream reference spec (read-only)
```

## Key Commands

```bash
bun install                       # Install dependencies
bun run dev                       # Development (Nuxt dev server)
bun run build                     # Build all packages (Nuxt + core)
bun run test                      # Run all tests
bun run test:app                  # Run work-please tests only
bun run check                     # Type-check all workspaces
bun run lint                      # Lint all workspaces
bun run lint:fix                  # Lint with auto-fix
```
