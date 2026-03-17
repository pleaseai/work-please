import type { ServiceConfig } from '../types'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createAuthenticatedGraphql } from './github-auth'

// Captured args from createAppAuth calls (populated by mock)
const capturedAuthOpts: unknown[] = []
const mockHook = mock(async (
  request: (...args: unknown[]) => Promise<unknown>,
  route: unknown,
  params: unknown,
) => request(route as string, params as Record<string, unknown>))

mock.module('@octokit/auth-app', () => ({
  createAppAuth: mock((opts: unknown) => {
    capturedAuthOpts.push(opts)
    return { hook: mockHook }
  }),
}))

function makeConfig(tracker: Partial<ServiceConfig['tracker']>): ServiceConfig {
  return {
    tracker: {
      kind: 'github_projects',
      endpoint: 'https://api.github.com',
      api_key: null,
      label_prefix: null,
      filter: { assignee: [], label: [] },
      ...tracker,
    },
    polling: { interval_ms: 30_000 },
    workspace: { root: '/tmp' },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60_000 },
    agent: { max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300_000, max_concurrent_agents_by_state: {} },
    claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3_600_000, read_timeout_ms: 5_000, stall_timeout_ms: 300_000, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
    env: {},
    server: { port: null },
  }
}

describe('createAuthenticatedGraphql', () => {
  let origFetch: typeof globalThis.fetch

  beforeEach(() => {
    origFetch = globalThis.fetch
    capturedAuthOpts.length = 0
    mockHook.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = origFetch
  })

  test('PAT mode: uses bearer token authorization header', async () => {
    let capturedAuth = ''
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.authorization ?? ''
      return new Response(JSON.stringify({ data: { viewer: { login: 'test' } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const config = makeConfig({ api_key: 'my-pat-token' })
    const gql = createAuthenticatedGraphql(config)
    await gql('{ viewer { login } }')
    expect(capturedAuth).toBe('bearer my-pat-token')
  })

  test('App mode: calls createAppAuth with correct credentials', () => {
    const config = makeConfig({
      api_key: null,
      app_id: '12345',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest',
      installation_id: 67890,
    })

    createAuthenticatedGraphql(config)

    expect(capturedAuthOpts).toHaveLength(1)
    const opts = capturedAuthOpts[0] as { appId: string | number, privateKey: string, installationId: number }
    expect(String(opts.appId)).toBe('12345')
    expect(opts.privateKey).toBe('-----BEGIN RSA PRIVATE KEY-----\ntest')
    expect(opts.installationId).toBe(67890)
  })

  test('App mode: uses auth.hook on the graphql instance', () => {
    const config = makeConfig({
      api_key: null,
      app_id: '99',
      private_key: 'private-key',
      installation_id: 1,
    })

    createAuthenticatedGraphql(config)

    // createAppAuth was called (hook attached), not PAT path
    expect(capturedAuthOpts).toHaveLength(1)
  })

  test('prefers api_key when both PAT and app fields are provided', async () => {
    let capturedAuth = ''
    globalThis.fetch = mock(async (_url: unknown, init: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.authorization ?? ''
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const config = makeConfig({
      api_key: 'pat-token',
      app_id: '12345',
      private_key: 'key',
      installation_id: 1,
    })
    const gql = createAuthenticatedGraphql(config)
    await gql('{ viewer { login } }')

    expect(capturedAuth).toBe('bearer pat-token')
    // createAppAuth should NOT have been called
    expect(capturedAuthOpts).toHaveLength(0)
  })
})
