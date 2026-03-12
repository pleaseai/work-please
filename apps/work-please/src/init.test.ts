import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  configureStatusField,
  createProject,
  generateWorkflow,
  initProject,
  isInitError,
  resolveOwnerId,
} from './init'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mockResponse(_ok: boolean, body: unknown, status = _ok ? 200 : 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// isInitError
// ---------------------------------------------------------------------------

describe('isInitError', () => {
  it('returns true for objects with code property', () => {
    expect(isInitError({ code: 'init_missing_owner' })).toBe(true)
    expect(isInitError({ code: 'init_network_error', cause: new Error('test') })).toBe(true)
  })

  it('returns false for non-error values', () => {
    expect(isInitError(null)).toBe(false)
    expect(isInitError('string')).toBe(false)
    expect(isInitError({ projectId: 'abc' })).toBe(false)
    expect(isInitError(42)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// generateWorkflow
// ---------------------------------------------------------------------------

describe('generateWorkflow', () => {
  it('includes the owner in the tracker config', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('owner: "myorg"')
  })

  it('includes the project_number in the tracker config', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('project_number: 42')
  })

  it('sets tracker kind to github_projects', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('kind: github_projects')
  })

  it('references $GITHUB_TOKEN for api_key', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('api_key: $GITHUB_TOKEN')
  })

  it('includes standard active_states', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('- Todo')
    expect(content).toContain('- In Progress')
  })

  it('includes standard terminal_states', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('- Done')
    expect(content).toContain('- Cancelled')
  })

  it('includes a Liquid prompt template', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('{{ issue.identifier | escape }}')
    expect(content).toContain('{{ issue.title | escape }}')
  })

  it('escapes all dynamic fields inside issue-data and blocker-data to prevent XML tag injection', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('{{ issue.title | escape }}')
    expect(content).toContain('{{ issue.description | escape }}')
    expect(content).toContain('{{ blocker.identifier | escape }}')
    expect(content).toContain('{{ blocker.title | escape }}')
    expect(content).toContain('{{ blocker.state | escape }}')
    // bare unescaped variables must not appear inside the data boundary
    expect(content).not.toContain('{{ issue.title }}')
    expect(content).not.toContain('{{ issue.description }}')
    expect(content).not.toContain('{{ blocker.title }}')
  })

  it('starts with YAML front matter delimiter', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content.startsWith('---\n')).toBe(true)
  })

  it('includes the owner in the after_create hook git clone command', () => {
    const content = generateWorkflow('acme', 7)
    expect(content).toContain('https://github.com/acme/<repo>')
  })

  it('produces different content for different owners', () => {
    const a = generateWorkflow('orgA', 1)
    const b = generateWorkflow('orgB', 1)
    expect(a).not.toBe(b)
  })

  it('produces different content for different project numbers', () => {
    const a = generateWorkflow('myorg', 1)
    const b = generateWorkflow('myorg', 99)
    expect(a).not.toBe(b)
  })

  it('includes "In Review" instruction in PR step', () => {
    const content = generateWorkflow('myorg', 42)
    expect(content).toContain('In Review')
  })
})

// ---------------------------------------------------------------------------
// configureStatusField
// ---------------------------------------------------------------------------

describe('configureStatusField', () => {
  it('returns true on success', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1) {
        return mockResponse(true, { data: { node: { field: { id: 'FIELD_1' } } } })
      }
      return mockResponse(true, { data: { updateProjectV2Field: { projectV2Field: { id: 'FIELD_1' } } } })
    }) as unknown as typeof fetch
    try {
      const result = await configureStatusField('tok', 'PVT_1', 'http://localhost')
      expect(result).toBe(true)
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns error when status field not found', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { node: { field: null } } }),
    ) as unknown as typeof fetch
    try {
      const result = await configureStatusField('tok', 'PVT_1', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns error when update mutation fails with GraphQL errors', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1) {
        return mockResponse(true, { data: { node: { field: { id: 'FIELD_1' } } } })
      }
      return mockResponse(true, { errors: [{ message: 'Cannot update field' }] })
    }) as unknown as typeof fetch
    try {
      const result = await configureStatusField('tok', 'PVT_1', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_graphql_errors')
    }
    finally { globalThis.fetch = origFetch }
  })
})

// ---------------------------------------------------------------------------
// resolveOwnerId
// ---------------------------------------------------------------------------

describe('resolveOwnerId', () => {
  it('returns the owner id for an organization login', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { repositoryOwner: { id: 'O_org123' } } }),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'myorg', 'http://localhost')
      expect(result).toBe('O_org123')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns the owner id for a user login', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { repositoryOwner: { id: 'U_user456' } } }),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'myuser', 'http://localhost')
      expect(result).toBe('U_user456')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_owner_not_found when repositoryOwner is null', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { repositoryOwner: null } }),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'nobody', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_owner_not_found')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_owner_not_found when data has no repositoryOwner field', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: {} }),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'nobody', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_owner_not_found')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_create_failed on non-ok HTTP response', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(false, { message: 'Unauthorized' }, 401),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('bad_token', 'myorg', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_graphql_errors when response contains errors', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { errors: [{ message: 'Not found' }] }),
    ) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'myorg', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_graphql_errors')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_network_error on fetch exception', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    try {
      const result = await resolveOwnerId('tok', 'myorg', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_network_error')
    }
    finally { globalThis.fetch = origFetch }
  })
})

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe('createProject', () => {
  it('returns projectId and projectNumber on success', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, {
        data: { createProjectV2: { projectV2: { id: 'PVT_proj789', number: 5 } } },
      }),
    ) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(false)
      if (!isInitError(result)) {
        expect(result.projectId).toBe('PVT_proj789')
        expect(result.projectNumber).toBe(5)
      }
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_create_failed when projectV2 fields are missing', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { createProjectV2: { projectV2: {} } } }),
    ) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_create_failed when createProjectV2 is null', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { createProjectV2: null } }),
    ) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_create_failed on non-ok HTTP response', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(false, { message: 'Forbidden' }, 403),
    ) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_graphql_errors when response contains errors', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { errors: [{ message: 'Insufficient permissions' }] }),
    ) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_graphql_errors')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_network_error on fetch exception', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () => {
      throw new Error('timeout')
    }) as unknown as typeof fetch
    try {
      const result = await createProject('tok', 'O_org123', 'My Board', 'http://localhost')
      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_network_error')
    }
    finally { globalThis.fetch = origFetch }
  })
})

