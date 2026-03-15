import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { handleWebhook, shouldProcessEvent, verifyGitHubSignature } from './webhook'

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

describe('verifyGitHubSignature', () => {
  const secret = 'test-secret'
  const payload = '{"action":"opened"}'

  test('valid signature returns true', () => {
    const sig = sign(payload, secret)
    expect(verifyGitHubSignature(payload, sig, secret)).toBe(true)
  })

  test('invalid signature returns false', () => {
    const sig = sign(payload, 'wrong-secret')
    expect(verifyGitHubSignature(payload, sig, secret)).toBe(false)
  })

  test('malformed signature without prefix returns false', () => {
    expect(verifyGitHubSignature(payload, 'not-a-valid-sig', secret)).toBe(false)
  })

  test('empty signature returns false', () => {
    expect(verifyGitHubSignature(payload, '', secret)).toBe(false)
  })

  test('signature with wrong length returns false', () => {
    expect(verifyGitHubSignature(payload, 'sha256=abc', secret)).toBe(false)
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

  test('missing event header defaults to unknown', async () => {
    let refreshed = false
    const req = makeRequest('{}')
    const res = await handleWebhook(req, null, null, () => {
      refreshed = true
    })

    const body = await res.json() as Record<string, unknown>
    expect(body.event).toBe('unknown')
    expect(refreshed).toBe(true)
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
