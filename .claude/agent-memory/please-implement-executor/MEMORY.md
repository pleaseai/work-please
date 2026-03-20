# Implement Executor Memory — agent-please (denver)

## Project Info
- Monorepo: Bun + Turbo
- Package manager: bun / bunx (NOT npm/pnpm)
- Test runner: `bun test` (bun:test, not vitest)
- Type check: `bunx tsc --noEmit -p packages/core/tsconfig.json`
- Working dir: /Users/lms/conductor/workspaces/work-please/denver

## Key File Paths
- Core types: `packages/core/src/types.ts`
- Core config parser: `packages/core/src/config.ts`
- Test convention: `*.test.ts` in same directory as source

## Config Shape (platform-centric, as of T001-T008)
ServiceConfig now has:
- `platforms: Record<string, PlatformConfig>` — credentials registry
- `projects: ProjectConfig[]` — polling targets (each references a platform)
- `channels: ChannelConfig[]` — chat surfaces (each references a platform)
- NO `tracker` or `chat` fields (removed in T002/T006)

## Test Patterns
- Use `bun:test` imports: `import { describe, expect, it } from 'bun:test'`
- Cast partial test objects: `{} as unknown as Record<string, PlatformConfig>`
- Run single file: `bun test packages/core/src/config-platforms.test.ts`
- Run all core: `bun test packages/core/src/`

## Expected Broken Tests (Phase 2 state)
config.test.ts, tracker.test.ts, orchestrator.test.ts, label.test.ts,
agent-runner.test.ts, issue-comment-handler.test.ts all use `config.tracker`/`config.chat`
— they will be fixed in T023-T026.

## Commit Convention
`refactor(core): ...` for config shape changes, `feat(core): ...` for new features
Always run `bun test` on new test file before commit.
