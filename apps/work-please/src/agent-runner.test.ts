import type { AgentMessage } from './types'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { AppServerClient, extractRateLimits, extractUsage, isInputRequired } from './agent-runner'
import { buildConfig } from './config'

describe('extractUsage - nested payload shapes (Section 17.5)', () => {
  it('extracts usage from params.usage', () => {
    const payload = {
      params: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
    }
    const result = extractUsage(payload)
    expect(result.usage?.input_tokens).toBe(100)
    expect(result.usage?.output_tokens).toBe(50)
    expect(result.usage?.total_tokens).toBe(150)
  })

  it('extracts usage from params.total_token_usage (alternate field name)', () => {
    const payload = {
      params: { total_token_usage: { inputTokens: 200, outputTokens: 80, totalTokens: 280 } },
    }
    const result = extractUsage(payload)
    expect(result.usage?.input_tokens).toBe(200)
    expect(result.usage?.output_tokens).toBe(80)
    expect(result.usage?.total_tokens).toBe(280)
  })

  it('accepts camelCase token field names', () => {
    const payload = {
      params: { usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400 } },
    }
    const result = extractUsage(payload)
    expect(result.usage?.input_tokens).toBe(300)
    expect(result.usage?.output_tokens).toBe(100)
    expect(result.usage?.total_tokens).toBe(400)
  })

  it('returns empty object when no usage data present', () => {
    const result = extractUsage({ params: {} })
    expect(result).toEqual({})
  })

  it('returns empty object when payload has no params', () => {
    const result = extractUsage({})
    expect(result).toEqual({})
  })

  it('extracts usage from params.tokenUsage.total (thread/tokenUsage/updated shape)', () => {
    const payload = {
      params: { tokenUsage: { total: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } } },
    }
    const result = extractUsage(payload)
    expect(result.usage?.input_tokens).toBe(8)
    expect(result.usage?.output_tokens).toBe(3)
    expect(result.usage?.total_tokens).toBe(11)
  })

  it('accepts prompt_tokens/completion_tokens as aliases for input/output tokens', () => {
    const payload = {
      params: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    }
    const result = extractUsage(payload)
    expect(result.usage?.input_tokens).toBe(10)
    expect(result.usage?.output_tokens).toBe(5)
    expect(result.usage?.total_tokens).toBe(15)
  })
})

describe('extractRateLimits - nested payload shapes (Section 17.5)', () => {
  it('extracts rate_limits from params.rate_limits', () => {
    const limits = { requests_per_minute: 60 }
    const payload = { params: { rate_limits: limits } }
    const result = extractRateLimits(payload)
    expect(result.rate_limits).toBe(limits)
  })

  it('extracts rate_limits from params.msg.rate_limits (nested msg)', () => {
    const limits = { tokens_per_minute: 1000 }
    const payload = { params: { msg: { rate_limits: limits } } }
    const result = extractRateLimits(payload)
    expect(result.rate_limits).toBe(limits)
  })

  it('extracts rate_limits from top-level payload.rate_limits', () => {
    const limits = { retry_after: 30 }
    const payload = { rate_limits: limits }
    const result = extractRateLimits(payload)
    expect(result.rate_limits).toBe(limits)
  })

  it('returns empty object when no rate_limits present', () => {
    const result = extractRateLimits({ params: {} })
    expect(result).toEqual({})
  })

  it('ignores non-object rate_limits values', () => {
    const result = extractRateLimits({ params: { rate_limits: 'invalid' } })
    expect(result).toEqual({})
  })
})

