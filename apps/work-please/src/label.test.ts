import type { Issue, ServiceConfig } from './types'
import { describe, expect, it, mock } from 'bun:test'
import { createLabelService, formatLabelName, parseGitHubIssueUrl } from './label'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'id1',
    identifier: 'MT-1',
    title: 'Test',
    description: null,
    priority: null,
    state: 'In Progress',
    branch_name: null,
    url: null,
    assignees: [],
    labels: [],
    blocked_by: [],
    pull_requests: [],
    review_decision: null,
    created_at: null,
    updated_at: null,
    project: null,
    ...overrides,
  }
}

function makeGithubConfig(labelPrefix: string | null): ServiceConfig {
  return {
    tracker: {
      kind: 'github_projects',
      endpoint: 'https://api.github.com',
      api_key: 'ghtoken',
      owner: 'myorg',
      project_number: 1,
      label_prefix: labelPrefix,
      filter: { assignee: [], label: [] },
    },
    polling: { interval_ms: 30000 },
    workspace: { root: '/tmp' },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60000 },
    agent: { runner: 'sdk', max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
    claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
    env: {},
    server: { port: null },
  }
}

function makeAsanaConfig(): ServiceConfig {
  return {
    tracker: {
      kind: 'asana',
      endpoint: 'https://app.asana.com/api/1.0',
      api_key: 'asana-token',
      project_gid: 'gid123',
      label_prefix: 'work-please',
      filter: { assignee: [], label: [] },
    },
    polling: { interval_ms: 30000 },
    workspace: { root: '/tmp' },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60000 },
    agent: { runner: 'sdk', max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
    claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
    env: {},
    server: { port: null },
  }
}

describe('parseGitHubIssueUrl', () => {
  it('parses standard issue URL', () => {
    const result = parseGitHubIssueUrl('https://github.com/myorg/myrepo/issues/42')
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 42 })
  })

  it('parses PR URL', () => {
    const result = parseGitHubIssueUrl('https://github.com/myorg/myrepo/pull/7')
    expect(result).toEqual({ owner: 'myorg', repo: 'myrepo', number: 7 })
  })

  it('returns null for invalid URL', () => {
    expect(parseGitHubIssueUrl('https://example.com/not-an-issue')).toBeNull()
    expect(parseGitHubIssueUrl('not-a-url')).toBeNull()
  })

  it('parses GHE URL', () => {
    const result = parseGitHubIssueUrl('https://github.mycompany.com/org/repo/issues/10')
    expect(result).toEqual({ owner: 'org', repo: 'repo', number: 10 })
  })
})

describe('formatLabelName', () => {
  it('formats label name as prefix: state', () => {
    expect(formatLabelName('work-please', 'dispatched')).toBe('work-please: dispatched')
    expect(formatLabelName('work-please', 'done')).toBe('work-please: done')
    expect(formatLabelName('work-please', 'failed')).toBe('work-please: failed')
  })
})

describe('createLabelService', () => {
  it('returns null when label_prefix is null', () => {
    expect(createLabelService(makeGithubConfig(null))).toBeNull()
  })

  it('returns null when label_prefix is empty string', () => {
    expect(createLabelService(makeGithubConfig(''))).toBeNull()
  })

  it('returns null for asana tracker even when label_prefix is set', () => {
    expect(createLabelService(makeAsanaConfig())).toBeNull()
  })

  it('returns service for github_projects with non-empty prefix', () => {
    expect(createLabelService(makeGithubConfig('work-please'))).not.toBeNull()
  })
})

describe('setLabel', () => {
  it('is a no-op when issue url is null', async () => {
    const service = createLabelService(makeGithubConfig('work-please'))!
    const result = await service.setLabel(makeIssue({ url: null }), 'dispatched')
    expect(result).toBeUndefined()
  })

  it('is a no-op when url is not a GitHub issue/PR URL', async () => {
    const service = createLabelService(makeGithubConfig('work-please'))!
    const result = await service.setLabel(makeIssue({ url: 'https://linear.app/team/issue/ISS-1' }), 'dispatched')
    expect(result).toBeUndefined()
  })

  it('fires create, list, and add label requests for happy path', async () => {
    const calls: Array<{ method: string, url: string }> = []
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      calls.push({ method: options.method ?? 'GET', url: String(url) })
      if (options.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({}), { status: 201, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/42' }), 'dispatched')
      const urls = calls.map(c => `${c.method} ${c.url}`)
      expect(urls).toContain('POST https://api.github.com/repos/org/repo/labels')
      expect(urls).toContain('GET https://api.github.com/repos/org/repo/issues/42/labels')
      expect(urls).toContain('POST https://api.github.com/repos/org/repo/issues/42/labels')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  it('removes existing prefix labels before adding new one', async () => {
    const calls: Array<{ method: string, url: string }> = []
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      calls.push({ method: options.method ?? 'GET', url: String(url) })
      if (options.method === 'GET') {
        return new Response(
          JSON.stringify([{ name: 'work-please: dispatched' }, { name: 'bug' }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/1' }), 'done')
      const deleteCalls = calls.filter(c => c.method === 'DELETE')
      expect(deleteCalls).toHaveLength(1)
      expect(deleteCalls[0].url).toContain('work-please%3A%20dispatched')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  it('handles 422 on label create (label already exists) without error', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      if (options.method === 'POST' && !String(url).includes('/issues/')) {
        return new Response(JSON.stringify({ message: 'already exists' }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (options.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      const result = await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/5' }), 'done')
      expect(result).toBeUndefined()
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  it('swallows network errors without propagating', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('network failure')
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      const result = await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/1' }), 'dispatched')
      expect(result).toBeUndefined()
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  it('logs warning when DELETE returns non-2xx status', async () => {
    const warnCalls: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args.join(' '))
    }
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string, options: RequestInit) => {
      if (options.method === 'GET') {
        return new Response(
          JSON.stringify([{ name: 'work-please: dispatched' }]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (options.method === 'DELETE') {
        return new Response('Forbidden', { status: 403 })
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/1' }), 'done')
      expect(warnCalls.some(w => w.includes('failed to remove label') && w.includes('HTTP 403'))).toBe(true)
    }
    finally {
      globalThis.fetch = origFetch
      console.warn = origWarn
    }
  })

  it('non-OK GET for existing labels skips DELETE but still adds new label', async () => {
    const calls: Array<{ method: string, url: string }> = []
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string, options: RequestInit) => {
      calls.push({ method: options.method ?? 'GET', url: String(url) })
      if (options.method === 'GET') {
        return new Response('Forbidden', { status: 403 })
      }
      return new Response(JSON.stringify({}), { status: 201, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const service = createLabelService(makeGithubConfig('work-please'))!
      const result = await service.setLabel(makeIssue({ url: 'https://github.com/org/repo/issues/7' }), 'done')
      expect(result).toBeUndefined()
      const deleteCalls = calls.filter(c => c.method === 'DELETE')
      expect(deleteCalls).toHaveLength(0)
      const postToIssue = calls.filter(c => c.method === 'POST' && c.url.includes('/issues/7/labels'))
      expect(postToIssue).toHaveLength(1)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})
