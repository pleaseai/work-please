# @pleaseai/relay-worker

Cloudflare Worker relay for Agent Please webhook events. Receives issue tracker webhooks via HTTP and broadcasts them to connected Agent Please instances over WebSocket using [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) (Durable Objects).

## Architecture

```
Issue Tracker (GitHub/Asana)
    |
    | POST /webhook/:room
    v
+---------------------------+
|  Cloudflare Worker        |
|  (PartyServer)            |
|                           |
|  onRequest: verify HMAC + |
|    broadcast to room      |
|  onConnect: auth check    |
+----------+----------------+
           | WebSocket (WSS)
           v
+---------------------------+
|  Agent Please             |
|  (partysocket client)     |
|                           |
|  relay transport ->       |
|    triggerRefresh()        |
+---------------------------+
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/webhook/:room` | Webhook ingress — verifies signature, broadcasts to room |
| GET | `/parties/relay-party/:room` | WebSocket upgrade for Agent Please clients |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBHOOK_SECRET` | No | Shared secret for GitHub HMAC SHA-256 signature verification |
| `AUTH_TOKEN` | No | Bearer token for WebSocket connection authentication |

Set via `wrangler secret put`:

```bash
wrangler secret put WEBHOOK_SECRET
wrangler secret put AUTH_TOKEN
```

## Development

```bash
# Install dependencies (from monorepo root)
bun install

# Start local dev server
bun run --cwd apps/relay-worker dev

# Type-check
bun run --cwd apps/relay-worker check
```

## Deployment

```bash
# Deploy to Cloudflare
bun run --cwd apps/relay-worker deploy
```

Requires a Cloudflare account with Workers and Durable Objects enabled.

## Agent Please Configuration

In the target repository's `WORKFLOW.md`, set polling mode to `relay`:

```yaml
polling:
  mode: relay

relay:
  url: https://agent-please-relay.<your-subdomain>.workers.dev
  token: $RELAY_TOKEN
  room: my-project
```

## How It Works

1. **Webhook ingress** — Issue trackers (GitHub) send webhooks to `POST /webhook/:room`. The worker verifies the `X-Hub-Signature-256` HMAC signature if `WEBHOOK_SECRET` is set, then broadcasts a lightweight event envelope to all WebSocket clients in that room.

2. **WebSocket connections** — Agent Please instances connect to `/parties/relay-party/:room` via `partysocket`. If `AUTH_TOKEN` is set, clients must include `?token=<value>` in the connection URL.

3. **Hibernation** — Idle rooms (no connected clients) hibernate automatically, incurring zero compute cost. The Durable Object wakes on new connections or HTTP requests.

4. **Event deduplication** — Each broadcast includes a unique `event_id` (UUID). The Agent Please client maintains a bounded cache of seen IDs to prevent duplicate processing after WebSocket reconnection.

## Broadcast Envelope

```json
{
  "type": "webhook_event",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "event": "issues",
  "action": "opened",
  "received_at": "2026-03-25T14:30:00.000Z"
}
```

## Tech Stack

- [PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) v0.3.3 — Durable Objects server framework
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) v4 — Cloudflare Workers CLI
- TypeScript — Strict mode, ESNext target
