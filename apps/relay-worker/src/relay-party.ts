import type { Connection, ConnectionContext } from 'partyserver'
import { Server } from 'partyserver'

export interface Env {
  [key: string]: unknown
  RelayParty: DurableObjectNamespace<RelayParty>
  WEBHOOK_SECRET?: string
  AUTH_TOKEN?: string
}

export class RelayParty extends Server<Env> {
  static options = { hibernate: true }

  onConnect(connection: Connection, ctx: ConnectionContext): void {
    const url = new URL(ctx.request.url)
    const token = url.searchParams.get('token')
    const expectedToken = this.env.AUTH_TOKEN

    if (expectedToken && token !== expectedToken) {
      connection.close(4001, 'Unauthorized')
      return
    }

    connection.send(JSON.stringify({
      type: 'connected',
      room: this.name,
    }))
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = await request.text()

    const secret = this.env.WEBHOOK_SECRET
    if (secret) {
      const signature = request.headers.get('x-hub-signature-256')
      if (!signature) {
        return Response.json(
          { error: { code: 'missing_signature', message: 'X-Hub-Signature-256 header required' } },
          { status: 401 },
        )
      }

      const valid = await this.verifySignature(body, signature, secret)
      if (!valid) {
        return Response.json(
          { error: { code: 'invalid_signature', message: 'Signature verification failed' } },
          { status: 401 },
        )
      }
    }

    const event = request.headers.get('x-github-event') ?? 'unknown'
    let action: string | null = null
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (typeof parsed?.action === 'string')
        action = parsed.action
    }
    catch {
      // Body parse failure does not block the broadcast
    }

    const envelope = JSON.stringify({
      type: 'webhook_event',
      event_id: crypto.randomUUID(),
      event,
      action,
      received_at: new Date().toISOString(),
    })

    this.broadcast(envelope)

    return Response.json({ accepted: true, event, action, connections: this.getConnectionCount() })
  }

  private getConnectionCount(): number {
    let count = 0
    for (const _ of this.getConnections())
      count++
    return count
  }

  private async verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )

    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    const expected = `sha256=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')}`

    if (signature.length !== expected.length)
      return false

    // Constant-time comparison
    let mismatch = 0
    for (let i = 0; i < expected.length; i++)
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)

    return mismatch === 0
  }
}
