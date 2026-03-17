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
| `bun build` | Application bundling (`apps/work`) |
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

## Core Dependencies

| Technology | Purpose |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | Claude Code agent session management (`query()`) |
| LiquidJS | Prompt template rendering (Liquid-compatible syntax) |
| `@octokit/auth-app` | GitHub App installation token authentication |
| consola | Structured logging |

## Infrastructure

| Technology | Purpose |
|---|---|
| Bun.serve | Built-in HTTP server for optional dashboard and JSON API |
| YAML front matter | Configuration parsing from WORKFLOW.md |

## Project Structure

```
work/                      # Monorepo root
├── apps/work/             # Main application (@pleaseai/work)
├── packages/                     # Shared libraries (none yet)
└── vendor/symphony/              # Upstream reference spec (read-only)
```

## Key Commands

```bash
bun install                       # Install dependencies
bun run dev                       # Development (watch mode, all workspaces)
bun run build                     # Build all packages
bun run test                      # Run all tests
bun run test:app                  # Run work tests only
bun run check                     # Type-check all workspaces
bun run lint                      # Lint all workspaces
bun run lint:fix                  # Lint with auto-fix
```
