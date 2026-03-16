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

const NEWLINE_RE = /[\r\n]/g

export async function handleWebhook(
  req: Request,
  secret: string | null,
  allowedEvents: string[] | null,
  triggerRefresh: () => void,
): Promise<Response> {
  const body = await req.text()
  const event = req.headers.get('x-github-event')

  if (!event) {
    return jsonResponse({ error: { code: 'missing_event_header', message: 'X-GitHub-Event header required' } }, 400)
  }

  if (!shouldProcessEvent(event, allowedEvents)) {
    return jsonResponse({ accepted: false, reason: 'event_filtered', event })
  }

  if (secret) {
    const signature = req.headers.get('x-hub-signature-256')
    if (!signature) {
      return jsonResponse({ error: { code: 'missing_signature', message: 'X-Hub-Signature-256 header required' } }, 401)
    }

    const webhooks = createWebhooks(secret, () => {})
    const valid = await webhooks.verify(body, signature)
    if (!valid) {
      return jsonResponse({ error: { code: 'invalid_signature', message: 'Signature verification failed' } }, 401)
    }
  }

  let action: string | null = null
  try {
    const parsed = JSON.parse(body)
    if (typeof parsed?.action === 'string')
      action = parsed.action
  }
  catch (err) {
    console.warn(`[webhook] failed to parse body as JSON: ${err instanceof Error ? err.message : String(err)}`)
  }

  const safeEvent = event.replace(NEWLINE_RE, '_')
  const safeAction = (action ?? 'none').replace(NEWLINE_RE, '_')
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
