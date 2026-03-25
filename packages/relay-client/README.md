# @pleaseai/relay-client

WebSocket relay client for Agent Please webhook events.

Provides `RelayTransport` — an auto-reconnecting WebSocket client that connects Agent Please
instances to a cloud relay worker (see `apps/relay-worker`) so they can receive webhook events
without requiring a public inbound port.

## Usage

Configure in `WORKFLOW.md`:

```yaml
polling:
  mode: relay

relay:
  url: agent-please-relay.<your-account>.workers.dev
  room: my-project
  token: $RELAY_AUTH_TOKEN
  secret: $WEBHOOK_SECRET
```

## Development

```bash
# Install dependencies (from project root)
bun install

# Type check
bun run --filter @pleaseai/relay-client check
```
