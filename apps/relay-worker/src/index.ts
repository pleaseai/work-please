import type { Env } from './relay-party'
import { getServerByName, routePartykitRequest } from 'partyserver'

export { RelayParty } from './relay-party'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    // Webhook ingress: POST /webhook/:room
    if (url.pathname.startsWith('/webhook/') && request.method === 'POST') {
      const room = url.pathname.slice('/webhook/'.length)
      if (!room) {
        return Response.json(
          { error: { code: 'missing_room', message: 'Room name required in URL path' } },
          { status: 400 },
        )
      }

      const stub = getServerByName(env.RelayParty, room)
      return (await stub).fetch(request)
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
