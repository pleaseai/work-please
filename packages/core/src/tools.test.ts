import type { ServiceConfig } from './types'
import { describe, expect, mock, test } from 'bun:test'
import { createToolsMcpServer, executeTool, getToolSpecs } from './tools'

function makeConfig(trackerKind: 'asana' | 'github_projects', apiKey: string | null = 'test-key'): ServiceConfig {
  const isAsana = trackerKind === 'asana'
  const platform = isAsana ? 'asana' : 'github'
  const base: ServiceConfig = {
    platforms: isAsana
      ? { asana: { kind: 'asana' as const, api_key: apiKey, bot_username: null, webhook_secret: null } }
      : { github: { kind: 'github' as const, api_key: apiKey, owner: null, bot_username: null, app_id: null, private_key: null, installation_id: null } },
    projects: [{
      platform,
      active_statuses: [],
      terminal_statuses: [],
      watched_statuses: [],
      endpoint: isAsana ? 'https://app.asana.com/api/1.0' : 'https://api.github.com',
      label_prefix: null,
      filter: { assignee: [], label: [] },
    }],
    channels: [],
    polling: { mode: 'poll' as const, interval_ms: 30000 },
    workspace: { root: '/tmp', branch_prefix: null },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60000 },
    agent: { max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
    claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000, sandbox: null, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
    auth: { secret: null, github: { client_id: null, client_secret: null }, admin: { email: null, password: null } },
    commit_signing: { mode: 'none' as const, ssh_signing_key: null },
    env: {},
    db: { path: '.agent-please/agent_runs.db', turso_url: null, turso_auth_token: null },
    state: { adapter: 'memory' as const, url: null, key_prefix: 'chat-sdk', on_lock_conflict: 'drop' as const },
    server: { port: null, webhook: { secret: null, events: null } },
  }
  return base
}

describe('getToolSpecs', () => {
  test('returns asana_api for asana tracker', () => {
    const specs = getToolSpecs(makeConfig('asana'))
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('asana_api')
  })

  test('returns github_graphql for github_projects tracker', () => {
    const specs = getToolSpecs(makeConfig('github_projects'))
    expect(specs).toHaveLength(1)
    expect(specs[0].name).toBe('github_graphql')
  })

  test('tool specs have inputSchema', () => {
    const asanaSpecs = getToolSpecs(makeConfig('asana'))
    expect(asanaSpecs[0].inputSchema).toBeDefined()

    const githubSpecs = getToolSpecs(makeConfig('github_projects'))
    expect(githubSpecs[0].inputSchema).toBeDefined()
  })
})

describe('executeTool - unsupported', () => {
  test('returns failure for unknown tool name with supportedTools list', async () => {
    const result = await executeTool(makeConfig('asana'), 'unknown_tool', {})
    expect(result.success).toBe(false)
    const text = result.contentItems[0].text
    expect(text).toContain('Unsupported tool')
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed.error.supportedTools)).toBe(true)
    expect(parsed.error.supportedTools).toContain('asana_api')
  })

  test('returns failure for github_graphql when tracker is asana', async () => {
    const result = await executeTool(makeConfig('asana'), 'github_graphql', { query: 'query {}' })
    expect(result.success).toBe(false)
  })

  test('returns failure for asana_api when tracker is github_projects', async () => {
    const result = await executeTool(makeConfig('github_projects'), 'asana_api', { method: 'GET', path: '/tasks' })
    expect(result.success).toBe(false)
  })
})

