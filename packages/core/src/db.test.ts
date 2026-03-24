import type { Kysely } from 'kysely'
import type { InsertRunParams } from './db'
import type { AppDatabase } from './db-types'
import type { DbConfig } from './types'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sql } from 'kysely'
import { createKyselyDb, insertRun, queryRuns, resolveDbPath, runMigrations } from './db'

function makeDbConfig(overrides: Partial<DbConfig> = {}): DbConfig {
  return {
    path: '.agent-please/agent_runs.db',
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
    const result = resolveDbPath('.agent-please/runs.db', '/tmp/ws')
    expect(result).toBe('/tmp/ws/.agent-please/runs.db')
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

describe('createKyselyDb', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'db-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates embedded client with auto-created directory', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)
    expect(db).not.toBeNull()
    expect(existsSync(join(tmpRoot, '.agent-please'))).toBe(true)
    await db?.destroy()
  })

  it('returns null for path traversal', () => {
    const db = createKyselyDb(makeDbConfig({ path: '../../etc/evil.db' }), tmpRoot)
    expect(db).toBeNull()
  })

  it('returns null for invalid turso URL', async () => {
    const db = createKyselyDb(makeDbConfig({ turso_url: 'not-a-valid-url' }), tmpRoot)
    expect(db).toBeNull()
    if (db)
      await db.destroy()
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
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    const ok = await runMigrations(db)
    expect(ok).toBe(true)

    const result = await sql<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'`.execute(db)
    expect(result.rows).toHaveLength(1)
    await db.destroy()
  })

  it('returns false when migration fails on destroyed connection', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await db.destroy()
    const ok = await runMigrations(db)
    expect(ok).toBe(false)
  })

  it('is idempotent', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)
    const ok = await runMigrations(db)
    expect(ok).toBe(true)
    await db.destroy()
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
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)

    await insertRun(db, makeInsertParams())

    const rows = await db.selectFrom('agent_runs').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].identifier).toBe('TEST-1')
    expect(rows[0].status).toBe('success')
    expect(rows[0].input_tokens).toBe(1000)
    await db.destroy()
  })

  it('does nothing when client is null', async () => {
    await insertRun(null, makeInsertParams())
    // no throw
  })

  it('handles failure status with error message', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)

    await insertRun(db, makeInsertParams({
      status: 'failure',
      error: 'agent crashed',
    }))

    const rows = await db.selectFrom('agent_runs').select(['status', 'error']).execute()
    expect(rows[0].status).toBe('failure')
    expect(rows[0].error).toBe('agent crashed')
    await db.destroy()
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

  async function seedRuns(db: Kysely<AppDatabase>) {
    await insertRun(db, makeInsertParams({ issue_id: 'i1', identifier: 'A-1', status: 'success' }))
    await insertRun(db, makeInsertParams({ issue_id: 'i2', identifier: 'A-2', status: 'failure', error: 'err' }))
    await insertRun(db, makeInsertParams({ issue_id: 'i3', identifier: 'A-1', status: 'terminated' }))
  }

  it('returns all runs when no filters', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)
    await seedRuns(db)

    const runs = await queryRuns(db)
    expect(runs).toHaveLength(3)
    // ordered by id DESC
    expect(runs[0].identifier).toBe('A-1')
    expect(runs[0].status).toBe('terminated')
    await db.destroy()
  })

  it('filters by identifier', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)
    await seedRuns(db)

    const runs = await queryRuns(db, { identifier: 'A-1' })
    expect(runs).toHaveLength(2)
    expect(runs.every(r => r.identifier === 'A-1')).toBe(true)
    await db.destroy()
  })

  it('filters by status', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)
    await seedRuns(db)

    const runs = await queryRuns(db, { status: 'failure' })
    expect(runs).toHaveLength(1)
    expect(runs[0].error).toBe('err')
    await db.destroy()
  })

  it('respects limit and offset', async () => {
    const db = createKyselyDb(makeDbConfig(), tmpRoot)!
    await runMigrations(db)
    await seedRuns(db)

    const page1 = await queryRuns(db, { limit: 2, offset: 0 })
    expect(page1).toHaveLength(2)

    const page2 = await queryRuns(db, { limit: 2, offset: 2 })
    expect(page2).toHaveLength(1)
    await db.destroy()
  })

  it('returns empty array when client is null', async () => {
    const runs = await queryRuns(null)
    expect(runs).toEqual([])
  })
})
