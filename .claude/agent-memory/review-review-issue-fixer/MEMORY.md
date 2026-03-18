# Review Issue Fixer Memory

## Project: brisbane (work-please monorepo)

### Package Manager
- Always use `bun` / `bunx` (not npm/pnpm)
- Type check commands: `bun run check --filter=@pleaseai/dashboard` and `bun run check:app`
- Lint command (non-blocking): `bun run lint --filter=@pleaseai/dashboard`

### Known Pre-existing Lint Issues
- `apps/dashboard/vite.config.ts:6` — `node/prefer-global/process` error (pre-existing, not introduced by fixes)

### Codebase Patterns
- Vue 3 + TypeScript (vue-tsc for type checking)
- ESLint uses `@antfu/eslint-config` — 2-space indent, single quotes, no semicolons
- Error handling pattern in composables: `console.error('[dashboard]', e)` then set `error.value = toMessage(e)`
- Overlap guard pattern: `let fetching = false` outside `load()`, guard at top of `load()`, reset in `finally`
- Security headers: defined as `SECURITY_HEADERS` const, spread into response headers
- Server file: `apps/work-please/src/server.ts` — handles API routes and static file serving

### JSON Editing Notes
- When removing a trailing block from package.json, check for trailing comma on previous property
- After editing package.json, always re-run `bun install` to update lockfile
