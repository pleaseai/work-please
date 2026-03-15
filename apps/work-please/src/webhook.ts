import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='

export function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX))
    return false

  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const provided = signature.slice(SIGNATURE_PREFIX.length)

  if (expected.length !== provided.length)
    return false

  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

export function shouldProcessEvent(event: string, allowedEvents: string[] | null): boolean {
  if (allowedEvents === null)
    return true
  return allowedEvents.includes(event)
}

export async function handleWebhook(
  req: Request,
  secret: string | null,
  allowedEvents: string[] | null,
  triggerRefresh: () => void,
): Promise<Response> {
  const body = await req.text()

  if (secret) {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) {
      return jsonResponse({ error: { code: 'missing_signature', message: 'X-Hub-Signature-256 header required' } }, 401)
    }
    if (!verifyGitHubSignature(body, signature, secret)) {
      return jsonResponse({ error: { code: 'invalid_signature', message: 'Signature verification failed' } }, 401)
    }
  }

  const event = req.headers.get('x-github-event') ?? 'unknown'

  if (!shouldProcessEvent(event, allowedEvents)) {
    return jsonResponse({ accepted: false, reason: 'event_filtered', event })
  }

  let action: string | null = null
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.action === 'string')
      action = parsed.action
  }
  catch {
    // best effort — body may not be valid JSON
  }

  console.warn(`[webhook] received event=${event} action=${action ?? 'none'}`)
  triggerRefresh()

  return jsonResponse({ accepted: true, event, action })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
