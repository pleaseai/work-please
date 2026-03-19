import type { Client } from '@libsql/client'
import type { AgentRunRecord, AgentRunStatus, DbConfig } from './types'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { createLogger } from './logger'

const log = createLogger('db')

const CREATE_AGENT_RUNS_TABLE = `
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  issue_state TEXT NOT NULL,
  session_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  retry_attempt INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0
)`

const CREATE_AGENT_RUNS_IDX = `CREATE INDEX IF NOT EXISTS idx_agent_runs_identifier ON agent_runs(identifier)`

export function resolveDbPath(dbPath: string, workspaceRoot: string): string | null {
  const resolved = resolve(workspaceRoot, dbPath)
  const normalizedRoot = resolve(workspaceRoot)
  if (!resolved.startsWith(`${normalizedRoot}/`) && resolved !== normalizedRoot) {
    log.warn(`db path traversal blocked: ${dbPath} resolves outside workspace root`)
    return null
  }
  return resolved
}

export function createDbClient(config: DbConfig, workspaceRoot: string): Client | null {
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
      const client = createClient({
        url: config.turso_url,
        authToken: config.turso_auth_token ?? undefined,
      })
      const hostname = new URL(config.turso_url).hostname
      log.info(`db connected to turso: ${hostname}`)
      return client
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
    const client = createClient({ url: `file:${dbFilePath}` })
    log.info(`db opened: ${dbFilePath}`)
    return client
  }
  catch (err) {
    log.error(`db connection failed: ${err}`)
    return null
  }
}

export async function runMigrations(client: Client): Promise<boolean> {
  try {
    await client.migrate([CREATE_AGENT_RUNS_TABLE, CREATE_AGENT_RUNS_IDX])
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

export async function insertRun(client: Client | null, params: InsertRunParams): Promise<void> {
  if (!client)
    return
  try {
    await client.execute({
      sql: `INSERT INTO agent_runs (issue_id, identifier, issue_state, session_id, started_at, finished_at, duration_ms, status, error, turn_count, retry_attempt, input_tokens, output_tokens, total_tokens)
            VALUES (:issue_id, :identifier, :issue_state, :session_id, :started_at, :finished_at, :duration_ms, :status, :error, :turn_count, :retry_attempt, :input_tokens, :output_tokens, :total_tokens)`,
      args: {
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
      },
    })
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

export async function queryRuns(client: Client | null, options: QueryRunsOptions = {}): Promise<AgentRunRecord[]> {
  if (!client)
    return []

  const conditions: string[] = []
  const args: Record<string, unknown> = {}

  if (options.identifier) {
    conditions.push('identifier = :identifier')
    args.identifier = options.identifier
  }
  if (options.status) {
    conditions.push('status = :status')
    args.status = options.status
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0

  try {
    const rs = await client.execute({
      sql: `SELECT id, issue_id, identifier, issue_state, session_id, started_at, finished_at, duration_ms, status, error, turn_count, retry_attempt, input_tokens, output_tokens, total_tokens FROM agent_runs ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`,
      args: { ...args, limit, offset },
    })

    return rs.rows.map((row) => {
      const rawStatus = row.status as string
      let status: AgentRunStatus
      if (VALID_STATUSES.has(rawStatus)) {
        status = rawStatus as AgentRunStatus
      }
      else {
        log.warn(`db: unexpected status value "${rawStatus}", defaulting to "failure"`)
        status = 'failure'
      }
      return {
        id: row.id as number,
        issue_id: row.issue_id as string,
        identifier: row.identifier as string,
        issue_state: row.issue_state as string,
        session_id: row.session_id as string | null,
        started_at: row.started_at as string,
        finished_at: row.finished_at as string,
        duration_ms: row.duration_ms as number,
        status,
        error: row.error as string | null,
        turn_count: row.turn_count as number,
        retry_attempt: row.retry_attempt as number | null,
        input_tokens: row.input_tokens as number,
        output_tokens: row.output_tokens as number,
        total_tokens: row.total_tokens as number,
      }
    })
  }
  catch (err) {
    log.error(`db query failed: ${err}`, err)
    return []
  }
}
