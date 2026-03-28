import type { Env } from '@pleaseai/relay-server'
import { getServerByName, routePartykitRequest } from 'partyserver'

export { RelayParty } from '@pleaseai/relay-server'

const ROOM_NAME_RE = /^[\w-]{1,128}$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    // Webhook ingress: POST /webhook/:provider/:room
    if (url.pathname.startsWith('/webhook/') && request.method === 'POST') {
      const rest = url.pathname.slice('/webhook/'.length)
      const segments = rest.split('/').filter(Boolean)

      if (segments.length < 2) {
        return Response.json(
          { error: { code: 'missing_room', message: 'Both provider and room are required: /webhook/:provider/:room' } },
          { status: 400 },
        )
      }

      const [provider, room] = segments

      if (!ROOM_NAME_RE.test(room)) {
        return Response.json(
          { error: { code: 'invalid_room', message: 'Room name must be alphanumeric, hyphens, or underscores (max 128 chars)' } },
          { status: 400 },
        )
      }

      const headers = new Headers(request.headers)
      headers.set('x-relay-provider', provider)
      const newRequest = new Request(request, { headers })

      const stub = getServerByName(env.RelayParty, room)
      return (await stub).fetch(newRequest)
    }

    // WebSocket connections: /parties/relay-party/:room
    const partyResponse = await routePartykitRequest(request, env)
    if (partyResponse)
      return partyResponse

    return Response.json(
      { error: { code: 'not_found', message: 'Route not found' } },
      { status: 404 },
    )
  },
} satisfies ExportedHandler<Env>
