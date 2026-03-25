# @pleaseai/relay-server

PartyServer relay server library for Agent Please webhook events.

Provides `RelayParty` — a [PartyServer](https://github.com/partykit/partyserver) Durable Object
class that receives webhook events, verifies signatures, and broadcasts lightweight envelopes to
connected WebSocket clients.

This package is used by `apps/relay-worker` (Cloudflare Worker deployment). It is not deployed
directly.

## Development

```bash
# Install dependencies (from project root)
bun install

# Type check
bun run --filter @pleaseai/relay-server check
```

See [`apps/relay-worker/README.md`](../../apps/relay-worker/README.md) for deployment instructions.
