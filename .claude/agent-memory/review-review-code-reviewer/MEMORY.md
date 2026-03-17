# Review Agent Memory — brisbane (work-please)

## Project conventions (from CLAUDE.md)
- Package manager: bun / bunx (never npm/pnpm)
- Code style: 2-space indent, single quotes, no semicolons (@antfu/eslint-config)
- TypeScript strict mode
- File limit: ≤500 LOC; function limit: ≤50 LOC, ≤5 params
- Commit convention: Conventional Commits, lowercase type, imperative mood
- Surgical changes only — do not reformat untouched lines

## Dashboard app (apps/dashboard) — PR amondnet/web-dashboard-shadcn
- Vue 3 SPA with shadcn-vue, TailwindCSS v4, Vite, vue-router
- API helpers in src/lib/api.ts — uses fetch('/api/v1/...')
- Composables: useOrchestratorState, useIssueDetail — polling via useIntervalFn
- server.ts serves static dashboard dist with path traversal guard using normalize+startsWith

## Known issues found in PR review (resolved)
- FIXED: package.json root lucide-vue-next dep removed
- FIXED: useIssueDetail/useOrchestratorState cleanup via onScopeDispose(pause)
- FIXED: refreshError cleared on successful refresh
- serveStatic: path traversal guard uses `sep` (OS path separator) — low impact for Bun-only server

See patterns.md for detailed notes.
