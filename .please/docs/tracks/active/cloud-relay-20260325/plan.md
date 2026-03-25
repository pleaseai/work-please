# Plan: Cloud Relay Transport

> Track: cloud-relay-20260325
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/cloud-relay-20260325/spec.md
- **Issue**: TBD
- **Created**: 2026-03-25
- **Approach**: Pragmatic

## Purpose

After this change, operators will be able to run Agent Please behind NAT or firewalls without exposing a public HTTP endpoint. They can verify it works by setting `polling.mode: relay` in WORKFLOW.md and observing that GitHub webhook events sent to the Cloudflare relay trigger orchestrator refreshes on their local instance.

## Context

Agent Please currently supports two polling modes: `poll` (timer-based periodic fetching) and `webhook` (HTTP endpoint receives events from issue trackers). The webhook mode requires the Agent Please instance to be publicly reachable, which creates friction for local development, NAT-behind deployments, and environments where firewall rules are restrictive.

The cloud relay approach introduces a Cloudflare Worker (using PartyServer on Durable Objects) as a persistent edge relay. Issue trackers send webhooks to the relay's public URL. The relay broadcasts events to connected Agent Please instances over WebSocket. This inverts the connection direction — the agent instance connects outbound to the relay, eliminating the need for inbound accessibility.

Key constraints: backward compatibility with existing webhook/poll modes is mandatory. The relay worker is deployed and managed independently from Agent Please. The transport is one-way (tracker → relay → agent) with no bidirectional RPC. The `triggerRefresh()` interface used by the existing webhook transport is reused — the relay is just another event source calling the same function.

PartyServer (`partyserver` npm package) is a library extracted from PartyKit that provides a `Server` class extending Cloudflare Durable Objects with WebSocket lifecycle hooks (`onConnect`, `onMessage`, `onRequest`, `onClose`), connection management (`broadcast`, `getConnections`), and hibernation support for zero-cost idle rooms. The client library `partysocket` is a reconnecting WebSocket wrapper compatible with Node.js, Bun, browsers, and Deno — it provides auto-reconnect with exponential backoff out of the box.

URL routing convention: `routePartykitRequest` matches `/${prefix}/:serverName/:roomName`. HTTP requests to the same URL route to `onRequest()`. Each room is a named Durable Object instance, globally addressable by name.

Non-goals: persistent event queuing, end-to-end encryption beyond TLS, bidirectional communication, Linear tracker support via relay.

## Architecture Decision

The relay transport follows the same pattern as the existing webhook transport: an external event source that calls `orchestrator.triggerRefresh()`. This is the simplest integration point — no changes to the dispatch/tick/reconcile logic are needed.

The implementation adds a third `PollingMode` value (`'relay'`) and a new config section (`relay: { url, token, room, secret }`). When relay mode is active, the orchestrator starts a `RelayTransport` that maintains a WebSocket connection to the Cloudflare relay via `partysocket`. The periodic poll timer still runs as a safety net, identical to webhook mode behavior.

The relay worker is a separate `apps/relay-worker/` workspace — a Cloudflare Worker using `partyserver`. It receives HTTP webhook POSTs from issue trackers on a `/webhook/:room` endpoint, verifies the shared secret via HMAC signature, and broadcasts a lightweight event envelope to all connected WebSocket clients in that room. Each room corresponds to a project/deployment, allowing multi-tenant usage. Hibernation is enabled so idle rooms have zero compute cost.

The worker and client are decoupled: the worker only needs `partyserver` (Cloudflare runtime), while the agent client only needs `partysocket` (Node/Bun runtime). Authentication uses bearer tokens on WebSocket upgrade and shared secrets on HTTP webhook ingress.

## Tasks

- [x] T001 Extend PollingMode type and add RelayConfig interface (file: packages/core/src/types.ts)
- [x] T002 Add relay config builder and extend pollingModeValue (file: packages/core/src/config.ts) (depends on T001)
- [x] T003 Create RelayTransport client with partysocket (file: packages/core/src/relay-transport.ts) (depends on T001)
- [x] T004 Integrate relay transport into Orchestrator start/stop lifecycle (file: packages/core/src/orchestrator.ts) (depends on T002, T003)
- [x] T005 Export relay transport from core barrel (file: packages/core/src/index.ts) (depends on T003)
- [x] T006 [P] Scaffold relay-worker package with wrangler config (file: apps/relay-worker/package.json)
- [x] T007 Implement RelayParty server class with broadcast (file: apps/relay-worker/src/relay-party.ts) (depends on T006)
- [x] T008 Add webhook ingress handler with signature verification (file: apps/relay-worker/src/relay-party.ts) (depends on T007)
- [x] T009 Add WebSocket connection authentication (file: apps/relay-worker/src/relay-party.ts) (depends on T007)
- [x] T010 Add relay config validation in validateConfig (file: packages/core/src/config.ts) (depends on T002)
- [x] T011 ~~Add Nitro plugin for relay transport lifecycle~~ Removed — orchestrator handles relay lifecycle directly (depends on T004)

