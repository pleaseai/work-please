import type { AgentMessage } from './types'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('AppServerClient - startup_failed event (Section 10.4)', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'conductor-runner-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('emits startup_failed event when turn/start fails', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"error":{"code":-32000,"message":"turn_start_failed"}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i1',
        identifier: 'MT-1',
        title: 'Test Issue',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeDefined()
    expect((startupFailed?.payload as { reason: string })?.reason).toContain('turn_start_failed')
  })

  it('emits session_started and turn_completed on successful turn', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-ok.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-1"}}}\'',
      '       printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-ok')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i1',
        identifier: 'MT-1',
        title: 'Test Issue',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(false)
    const sessionStarted = messages.find(m => m.event === 'session_started')
    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(sessionStarted).toBeDefined()
    expect(turnCompleted).toBeDefined()
    if (result instanceof Error)
      return
    // session_id format is "{threadId}-{turnId}" (Section 17.5)
    expect(result.session_id).toBe('t-1-turn-1')
    expect(result.thread_id).toBe('t-1')
    expect(result.turn_id).toBe('turn-1')
  })

  it('non-JSON stderr lines do not crash session (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-stderr.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' \'not valid json at all\' >&2',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-2"}}}\'',
      '       printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-stderr')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i2',
        identifier: 'MT-2',
        title: 'Stderr Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    // Session completes successfully despite stderr noise
    expect(result instanceof Error).toBe(false)
    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(turnCompleted).toBeDefined()
  })

  it('auto-approves command execution approval requests (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-approval.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  idStr=$(printf \'%s\' "$line" | grep -o \'"id":"[^"]*"\' | head -1)',
      '  if printf \'%s\' "$line" | grep -q "acceptForSession"; then',
      // Client sent acceptForSession response — now complete the turn
      '    printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\'',
      '    break',
      '  fi',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-4"}}}\'',
      '       printf \'%s\\n\' \'{"id":"approval-1","method":"item/commandExecution/requestApproval","params":{}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-approval')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i4',
        identifier: 'MT-4',
        title: 'Approval Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(false)
    const autoApproved = messages.find(m => m.event === 'approval_auto_approved')
    expect(autoApproved).toBeDefined()
    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(turnCompleted).toBeDefined()
  })

  it('returns Error with response_timeout when agent does not respond to turn/start within read_timeout_ms (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-slow.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      // id=3 (turn/start) intentionally not handled — agent hangs
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-slow')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 500, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i5',
        identifier: 'MT-5',
        title: 'Timeout Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    if (!(result instanceof Error))
      return
    expect(result.message).toContain('response_timeout')
    const startupFailed = messages.find(m => m.event === 'startup_failed')
    expect(startupFailed).toBeDefined()
  })

  it('enforces turn_timeout_ms when agent never sends turn/completed (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-noturn.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-timeout"}}}\';;',
      // turn/completed is never sent — agent silently hangs
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-noturn')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 500 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i6',
        identifier: 'MT-6',
        title: 'Turn Timeout Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    if (!(result instanceof Error))
      return
    expect(result.message).toContain('turn_timeout')
    const sessionStarted = messages.find(m => m.event === 'session_started')
    expect(sessionStarted).toBeDefined()
  })

  it('rejects unsupported dynamic tool calls without stalling (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-unsupported-tool.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  idStr=$(printf \'%s\' "$line" | grep -o \'"id":"[^"]*"\' | head -1)',
      // Check if we received the rejection response for tool-call-99
      '  if printf \'%s\' "$line" | grep -q "unsupported_tool_call"; then',
      '    printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\'',
      '    break',
      '  fi',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-tool"}}}\'',
      '       printf \'%s\\n\' \'{"id":"tool-99","method":"item/tool/call","params":{"name":"unknown_tool","arguments":{}}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-unsupported-tool')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i7',
        identifier: 'MT-7',
        title: 'Unsupported Tool Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(false)
    const unsupportedToolCall = messages.find(m => m.event === 'unsupported_tool_call')
    expect(unsupportedToolCall).toBeDefined()
    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(turnCompleted).toBeDefined()
  })

  it('buffers partial JSON lines until newline arrives (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-chunked.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      // Write the turn/start response in two separate writes with no newline after the first
      '    3) printf \'%s\' \'{"id":3,"result":{"turn":{"id":"turn-chunk"}}}\'',
      '       sleep 0.01',
      '       printf \'\\n\'',
      '       printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-chunked')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i8',
        identifier: 'MT-8',
        title: 'Chunked Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    // Session should complete successfully despite chunked JSON response
    expect(result instanceof Error).toBe(false)
    const turnCompleted = messages.find(m => m.event === 'turn_completed')
    expect(turnCompleted).toBeDefined()
    if (result instanceof Error)
      return
    expect(result.turn_id).toBe('turn-chunk')
  })

  it('emits turn_input_required and returns Error when agent requests user input (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-input.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-3"}}}\'',
      '       printf \'%s\\n\' \'{"id":"req-1","method":"item/tool/requestUserInput","params":{}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-input')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 5000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    expect(session instanceof Error).toBe(false)
    if (session instanceof Error)
      return

    const messages: AgentMessage[] = []
    const result = await client.runTurn(
      session,
      'hello',
      {
        id: 'i3',
        identifier: 'MT-3',
        title: 'Input Test',
        description: null,
        priority: null,
        state: 'In Progress',
        branch_name: null,
        url: null,
        labels: [],
        blocked_by: [],
        created_at: null,
        updated_at: null,
      },
      msg => messages.push(msg),
    )
    client.stopSession()

    expect(result instanceof Error).toBe(true)
    if (!(result instanceof Error))
      return
    expect(result.message).toContain('turn_input_required')
    const inputRequired = messages.find(m => m.event === 'turn_input_required')
    expect(inputRequired).toBeDefined()
  })

  it('executes supported dynamic tool calls and returns the result to the agent (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-supported-tool.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      // After receiving tool call result (contentItems is in the response body), send turn/completed
      '  if printf \'%s\' "$line" | grep -q \'contentItems\'; then',
      '    printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\'',
      '    break',
      '  fi',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-st"}}}\'',
      '       printf \'%s\\n\' \'{"id":"tc-1","method":"item/tool/call","params":{"name":"asana_api","arguments":{"method":"GET","path":"/tasks/t1"}}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-supported-tool')
    mkdirSync(wsPath)

    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: { gid: 't1', name: 'Task One' } }),
    })) as unknown as typeof fetch

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 8000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    try {
      expect(session instanceof Error).toBe(false)
      if (session instanceof Error)
        return

      const messages: AgentMessage[] = []
      const result = await client.runTurn(
        session,
        'hello',
        {
          id: 'i9',
          identifier: 'MT-9',
          title: 'Supported Tool',
          description: null,
          priority: null,
          state: 'In Progress',
          branch_name: null,
          url: null,
          labels: [],
          blocked_by: [],
          created_at: null,
          updated_at: null,
        },
        msg => messages.push(msg),
      )
      client.stopSession()

      expect(result instanceof Error).toBe(false)
      const turnCompleted = messages.find(m => m.event === 'turn_completed')
      expect(turnCompleted).toBeDefined()
      // Tool call notification event (success=true)
      const toolNotification = messages.find(m => m.event === 'notification')
      expect(toolNotification).toBeDefined()
    }
    finally {
      globalThis.fetch = origFetch
      client.stopSession()
    }
  })

  it('emits tool_call_failed event when supported tool returns success=false (Section 17.5)', async () => {
    const scriptPath = join(tmpRoot, 'fake-agent-tool-fail.sh')
    writeFileSync(scriptPath, [
      '#!/usr/bin/env bash',
      'while IFS= read -r line; do',
      '  id=$(printf \'%s\' "$line" | grep -o \'"id":[0-9]*\' | grep -o \'[0-9]*\' | head -1)',
      // After receiving tool call result (contentItems in response), send turn/completed
      '  if printf \'%s\' "$line" | grep -q \'contentItems\'; then',
      '    printf \'%s\\n\' \'{"method":"turn/completed","params":{}}\'',
      '    break',
      '  fi',
      '  case "$id" in',
      '    1) printf \'%s\\n\' \'{"id":1,"result":{"capabilities":{}}}\';;',
      '    2) printf \'%s\\n\' \'{"id":2,"result":{"thread":{"id":"t-1"}}}\';;',
      // Send tool call with empty args (missing method/path = validation failure = success:false)
      '    3) printf \'%s\\n\' \'{"id":3,"result":{"turn":{"id":"turn-tf"}}}\'',
      '       printf \'%s\\n\' \'{"id":"tc-2","method":"item/tool/call","params":{"name":"asana_api","arguments":{}}}\';;',
      '  esac',
      'done',
    ].join('\n'), { mode: 0o755 })

    const wsPath = join(tmpRoot, 'ws-tool-fail')
    mkdirSync(wsPath)

    const config = buildConfig({
      config: {
        tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
        workspace: { root: tmpRoot },
        claude: { command: scriptPath, read_timeout_ms: 2000, turn_timeout_ms: 8000 },
      },
      prompt_template: '',
    })

    const client = new AppServerClient(config, wsPath)
    const session = await client.startSession()
    try {
      expect(session instanceof Error).toBe(false)
      if (session instanceof Error)
        return

      const messages: AgentMessage[] = []
      const result = await client.runTurn(
        session,
        'hello',
        {
          id: 'i10',
          identifier: 'MT-10',
          title: 'Tool Fail',
          description: null,
          priority: null,
          state: 'In Progress',
          branch_name: null,
          url: null,
          labels: [],
          blocked_by: [],
          created_at: null,
          updated_at: null,
        },
        msg => messages.push(msg),
      )
      client.stopSession()

      expect(result instanceof Error).toBe(false)
      // Tool failure emits tool_call_failed, not a generic notification
      const toolCallFailed = messages.find(m => m.event === 'tool_call_failed')
      expect(toolCallFailed).toBeDefined()
      // Turn still completes after tool failure
      const turnCompleted = messages.find(m => m.event === 'turn_completed')
      expect(turnCompleted).toBeDefined()
    }
    finally {
      client.stopSession()
    }
  })
})
