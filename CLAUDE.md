# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills

Before starting any implementation task, evaluate available skills and activate relevant ones using the `Skill()` tool.
Key skills for this project:

| Task                             | Skill                             |
|----------------------------------|-----------------------------------|
| Commit messages                  | `standards:commit-convention`     |
| Code quality / engineering rules | `standards:engineering-standards` |
| TDD / Tidy First workflow        | `tidy-first:tdd-workflow`         |
| Augmented Coding / AI discipline | `tidy-first:augmented-coding`     |
| Bun package manager usage        | `bun:bun-package-manager`         |
| Bun test runner                  | `bun:bun-testing`                 |
| GitHub issues / PRs              | `github:github-workflow`          |
| Creating a commit                | `github:commit`                   |
| Commit + push + PR               | `github:commit-push-pr`           |

## Package Manager

Always use **bun** instead of npm or pnpm, and **bunx** instead of npx or pnpm dlx.

```bash
bun install        # not: npm install / pnpm install
bun add <pkg>      # not: npm install <pkg> / pnpm add <pkg>
bun remove <pkg>   # not: npm uninstall / pnpm remove
bunx <cmd>         # not: npx <cmd> / pnpm dlx <cmd>
```

## Commands

```bash
# Install dependencies
bun install

# Development (watch mode)
bun run dev                    # from apps/work-please, or:
turbo run dev                  # from root

# Build
bun run build                  # root: builds all packages via turbo
# apps/work-please builds with: bun build ./src/index.ts --outdir ./dist --target bun

# Lint
bun run lint                   # check
bun run lint:fix               # auto-fix

# Type check
bun run check                  # tsc --noEmit (runs after build due to turbo deps)

# Test
bun test                       # from apps/work-please (single package)
bun run test                   # from root (all packages via turbo)
```

## Architecture

Work Please is a TypeScript monorepo (Bun + Turbo) implementing the [Symphony spec](vendor/symphony/SPEC.md) for Claude
Code + Asana/GitHub Projects v2. The reference implementation in Elixir/OTP lives in `vendor/symphony/elixir/`.

**Workspaces:**

- `apps/work-please` — main service entry point (`@pleaseai/work`)
- `packages/*` — shared libraries (none yet scaffolded)
- `vendor/symphony/` — upstream Symphony reference (read-only, excluded from ESLint/TS)

**Intended component boundaries** (per SPEC.md — not yet implemented):

| Component            | Responsibility                                                 |
|----------------------|----------------------------------------------------------------|
| Workflow Loader      | Parse `WORKFLOW.md` YAML front matter + Liquid prompt template |
| Config Layer         | Typed getters with env-var indirection (`$ENV_VAR` syntax)     |
| Issue Tracker Client | Asana REST or GitHub Projects v2 GraphQL; poll + reconcile     |
| Orchestrator         | In-memory state; poll/dispatch/retry loop                      |
| Workspace Manager    | Create/reuse per-issue directories; run lifecycle hooks        |
| Agent Runner         | Launch `claude` CLI; stream JSON events back                   |
| Status Surface       | Optional HTTP dashboard + structured `key=value` logs          |

**WORKFLOW.md** is a user-created file in a _target repository_ (not this repo). It contains YAML front matter (tracker
config, hooks, agent limits) and a Liquid prompt template body. Work Please reads it at runtime.

## Code Style

ESLint uses `@antfu/eslint-config` (`eslint.config.ts`):

- 2-space indent, single quotes, no semicolons
- TypeScript strict mode
- `vendor/**` and `dist/**` are excluded from linting and type-checking

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/) (`@commitlint/config-conventional`):

```
<type>(<scope>): <subject>
```

**Types:** `feat` | `fix` | `docs` | `style` | `refactor` | `perf` | `test` | `build` | `ci` | `chore` | `revert`

Rules: lowercase type, imperative mood (`add` not `added`), no trailing period, header ≤ 100 chars.

```bash
feat(tracker): add Asana polling adapter
fix(workspace): prevent path traversal on workspace creation
refactor(orchestrator): extract retry logic into separate module
```

## Engineering Standards

- **File limit**: ≤ 500 LOC per source file; split by responsibility when exceeded
- **Function limit**: ≤ 50 LOC, ≤ 5 parameters (use parameter objects beyond that)
- **Complexity**: cyclomatic ≤ 10, cognitive ≤ 15
- **Surgical changes**: modify only what is requested — do not refactor surrounding code, restyle, or reformat untouched
  lines
- **No test manipulation**: never modify or delete tests to make code pass; fix the code instead

### AI Collaboration Warning Signs

Stop and revert when:

- AI repeats the same failing approach 3+ times → try a different strategy
- AI adds unrequested features → revert to requested scope only
- AI modifies tests to make code pass → never allowed
- AI makes silent architecture decisions → surface options and decide explicitly

## Development Workflow (Tidy First + TDD)

Separate **structural changes** (rename, extract, move — no behavior change) from **behavioral changes** (new features,
bug fixes). Commit them independently.

```
Red → Green → Refactor → Commit → repeat
```

1. Write a failing test (Red)
2. Implement the minimum to pass (Green)
3. Make structural improvements — tests must stay green (Refactor)
4. Commit structural changes with `refactor:` prefix
5. Commit behavioral changes with `feat:` or `fix:` prefix

Only commit when **all tests pass** and **all lint/type errors are resolved**.

## Key Implementation Notes

- The service is a **scheduler/runner only** — it does not write to the issue tracker itself. Ticket state transitions
  and PR links are performed by the Claude Code agent.
- `WORKFLOW.md` supports `$ENV_VAR` references in the `api_key` field — the config layer must resolve these at startup.
- Prompt templates use Liquid-compatible syntax (`{{ issue.title }}`, `{% if %}` blocks).
- Agent runs use `claude --output-format stream-json` CLI output, not JSON-RPC.
- Workspace paths must be validated against `workspace.root` before launch (path traversal prevention).
