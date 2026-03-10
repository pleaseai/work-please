import type { AgentMessage } from './types'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { AppServerClient, extractRateLimits, extractUsage } from './agent-runner'
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
})
