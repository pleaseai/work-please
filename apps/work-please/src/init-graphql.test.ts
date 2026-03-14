import { describe, expect, it, mock } from 'bun:test'
import {
  configureStatusField,
  createProject,
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
