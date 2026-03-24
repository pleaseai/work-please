import type { AppDatabase } from './db-types'
import type { AgentRunRecord, AgentRunStatus, DbConfig } from './types'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { Kysely, Migrator } from 'kysely'
import * as migration001 from './migrations/001_create_agent_runs'
import { createLogger } from './logger'

const log = createLogger('db')

export function resolveDbPath(dbPath: string, workspaceRoot: string): string | null {
  const resolved = resolve(workspaceRoot, dbPath)
  const normalizedRoot = resolve(workspaceRoot)
  if (!resolved.startsWith(`${normalizedRoot}/`) && resolved !== normalizedRoot) {
    log.warn(`db path traversal blocked: ${dbPath} resolves outside workspace root`)
    return null
  }
  return resolved
}

export function createKyselyDb(config: DbConfig, workspaceRoot: string): Kysely<AppDatabase> | null {
  if (config.turso_url) {
    const allowedSchemes = ['libsql:', 'libsqls:', 'https:']
    let scheme: string
    try {
      scheme = new URL(config.turso_url).protocol
    }
    catch {
      log.error(`db connection failed: invalid turso_url`)
      return null
    }
    if (!allowedSchemes.includes(scheme)) {
      log.error(`db connection failed: unsupported turso_url scheme "${scheme}"`)
      return null
    }
    try {
      const dialect = new LibsqlDialect({
        url: config.turso_url,
        authToken: config.turso_auth_token ?? undefined,
      })
      const hostname = new URL(config.turso_url).hostname
      log.info(`db connected to turso: ${hostname}`)
      return new Kysely<AppDatabase>({ dialect })
    }
    catch (err) {
      log.error(`db connection failed: ${err}`)
      return null
    }
  }

  const dbFilePath = resolveDbPath(config.path, workspaceRoot)
  if (!dbFilePath)
    return null

  try {
    mkdirSync(dirname(dbFilePath), { recursive: true })
  }
  catch (err) {
    log.error(`db directory creation failed: ${err}`)
    return null
  }

  try {
    const dialect = new LibsqlDialect({ url: `file:${dbFilePath}` })
    log.info(`db opened: ${dbFilePath}`)
    return new Kysely<AppDatabase>({ dialect })
  }
  catch (err) {
    log.error(`db connection failed: ${err}`)
    return null
  }
}

export async function runMigrations(db: Kysely<AppDatabase>): Promise<boolean> {
  try {
    const migrator = new Migrator({
      db,
      provider: {
        getMigrations() {
          return Promise.resolve({
            '001_create_agent_runs': migration001,
          })
        },
      },
    })
    const { error } = await migrator.migrateToLatest()
    if (error) {
      log.warn(`db migration failed: ${error}`)
      return false
    }
    log.info('db migrations complete')
    return true
  }
  catch (err) {
    log.warn(`db migration failed: ${err}`)
    return false
  }
}

export interface InsertRunParams {
  issue_id: string
  identifier: string
  issue_state: string
  session_id: string | null
  started_at: Date
  finished_at: Date
  duration_ms: number
  status: AgentRunStatus
  error: string | null
  turn_count: number
  retry_attempt: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export async function insertRun(db: Kysely<AppDatabase> | null, params: InsertRunParams): Promise<void> {
  if (!db)
    return
  try {
    await db.insertInto('agent_runs').values({
      issue_id: params.issue_id,
      identifier: params.identifier,
      issue_state: params.issue_state,
      session_id: params.session_id,
      started_at: params.started_at.toISOString(),
      finished_at: params.finished_at.toISOString(),
      duration_ms: params.duration_ms,
      status: params.status,
      error: params.error,
      turn_count: params.turn_count,
      retry_attempt: params.retry_attempt,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      total_tokens: params.total_tokens,
    }).execute()
  }
  catch (err) {
    log.error(`db insert failed: ${err}`, err)
  }
}

export interface QueryRunsOptions {
  identifier?: string
  status?: AgentRunStatus
  limit?: number
  offset?: number
}

const VALID_STATUSES = new Set<string>(['success', 'failure', 'terminated'])

export async function queryRuns(db: Kysely<AppDatabase> | null, options: QueryRunsOptions = {}): Promise<AgentRunRecord[]> {
  if (!db)
    return []

  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  try {
    let query = db.selectFrom('agent_runs').selectAll()

    if (options.identifier) {
      query = query.where('identifier', '=', options.identifier)
    }
    if (options.status) {
      query = query.where('status', '=', options.status)
    }

    const rows = await query.orderBy('id', 'desc').limit(limit).offset(offset).execute()

    return rows.map((row) => {
      const rawStatus = row.status
      let status: AgentRunStatus
      if (VALID_STATUSES.has(rawStatus)) {
        status = rawStatus as AgentRunStatus
      }
      else {
        log.warn(`db: unexpected status value "${rawStatus}", defaulting to "failure"`)
        status = 'failure'
      }
      return {
        id: row.id,
        issue_id: row.issue_id,
        identifier: row.identifier,
        issue_state: row.issue_state,
        session_id: row.session_id,
        started_at: row.started_at,
        finished_at: row.finished_at,
        duration_ms: row.duration_ms,
        status,
        error: row.error,
        turn_count: row.turn_count,
        retry_attempt: row.retry_attempt,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        total_tokens: row.total_tokens,
      }
    })
  }
  catch (err) {
    log.error(`db query failed: ${err}`, err)
    return []
  }
}
