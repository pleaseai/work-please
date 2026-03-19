import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { createVerify, handleWebhook, shouldProcessEvent } from './webhook'

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

describe('createVerify', () => {
  test('returns true for valid signature', async () => {
    const verify = createVerify('secret')
    const payload = '{"action":"opened"}'
    const valid = await verify(payload, sign(payload, 'secret'))
    expect(valid).toBe(true)
  })

  test('returns false for invalid signature', async () => {
    const verify = createVerify('secret')
    const payload = '{"action":"opened"}'
    const valid = await verify(payload, sign(payload, 'wrong-secret'))
    expect(valid).toBe(false)
  })

  test('reuses the same Webhooks instance across calls', async () => {
    const verify = createVerify('secret')
    const p1 = '{"a":1}'
    const p2 = '{"b":2}'
    expect(await verify(p1, sign(p1, 'secret'))).toBe(true)
    expect(await verify(p2, sign(p2, 'secret'))).toBe(true)
    expect(await verify(p1, sign(p1, 'wrong'))).toBe(false)
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
  test('no verify configured triggers refresh and returns accepted', async () => {
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
    const verify = createVerify('my-secret')
    const payload = '{"action":"synchronize"}'
    let refreshed = false
    const req = makeRequest(payload, {
      'x-github-event': 'pull_request',
      'x-hub-signature-256': sign(payload, 'my-secret'),
    })
    const res = await handleWebhook(req, verify, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(refreshed).toBe(true)
  })

  test('invalid signature returns 401 and does not trigger refresh', async () => {
    const verify = createVerify('my-secret')
    let refreshed = false
    const req = makeRequest('{"action":"opened"}', {
      'x-github-event': 'issues',
      'x-hub-signature-256': sign('{"action":"opened"}', 'wrong-secret'),
    })
    const res = await handleWebhook(req, verify, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(401)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_signature')
    expect(refreshed).toBe(false)
  })

  test('missing signature header returns 401', async () => {
    const verify = createVerify('my-secret')
    let refreshed = false
    const req = makeRequest('{"action":"opened"}', { 'x-github-event': 'issues' })
    const res = await handleWebhook(req, verify, null, () => {
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

  test('signature verification runs before event filtering', async () => {
    const verify = createVerify('my-secret')
    let refreshed = false
    const req = makeRequest('{}', {
      'x-github-event': 'push',
      'x-hub-signature-256': 'sha256=invalid',
    })
    const res = await handleWebhook(req, verify, ['issues'], () => {
      refreshed = true
    })

    expect(res.status).toBe(401)
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

  test('rejects oversized payload via content-length', async () => {
    let refreshed = false
    const req = new Request('http://localhost/api/v1/webhook', {
      method: 'POST',
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(26 * 1024 * 1024),
        'x-github-event': 'push',
      },
    })
    const res = await handleWebhook(req, null, null, () => {
      refreshed = true
    })

    expect(res.status).toBe(413)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('payload_too_large')
    expect(refreshed).toBe(false)
  })
})