describe('isInputRequired - compatible payload variants (Section 17.5)', () => {
  it('returns true for turn/input_required method', () => {
    expect(isInputRequired('turn/input_required', {})).toBe(true)
  })

  it('returns true for turn/needs_input method', () => {
    expect(isInputRequired('turn/needs_input', {})).toBe(true)
  })

  it('returns true for turn/need_input method', () => {
    expect(isInputRequired('turn/need_input', {})).toBe(true)
  })

  it('returns true for turn/approval_required method', () => {
    expect(isInputRequired('turn/approval_required', {})).toBe(true)
  })

  it('returns true when payload has requiresInput=true', () => {
    expect(isInputRequired('notification', { requiresInput: true })).toBe(true)
  })

  it('returns true when params has input_required=true', () => {
    expect(isInputRequired('notification', { params: { input_required: true } })).toBe(true)
  })

  it('returns true when params has inputRequired=true', () => {
    expect(isInputRequired('other', { params: { inputRequired: true } })).toBe(true)
  })

  it('returns false for unrelated methods and payloads', () => {
    expect(isInputRequired('turn/completed', {})).toBe(false)
    expect(isInputRequired('notification', { params: {} })).toBe(false)
  })
})

// --- SDK-based AppServerClient integration tests ---

// Minimal fake SDKMessage factory helpers
function makeInitMsg(session_id: string, cwd = '/tmp/ws') {
  return {
    type: 'system' as const,
    subtype: 'init' as const,
    session_id,
    cwd,
    tools: [],
    mcp_servers: [],
    model: 'claude-sonnet-4-6',
    permissionMode: 'bypassPermissions' as const,
    slash_commands: [],
    output_style: 'text',
    skills: [],
    plugins: [],
    apiKeySource: 'user' as const,
    betas: [],
    claude_code_version: '1.0.0',
    uuid: 'uuid-init' as `${string}-${string}-${string}-${string}-${string}`,
  }
}

function makeSuccessMsg(session_id: string) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    session_id,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.001,
    duration_ms: 1000,
    duration_api_ms: 900,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    uuid: 'uuid-result' as `${string}-${string}-${string}-${string}-${string}`,
  }
}

function makeErrorMsg(session_id: string, subtype: 'error_during_execution' | 'error_max_turns' = 'error_during_execution') {
  return {
    type: 'result' as const,
    subtype,
    session_id,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    duration_ms: 100,
    duration_api_ms: 80,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors: ['execution failed'],
    uuid: 'uuid-error' as `${string}-${string}-${string}-${string}-${string}`,
  }
}

function makeRateLimitMsg(session_id: string) {
  return {
    type: 'rate_limit_event' as const,
    session_id,
    rate_limit_info: { status: 'allowed' as const },
    uuid: 'uuid-rl' as `${string}-${string}-${string}-${string}-${string}`,
  }
}

function makeIssue() {
  return {
    id: 'i1',
    identifier: 'MT-1',
    title: 'Test Issue',
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
  }
}

describe('AppServerClient - startSession workspace validation (Section 17.5)', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-sdk-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns Error when workspace equals workspace root', async () => {
    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, tmpRoot)
    const result = await client.startSession()
    expect(result instanceof Error).toBe(true)
    if (result instanceof Error)
      expect(result.message).toContain('invalid_workspace_cwd')
  })

  it('returns Error when workspace is outside workspace root', async () => {
    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, '/tmp/outside-root')
    const result = await client.startSession()
    expect(result instanceof Error).toBe(true)
    if (result instanceof Error)
      expect(result.message).toContain('outside_workspace_root')
  })

  it('returns AgentSession with UUID sessionId on valid workspace', async () => {
    const wsPath = join(tmpRoot, 'ws')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const result = await client.startSession()
    expect(result instanceof Error).toBe(false)
    if (result instanceof Error)
      return
    expect(result.sessionId).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i)
    expect(result.workspace).toBe(wsPath)
  })

  it('returns Error when provided sessionId is not a valid UUID', async () => {
    const wsPath = join(tmpRoot, 'ws-invalid')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const result = await client.startSession('not-a-uuid')
    expect(result instanceof Error).toBe(true)
    if (result instanceof Error)
      expect(result.message).toContain('invalid_session_id')
  })

  it('uses provided sessionId when given to startSession', async () => {
    const wsPath = join(tmpRoot, 'ws2')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const existingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const client = new AppServerClient(config, wsPath)
    const result = await client.startSession(existingId)
    expect(result instanceof Error).toBe(false)
    if (result instanceof Error)
      return
    expect(result.sessionId).toBe(existingId)
  })
})

