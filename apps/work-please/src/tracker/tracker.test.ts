import type { ServiceConfig } from '../types'
import { describe, expect, mock, test } from 'bun:test'
import { buildConfig, validateConfig } from '../config'
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

describe('fetchCandidateIssues - uses active states (Section 17.3)', () => {
  test('asana: calls fetchIssuesByStates with configured active_sections', async () => {
    const config = makeAsanaConfig({ active_sections: 'In Progress,Review' })
    const adapter = createAsanaAdapter(config)

    const fetchedUrls: string[] = []
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      fetchedUrls.push(String(url))
      // Return empty sections so no tasks are fetched
      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(Array.isArray(result)).toBe(true)
      // The sections fetch should have been called
      expect(fetchedUrls.some(u => u.includes('/projects/'))).toBe(true)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github_projects: calls fetchIssuesByStates with active_statuses', async () => {
    const config = makeGitHubConfig({ active_statuses: 'In Progress,Todo' })
    const adapter = createGitHubAdapter(config)

    let fetchCalled = false
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      fetchCalled = true
      return new Response(JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              items: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(Array.isArray(result)).toBe(true)
      expect(fetchCalled).toBe(true)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('github_projects pagination', () => {
  test('fetchIssuesByStates collects items across multiple pages', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    let callCount = 0
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({
          data: {
            repositoryOwner: {
              projectV2: {
                items: {
                  nodes: [
                    {
                      id: 'PVTI_1',
                      fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                      content: { number: 1, title: 'Issue One' },
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
                },
              },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              items: {
                nodes: [
                  {
                    id: 'PVTI_2',
                    fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                    content: { number: 2, title: 'Issue Two' },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('PVTI_1')
      expect(result[1].id).toBe('PVTI_2')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('github_projects project_id path', () => {
  test('uses node(id) query when project_id is configured', async () => {
    const config = makeGitHubConfig({ project_id: 'PVT_kwABC123' })
    const adapter = createGitHubAdapter(config)

    let capturedBody: string | null = null
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === 'string' ? init.body : null
      return new Response(JSON.stringify({
        data: {
          node: {
            items: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(Array.isArray(result)).toBe(true)
      expect(capturedBody).not.toBeNull()
      const body = JSON.parse(capturedBody!)
      expect(body.query).toContain('node(id: $projectId)')
      expect(body.variables.projectId).toBe('PVT_kwABC123')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns issues from node query response', async () => {
    const config = makeGitHubConfig({ project_id: 'PVT_kwABC123' })
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        node: {
          items: {
            nodes: [
              {
                id: 'PVTI_1',
                fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                content: { number: 5, title: 'Node ID Issue', body: null, url: null, labels: { nodes: [] } },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('PVTI_1')
      expect(result[0].identifier).toBe('#5')
      expect(result[0].title).toBe('Node ID Issue')
      expect(result[0].state).toBe('In Progress')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('validateConfig accepts project_id without owner/project_number', () => {
    const config = buildConfig({
      config: { tracker: { kind: 'github_projects', api_key: 'ghtoken', project_id: 'PVT_kwABC123' } },
      prompt_template: '',
    })
    expect(validateConfig(config)).toBeNull()
  })

  test('validateConfig requires owner when project_id is absent', () => {
    const config = buildConfig({
      config: { tracker: { kind: 'github_projects', api_key: 'ghtoken' } },
      prompt_template: '',
    })
    expect((validateConfig(config) as { code: string } | null)?.code).toBe('missing_tracker_project_config')
  })
})

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
  test('uses GraphQL [ID!]! typing in state refresh query (Section 17.3)', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    let capturedBody: string | null = null
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedBody = typeof init?.body === 'string' ? init.body : null
      return new Response(JSON.stringify({ data: { nodes: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    try {
      await adapter.fetchIssueStatesByIds(['PVTI_test'])
      expect(capturedBody).not.toBeNull()
      const body = JSON.parse(capturedBody!)
      expect(body.query).toContain('[ID!]')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns normalized minimal issue with state from GraphQL nodes response', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
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
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

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
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({ message: 'Unauthorized' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

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

  test('returns github_projects_graphql_errors on 200 with errors array', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      errors: [{ message: 'Could not resolve to a node' }],
      data: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['bad-id'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('github_projects_graphql_errors')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('asana blockers normalization', () => {
  test('normalizes dependencies as blocked_by entries', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const mockSectionsResponse = {
      ok: true,
      json: async () => ({ data: [{ gid: 'sec1', name: 'Todo' }] }),
    }
    const mockTasksResponse = {
      ok: true,
      json: async () => ({
        data: [
          {
            gid: 'task1',
            name: 'Blocked Task',
            notes: null,
            tags: [],
            dependencies: [{ gid: 'dep1' }, { gid: 'dep2' }],
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
      expect(result[0].blocked_by).toHaveLength(2)
      expect(result[0].blocked_by[0].id).toBe('dep1')
      expect(result[0].blocked_by[1].id).toBe('dep2')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('tracker malformed payload errors (Section 17.3)', () => {
  test('asana: returns asana_unknown_payload when sections response is not an array', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ data: 'not-an-array' }), // malformed
    })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('asana_unknown_payload')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github_projects: returns github_projects_unknown_payload when nodes is not an array', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(
      JSON.stringify({ data: { nodes: 'not-an-array' } }), // malformed
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['PVTI_abc'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('github_projects_unknown_payload')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('tracker transport and malformed payload errors (Section 17.3)', () => {
  test('asana: returns asana_api_request error when fetch throws', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('network failure')
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['task-1'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('asana_api_request')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github_projects: returns github_projects_api_request error when fetch throws', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('network failure')
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['PVTI_abc'])
      expect(Array.isArray(result)).toBe(false)
      if (Array.isArray(result))
        return
      expect((result as { code: string }).code).toBe('github_projects_api_request')
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

describe('github_projects label normalization (Section 17.3)', () => {
  test('normalizes issue labels to lowercase', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                  content: {
                    number: 1,
                    title: 'Labeled Issue',
                    body: null,
                    url: null,
                    labels: { nodes: [{ name: 'BUG' }, { name: 'High-Priority' }] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

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

describe('github_projects pull_requests normalization', () => {
  test('normalizes closedByPullRequestsReferences into pull_requests', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                  content: {
                    number: 10,
                    title: 'Issue with PRs',
                    body: null,
                    url: 'https://github.com/org/repo/issues/10',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    closedByPullRequestsReferences: {
                      nodes: [
                        { number: 42, title: 'Fix it', url: 'https://github.com/org/repo/pull/42', state: 'MERGED', headRefName: 'fix/issue-10' },
                        { number: 43, title: 'Alt fix', url: null, state: 'OPEN', headRefName: null },
                      ],
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      const issue = result[0]
      expect(issue.pull_requests).toHaveLength(2)
      expect(issue.pull_requests[0].number).toBe(42)
      expect(issue.pull_requests[0].title).toBe('Fix it')
      expect(issue.pull_requests[0].url).toBe('https://github.com/org/repo/pull/42')
      expect(issue.pull_requests[0].state).toBe('merged')
      expect(issue.pull_requests[0].branch_name).toBe('fix/issue-10')
      expect(issue.pull_requests[1].number).toBe(43)
      expect(issue.pull_requests[1].state).toBe('open')
      expect(issue.pull_requests[1].branch_name).toBeNull()
      expect(issue.pull_requests[1].url).toBeNull()
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('populates branch_name from PullRequest headRefName', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_2',
                  fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                  content: {
                    number: 55,
                    title: 'A pull request',
                    body: null,
                    url: 'https://github.com/org/repo/pull/55',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    headRefName: 'feature/my-branch',
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].branch_name).toBe('feature/my-branch')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns null branch_name when PullRequest headRefName is null', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_3',
                  fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                  content: {
                    number: 66,
                    title: 'A pull request without branch',
                    body: null,
                    url: 'https://github.com/org/repo/pull/66',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    headRefName: null,
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].branch_name).toBeNull()
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('skips null entries in closedByPullRequestsReferences nodes', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_null_test',
                  fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                  content: {
                    number: 20,
                    title: 'Issue with mixed PR nodes',
                    body: null,
                    url: 'https://github.com/org/repo/issues/20',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    closedByPullRequestsReferences: {
                      nodes: [
                        null,
                        { number: 77, title: 'Valid PR', url: 'https://github.com/org/repo/pull/77', state: 'OPEN', headRefName: 'fix/20' },
                      ],
                    },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].pull_requests).toHaveLength(1)
      expect(result[0].pull_requests[0].number).toBe(77)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('returns empty pull_requests when field absent (ITEMS_BY_IDS_QUERY path)', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        nodes: [
          {
            id: 'PVTI_abc',
            fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
            content: { number: 42, title: 'Test Issue' },
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssueStatesByIds(['PVTI_abc'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].pull_requests).toEqual([])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('asana pull_requests field', () => {
  test('always returns empty pull_requests array', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/')) {
        return { ok: true, json: async () => ({ data: [{ gid: 'sec1', name: 'Todo' }] }) } as unknown as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ gid: 'task1', name: 'Task', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null }],
          next_page: null,
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].pull_requests).toEqual([])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('asana assignee extraction', () => {
  test('extracts assignee email from task response', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/')) {
        return { ok: true, json: async () => ({ data: [{ gid: 'sec1', name: 'Todo' }] }) } as unknown as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              gid: 'task1',
              name: 'Assigned Task',
              notes: null,
              tags: [],
              dependencies: [],
              created_at: null,
              modified_at: null,
              assignee: { email: 'alice@example.com' },
            },
          ],
          next_page: null,
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].assignees).toEqual(['alice@example.com'])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('sets assignee to null when task has no assignee', async () => {
    const config = makeAsanaConfig()
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/')) {
        return { ok: true, json: async () => ({ data: [{ gid: 'sec1', name: 'Todo' }] }) } as unknown as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { gid: 'task1', name: 'Unassigned Task', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null, assignee: null },
          ],
          next_page: null,
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].assignees).toEqual([])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('github_projects assignee extraction', () => {
  test('extracts first assignee login from GraphQL response', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                  content: {
                    number: 1,
                    title: 'Assigned Issue',
                    body: null,
                    url: null,
                    labels: { nodes: [] },
                    assignees: { nodes: [{ login: 'bob' }] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].assignees).toEqual(['bob'])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('sets assignee to null when issue has no assignees', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                  content: {
                    number: 1,
                    title: 'Unassigned Issue',
                    body: null,
                    url: null,
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchIssuesByStates(['Todo'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].assignees).toEqual([])
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('fetchCandidateIssues filter application', () => {
  test('asana: filters candidates by assignee when filter configured', async () => {
    const config = makeAsanaConfig({ filter: { assignee: 'alice@example.com' } })
    const adapter = createAsanaAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const urlStr = String(url)
      if (urlStr.includes('/projects/')) {
        return { ok: true, json: async () => ({ data: [{ gid: 'sec1', name: 'To Do' }] }) } as unknown as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { gid: 'task1', name: 'Matching', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null, assignee: { email: 'alice@example.com' } },
            { gid: 'task2', name: 'Non-matching', notes: null, tags: [], dependencies: [], created_at: null, modified_at: null, assignee: { email: 'bob@example.com' } },
          ],
          next_page: null,
        }),
      } as unknown as Response
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].identifier).toBe('task1')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github_projects: passes label filter as server-side query string', async () => {
    const config = makeGitHubConfig({ filter: { label: 'bug' } })
    const adapter = createGitHubAdapter(config)

    let capturedVariables: Record<string, unknown> = {}
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      capturedVariables = (JSON.parse(String(options?.body ?? '{}')).variables ?? {}) as Record<string, unknown>
      return new Response(JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              items: {
                nodes: [
                  {
                    id: 'PVTI_1',
                    fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                    content: { number: 1, title: 'Bug Issue', body: null, url: null, labels: { nodes: [{ name: 'bug' }] }, assignees: { nodes: [] } },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(capturedVariables.search).toBe('label:bug')
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(1)
      expect(result[0].identifier).toBe('#1')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('github_projects: passes multi-assignee filter as OR query string', async () => {
    const config = makeGitHubConfig({ filter: { assignee: 'alice,bob' } })
    const adapter = createGitHubAdapter(config)

    let capturedVariables: Record<string, unknown> = {}
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string | URL | Request, options?: RequestInit) => {
      capturedVariables = (JSON.parse(String(options?.body ?? '{}')).variables ?? {}) as Record<string, unknown>
      return new Response(JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              items: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      await adapter.fetchCandidateIssues()
      expect(capturedVariables.search).toBe('assignee:alice,bob')
    }
    finally {
      globalThis.fetch = origFetch
    }
  })

  test('no filter: all candidates returned (backward-compatible)', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)

    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_1',
                  fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                  content: { number: 1, title: 'Issue One', body: null, url: null, labels: { nodes: [] }, assignees: { nodes: [] } },
                },
                {
                  id: 'PVTI_2',
                  fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
                  content: { number: 2, title: 'Issue Two', body: null, url: null, labels: { nodes: [] }, assignees: { nodes: [] } },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

    try {
      const result = await adapter.fetchCandidateIssues()
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result).toHaveLength(2)
    }
    finally {
      globalThis.fetch = origFetch
    }
  })
})

describe('github_projects review_decision normalization', () => {
  function makePrResponse(reviewDecision: unknown) {
    return new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_RD',
                  fieldValues: { nodes: [{ name: 'In Review', field: { name: 'Status' } }] },
                  content: {
                    number: 77,
                    title: 'A PR with review',
                    body: null,
                    url: 'https://github.com/org/repo/pull/77',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    headRefName: 'feature/rd',
                    reviewDecision,
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  test('maps CHANGES_REQUESTED to changes_requested', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => makePrResponse('CHANGES_REQUESTED')) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Review'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBe('changes_requested')
    }
    finally { globalThis.fetch = origFetch }
  })

  test('maps APPROVED to approved', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => makePrResponse('APPROVED')) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Review'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBe('approved')
    }
    finally { globalThis.fetch = origFetch }
  })

  test('maps COMMENTED to commented', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => makePrResponse('COMMENTED')) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Review'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBe('commented')
    }
    finally { globalThis.fetch = origFetch }
  })

  test('maps REVIEW_REQUIRED to review_required', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => makePrResponse('REVIEW_REQUIRED')) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Review'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBe('review_required')
    }
    finally { globalThis.fetch = origFetch }
  })

  test('maps null reviewDecision to null', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => makePrResponse(null)) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Review'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBeNull()
    }
    finally { globalThis.fetch = origFetch }
  })

  test('maps missing reviewDecision to null for Issue content', async () => {
    const config = makeGitHubConfig()
    const adapter = createGitHubAdapter(config)
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      data: {
        repositoryOwner: {
          projectV2: {
            items: {
              nodes: [
                {
                  id: 'PVTI_ISS',
                  fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] },
                  content: {
                    number: 88,
                    title: 'A regular issue',
                    body: null,
                    url: 'https://github.com/org/repo/issues/88',
                    labels: { nodes: [] },
                    assignees: { nodes: [] },
                    createdAt: null,
                    updatedAt: null,
                    closedByPullRequestsReferences: { nodes: [] },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    try {
      const result = await adapter.fetchIssuesByStates(['In Progress'])
      expect(Array.isArray(result)).toBe(true)
      if (!Array.isArray(result))
        return
      expect(result[0].review_decision).toBeNull()
    }
    finally { globalThis.fetch = origFetch }
  })
})
