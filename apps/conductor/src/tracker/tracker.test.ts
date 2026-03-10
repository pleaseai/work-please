import type { ServiceConfig } from '../types'
import { describe, expect, mock, test } from 'bun:test'
import { buildConfig } from '../config'
import { createAsanaAdapter } from './asana'
import { createGitHubAdapter } from './github'

function makeAsanaConfig(extra: Record<string, unknown> = {}): ServiceConfig {
  return buildConfig({
    config: {
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid456', ...extra },
    },
    prompt_template: '',
  })
}

function makeGitHubConfig(extra: Record<string, unknown> = {}): ServiceConfig {
  return buildConfig({
    config: {
      tracker: { kind: 'github_projects', api_key: 'ghtoken', owner: 'myorg', project_number: 1, ...extra },
    },
    prompt_template: '',
  })
}

describe('fetchIssuesByStates - empty states early return', () => {
  test('asana: returns [] immediately without making any fetch call', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)
    const result = await adapter.fetchIssuesByStates([])
    expect(result).toEqual([])
  })

  test('github_projects: returns [] immediately without making any fetch call', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const result = await adapter.fetchIssuesByStates([])
    expect(result).toEqual([])
  })
})

describe('asana pagination', () => {
  test('fetchIssuesByStates collects tasks across multiple pages', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const mockSectionsResponse = {
      ok: true,
      json: async () => ({ data: [{ gid: 'sec1', name: 'Todo' }] }),
    }

    let callCount = 0
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/'))
        return mockSectionsResponse as unknown as Response

      callCount++
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            data: [{ gid: 'task1', name: 'Task 1', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null }],
            next_page: { offset: 'page2token' },
          }),
        } as unknown as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ gid: 'task2', name: 'Task 2', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null }],
          next_page: null,
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(2)
      expect(result[0].identifier).toBe('task1')
      expect(result[1].identifier).toBe('task2')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('fetchIssueStatesByIds - empty ids early return', () => {
  test('asana: returns [] immediately without making any fetch call', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)
    const result = await adapter.fetchIssueStatesByIds([])
    expect(result).toEqual([])
  })

  test('github_projects: returns [] immediately without making any fetch call', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const result = await adapter.fetchIssueStatesByIds([])
    expect(result).toEqual([])
  })
})

describe('asana fetchIssueStatesByIds', () => {
  test('returns normalized minimal issue for a task id', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        data: {
          gid: 'task-gid-1',
          name: 'My Task',
          memberships: [{ section: { name: 'In Progress' } }],
        },
      }),
    })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['task-gid-1'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('task-gid-1')
      expect(result[0].state).toBe('In Progress')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns asana_api_status error on non-200 response', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ message: 'Forbidden' }] }),
    })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['some-id'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('asana_api_status')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('github_projects fetchIssueStatesByIds', () => {
  test('returns normalized minimal issue with state from GraphQL nodes response', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        data: {
          nodes: [
            {
              id: 'PVTI_abc',
              fieldValues: {
                nodes: [
                  { name: 'In Progress', field: { name: 'Status' } },
                ],
              },
              content: { number: 42, title: 'Test Issue' },
            },
          ],
        },
      }),
    })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['PVTI_abc'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('PVTI_abc')
      expect(result[0].identifier).toBe('#42')
      expect(result[0].state).toBe('In Progress')
      expect(result[0].title).toBe('Test Issue')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns github_projects_api_status error on non-200 response', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['some-id'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('github_projects_api_status')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('asana label normalization', () => {
  test('normalizes tags to lowercase', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const mockSectionsResponse = {
      ok: true,
      json: async () => ({
        data: [{ gid: 'sec1', name: 'Todo' }],
      }),
    }

    const mockTasksResponse = {
      ok: true,
      json: async () => ({
        data: [
          {
            gid: 'task1',
            name: 'My Task',
            notes: null,
            tags: [{ name: 'Bug' }, { name: 'HIGH-Priority' }],
            dependencies: [],
            created_at: null,
            modified_at: null,
          },
        ],
        next_page: null,
      }),
    }

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/'))
        return mockSectionsResponse as unknown as Response
      return mockTasksResponse as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].labels).toEqual(['bug', 'high-priority'])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})
