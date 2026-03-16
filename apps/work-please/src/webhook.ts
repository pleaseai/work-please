import { Webhooks } from '@octokit/webhooks'

export function createWebhooks(
  secret: string,
  triggerRefresh: () => void,
): Webhooks {
  const webhooks = new Webhooks({ secret })
  webhooks.onAny(() => {
    triggerRefresh()
  })
  return webhooks
}

export function shouldProcessEvent(event: string, allowedEvents: string[] | null): boolean {
  if (allowedEvents === null)
    return true
  return allowedEvents.includes(event)
}

const NON_PRINTABLE_RE = /[^\x20-\x7E]/g
const MAX_BODY_BYTES = 25 * 1024 * 1024

export async function handleWebhook(
  req: Request,
  secret: string | null,
  allowedEvents: string[] | null,
  triggerRefresh: () => void,
): Promise<Response> {
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    return jsonResponse({ error: { code: 'payload_too_large', message: 'Payload exceeds maximum allowed size' } }, 413)
  }

  const body = await req.text()
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: { code: 'payload_too_large', message: 'Payload exceeds maximum allowed size' } }, 413)
  }

  const event = req.headers.get('x-github-event')

  if (!event) {
    return jsonResponse({ error: { code: 'missing_event_header', message: 'X-GitHub-Event header required' } }, 400)
  }

  // Verify signature before event filtering to avoid leaking config to unauthenticated callers
  if (secret) {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) {
      return jsonResponse({ error: { code: 'missing_signature', message: 'X-Hub-Signature-256 header required' } }, 401)
    }

    let valid: boolean
    try {
      const webhooks = new Webhooks({ secret })
      valid = await webhooks.verify(body, signature)
    }
    catch (err) {
      console.error(`[webhook] signature verification error: ${err instanceof Error ? err.message : String(err)}`)
      return jsonResponse({ error: { code: 'signature_error', message: 'Signature verification failed' } }, 500)
    }

    if (!valid) {
      const safeEvent = event.replace(NON_PRINTABLE_RE, '_')
      console.warn(`[webhook] invalid signature for event=${safeEvent}`)
      return jsonResponse({ error: { code: 'invalid_signature', message: 'Signature verification failed' } }, 401)
    }
  }

  if (!shouldProcessEvent(event, allowedEvents)) {
    return jsonResponse({ accepted: false, reason: 'event_filtered', event })
  }

  let action: string | null = null
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.action === 'string')
      action = parsed.action
  }
  catch (err) {
    // Intentional: body parse failure does not block the refresh.
    // The event header is sufficient to trigger a reconciliation.
    console.warn(`[webhook] body parse failed (proceeding with event-only trigger): ${err instanceof Error ? err.message : String(err)}`)
  }

  const safeEvent = event.replace(NON_PRINTABLE_RE, '_')
  const safeAction = (action ?? 'none').replace(NON_PRINTABLE_RE, '_')
  console.warn(`[webhook] received event=${safeEvent} action=${safeAction}`)
  triggerRefresh()

  return jsonResponse({ accepted: true, event, action })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
