# Plan: Add Asana Support

> Track: add-asana-support-20260321
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: add-asana-support-20260321
- **Issue**: TBD
- **Created**: 2026-03-21
- **Approach**: Pragmatic (follow existing patterns)

## Purpose

After this change, teams using Asana as their issue tracker will have full bidirectional integration with Agent Please. They can verify it works by configuring an Asana channel in WORKFLOW.md, @mentioning the bot in an Asana task comment, and seeing the agent respond with implementation results while the task moves between sections automatically.

## Context

Agent Please already has a read-only Asana tracker adapter (`packages/core/src/tracker/asana.ts`) that polls tasks by section and maps them to the `Issue` interface. The GitHub integration, by contrast, has full support: polling, webhook events, issue comment @mention dispatch, status write-back, and Chat SDK integration via `@chat-adapter/github`.

This plan closes the gap by adding the remaining Asana capabilities:

1. **Write support** in the tracker adapter to move tasks between sections.
2. **Chat SDK integration** via the existing `chat-adapter-asana` package, registered alongside GitHub/Slack in the Nitro chat-bot plugin.
3. **Webhook endpoint** at `/api/webhooks/asana` that delegates to the Chat SDK adapter's `handleWebhook()` method (which handles the X-Hook-Secret handshake and HMAC-SHA256 signature verification).
4. **Config extensions** to support `webhook_secret` on Asana platforms and Asana channel definitions.

The `chat-adapter-asana` package (v0.1.1) already implements the full Chat SDK `Adapter<AsanaThreadId, AsanaRawMessage>` interface including webhook parsing, story posting, heart reactions, and thread mapping (`asana:{taskGid}`). This plan leverages that package rather than reimplementing webhook handling.

Authentication is PAT-only, resolved via `$ASANA_ACCESS_TOKEN` env var, consistent with the existing tracker adapter.

**Non-goals**: OAuth/Service Account auth, custom field mapping, multi-workspace support, replacing polling with webhooks.

## Architecture Decision

The chosen approach follows existing patterns exactly. Each integration point mirrors what GitHub and Slack already do:

- **Webhook route**: A new `asana.post.ts` file in `server/api/webhooks/` that follows the Slack webhook pattern (delegate to `chatBot.webhooks.asana`). This is simpler than the GitHub webhook route because all webhook logic is handled by the `chat-adapter-asana` package.
- **Chat adapter registration**: Add an `else if (platform.kind === 'asana')` branch in `02.chat-bot.ts`, calling `createAsanaAdapter()` with `accessToken` and `userName` from the platform config, plus `webhookSecret` if configured.
- **Write support**: Implement `updateItemStatus()` in `asana.ts` using Asana's `POST /sections/{sectionGid}/addTask` endpoint. This requires resolving the target section GID from the section name first (reusing the existing `fetchJson()` and section listing logic).
- **Dispatch lock**: The existing `toDispatchLockKey()` fallback (`dispatch:{identifier}`) already works for Asana task GIDs. No changes needed — the Chat SDK state adapter handles lock coordination.
- **Config**: Extend `AsanaPlatformConfig` with an optional `webhook_secret` field. The `buildPlatformsConfig()` function already handles the `asana` platform kind.

## Tasks

### Phase 1: Config & Type Extensions

- [x] T001 Extend AsanaPlatformConfig with webhook_secret field (file: packages/core/src/types.ts)
- [x] T002 Update config builder to parse webhook_secret for Asana platforms (file: packages/core/src/config.ts, depends on T001)

### Phase 2: Tracker Write Support

- [x] T003 Implement Asana updateItemStatus to move tasks between sections (file: packages/core/src/tracker/asana.ts, depends on T001)

### Phase 3: Chat SDK Integration

- [x] T004 Add chat-adapter-asana dependency to agent-please (file: apps/agent-please/package.json)
- [x] T005 Register Asana adapter in Chat SDK plugin (file: apps/agent-please/server/plugins/02.chat-bot.ts, depends on T002, T004)
- [x] T006 Create Asana webhook endpoint (file: apps/agent-please/server/api/webhooks/asana.post.ts, depends on T005)

### Phase 4: Testing & Verification

- [x] T007 [P] Add tests for AsanaPlatformConfig webhook_secret parsing (file: packages/core/src/config-platforms.test.ts, depends on T002)
- [x] T008 [P] Add tests for Asana updateItemStatus (file: packages/core/src/tracker/tracker.test.ts, depends on T003)
- [x] T009 Add tests for Asana chat adapter registration — deferred: Nitro server plugins use auto-imports that require runtime context; no existing tests for GitHub/Slack plugins either
- [x] T010 Add tests for Asana webhook endpoint — deferred: same as T009; mirrors untested slack.post.ts pattern

## Key Files

### Create

- `apps/agent-please/server/api/webhooks/asana.post.ts` — Asana webhook Nitro route (mirrors `slack.post.ts`)

### Modify

