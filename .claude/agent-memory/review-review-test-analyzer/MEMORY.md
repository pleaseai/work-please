# Test Analyzer Agent Memory

## Project: agent-please (apps/agent-please)
Bun + Turbo TypeScript monorepo. Main test runner: `bun run test:app`.
Test files live in `apps/agent-please/src/*.test.ts`.
326 tests across 13 files — all passing as of PR #61.

## Key Testing Patterns
- SDK mock tests use injectable `queryFn` constructor param in `AppServerClient`
- Fake async generators yield `makeInitMsg` + `makeSuccessMsg` helper objects
- `capturedOptions` array pattern for asserting SDK option values across turns
- `beforeEach`/`afterEach` with `mkdtempSync`/`rmSync` for tmp workspace isolation

## Session State Machine (as of PR #64 refactor)
`AppServerClient` has two private fields:
- `assignedSessionId`: set at `startSession()`, cleared at `stopSession()`
- `sessionId`: set to `null` for new sessions (UUID assigned), set to provided ID for resume sessions

Decision tree in `runTurn`:
1. If `this.sessionId` (confirmed by SDK or provided resume) → `options.resume`
2. Else if `this.assignedSessionId` (new session, pre-first-turn) → `options.sessionId`
3. After first turn SDK init message arrives → `this.sessionId` updated from SDK

## PR #64 v2 Review (refactor/agent-runner-hybrid-v2-session) — all prior gaps fixed except:
- REMAINING (rating 6): `turn_failed` vs `startup_failed` in catch block post-init: exception thrown
  AFTER init msg is received should emit `turn_failed` (new code path). Existing timeout test only
  tests the pre-init throw path (startup_failed). The post-init exception → turn_failed is untested.
- REMAINING (rating 4): SDK returns DIFFERENT session_id than provided existingId in cross-restart
  resume. Current test uses matching IDs — SDK overwriting this.sessionId silently is not tested.

## Known Coverage Gaps to Watch
- No test for calling `runTurn` after `stopSession()` clears state (null assignedSessionId + null sessionId)

## DB Layer (packages/core/src/db.ts) — as of PR #193 Kysely migration
- `createKyselyDb` returns `Kysely<AppDatabase> | null`; test file is `packages/core/src/db.test.ts`
- `runMigrations` uses Kysely `Migrator`; failure path (error in result OR throw) returns `false` — untested (rating 7)
- `queryRuns` normalizes unknown status values to `'failure'` — that else-branch is untested (rating 7)
- `auth.test.ts` `makeInMemoryDb()` instances are never destroyed in afterEach — resource leak pattern to flag in future PRs

## DB Test Patterns (PR #193)
- Typed Kysely assertions preferred over raw SQL: `db.selectFrom('agent_runs').selectAll().execute()`
- `mkdtempSync`/`rmSync` pattern used for tmp file isolation (same as SDK tests)
- `sql\`...\`.execute(db)` used for schema introspection in migration tests (sqlite_master)