describe('AppServerClient - runTurn with SDK mock (Section 17.5)', () => {
  let tmpRoot: string
  let wsPath: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-sdk-test-'))
    wsPath = join(tmpRoot, 'ws')
    mkdirSync(wsPath)
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function makeConfig() {
    return buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })
  }

  it('emits session_started and turn_completed on successful SDK turn', async () => {
    const sessionId = 'sdk-session-1'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      yield makeSuccessMsg(sessionId)
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))
    client.stopSession()

    expect(result instanceof Error).toBe(false)
    const sessionStarted = messages.find(m => m.event === 'session_started')
    expect(sessionStarted).toBeDefined()
    expect(sessionStarted?.session_id).toBe(sessionId)

    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(turnCompleted).toBeDefined()
    expect(turnCompleted?.usage?.input_tokens).toBe(100)
    expect(turnCompleted?.usage?.output_tokens).toBe(50)

    if (result instanceof Error)
      return
    expect(result.session_id).toBe(sessionId)
    expect(typeof result.turn_id).toBe('string')
  })

  it('emits startup_failed and returns Error when query throws', async () => {
    async function* mockQuery() {
      throw new Error('claude_not_found')

      yield makeInitMsg('s1')
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeDefined()
    expect((startupFailed?.payload as { reason: string })?.reason).toContain('claude_not_found')
  })

  it('emits startup_failed when query yields no system init message', async () => {
    async function* mockQuery() {
      // yields result without init — SDK error path
      yield makeSuccessMsg('s-no-init')
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))

    expect(result instanceof Error).toBe(true)
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeDefined()
    if (result instanceof Error)
      expect(result.message).toBe('no_session_started')
  })

  it('emits turn_failed (not startup_failed) when query throws after init received', async () => {
    const sessionId = 'sdk-throw-after-init'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      throw new Error('mid_turn_crash')
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))

    expect(result instanceof Error).toBe(true)
    const turnFailed = messages.find(m => m.event === 'turn_failed')
    expect(turnFailed).toBeDefined()
    expect((turnFailed?.payload as { reason: string })?.reason).toContain('mid_turn_crash')
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeUndefined()
  })

  it('emits turn_failed and returns Error when SDKResultError received', async () => {
    const sessionId = 'sdk-error-session'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      yield makeErrorMsg(sessionId, 'error_during_execution')
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    const sessionStarted = messages.find(m => m.event === 'session_started')
    expect(sessionStarted).toBeDefined()
    const turnFailed = messages.find(m => m.event === 'turn_failed')
    expect(turnFailed).toBeDefined()
    expect((turnFailed?.payload as { subtype: string })?.subtype).toBe('error_during_execution')
  })

  it('emits turn_failed for error_max_turns result', async () => {
    const sessionId = 'sdk-max-turns-session'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      yield makeErrorMsg(sessionId, 'error_max_turns')
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))

    expect(result instanceof Error).toBe(true)
    const turnFailed = messages.find(m => m.event === 'turn_failed')
    expect(turnFailed).toBeDefined()
    expect((turnFailed?.payload as { subtype: string })?.subtype).toBe('error_max_turns')
  })

  it('aborts query and returns Error on turn_timeout', async () => {
    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 200, turn_timeout_ms: 300 },
      },
      prompt_template: '',
    })

    // Generator that hangs until aborted via the AbortSignal in options
    const client = new AppServerClient(config, wsPath, ({ options }) => (async function* () {
      await new Promise<void>((_resolve, reject) => {
        options?.abortController?.signal.addEventListener('abort', () => reject(new Error('turn_timeout')))
      })
      yield makeInitMsg('s-timeout')
    })())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeDefined()
  })

  it('stopSession aborts the active query', async () => {
    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    // Use a mock that aborts when the AbortController fires
    let capturedController: AbortController | null = null
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedController = options?.abortController ?? null
      return (async function* () {
        yield makeInitMsg('s-stop', wsPath)
        // Simulate waiting — stopSession should abort this
        await new Promise<void>((_resolve, reject) => {
          options?.abortController?.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const turnPromise = client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(capturedController).not.toBeNull()

    // Stop the session
    client.stopSession()

    const result = await turnPromise
    expect(result instanceof Error).toBe(true)
  })

  it('passes options.sessionId (not resume) on first turn of a new session', async () => {
    const capturedOptions: { sessionId?: string, resume?: string }[] = []

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedOptions.push({ sessionId: options?.sessionId, resume: options?.resume })
      return (async function* () {
        yield makeInitMsg('new-session-id', wsPath)
        yield makeSuccessMsg('new-session-id')
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'turn 1', makeIssue(), () => {})
    expect(capturedOptions[0]?.resume).toBeUndefined()
    expect(capturedOptions[0]?.sessionId).toBe(session.sessionId)
  })

  it('resumes previous session on 2nd turn (passes resume option)', async () => {
    const sessionId = 'sdk-resume-session'
    const capturedOptions: { sessionId?: string | undefined, resume?: string }[] = []

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedOptions.push({ sessionId: options?.sessionId, resume: options?.resume })
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    // First turn — no resume (uses options.sessionId instead)
    await client.runTurn(session, 'turn 1', makeIssue(), () => {})
    expect(capturedOptions[0]?.resume).toBeUndefined()

    // Second turn — should resume previous session; options.sessionId must be absent
    await client.runTurn(session, 'turn 2', makeIssue(), () => {})
    expect(capturedOptions[1]?.resume).toBe(sessionId)
    expect(capturedOptions[1]?.sessionId).toBeUndefined()
  })

  it('stopSession then startSession uses fresh options.sessionId (not resume from previous)', async () => {
    const firstSdkSessionId = 'first-sdk-session'
    const capturedOptions: { sessionId?: string | undefined, resume?: string }[] = []

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedOptions.push({ sessionId: options?.sessionId, resume: options?.resume })
      return (async function* () {
        yield makeInitMsg(firstSdkSessionId, wsPath)
        yield makeSuccessMsg(firstSdkSessionId)
      })()
    })

    // First session
    const session1 = await client.startSession()
    if (session1 instanceof Error)
      return
    await client.runTurn(session1, 'turn 1', makeIssue(), () => {})
    client.stopSession()

    // Second session — must get a fresh options.sessionId, not resume the first
    const session2 = await client.startSession()
    if (session2 instanceof Error)
      return
    await client.runTurn(session2, 'turn 2', makeIssue(), () => {})

    expect(capturedOptions[0]?.resume).toBeUndefined()
    expect(capturedOptions[1]?.resume).toBeUndefined()
    expect(capturedOptions[1]?.sessionId).toBe(session2.sessionId)
    expect(session2.sessionId).not.toBe(session1.sessionId)
  })

  it('passes options.resume on first turn when sessionId provided to startSession (cross-restart resume)', async () => {
    const existingId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const capturedOptions: { sessionId?: string, resume?: string }[] = []

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedOptions.push({ sessionId: options?.sessionId, resume: options?.resume })
      return (async function* () {
        yield makeInitMsg(existingId, wsPath)
        yield makeSuccessMsg(existingId)
      })()
    })

    const session = await client.startSession(existingId)
    if (session instanceof Error)
      return

    await client.runTurn(session, 'resume turn', makeIssue(), () => {})
    expect(capturedOptions[0]?.resume).toBe(existingId)
    expect(capturedOptions[0]?.sessionId).toBeUndefined()
  })

  it('preserves resume session ID on pre-init failure so next turn can retry', async () => {
    const existingId = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff'
    const capturedOptions: { resume?: string }[] = []
    let callCount = 0

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedOptions.push({ resume: options?.resume })
      callCount++
      if (callCount === 1) {
        // First turn: transient error before system/init
        return (async function* () {
          throw new Error('transient_network_error')
          // unreachable but satisfies generator return type
          yield makeInitMsg(existingId, wsPath)
        })()
      }
      // Second turn: succeeds
      return (async function* () {
        yield makeInitMsg(existingId, wsPath)
        yield makeSuccessMsg(existingId)
      })()
    })

    const session = await client.startSession(existingId)
    if (session instanceof Error)
      return

    // First turn fails before init
    const result1 = await client.runTurn(session, 'try 1', makeIssue(), () => {})
    expect(result1 instanceof Error).toBe(true)
    expect(capturedOptions[0]?.resume).toBe(existingId)

    // Second turn should still pass resume (session ID preserved after pre-init failure)
    const result2 = await client.runTurn(session, 'try 2', makeIssue(), () => {})
    expect(result2 instanceof Error).toBe(false)
    expect(capturedOptions[1]?.resume).toBe(existingId)
  })

  it('sessionId on AgentSession remains stable across turns', async () => {
    const sdkSessionId = 'stable-session-id'

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => (async function* () {
      yield makeInitMsg(sdkSessionId, wsPath)
      yield makeSuccessMsg(sdkSessionId)
    })())

    const session = await client.startSession()
    if (session instanceof Error)
      return

    const idBeforeTurn = session.sessionId
    await client.runTurn(session, 'turn 1', makeIssue(), () => {})
    expect(session.sessionId).toBe(idBeforeTurn)
  })

  it('passes bypassPermissions and allowDangerouslySkipPermissions when configured', async () => {
    const sessionId = 'sdk-bypass-session'
    let capturedPermMode: string | undefined
    let capturedBypass: boolean | undefined

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', permission_mode: 'bypassPermissions', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedPermMode = options?.permissionMode
      capturedBypass = options?.allowDangerouslySkipPermissions
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedPermMode).toBe('bypassPermissions')
    expect(capturedBypass).toBe(true)
  })

  it('sets cwd to session workspace', async () => {
    const sessionId = 'sdk-cwd-session'
    let capturedCwd: string | undefined

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedCwd = options?.cwd
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedCwd).toBe(wsPath)
  })

  it('sets mcpServers when tracker has tool specs', async () => {
    const sessionId = 'sdk-mcp-session'
    let capturedMcpServers: unknown

    const config = makeConfig() // asana tracker → has asana_api tool
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedMcpServers = options?.mcpServers
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedMcpServers).toBeDefined()
    expect(typeof capturedMcpServers).toBe('object')
    expect(Object.keys(capturedMcpServers as object)).toContain('work-please-tools')
  })

  it('emits notification for rate_limit_event', async () => {
    const sessionId = 'sdk-ratelimit-session'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      yield makeRateLimitMsg(sessionId)
      yield makeSuccessMsg(sessionId)
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))
    client.stopSession()

    expect(result instanceof Error).toBe(false)
    const rateLimitNotif = messages.find(m => m.event === 'notification' && m.rate_limits != null)
    expect(rateLimitNotif).toBeDefined()
    expect((rateLimitNotif?.rate_limits as { status: string })?.status).toBe('allowed')
  })

  it('emits notification for other SDK message types', async () => {
    const sessionId = 'sdk-other-session'

    async function* mockQuery() {
      yield makeInitMsg(sessionId, wsPath)
      // Emit a status message (simpler SDK message type)
      yield {
        type: 'status' as const,
        status: 'thinking' as const,
        session_id: sessionId,
        uuid: 'uuid-status' as `${string}-${string}-${string}-${string}-${string}`,
      }
      yield makeSuccessMsg(sessionId)
    }

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, () => mockQuery())
    const session = await client.startSession()
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(session, 'hello', makeIssue(), msg => messages.push(msg))

    expect(result instanceof Error).toBe(false)
    const notifications = messages.filter(m => m.event === 'notification')
    expect(notifications.length).toBeGreaterThan(0)
  })

  it('sets pathToClaudeCodeExecutable when command differs from default', async () => {
    const sessionId = 'sdk-path-session'
    let capturedPath: string | undefined

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: '/usr/local/bin/custom-claude', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedPath = options?.pathToClaudeCodeExecutable
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedPath).toBe('/usr/local/bin/custom-claude')
  })

  it('does not set pathToClaudeCodeExecutable when command is default "claude"', async () => {
    const sessionId = 'sdk-default-path-session'
    let capturedPath: string | undefined = 'INITIAL'

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedPath = options?.pathToClaudeCodeExecutable
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedPath).toBeUndefined()
  })

  it('passes model to SDK options when configured', async () => {
    const sessionId = 'sdk-model-session'
    let capturedModel: string | undefined

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', model: 'claude-sonnet-4-6', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedModel = options?.model
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedModel).toBe('claude-sonnet-4-6')
  })

  it('does not set model when not configured', async () => {
    const sessionId = 'sdk-no-model-session'
    let capturedModel: string | undefined = 'INITIAL'

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedModel = options?.model
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedModel).toBeUndefined()
  })

  it('passes default preset systemPrompt to SDK options', async () => {
    const sessionId = 'sdk-system-prompt-default-session'
    let capturedSystemPrompt: unknown = 'INITIAL'

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSystemPrompt = options?.systemPrompt
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedSystemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('does not set settingSources when setting_sources is explicitly empty', async () => {
    const sessionId = 'sdk-no-setting-sources'
    let capturedSettingSources: unknown = 'INITIAL'

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000, setting_sources: [] },
      },
      prompt_template: '',
    })
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSettingSources = options?.settingSources
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    const result = await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(result instanceof Error).toBe(false)
    expect(capturedSettingSources).toBeUndefined()
  })

  it('passes default settingSources [project, local, user] when setting_sources not configured', async () => {
    const sessionId = 'sdk-default-setting-sources'
    let capturedSettingSources: unknown

    const config = makeConfig()
    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSettingSources = options?.settingSources
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    const result = await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(result instanceof Error).toBe(false)
    expect(capturedSettingSources).toEqual(['project', 'local', 'user'])
  })

  it('passes custom string systemPrompt to SDK options', async () => {
    const sessionId = 'sdk-system-prompt-custom-session'
    let capturedSystemPrompt: unknown = 'INITIAL'

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', system_prompt: 'You are a specialized agent.', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSystemPrompt = options?.systemPrompt
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedSystemPrompt).toBe('You are a specialized agent.')
  })

  it('passes settingSources when setting_sources is configured', async () => {
    const sessionId = 'sdk-setting-sources'
    let capturedSettingSources: unknown

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000, setting_sources: ['project'] },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSettingSources = options?.settingSources
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedSettingSources).toEqual(['project'])
  })

  it('passes preset with append systemPrompt to SDK options', async () => {
    const sessionId = 'sdk-system-prompt-preset-append-session'
    let capturedSystemPrompt: unknown = 'INITIAL'

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: {
          command: 'claude',
          system_prompt: { type: 'preset', preset: 'claude_code', append: 'Additional instructions.' },
          read_timeout_ms: 2000,
          turn_timeout_ms: 5000,
        },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSystemPrompt = options?.systemPrompt
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedSystemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Additional instructions.' })
  })

  it('passes all three setting sources verbatim when all are configured', async () => {
    const sessionId = 'sdk-all-setting-sources'
    let capturedSettingSources: unknown

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', read_timeout_ms: 2000, turn_timeout_ms: 5000, setting_sources: ['project', 'user', 'local'] },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedSettingSources = options?.settingSources
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    const result = await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(result instanceof Error).toBe(false)
    expect(capturedSettingSources).toEqual(['project', 'user', 'local'])
  })

  it('passes effort to SDK options when configured', async () => {
    const sessionId = 'sdk-effort-session'
    let capturedEffort: string | undefined

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: 'claude', effort: 'low', read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath, ({ options }) => {
      capturedEffort = (options as Record<string, unknown>)?.effort as string | undefined
      return (async function* () {
        yield makeInitMsg(sessionId, wsPath)
        yield makeSuccessMsg(sessionId)
      })()
    })

    const session = await client.startSession()
    if (session instanceof Error)
      return

    await client.runTurn(session, 'hello', makeIssue(), () => {})
    expect(capturedEffort).toBe('low')
  })
})
