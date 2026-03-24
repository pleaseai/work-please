import type { OrchestratorState, RetryEntry, RunningEntry, ServiceConfig } from './types'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { HttpServer } from './server'

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {

    platforms: {},
    projects: [],
    channels: [],
    polling: { mode: 'poll' as const, interval_ms: 30000 },
    workspace: { root: '/tmp/test_ws', branch_prefix: null },
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60000 },
    agent: { max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
    claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000, sandbox: null, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
    auth: { secret: null, github: { client_id: null, client_secret: null }, admin: { email: null, password: null } },
    commit_signing: { mode: 'none' as const, ssh_signing_key: null },
    env: {},
    db: { path: '.agent-please/agent_runs.db', turso_url: null, turso_auth_token: null },
    state: { adapter: 'memory' as const, url: null, key_prefix: 'chat-sdk', on_lock_conflict: 'drop' as const },
    server: { port: null, webhook: { secret: null, events: null } },
    ...overrides,
  }
}

function makeRunningEntry(overrides: Partial<RunningEntry> = {}): RunningEntry {
  return {
    identifier: 'TEST-1',
    issue: { id: 'issue-1', identifier: 'TEST-1', title: 'Test issue', description: null, priority: 1, state: 'In Progress', branch_name: null, url: null, assignees: [], labels: [], blocked_by: [], pull_requests: [], review_decision: null, created_at: null, updated_at: null, project: null },
    session_id: 'sess-1',
    agent_app_server_pid: null,
    last_agent_message: null,
    last_agent_event: 'turn_completed',
    last_agent_timestamp: new Date('2026-01-01T10:00:00Z'),
    agent_input_tokens: 100,
    agent_output_tokens: 50,
    agent_total_tokens: 150,
    last_reported_input_tokens: 100,
    last_reported_output_tokens: 50,
    last_reported_total_tokens: 150,
    turn_count: 3,
    retry_attempt: null,
    started_at: new Date('2026-01-01T09:00:00Z'),
    dispatch_lock: null,
    dispatch_lock_timer: null,
    ...overrides,
  }
}

function makeRetryEntry(overrides: Partial<RetryEntry> = {}): RetryEntry {
  return {
    issue_id: 'issue-2',
    identifier: 'TEST-2',
    attempt: 2,
    due_at_ms: Date.now() + 60000,
    timer_handle: null,
    error: 'turn_failed',
    ...overrides,
  }
}

function makeOrchestratorStub(state: Partial<OrchestratorState> = {}) {
  const fullState: OrchestratorState = {
    poll_interval_ms: 30000,
    max_concurrent_agents: 5,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    watched_last_dispatched: new Map(),
    agent_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
    agent_rate_limits: null,
    ...state,
  }

  return {
    getState: () => fullState,
    getConfig: () => makeConfig(),
    getDb: () => null,
    triggerRefresh: () => {},
  }
}