## Key Files

### Create

- `packages/core/src/relay-transport.ts` — WebSocket client using partysocket, connects to relay and calls triggerRefresh()
- `packages/core/src/relay-transport.test.ts` — Unit tests for relay transport
- `apps/relay-worker/package.json` — New workspace package for Cloudflare Worker
- `apps/relay-worker/src/relay-party.ts` — PartyServer class: onRequest (webhook ingress), onConnect (auth), broadcast
- `apps/relay-worker/src/index.ts` — Worker entry point exporting the party and fetch handler
- `apps/relay-worker/wrangler.json` — Cloudflare Worker + Durable Object binding config
- `apps/relay-worker/tsconfig.json` — TypeScript config for Cloudflare Workers environment
- `apps/agent-please/server/plugins/04.relay.ts` — Nitro plugin managing relay connection lifecycle

### Modify

- `packages/core/src/types.ts` — Add `'relay'` to PollingMode union, add RelayConfig interface to ServiceConfig
- `packages/core/src/config.ts` — Add `buildRelayConfig()`, extend `pollingModeValue()` to accept `'relay'`, add relay validation
- `packages/core/src/orchestrator.ts` — Start/stop RelayTransport in `start()`/`stop()` when mode is relay
- `packages/core/src/index.ts` — Export RelayTransport and RelayConfig types

### Reuse

- `packages/core/src/webhook.ts` — `createVerify()` for HMAC signature verification pattern (reference for relay-side verification)
- `packages/core/src/logger.ts` — `createLogger()` for structured logging in relay transport
- `packages/core/src/config.ts` — `resolveEnvValue()`, `stringValue()` helpers for config parsing

## Verification

### Automated Tests

- [ ] RelayTransport connects, receives message, calls triggerRefresh callback
- [ ] RelayTransport reconnects on disconnect with backoff
- [ ] RelayTransport rejects connection when auth token is missing/invalid
- [ ] Config builder parses relay section from YAML correctly
- [ ] Config validator rejects relay mode with missing relay.url
- [ ] Config validator accepts poll/webhook modes without relay config
- [ ] PollingMode type accepts 'relay' as valid value
- [ ] RelayParty.onRequest verifies webhook signature and rejects invalid
- [ ] RelayParty.onRequest broadcasts event to connected clients
- [ ] RelayParty.onConnect rejects unauthenticated connections

### Observable Outcomes

- After setting `polling.mode: relay` with a valid relay URL, the orchestrator log shows `starting mode=relay` and a successful WebSocket connection
- Running `wrangler deploy` in `apps/relay-worker/` deploys the relay worker to Cloudflare
- Sending a test webhook POST to the relay worker URL triggers an orchestrator refresh on the connected agent instance

### Manual Testing

- [ ] Deploy relay worker to Cloudflare, configure GitHub webhook to point at relay URL, verify events flow to local Agent Please instance
- [ ] Kill and restart Agent Please — verify WebSocket reconnects automatically
- [ ] Run two Agent Please instances against same relay room — verify both receive events

### Acceptance Criteria Check

- [ ] AC-1: Agent Please with relay mode connects without exposing public HTTP endpoint
- [ ] AC-2: GitHub webhook events via relay trigger orchestrator refresh
- [ ] AC-3: Disconnect/reconnect works seamlessly
- [ ] AC-4: Existing webhook/poll modes unchanged
- [ ] AC-5: Relay worker deployable via wrangler deploy

## Decision Log

- Decision: Add relay as a third PollingMode rather than a separate transport layer
  Rationale: The orchestrator already treats poll and webhook modes identically at runtime (both use triggerRefresh). Adding relay as a third mode keeps the interface consistent and requires minimal orchestrator changes.
  Date/Author: 2026-03-25 / Claude

- Decision: Use partysocket client library instead of raw WebSocket
  Rationale: partysocket provides auto-reconnect with exponential backoff out of the box, matching FR-4 without custom reconnection logic. Works across Node.js, Bun, browsers, and Deno.
  Date/Author: 2026-03-25 / Claude

- Decision: Separate relay-worker as independent package rather than embedding in core
  Rationale: The relay worker runs on Cloudflare Workers runtime (not Bun), has different dependencies (partyserver vs partysocket), and is deployed independently. Keeping it as a separate workspace enforces this boundary.
  Date/Author: 2026-03-25 / Claude

- Decision: Enable PartyServer hibernation for relay rooms
  Rationale: Hibernation allows idle Durable Objects (no connected clients) to have zero compute cost. The relay wakes automatically on new connections or HTTP requests.
  Date/Author: 2026-03-25 / Claude
