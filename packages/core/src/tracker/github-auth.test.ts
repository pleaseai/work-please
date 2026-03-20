import type { GitHubPlatformConfig, ProjectConfig } from '../types'
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

function makeProject(extra: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    platform: 'github',
    project_number: 1,
    project_id: null,
    active_statuses: ['Todo', 'In Progress'],
    terminal_statuses: ['Done', 'Cancelled'],
    watched_statuses: [],
    endpoint: 'https://api.github.com',
    label_prefix: null,
    filter: { assignee: [], label: [] },
    ...extra,
  }
}

function makePlatform(extra: Partial<GitHubPlatformConfig> = {}): GitHubPlatformConfig {
  return {
    api_key: null,
    owner: null,
    bot_username: null,
    app_id: null,
    private_key: null,
    installation_id: null,
    ...extra,
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

    const project = makeProject()
    const platform = makePlatform({ api_key: 'my-pat-token' })
    const gql = createAuthenticatedGraphql(project, platform)
    await gql('{ viewer { login } }')
    expect(capturedAuth).toBe('bearer my-pat-token')
  })

  test('App mode: calls createAppAuth with correct credentials', () => {
    const project = makeProject()
    const platform = makePlatform({
      api_key: null,
      app_id: '12345',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest',
      installation_id: 67890,
    })

    createAuthenticatedGraphql(project, platform)

    expect(capturedAuthOpts).toHaveLength(1)
    const opts = capturedAuthOpts[0] as { appId: string | number, privateKey: string, installationId: number }
    expect(String(opts.appId)).toBe('12345')
    expect(opts.privateKey).toBe('-----BEGIN RSA PRIVATE KEY-----\ntest')
    expect(opts.installationId).toBe(67890)
  })

  test('App mode: uses auth.hook on the graphql instance', () => {
    const project = makeProject()
    const platform = makePlatform({
      api_key: null,
      app_id: '99',
      private_key: 'private-key',
      installation_id: 1,
    })

    createAuthenticatedGraphql(project, platform)

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

    const project = makeProject()
    const platform = makePlatform({
      api_key: 'pat-token',
      app_id: '12345',
      private_key: 'key',
      installation_id: 1,
    })
    const gql = createAuthenticatedGraphql(project, platform)
    await gql('{ viewer { login } }')

    expect(capturedAuth).toBe('bearer pat-token')
    // createAppAuth should NOT have been called
    expect(capturedAuthOpts).toHaveLength(0)
  })
})