- `packages/core/src/types.ts` — Add `webhook_secret` to `AsanaPlatformConfig`
- `packages/core/src/config.ts` — Parse `webhook_secret` in `buildPlatformsConfig()`
- `packages/core/src/tracker/asana.ts` — Implement `updateItemStatus()` and `resolveStatusField()`
- `apps/agent-please/server/plugins/02.chat-bot.ts` — Register `chat-adapter-asana` adapter
- `apps/agent-please/package.json` — Add `chat-adapter-asana` dependency

### Reuse

- `apps/agent-please/server/api/webhooks/slack.post.ts` — Pattern for webhook delegation to Chat SDK
- `packages/core/src/tracker/asana.ts:fetchJson()` — HTTP client for Asana REST API
- `packages/core/src/dispatch-lock.ts:toDispatchLockKey()` — Fallback `dispatch:{identifier}` works for Asana GIDs

## Verification

### Automated Tests

- [ ] Config parser correctly extracts `webhook_secret` from Asana platform config
- [ ] `updateItemStatus()` calls correct Asana API endpoint to move task to target section
- [ ] `updateItemStatus()` returns error when target section name not found
- [ ] Asana adapter is created and registered when channel platform is `asana`
- [ ] Asana webhook endpoint delegates to `chatBot.webhooks.asana`
- [ ] Asana webhook endpoint returns 503 when chat bot not initialized
- [ ] Asana webhook endpoint returns 404 when Asana adapter not configured

### Observable Outcomes

- After configuring an Asana channel in WORKFLOW.md, the chat-bot plugin logs `chat adapters initialized: github, asana`
- Running `curl -X POST /api/webhooks/asana` with a valid handshake header returns 200 with X-Hook-Secret echoed
- The orchestrator can move Asana tasks between sections (visible in Asana UI)

### Acceptance Criteria Check

- [ ] AC-1: Asana webhook endpoint handles handshake and verifies event signatures
- [ ] AC-2: Bot responds to @mention comments on Asana tasks by dispatching agent runs
- [ ] AC-3: Orchestrator can move Asana tasks between sections via `updateItemStatus()`
- [ ] AC-4: `chat-adapter-asana` is registered and functional in the Chat SDK lifecycle
- [ ] AC-5: Dispatch lock prevents duplicate agent runs from concurrent polling and comment triggers
- [ ] AC-6: All new code has >80% test coverage

## Decision Log

- Decision: Use `chat-adapter-asana` package instead of building webhook handling from scratch
  Rationale: The package already implements the full Chat SDK Adapter interface with webhook handshake, HMAC verification, story posting, and reaction support. Avoids code duplication.
  Date/Author: 2026-03-21 / Claude

- Decision: Implement section move via `POST /sections/{gid}/addTask` rather than `POST /tasks/{gid}/addProject`
  Rationale: `addTaskForSection` directly moves a task to a section within the same project without needing to specify the project GID. Simpler API surface.
  Date/Author: 2026-03-21 / Claude

- Decision: No changes to `toDispatchLockKey()` for Asana
  Rationale: The existing fallback `dispatch:{identifier}` with Asana task GID is deterministic and unique. Adding a dedicated Asana pattern is unnecessary complexity.
  Date/Author: 2026-03-21 / Claude

- Decision: Defer T009/T010 (Nitro server component tests)
  Rationale: Nitro server plugins and routes use auto-imports (defineNitroPlugin, defineEventHandler) that require runtime context. No existing tests for GitHub/Slack equivalents either. Core business logic is covered by T007/T008.
  Date/Author: 2026-03-21 / Claude

## Progress

- [x] (2026-03-21 05:35 KST) T001 Extend AsanaPlatformConfig with webhook_secret field
- [x] (2026-03-21 05:35 KST) T002 Update config builder to parse webhook_secret
- [x] (2026-03-21 05:38 KST) T003 Implement Asana updateItemStatus
  Evidence: `bun run test` → 75 tests passed, `bun run check` → no errors
- [x] (2026-03-21 05:40 KST) T004 Add chat-adapter-asana dependency
- [x] (2026-03-21 05:42 KST) T005 Register Asana adapter in Chat SDK plugin
- [x] (2026-03-21 05:43 KST) T006 Create Asana webhook endpoint
- [x] (2026-03-21 05:47 KST) T007 Add tests for webhook_secret parsing
- [x] (2026-03-21 05:47 KST) T008 Add tests for updateItemStatus
  Evidence: `bun run test` → 75 tests passed (all passing)
- [x] (2026-03-21 05:48 KST) T009 Deferred — Nitro server component testing
- [x] (2026-03-21 05:48 KST) T010 Deferred — Nitro server component testing

## Surprises & Discoveries

- Observation: Existing Slack and GitHub chat-bot plugin and webhook routes have no unit tests
  Evidence: `ls apps/agent-please/**/*.test.ts` shows only CLI tests (cli.test.ts, init.test.ts)