describe('HttpServer', () => {
  let server: HttpServer
  let baseUrl: string

  beforeEach(() => {
    const orchestrator = makeOrchestratorStub()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(() => {
    server.stop()
  })

  test('GET / returns HTML dashboard', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('<title>Agent Please</title>')
  })

  test('GET /api/v1/state returns empty state', async () => {
    const res = await fetch(`${baseUrl}/api/v1/state`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.counts).toEqual({ running: 0, retrying: 0 })
    expect(body.running).toEqual([])
    expect(body.retrying).toEqual([])
    expect(typeof body.generated_at).toBe('string')
  })

  test('GET /api/v1/state includes agent_totals and rate_limits fields (Section 13.5)', async () => {
    const orchestrator = makeOrchestratorStub({
      agent_totals: { input_tokens: 100, output_tokens: 50, total_tokens: 150, seconds_running: 30 },
      agent_rate_limits: { requests_per_minute: 60 },
    })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/state`)
    const body = await res.json() as Record<string, unknown>
    const totals = body.codex_totals as Record<string, unknown>
    expect(totals.total_tokens).toBe(150)
    expect(totals.seconds_running).toBe(30)
    expect((body.rate_limits as Record<string, unknown>).requests_per_minute).toBe(60)
  })

  test('GET /api/v1/state includes retrying entries', async () => {
    const retry_attempts = new Map([['issue-2', makeRetryEntry()]])
    const orchestrator = makeOrchestratorStub({ retry_attempts })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/state`)
    const body = await res.json() as { counts: Record<string, number>, retrying: Array<Record<string, unknown>> }
    expect(body.counts.retrying).toBe(1)
    expect(body.retrying).toHaveLength(1)
    expect(body.retrying[0].issue_identifier).toBe('TEST-2')
    expect(body.retrying[0].attempt).toBe(2)
    // Section 17.4: retry queue entries include attempt, due time, identifier, and error
    expect(typeof body.retrying[0].due_at).toBe('string')
    expect(body.retrying[0].error).toBe('turn_failed')
  })

  test('GET /api/v1/state includes running entry', async () => {
    const running = new Map([['issue-1', makeRunningEntry()]])
    const orchestrator = makeOrchestratorStub({ running })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/state`)
    const body = await res.json() as { running: Array<Record<string, unknown>> }
    expect(body.running).toHaveLength(1)
    expect(body.running[0].issue_identifier).toBe('TEST-1')
    expect(body.running[0].turn_count).toBe(3)
  })

  test('GET /api/v1/<identifier> returns running issue', async () => {
    const running = new Map([['issue-1', makeRunningEntry()]])
    const orchestrator = makeOrchestratorStub({ running })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/TEST-1`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.issue_identifier).toBe('TEST-1')
    expect(body.status).toBe('running')
    expect((body.running as Record<string, unknown>).turn_count).toBe(3)
  })

  test('GET /api/v1/<identifier> returns 404 for unknown issue', async () => {
    const res = await fetch(`${baseUrl}/api/v1/UNKNOWN-99`)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('issue_not_found')
  })

  test('GET /api/v1/<identifier> returns retrying issue', async () => {
    const retryEntry = makeRetryEntry()
    const retry_attempts = new Map([['issue-2', retryEntry]])
    const orchestrator = makeOrchestratorStub({ retry_attempts })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/TEST-2`)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.status).toBe('retrying')
    expect((body.retry as Record<string, unknown>).attempt).toBe(2)
  })

  test('POST /api/v1/refresh returns 202', async () => {
    const res = await fetch(`${baseUrl}/api/v1/refresh`, { method: 'POST' })
    expect(res.status).toBe(202)
    const body = await res.json() as { queued: boolean, operations: string[] }
    expect(body.queued).toBe(true)
    expect(body.operations).toContain('poll')
  })

  test('GET /api/v1/refresh returns 405', async () => {
    const res = await fetch(`${baseUrl}/api/v1/refresh`, { method: 'GET' })
    expect(res.status).toBe(405)
  })

  test('POST /api/v1/state returns 405', async () => {
    const res = await fetch(`${baseUrl}/api/v1/state`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  test('unknown route returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/v2/something`)
    expect(res.status).toBe(404)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('not_found')
  })

  test('POST /api/v1/webhook with no secret returns 200 accepted', async () => {
    let refreshed = false
    const orchestrator = makeOrchestratorStub()
    orchestrator.triggerRefresh = () => {
      refreshed = true
    }
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/webhook`, {
      method: 'POST',
      body: '{"action":"opened"}',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
    expect(body.event).toBe('issues')
    expect(refreshed).toBe(true)
  })

  test('POST /api/v1/webhook with valid signature returns 200', async () => {
    const secret = 'test-webhook-secret'
    const payload = '{"action":"synchronize"}'
    const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`

    const orchestrator = makeOrchestratorStub()
    orchestrator.getConfig = () => makeConfig({ server: { port: null, webhook: { secret, events: null } } })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/webhook`, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': signature },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.accepted).toBe(true)
  })

  test('POST /api/v1/webhook with invalid signature returns 401', async () => {
    const orchestrator = makeOrchestratorStub()
    orchestrator.getConfig = () => makeConfig({ server: { port: null, webhook: { secret: 'real-secret', events: null } } })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/api/v1/webhook`, {
      method: 'POST',
      body: '{"action":"opened"}',
      headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'issues', 'X-Hub-Signature-256': 'sha256=invalid' },
    })
    expect(res.status).toBe(401)
  })

  test('GET /api/v1/webhook returns 405', async () => {
    const res = await fetch(`${baseUrl}/api/v1/webhook`, { method: 'GET' })
    expect(res.status).toBe(405)
  })

  test('GET / dashboard links session IDs to session page', async () => {
    const running = new Map([['issue-1', makeRunningEntry({ session_id: 'abc-123' })]])
    const orchestrator = makeOrchestratorStub({ running })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/`)
    const body = await res.text()
    expect(body).toContain('href="/sessions/abc-123"')
    expect(body).toContain('>abc-123</a>')
  })

  test('GET / dashboard shows empty cell when session_id is null', async () => {
    const running = new Map([['issue-1', makeRunningEntry({ session_id: null })]])
    const orchestrator = makeOrchestratorStub({ running })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/`)
    const body = await res.text()
    expect(body).not.toContain('href="/sessions/')
  })

  test('GET /sessions/<id> returns HTML session page', async () => {
    const running = new Map([['issue-1', makeRunningEntry({ session_id: 'sess-1' })]])
    const orchestrator = makeOrchestratorStub({ running })
    server.stop()
    server = new HttpServer(orchestrator as never, 0)
    const port = server.start()
    baseUrl = `http://127.0.0.1:${port}`

    const res = await fetch(`${baseUrl}/sessions/sess-1`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('Session sess-1')
    expect(body).toContain('Dashboard')
  })

  test('GET /sessions/<id> returns HTML even with unknown session', async () => {
    const res = await fetch(`${baseUrl}/sessions/unknown-session`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('No messages found.')
  })

  test('POST /sessions/<id> returns 405', async () => {
    const res = await fetch(`${baseUrl}/sessions/sess-1`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  test('GET /api/v1/sessions/<id>/messages returns empty array for unknown session', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/unknown-session/messages`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual([])
  })

  test('GET /api/v1/runs returns empty array when DB is null', async () => {
    const res = await fetch(`${baseUrl}/api/v1/runs`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual([])
  })

  test('GET /api/v1/runs ignores invalid status param', async () => {
    const res = await fetch(`${baseUrl}/api/v1/runs?status=bogus`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(body).toEqual([])
  })

  test('POST /api/v1/sessions/<id>/messages returns 405', async () => {
    const res = await fetch(`${baseUrl}/api/v1/sessions/sess-1/messages`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  test('POST /api/v1/runs returns 405', async () => {
    const res = await fetch(`${baseUrl}/api/v1/runs`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
