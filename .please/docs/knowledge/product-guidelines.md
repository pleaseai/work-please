# Product Guidelines — Work Please

## Code Style

- **ESLint**: `@antfu/eslint-config` — 2-space indent, single quotes, no semicolons.
- **TypeScript**: Strict mode enabled. ESNext target with bundler module resolution.
- **File limit**: 500 LOC max per source file. Split by responsibility when exceeded.
- **Function limit**: 50 LOC max, 5 parameters max (use parameter objects beyond that).

## Error Handling

- Use **discriminated union types** for expected errors — never throw for recoverable failures.
- Each error type has a `code` field for programmatic matching and a corresponding type guard function.
- Pattern: `TrackerError`, `ValidationError`, `WorkflowError`, `PromptBuildError`, `InitError`.

## Naming Conventions

- Files: `kebab-case.ts` (e.g., `agent-runner.ts`, `prompt-builder.ts`).
- Types/Interfaces: `PascalCase` (e.g., `ServiceConfig`, `OrchestratorState`).
- Functions/variables: `camelCase` (e.g., `createWorkspace`, `runTurn`).
- Constants: `camelCase` for module-level, `UPPER_SNAKE_CASE` for true global constants.

## Testing

- **Runner**: Bun test (Jest-compatible API).
- **Co-location**: Test files (`*.test.ts`) live alongside source files.
- **Mocking**: Use injectable dependencies (e.g., `queryFn` in `AppServerClient`) and `spyOn` for system calls.
- **Coverage**: Target >80% code coverage.

## Commit Convention

- Follow Conventional Commits (`@commitlint/config-conventional`).
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- Lowercase type, imperative mood, no trailing period, header ≤100 chars.
- Separate structural changes (refactor) from behavioral changes (feat/fix).

## Documentation

- English as the primary language for code, comments, and documentation.
- README available in multiple languages (EN, KO, JA, ZH-CN).
- ARCHITECTURE.md provides the bird's-eye view for contributors.
- WORKFLOW.md is a user-created runtime workflow file in target repositories; use `.please/config.yml` for this workspace's configuration.

## Design Principles

- **Minimal surface area** — The orchestrator does the minimum: poll, dispatch, retry. The agent handles the rest.
- **Single source of truth** — WORKFLOW.md defines all runtime behavior. No hidden config.
- **Error types over exceptions** — Predictable error handling via discriminated unions.
- **Config immutability** — Config is replaced atomically on reload, never mutated in place.
- **Workspace isolation** — Every issue gets a dedicated, validated workspace directory.
