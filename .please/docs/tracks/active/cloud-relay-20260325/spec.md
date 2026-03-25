# Cloud Relay Transport

> Track: cloud-relay-20260325

## Overview

Add a cloud relay transport as an alternative to the existing webhook-based event delivery. Instead of requiring the Agent Please instance to expose a public HTTP endpoint for receiving webhooks, the cloud relay approach uses Cloudflare Workers + Durable Objects (via PartyServer) as a persistent edge relay. Issue tracker events are forwarded to a Cloudflare Worker, which relays them to connected Agent Please instances over WebSocket. This eliminates the need for public webhook URLs, firewall configuration, or static IP addresses.

## Requirements

### Functional Requirements

- [ ] FR-1: Deploy a Cloudflare Worker with PartyServer that accepts issue tracker webhook events (GitHub, Asana) via HTTP and broadcasts them to connected clients via WebSocket
- [ ] FR-2: Add a `relay` polling mode to the Agent Please orchestrator that connects to the cloud relay via WebSocket (using `partysocket`) instead of requiring incoming webhooks
- [ ] FR-3: Support `WORKFLOW.md` configuration for relay mode — relay URL, authentication token, room/party name
- [ ] FR-4: Auto-reconnect with exponential backoff when the WebSocket connection drops
- [ ] FR-5: Maintain backward compatibility — existing webhook mode remains the default; relay is opt-in via config
- [ ] FR-6: Relay worker authenticates incoming webhook requests (shared secret) and outbound WebSocket connections (bearer token)
- [ ] FR-7: Relay worker provides an HTTP endpoint that issue trackers (GitHub/Asana) can use as their webhook URL
- [ ] FR-8: Support multiple Agent Please instances connecting to the same relay room (fan-out)

### Non-functional Requirements

- [ ] NFR-1: WebSocket reconnection must not cause duplicate event processing (idempotent handling via event IDs)
- [ ] NFR-2: Relay latency should add < 100ms to event delivery compared to direct webhooks
- [ ] NFR-3: Relay worker should be deployable via `wrangler deploy` with minimal configuration

## Acceptance Criteria

- [ ] AC-1: An Agent Please instance with `polling.mode: relay` connects to the Cloudflare relay and receives issue tracker events without exposing any public HTTP endpoint
- [ ] AC-2: GitHub webhook events sent to the relay worker's URL trigger an orchestrator refresh on the connected Agent Please instance
- [ ] AC-3: Disconnection and reconnection works seamlessly with no lost events (within Durable Object's buffer window)
- [ ] AC-4: Existing webhook-based configuration continues to work without changes
- [ ] AC-5: Relay worker can be deployed independently with `wrangler deploy`

## Out of Scope

- Full event queue/persistence on the relay (Durable Object provides short-term buffering only)
- End-to-end encryption beyond TLS (WebSocket over WSS is sufficient)
- Relay-based bidirectional RPC (this is one-way: tracker → relay → agent-please)
- Linear tracker support via relay (future track)

## Technical Approach

### Architecture

```
Issue Tracker (GitHub/Asana)
    │
    │ HTTP webhook POST
    ▼
┌──────────────────────────┐
│  Cloudflare Worker        │
│  (PartyServer)            │
│                           │
│  onRequest: verify +      │
│    broadcast to room      │
│  onConnect: auth check    │
│  onMessage: N/A (one-way) │
└──────────┬───────────────┘
           │ WebSocket (WSS)
           ▼
┌──────────────────────────┐
│  Agent Please             │
│  (partysocket client)     │
│                           │
│  relay transport →        │
│    triggerRefresh()       │
└──────────────────────────┘
```

### Key Components

1. **`apps/relay-worker/`** — Cloudflare Worker with PartyServer class handling webhook reception and WebSocket fan-out
2. **`packages/core/src/relay-transport.ts`** — WebSocket client using `partysocket` that connects to the relay and calls `triggerRefresh()` on events
3. **Config extension** — New `relay` section in `WORKFLOW.md` YAML front matter (`relay.url`, `relay.token`, `relay.room`)
4. **Orchestrator integration** — When `polling.mode: relay`, start relay transport alongside (or instead of) HTTP webhook listener

### Dependencies

- `partyserver` — Server framework for Cloudflare Workers + Durable Objects
- `partysocket` — Client-side WebSocket with auto-reconnect
- `wrangler` — Cloudflare Workers CLI (dev dependency for relay worker)

## Assumptions

- Users deploying in relay mode have a Cloudflare account with Workers + Durable Objects enabled
- The relay worker is deployed separately from the Agent Please application
- GitHub/Asana webhook URLs are pointed at the relay worker's public URL
