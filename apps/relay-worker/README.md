# @pleaseai/relay-worker

Cloudflare Worker that relays webhook events to Agent Please instances via WebSocket.

When Agent Please runs behind a firewall or NAT (e.g., on a developer laptop), it cannot receive incoming webhooks directly. This worker acts as a cloud-hosted relay: it receives webhook `POST` requests, verifies their signatures, and broadcasts event notifications to all connected Agent Please clients over WebSocket.

## How It Works

```
GitHub ──POST /webhook/:room──▶ Cloudflare Worker (RelayParty)
                                       │
                                       ▼
                              Durable Object per room
                                       │
                               broadcast via WebSocket
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                   Agent Please   Agent Please   Agent Please
                    (laptop A)    (laptop B)     (CI runner)
```

1. **Webhook ingress** — `POST /webhook/:room` forwards the request to a `RelayParty` Durable Object identified by `room`.
2. **Signature verification** — If `WEBHOOK_SECRET` is set, the worker validates `X-Hub-Signature-256` using constant-time HMAC-SHA256 comparison.
3. **Broadcast** — The Durable Object broadcasts a lightweight envelope (`event`, `action`, `event_id`, `received_at`) to all connected WebSocket clients. The full payload is **not** forwarded — clients fetch fresh state from the issue tracker on notification.
4. **Client connection** — Agent Please connects via `partysocket` (`RelayTransport` in `@pleaseai/core`) to `wss://<worker>/parties/relay-party/:room`.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns `{ "status": "ok" }` |
| `POST` | `/webhook/:room` | Webhook ingress — forwards to the Durable Object for `:room` |
| `GET` | `/parties/relay-party/:room` | WebSocket upgrade for relay clients |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBHOOK_SECRET` | No | GitHub webhook secret for HMAC-SHA256 signature verification |
| `AUTH_TOKEN` | No | Token required for WebSocket connections (passed as `?token=` query param) |

## Development

```bash
# Install dependencies (from project root)
bun install

# Start local dev server
bun run --filter @pleaseai/relay-worker dev

# Type check
bun run --filter @pleaseai/relay-worker check
```

## Deployment

```bash
bun run --filter @pleaseai/relay-worker deploy
```

This runs `wrangler deploy`, which publishes the worker to Cloudflare. Configure secrets with:

```bash
wrangler secret put WEBHOOK_SECRET
wrangler secret put AUTH_TOKEN
```

## Client Configuration

In the target repository's `WORKFLOW.md`, configure the relay transport:

```yaml
polling:
  mode: relay

relay:
  url: agent-please-relay.<your-account>.workers.dev
  room: my-project
  token: $RELAY_AUTH_TOKEN
  secret: $WEBHOOK_SECRET
```

Then configure a GitHub webhook pointing to `https://agent-please-relay.<your-account>.workers.dev/webhook/my-project`.
