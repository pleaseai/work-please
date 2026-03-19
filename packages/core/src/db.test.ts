import type { InsertRunParams } from './db'
import type { DbConfig } from './types'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createDbClient, insertRun, queryRuns, resolveDbPath, runMigrations } from './db'

function makeDbConfig(overrides: Partial<DbConfig> = {}): DbConfig {
  return {
    path: '.work-please/agent_runs.db',
    turso_url: null,
    turso_auth_token: null,
    ...overrides,
  }
}

function makeInsertParams(overrides: Partial<InsertRunParams> = {}): InsertRunParams {
  return {
    issue_id: 'issue-1',
    identifier: 'TEST-1',
    issue_state: 'In Progress',
    session_id: 'sess-abc',
    started_at: new Date('2026-03-17T10:00:00Z'),
    finished_at: new Date('2026-03-17T10:05:00Z'),
    duration_ms: 300_000,
    status: 'success',
    error: null,
    turn_count: 3,
    retry_attempt: null,
    input_tokens: 1000,
    output_tokens: 500,
    total_tokens: 1500,
    ...overrides,
  }
}

describe('resolveDbPath', () => {
  it('resolves a relative path under workspace root', () => {
    const result = resolveDbPath('.work-please/runs.db', '/tmp/ws')
    expect(result).toBe('/tmp/ws/.work-please/runs.db')
  })

  it('blocks path traversal', () => {
    const result = resolveDbPath('../../etc/passwd', '/tmp/ws')
    expect(result).toBeNull()
  })

  it('allows absolute path under workspace root', () => {
    const result = resolveDbPath('/tmp/ws/data/runs.db', '/tmp/ws')
    expect(result).toBe('/tmp/ws/data/runs.db')
  })

  it('blocks absolute path outside workspace root', () => {
    const result = resolveDbPath('/other/runs.db', '/tmp/ws')
    expect(result).toBeNull()
  })
})

describe('createDbClient', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'db-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates embedded client with auto-created directory', () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)
    expect(client).not.toBeNull()
    expect(existsSync(join(tmpRoot, '.work-please'))).toBe(true)
    client?.close()
  })

  it('returns null for path traversal', () => {
    const client = createDbClient(makeDbConfig({ path: '../../etc/evil.db' }), tmpRoot)
    expect(client).toBeNull()
  })

  it('returns null for invalid turso URL', () => {
    const client = createDbClient(makeDbConfig({ turso_url: 'not-a-valid-url' }), tmpRoot)
    expect(client).toBeNull()
    if (client)
      client.close()
  })
})

describe('runMigrations', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'db-migrate-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates agent_runs table', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    const ok = await runMigrations(client)
    expect(ok).toBe(true)

    const rs = await client.execute('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'agent_runs\'')
    expect(rs.rows).toHaveLength(1)
    client.close()
  })

  it('is idempotent', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)
    const ok = await runMigrations(client)
    expect(ok).toBe(true)
    client.close()
  })
})

describe('insertRun', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'db-insert-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('inserts a run record', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)

    await insertRun(client, makeInsertParams())

    const rs = await client.execute('SELECT * FROM agent_runs')
    expect(rs.rows).toHaveLength(1)
    expect(rs.rows[0].identifier).toBe('TEST-1')
    expect(rs.rows[0].status).toBe('success')
    expect(rs.rows[0].input_tokens).toBe(1000)
    client.close()
  })

  it('does nothing when client is null', async () => {
    await insertRun(null, makeInsertParams())
    // no throw
  })

  it('handles failure status with error message', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)

    await insertRun(client, makeInsertParams({
      status: 'failure',
      error: 'agent crashed',
    }))

    const rs = await client.execute('SELECT status, error FROM agent_runs')
    expect(rs.rows[0].status).toBe('failure')
    expect(rs.rows[0].error).toBe('agent crashed')
    client.close()
  })
})

describe('queryRuns', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'db-query-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  async function seedRuns(client: NonNullable<ReturnType<typeof createDbClient>>) {
    await insertRun(client, makeInsertParams({ issue_id: 'i1', identifier: 'A-1', status: 'success' }))
    await insertRun(client, makeInsertParams({ issue_id: 'i2', identifier: 'A-2', status: 'failure', error: 'err' }))
    await insertRun(client, makeInsertParams({ issue_id: 'i3', identifier: 'A-1', status: 'terminated' }))
  }

  it('returns all runs when no filters', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)
    await seedRuns(client)

    const runs = await queryRuns(client)
    expect(runs).toHaveLength(3)
    // ordered by id DESC
    expect(runs[0].identifier).toBe('A-1')
    expect(runs[0].status).toBe('terminated')
    client.close()
  })

  it('filters by identifier', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)
    await seedRuns(client)

    const runs = await queryRuns(client, { identifier: 'A-1' })
    expect(runs).toHaveLength(2)
    expect(runs.every(r => r.identifier === 'A-1')).toBe(true)
    client.close()
  })

  it('filters by status', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)
    await seedRuns(client)

    const runs = await queryRuns(client, { status: 'failure' })
    expect(runs).toHaveLength(1)
    expect(runs[0].error).toBe('err')
    client.close()
  })

  it('respects limit and offset', async () => {
    const client = createDbClient(makeDbConfig(), tmpRoot)!
    await runMigrations(client)
    await seedRuns(client)

    const page1 = await queryRuns(client, { limit: 2, offset: 0 })
    expect(page1).toHaveLength(2)

    const page2 = await queryRuns(client, { limit: 2, offset: 2 })
    expect(page2).toHaveLength(1)
    client.close()
  })

  it('returns empty array when client is null', async () => {
    const runs = await queryRuns(null)
    expect(runs).toEqual([])
  })
})
