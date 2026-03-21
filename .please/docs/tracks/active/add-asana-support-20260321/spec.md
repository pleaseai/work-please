# Add Asana Support

> Track: add-asana-support-20260321

## Overview

Expand Asana integration from read-only polling to full-featured support including webhook-based push events, task comment @mention dispatch, task status write-back, and Chat SDK integration via `chat-adapter-asana`.

The existing Asana tracker adapter (`packages/core/src/tracker/asana.ts`) already supports polling tasks by section and mapping them to the `Issue` interface. This track adds the remaining capabilities to achieve parity with the GitHub integration.

## Requirements

### Functional Requirements

- [ ] FR-1: **Asana Webhook Integration** — Register and handle Asana webhooks for task events (task added/changed/removed, story created). Implement the webhook handshake (X-Hook-Secret challenge-response) and event verification (X-Hook-Signature HMAC-SHA256). Expose a webhook endpoint at `/api/webhooks/asana`.
- [ ] FR-2: **Asana Task Comment Dispatch** — When a user @mentions the bot username in an Asana task comment (story), dispatch a Claude Code agent run against that task. Follow the same pattern as the GitHub issue comment handler: acknowledge with a heart reaction, run the agent, post the response as a new task comment, and update the reaction on completion/failure.
- [ ] FR-3: **Asana Write Support** — Implement `updateItemStatus()` in the Asana tracker adapter to move tasks between sections (POST `/sections/{section_gid}/addTask` with `task` parameter). Replace the current `tracker_write_not_supported` stub.
- [ ] FR-4: **Chat SDK Asana Adapter** — Integrate `chat-adapter-asana` package as a Chat SDK adapter alongside the existing GitHub adapter. Register it in the Nitro server plugin for chat lifecycle management. The adapter handles webhook parsing, message posting (stories), reactions (heart), and thread mapping (`asana:{taskGid}`). Support dispatch lock via Chat SDK `StateAdapter`.
- [ ] FR-5: **Webhook Configuration** — Extend `AsanaPlatformConfig` to include optional `webhook_secret` field. Add WORKFLOW.md channel config for Asana (similar to GitHub/Slack channel definitions).

### Non-functional Requirements

- [ ] NFR-1: **Authentication** — Use Personal Access Token (PAT) only, consistent with the existing tracker adapter. Resolve via `$ASANA_ACCESS_TOKEN` env var.
- [ ] NFR-2: **Webhook Security** — Validate all incoming webhook requests using HMAC-SHA256 signature verification (handled by `chat-adapter-asana`).
- [ ] NFR-3: **Error Resilience** — Webhook handler must respond within Asana's timeout window. Long-running agent dispatch should be async (fire-and-forget from webhook response).

## Acceptance Criteria

- [ ] AC-1: Asana webhook endpoint handles handshake and verifies event signatures
- [ ] AC-2: Bot responds to @mention comments on Asana tasks by dispatching agent runs
- [ ] AC-3: Orchestrator can move Asana tasks between sections via `updateItemStatus()`
- [ ] AC-4: `chat-adapter-asana` is registered and functional in the Chat SDK lifecycle
- [ ] AC-5: Dispatch lock prevents duplicate agent runs from concurrent polling and comment triggers
- [ ] AC-6: All new code has >80% test coverage

## Out of Scope

- OAuth 2.0 / Service Account authentication (PAT only for this track)
- Asana custom fields mapping beyond section-based status
- Multi-workspace support
- Asana project/portfolio management
- Replacing polling with webhooks entirely (webhooks supplement polling)

## Assumptions

- `chat-adapter-asana` npm package (v0.1.1) at `pleaseai/chat-adapter-asana` implements the Chat SDK `Adapter<AsanaThreadId, AsanaRawMessage>` interface
- Asana webhook delivery is reliable with at-least-once semantics
- Section names in Asana projects map 1:1 to workflow states

## References

- [chat-adapter-asana](https://github.com/pleaseai/chat-adapter-asana)
- [node-asana SDK](https://github.com/Asana/node-asana)
- [Asana Webhooks Guide](https://developers.asana.com/docs/webhooks-guide)
- [Asana PAT Auth](https://developers.asana.com/docs/personal-access-token)
- [Webhook Example](https://github.com/Asana/devrel-examples/blob/master/javascript/webhooks-nodejs/createWebhook.js)