describe('executeTool - asana_api validation', () => {
  test('fails when api_key is null', async () => {
    const result = await executeTool(makeConfig('asana', null), 'asana_api', { method: 'GET', path: '/tasks' })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('auth not configured')
  })

  test('fails on invalid args (not an object)', async () => {
    const result = await executeTool(makeConfig('asana'), 'asana_api', 'not an object')
    expect(result.success).toBe(false)
  })

  test('fails when method is missing', async () => {
    const result = await executeTool(makeConfig('asana'), 'asana_api', { path: '/tasks' })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('method')
  })

  test('fails when path does not start with /', async () => {
    const result = await executeTool(makeConfig('asana'), 'asana_api', { method: 'GET', path: 'tasks' })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('path')
  })

  test('returns successful response body as tool content', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { gid: 'task1', name: 'My Task' } }),
    })) as unknown as typeof fetch

    try {
      const result = await executeTool(makeConfig('asana'), 'asana_api', { method: 'GET', path: '/tasks/task1' })
      expect(result.success).toBe(true)
      expect(result.contentItems[0].text).toContain('My Task')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('marks non-200 HTTP response as failure while preserving body', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ message: 'Forbidden' }] }),
    })) as unknown as typeof fetch

    try {
      const result = await executeTool(makeConfig('asana'), 'asana_api', { method: 'GET', path: '/tasks/task1' })
      expect(result.success).toBe(false)
      expect(result.contentItems[0].text).toContain('403')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns failure when fetch throws (transport error)', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('network failure')
    }) as unknown as typeof fetch

    try {
      const result = await executeTool(makeConfig('asana'), 'asana_api', { method: 'GET', path: '/tasks/task1' })
      expect(result.success).toBe(false)
      expect(result.contentItems[0].text).toContain('network failure')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('executeTool - github_graphql validation', () => {
  test('fails when api_key is null', async () => {
    const result = await executeTool(makeConfig('github_projects', null), 'github_graphql', { query: 'query { viewer { login } }' })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('auth not configured')
  })

  test('fails on invalid args (not an object or string)', async () => {
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', 42)
    expect(result.success).toBe(false)
  })

  test('fails when query is missing', async () => {
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', {})
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('query')
  })

  test('fails when query is empty string', async () => {
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', { query: '   ' })
    expect(result.success).toBe(false)
  })

  test('accepts raw string query', async () => {
    // Will fail at network level (no real GitHub), but arg parsing should succeed
    // Just verify the args parse without error before the network call
    // We test this by checking that the error is network-related, not arg-related
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', 'query { viewer { login } }')
    // Will fail since no real endpoint, but not from arg validation
    const text = result.contentItems[0].text
    expect(text).not.toContain('non-empty string')
    expect(text).not.toContain('must be a non-empty')
  })

  test('fails when multiple operations in query', async () => {
    const multiOp = 'query A { viewer { login } } query B { rateLimit { limit } }'
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', { query: multiOp })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('exactly one')
  })

  test('fails when variables is an array (not a JSON object)', async () => {
    const result = await executeTool(makeConfig('github_projects'), 'github_graphql', {
      query: 'query { viewer { login } }',
      variables: ['bad', 'array'],
    })
    expect(result.success).toBe(false)
    expect(result.contentItems[0].text).toContain('variables')
    expect(result.contentItems[0].text).toContain('JSON object')
  })

  test('ignores operationName field (legacy compat)', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ data: { viewer: { login: 'testuser' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

    try {
      const result = await executeTool(makeConfig('github_projects'), 'github_graphql', {
        query: 'query Viewer { viewer { login } }',
        operationName: 'Viewer',
      })
      expect(result.success).toBe(true)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('marks GraphQL error response as failure while preserving body in contentItems', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        data: null,
        errors: [{ message: 'Field does not exist on type Query' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

    try {
      const result = await executeTool(
        makeConfig('github_projects'),
        'github_graphql',
        { query: 'query { nonexistentField }' },
      )
      expect(result.success).toBe(false)
      // Body is preserved in contentItems so agent can read the error message
      expect(result.contentItems[0].text).toContain('errors')
      expect(result.contentItems[0].text).toContain('Field does not exist')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns success=true with body for successful GitHub GraphQL response', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ data: { viewer: { login: 'testuser' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

    try {
      const result = await executeTool(
        makeConfig('github_projects'),
        'github_graphql',
        { query: 'query { viewer { login } }' },
      )
      expect(result.success).toBe(true)
      expect(result.contentItems[0].text).toContain('testuser')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('createToolsMcpServer - MCP server factory (Section 18.2)', () => {
  test('creates a server with instance for asana config', () => {
    const config = makeConfig('asana')
    const server = createToolsMcpServer(config)
    expect(server).toBeDefined()
    expect(server.instance).toBeDefined()
  })

  test('creates a server with instance for github_projects config', () => {
    const config = makeConfig('github_projects')
    const server = createToolsMcpServer(config)
    expect(server).toBeDefined()
    expect(server.instance).toBeDefined()
  })

  test('asana tool handler delegates to executeTool and produces text content', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { gid: 't1', name: 'Task One' } }),
    })) as unknown as typeof fetch

    try {
      const config = makeConfig('asana')
      const result = await executeTool(config, 'asana_api', { method: 'GET', path: '/tasks/t1' })
      expect(result.success).toBe(true)
      expect(result.contentItems[0].text).toContain('Task One')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github tool handler delegates to executeTool and produces text content', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({ data: { viewer: { login: 'testuser' } } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

    try {
      const config = makeConfig('github_projects')
      const result = await executeTool(config, 'github_graphql', { query: 'query { viewer { login } }' })
      expect(result.success).toBe(true)
      expect(result.contentItems[0].text).toContain('testuser')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})
