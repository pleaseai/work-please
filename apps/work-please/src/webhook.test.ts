import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { createWebhooks, handleWebhook, shouldProcessEvent } from './webhook'

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/webhook', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('createWebhooks', () => {
  test('calls triggerRefresh on any event', async () => {
    let refreshed = false
    const webhooks = createWebhooks('secret', () => {
      refreshed = true
    })

    const payload = '{"action":"opened"}'
    await webhooks.verifyAndReceive({
      id: 'delivery-1',
      name: 'issues',
      payload,
      signature: sign(payload, 'secret'),
    })
    expect(refreshed).toBe(true)
  })

  test('verify returns false for invalid signature', async () => {
    const webhooks = createWebhooks('secret', () => {})
    const payload = '{"action":"opened"}'
    const wrongSig = sign(payload, 'wrong-secret')

    const valid = await webhooks.verify(payload, wrongSig)
    expect(valid).toBe(false)
  })
})

describe('shouldProcessEvent', () => {
  test('null allowedEvents accepts everything', () => {
    expect(shouldProcessEvent('push', null)).toBe(true)
    expect(shouldProcessEvent('issues', null)).toBe(true)
  })

  test('matching event accepted', () => {
    expect(shouldProcessEvent('issues', ['issues', 'pull_request'])).toBe(true)
  })

  test('non-matching event rejected', () => {
    expect(shouldProcessEvent('push', ['issues', 'pull_request'])).toBe(false)
  })

  test('empty allowedEvents rejects everything', () => {
    expect(shouldProcessEvent('issues', [])).toBe(false)
  })
})

describe('handleWebhook', () => {
  test('no secret configured triggers refresh and returns accepted', async () => {
    let refreshed = false
    const req = makeRequest('{"action":"opened"}', { 'x-github-event': 'issues' })
    const res = await handleWebhook(req, null, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(body.event).toBe('issues')
    expect(body.action).toBe('opened')
    expect(refreshed).toBe(true)
  })

  test('valid signature triggers refresh', async () => {
    const secret = 'my-secret'
    const payload = '{"action":"synchronize"}'
    let refreshed = false
    const req = makeRequest(payload, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign(payload, secret),
    })
    const res = await handleWebhook(req, secret, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(refreshed).toBe(true)
  })

  test('invalid signature returns 401 and does not trigger refresh', async () => {
    const secret = 'my-secret'
    let refreshed = false
    const req = makeRequest('{"action":"opened"}', {
      'x-github-event': 'issues',
      'x-hub-signature-256': sign('{"action":"opened"}', 'wrong-secret'),
    })
    const res = await handleWebhook(req, secret, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_signature')
    expect(refreshed).toBe(false)
  })

  test('missing signature header returns 401', async () => {
    let refreshed = false
    const req = makeRequest('{"action":"opened"}', { 'x-github-event': 'issues' })
    const res = await handleWebhook(req, 'my-secret', null, () => {
      refreshed = true
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('missing_signature')
    expect(refreshed).toBe(false)
  })

  test('filtered event returns accepted false and does not trigger refresh', async () => {
    let refreshed = false
    const req = makeRequest('{}', { 'x-github-event': 'push' })
    const res = await handleWebhook(req, null, ['issues', 'pull_request'], () => {
      refreshed = true
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(false)
    expect(body.reason).toBe('event_filtered')
    expect(refreshed).toBe(false)
  })

  test('missing event header returns 400', async () => {
    let refreshed = false
    const req = makeRequest('{}')
    const res = await handleWebhook(req, null, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('missing_event_header')
    expect(refreshed).toBe(false)
  })

  test('non-JSON body still works', async () => {
    let refreshed = false
    const req = makeRequest('not json', { 'x-github-event': 'ping' })
    const res = await handleWebhook(req, null, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(body.action).toBe(null)
    expect(refreshed).toBe(true)
  })
})