// ---------------------------------------------------------------------------
// initProject
// ---------------------------------------------------------------------------

describe('initProject', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(import.meta.dir, `../.tmp-init-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes WORKFLOW.md and returns result on success', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1) {
        return mockResponse(true, { data: { repositoryOwner: { id: 'O_org1' } } })
      }
      return mockResponse(true, { data: { createProjectV2: { projectV2: { id: 'PVT_1', number: 3 } } } })
    }) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'myorg', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(false)
      if (!isInitError(result)) {
        expect(result.projectNumber).toBe(3)
        expect(result.projectId).toBe('PVT_1')
        expect(result.owner).toBe('myorg')
      }

      const written = readFileSync(join(tmpDir, 'WORKFLOW.md'), 'utf-8')
      expect(written).toContain('owner: "myorg"')
      expect(written).toContain('project_number: 3')
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns init_workflow_exists when WORKFLOW.md already exists', async () => {
    const path = join(tmpDir, 'WORKFLOW.md')
    await Bun.write(path, 'existing content')

    const result = await initProject(
      { owner: 'myorg', title: 'My Board', token: 'tok' },
      'http://localhost',
      tmpDir,
    )

    expect(isInitError(result)).toBe(true)
    if (isInitError(result)) {
      expect(result.code).toBe('init_workflow_exists')
      if (result.code === 'init_workflow_exists')
        expect(result.path).toBe(resolve(tmpDir, 'WORKFLOW.md'))
    }
  })

  it('propagates resolveOwnerId error without writing file', async () => {
    const origFetch = globalThis.fetch
    globalThis.fetch = mock(async () =>
      mockResponse(true, { data: { organization: null, user: null } }),
    ) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'nobody', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_owner_not_found')

      const path = Bun.file(join(tmpDir, 'WORKFLOW.md'))
      expect(await path.exists()).toBe(false)
    }
    finally { globalThis.fetch = origFetch }
  })

  it('propagates createProject error without writing file', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1)
        return mockResponse(true, { data: { repositoryOwner: { id: 'O_org1' } } })
      return mockResponse(false, { message: 'Forbidden' }, 403)
    }) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'myorg', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(true)
      if (isInitError(result))
        expect(result.code).toBe('init_create_failed')

      const path = Bun.file(join(tmpDir, 'WORKFLOW.md'))
      expect(await path.exists()).toBe(false)
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns correct workflowPath in result', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1)
        return mockResponse(true, { data: { repositoryOwner: { id: 'O_org1' } } })
      return mockResponse(true, { data: { createProjectV2: { projectV2: { id: 'PVT_1', number: 7 } } } })
    }) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'myorg', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(false)
      if (!isInitError(result))
        expect(result.workflowPath).toBe(resolve(tmpDir, 'WORKFLOW.md'))
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns statusConfigured: true when all 4 API calls succeed', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1)
        return mockResponse(true, { data: { repositoryOwner: { id: 'O_org1' } } })
      if (callCount === 2)
        return mockResponse(true, { data: { createProjectV2: { projectV2: { id: 'PVT_1', number: 3 } } } })
      if (callCount === 3)
        return mockResponse(true, { data: { node: { field: { id: 'FIELD_1' } } } })
      return mockResponse(true, { data: { updateProjectV2Field: { projectV2Field: { id: 'FIELD_1' } } } })
    }) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'myorg', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(false)
      if (!isInitError(result)) {
        expect(result.statusConfigured).toBe(true)
        expect(result.projectNumber).toBe(3)
        expect(result.projectId).toBe('PVT_1')
      }
    }
    finally { globalThis.fetch = origFetch }
  })

  it('returns statusConfigured: false when status configuration fails (non-fatal)', async () => {
    const origFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = mock(async () => {
      callCount++
      if (callCount === 1)
        return mockResponse(true, { data: { repositoryOwner: { id: 'O_org1' } } })
      if (callCount === 2)
        return mockResponse(true, { data: { createProjectV2: { projectV2: { id: 'PVT_1', number: 3 } } } })
      return mockResponse(true, { data: { node: { field: null } } })
    }) as unknown as typeof fetch
    try {
      const result = await initProject(
        { owner: 'myorg', title: 'My Board', token: 'tok' },
        'http://localhost',
        tmpDir,
      )

      expect(isInitError(result)).toBe(false)
      if (!isInitError(result)) {
        expect(result.statusConfigured).toBe(false)
        expect(result.projectNumber).toBe(3)
      }

      const written = readFileSync(join(tmpDir, 'WORKFLOW.md'), 'utf-8')
      expect(written).toContain('owner: "myorg"')
    }
    finally { globalThis.fetch = origFetch }
  })
})
