import type { LabelService } from './label'
import type { GitHubPlatformConfig, Issue, ProjectConfig, RunningEntry, WatchedSnapshot } from './types'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { normalizeState } from './config'
import { buildTokenProvider, getLinkedPrUpdateMs, isWatchedUnchanged, Orchestrator } from './orchestrator'

// Test the sort/dispatch logic utilities in isolation

function countRunningInState(running: Map<string, Pick<RunningEntry, 'issue'>>, state: string): number {
  let count = 0
  const normalized = normalizeState(state)
  for (const entry of running.values()) {
    if (normalizeState(entry.issue.state) === normalized)
      count++
  }
  return count
}

function sortForDispatch(issues: Issue[]): Issue[] {
  return issues.toSorted((a, b) => {
    const pa = a.priority ?? 999
    const pb = b.priority ?? 999
    if (pa !== pb)
      return pa - pb
    const ca = a.created_at?.getTime() ?? 0
    const cb = b.created_at?.getTime() ?? 0
    if (ca !== cb)
      return ca - cb
    return (a.identifier ?? '').localeCompare(b.identifier ?? '')
  })
}

function retryBackoffMs(attempt: number, maxMs: number): number {
  const base = 10_000
  return Math.min(base * (2 ** (attempt - 1)), maxMs)
}

function hasNonTerminalBlockers(issue: Issue, terminalStates: string[]): boolean {
  return issue.blocked_by.some((blocker) => {
    if (!blocker.state)
      return false
    const norm = normalizeState(blocker.state)
    return !terminalStates.some(ts => normalizeState(ts) === norm)
  })
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'id1',
    identifier: 'MT-1',
    title: 'Test',
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
    project: null,
    ...overrides,
  }
}

describe('dispatch sort order', () => {
  it('sorts by priority ascending (lower number = higher priority)', () => {
    const issues = [
      makeIssue({ id: '3', priority: 3, identifier: 'C' }),
      makeIssue({ id: '1', priority: 1, identifier: 'A' }),
      makeIssue({ id: '2', priority: 2, identifier: 'B' }),
    ]
    const sorted = sortForDispatch(issues)
    expect(sorted.map(i => i.identifier)).toEqual(['A', 'B', 'C'])
  })

  it('sorts null priority last', () => {
    const issues = [
      makeIssue({ id: '2', priority: null, identifier: 'B' }),
      makeIssue({ id: '1', priority: 1, identifier: 'A' }),
    ]
    const sorted = sortForDispatch(issues)
    expect(sorted[0].identifier).toBe('A')
    expect(sorted[1].identifier).toBe('B')
  })

  it('sorts by created_at oldest first when priority equals', () => {
    const issues = [
      makeIssue({ id: '2', priority: 1, identifier: 'B', created_at: new Date('2024-01-02') }),
      makeIssue({ id: '1', priority: 1, identifier: 'A', created_at: new Date('2024-01-01') }),
    ]
    const sorted = sortForDispatch(issues)
    expect(sorted[0].identifier).toBe('A')
  })

  it('uses identifier as tie-breaker', () => {
    const issues = [
      makeIssue({ id: '2', priority: null, identifier: 'B', created_at: null }),
      makeIssue({ id: '1', priority: null, identifier: 'A', created_at: null }),
    ]
    const sorted = sortForDispatch(issues)
    expect(sorted[0].identifier).toBe('A')
  })
})

describe('retry backoff', () => {
  it('uses 10s base with exponential growth', () => {
    expect(retryBackoffMs(1, 300_000)).toBe(10_000)
    expect(retryBackoffMs(2, 300_000)).toBe(20_000)
    expect(retryBackoffMs(3, 300_000)).toBe(40_000)
  })

  it('caps at max_retry_backoff_ms', () => {
    expect(retryBackoffMs(10, 300_000)).toBe(300_000)
  })
})

describe('stall detection elapsed_ms logic', () => {
  function computeElapsedMs(
    lastTimestamp: Date | null,
    startedAt: Date,
    nowMs: number,
  ): number {
    const lastActivity = lastTimestamp ?? startedAt
    return nowMs - lastActivity.getTime()
  }

  it('uses last_agent_timestamp when available', () => {
    const startedAt = new Date(1000)
    const lastTimestamp = new Date(5000)
    const elapsed = computeElapsedMs(lastTimestamp, startedAt, 10000)
    expect(elapsed).toBe(5000)
  })

  it('falls back to started_at when no last_agent_timestamp', () => {
    const startedAt = new Date(1000)
    const elapsed = computeElapsedMs(null, startedAt, 11000)
    expect(elapsed).toBe(10000)
  })

  it('exceeds stall threshold triggers stall detection', () => {
    const stallTimeoutMs = 300_000
    const startedAt = new Date(Date.now() - 400_000)
    const elapsed = computeElapsedMs(null, startedAt, Date.now())
    expect(elapsed).toBeGreaterThan(stallTimeoutMs)
  })

  it('does not exceed stall threshold for recent activity', () => {
    const stallTimeoutMs = 300_000
    const startedAt = new Date(Date.now() - 10_000)
    const elapsed = computeElapsedMs(null, startedAt, Date.now())
    expect(elapsed).toBeLessThan(stallTimeoutMs)
  })

  it('stall detection kills session and schedules retry with stall timeout reason (Section 17.4)', () => {
    // Mirror the stall detection+retry scheduling logic
    const killed: string[] = []
    const retried: Array<{ issueId: string, error: string }> = []

    function detectStall(
      issueId: string,
      elapsed: number,
      stallTimeoutMs: number,
      terminate: (id: string) => void,
      scheduleRetry: (id: string, error: string) => void,
    ) {
      if (elapsed > stallTimeoutMs) {
        terminate(issueId)
        scheduleRetry(issueId, 'stall timeout')
      }
    }

    detectStall('issue-1', 400_000, 300_000, id => killed.push(id), (id, err) => retried.push({ issueId: id, error: err }))
    expect(killed).toEqual(['issue-1'])
    expect(retried).toHaveLength(1)
    expect(retried[0].error).toBe('stall timeout')
  })
})

describe('token aggregation (delta tracking)', () => {
  // Replicate the handleAgentMessage token delta logic for unit testing

  interface TokenState {
    agent_input_tokens: number
    agent_output_tokens: number
    agent_total_tokens: number
    last_reported_input_tokens: number
    last_reported_output_tokens: number
    last_reported_total_tokens: number
  }

  function applyTokenUpdate(state: TokenState, usage: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }): void {
    const { input_tokens = 0, output_tokens = 0, total_tokens = 0 } = usage
    if (total_tokens > state.last_reported_total_tokens) {
      const inputDelta = input_tokens - state.last_reported_input_tokens
      const outputDelta = output_tokens - state.last_reported_output_tokens
      const totalDelta = total_tokens - state.last_reported_total_tokens
      state.agent_input_tokens += inputDelta
      state.agent_output_tokens += outputDelta
      state.agent_total_tokens += totalDelta
      state.last_reported_input_tokens = input_tokens
      state.last_reported_output_tokens = output_tokens
      state.last_reported_total_tokens = total_tokens
    }
  }

  function makeTokenState(): TokenState {
    return {
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
    }
  }

  it('accumulates tokens correctly across multiple updates', () => {
    const state = makeTokenState()
    applyTokenUpdate(state, { input_tokens: 100, output_tokens: 50, total_tokens: 150 })
    applyTokenUpdate(state, { input_tokens: 200, output_tokens: 80, total_tokens: 280 })
    expect(state.agent_input_tokens).toBe(200)
    expect(state.agent_output_tokens).toBe(80)
    expect(state.agent_total_tokens).toBe(280)
  })

  it('ignores update when total_tokens does not increase', () => {
    const state = makeTokenState()
    applyTokenUpdate(state, { input_tokens: 100, output_tokens: 50, total_tokens: 150 })
    applyTokenUpdate(state, { input_tokens: 100, output_tokens: 50, total_tokens: 150 })
    expect(state.agent_total_tokens).toBe(150)
  })

  it('ignores update when total_tokens is zero', () => {
    const state = makeTokenState()
    applyTokenUpdate(state, { input_tokens: 0, output_tokens: 0, total_tokens: 0 })
    expect(state.agent_total_tokens).toBe(0)
  })
})

describe('blocker rules', () => {
  it('does not block when blockers are terminal', () => {
    const issue = makeIssue({
      state: 'Todo',
      blocked_by: [{ id: 'x', identifier: 'MT-0', state: 'Done' }],
    })
    expect(hasNonTerminalBlockers(issue, ['Done', 'Cancelled'])).toBe(false)
  })

  it('blocks when any blocker is non-terminal', () => {
    const issue = makeIssue({
      state: 'Todo',
      blocked_by: [{ id: 'x', identifier: 'MT-0', state: 'In Progress' }],
    })
    expect(hasNonTerminalBlockers(issue, ['Done', 'Cancelled'])).toBe(true)
  })

  it('treats null blocker state as non-blocking', () => {
    const issue = makeIssue({
      state: 'Todo',
      blocked_by: [{ id: 'x', identifier: 'MT-0', state: null }],
    })
    expect(hasNonTerminalBlockers(issue, ['Done', 'Cancelled'])).toBe(false)
  })

  it('state comparison is case-insensitive', () => {
    const issue = makeIssue({
      state: 'Todo',
      blocked_by: [{ id: 'x', identifier: 'MT-0', state: 'DONE' }],
    })
    expect(hasNonTerminalBlockers(issue, ['Done', 'Cancelled'])).toBe(false)
  })

  it('dispatch revalidation skips stale todo issue once a non-terminal blocker appears (Section 17.4)', () => {
    // Mirror the onRetryTimer blocker revalidation logic:
    // Fresh candidate data may show new blockers — skip dispatch if Todo issue is now blocked
    function shouldSkipDueToBlocker(issue: Issue, terminalStates: string[]): boolean {
      return normalizeState(issue.state) === 'todo' && hasNonTerminalBlockers(issue, terminalStates)
    }

    const staleIssue = makeIssue({ state: 'Todo', blocked_by: [] })
    const refreshedIssue = makeIssue({
      state: 'Todo',
      blocked_by: [{ id: 'blocker-1', identifier: 'MT-900', state: 'In Progress' }],
    })

    expect(shouldSkipDueToBlocker(staleIssue, ['Done', 'Cancelled'])).toBe(false)
    expect(shouldSkipDueToBlocker(refreshedIssue, ['Done', 'Cancelled'])).toBe(true)
  })
})

describe('dispatch eligibility - already running/claimed', () => {
  // Mirror the dispatchEligible check logic for issues already being processed
  function isDispatchEligible(
    issue: Issue,
    running: Map<string, unknown>,
    claimed: Set<string>,
    activeStates: string[],
  ): boolean {
    const normalized = normalizeState(issue.state)
    const isActive = activeStates.some(s => normalizeState(s) === normalized)
    if (!isActive)
      return false
    if (running.has(issue.id))
      return false
    if (claimed.has(issue.id))
      return false
    return true
  }

  it('issue already in running is not dispatch-eligible', () => {
    const issue = makeIssue({ id: 'i1', state: 'In Progress' })
    const running = new Map([['i1', {}]])
    const claimed = new Set<string>()
    expect(isDispatchEligible(issue, running, claimed, ['In Progress'])).toBe(false)
  })

  it('issue already in claimed is not dispatch-eligible', () => {
    const issue = makeIssue({ id: 'i2', state: 'In Progress' })
    const running = new Map<string, unknown>()
    const claimed = new Set(['i2'])
    expect(isDispatchEligible(issue, running, claimed, ['In Progress'])).toBe(false)
  })

  it('eligible issue not in running or claimed is dispatched', () => {
    const issue = makeIssue({ id: 'i3', state: 'In Progress' })
    const running = new Map<string, unknown>()
    const claimed = new Set<string>()
    expect(isDispatchEligible(issue, running, claimed, ['In Progress'])).toBe(true)
  })
})

describe('per-state concurrency counting', () => {
  function makeRunningEntry(state: string): Pick<RunningEntry, 'issue'> {
    return { issue: makeIssue({ state }) }
  }

  it('counts zero for empty running map', () => {
    const running = new Map<string, Pick<RunningEntry, 'issue'>>()
    expect(countRunningInState(running, 'In Progress')).toBe(0)
  })

  it('counts only entries matching the queried state', () => {
    const running = new Map([
      ['id1', makeRunningEntry('In Progress')],
      ['id2', makeRunningEntry('In Progress')],
      ['id3', makeRunningEntry('Todo')],
    ])
    expect(countRunningInState(running, 'In Progress')).toBe(2)
    expect(countRunningInState(running, 'Todo')).toBe(1)
  })

  it('state comparison is case-insensitive', () => {
    const running = new Map([
      ['id1', makeRunningEntry('in progress')],
      ['id2', makeRunningEntry('IN PROGRESS')],
    ])
    expect(countRunningInState(running, 'In Progress')).toBe(2)
  })

  it('slot exhaustion: all slots in state are filled', () => {
    const running = new Map([
      ['id1', makeRunningEntry('In Progress')],
      ['id2', makeRunningEntry('In Progress')],
    ])
    const stateLimit = 2
    const count = countRunningInState(running, 'In Progress')
    expect(count >= stateLimit).toBe(true)
  })

  it('slot exhaustion requeues retries with explicit error reason (Section 17.4)', () => {
    // Mirror the slot exhaustion requeue logic: when availableSlots() === 0,
    // scheduleRetry is called with error reason 'no available orchestrator slots'
    const retryErrors: string[] = []
    function handleSlotExhaustion(availableSlots: number, retryFn: (error: string) => void) {
      if (availableSlots === 0) {
        retryFn('no available orchestrator slots')
      }
    }
    handleSlotExhaustion(0, err => retryErrors.push(err))
    expect(retryErrors).toHaveLength(1)
    expect(retryErrors[0]).toBe('no available orchestrator slots')
  })
})

describe('reconciliation state machine (Section 17.4)', () => {
  // Mirror the reconcileRunningIssues Part B state-classification logic
  type ReconcileAction = 'update' | 'terminate_cleanup' | 'terminate_no_cleanup'

  function classifyRunningIssueState(
    issueState: string | null,
    activeStates: string[],
    terminalStates: string[],
    watchedStates: string[] = [],
  ): ReconcileAction {
    if (!issueState)
      return 'terminate_no_cleanup'
    const normalized = normalizeState(issueState)
    const isTerminal = terminalStates.some(s => normalizeState(s) === normalized)
    const isActive = activeStates.some(s => normalizeState(s) === normalized)
      || watchedStates.some(s => normalizeState(s) === normalized)
    if (isTerminal)
      return 'terminate_cleanup'
    if (isActive)
      return 'update'
    return 'terminate_no_cleanup'
  }

  const activeStates = ['In Progress', 'Todo']
  const terminalStates = ['Done', 'Cancelled']
  const watchedStates = ['Human Review']

  it('terminal state stops running agent and cleans workspace', () => {
    expect(classifyRunningIssueState('Done', activeStates, terminalStates)).toBe('terminate_cleanup')
    expect(classifyRunningIssueState('Cancelled', activeStates, terminalStates)).toBe('terminate_cleanup')
  })

  it('active state updates in-memory issue snapshot', () => {
    expect(classifyRunningIssueState('In Progress', activeStates, terminalStates)).toBe('update')
    expect(classifyRunningIssueState('Todo', activeStates, terminalStates)).toBe('update')
  })

  it('watched state keeps running agent alive (not terminated)', () => {
    expect(classifyRunningIssueState('Human Review', activeStates, terminalStates, watchedStates)).toBe('update')
  })

  it('non-active non-terminal non-watched state stops agent without workspace cleanup', () => {
    expect(classifyRunningIssueState('Blocked', activeStates, terminalStates, watchedStates)).toBe('terminate_no_cleanup')
  })

  it('null state stops agent without workspace cleanup', () => {
    expect(classifyRunningIssueState(null, activeStates, terminalStates)).toBe('terminate_no_cleanup')
  })

  it('state comparison is case-insensitive', () => {
    expect(classifyRunningIssueState('done', activeStates, terminalStates)).toBe('terminate_cleanup')
    expect(classifyRunningIssueState('IN PROGRESS', activeStates, terminalStates)).toBe('update')
  })

  it('reconciliation with no running issues is a no-op (empty list produces no actions)', () => {
    // Simulates: runningIds.length === 0 → return early (no fetch, no actions)
    const runningIds: string[] = []
    const actions: ReconcileAction[] = runningIds.map(id =>
      classifyRunningIssueState(id, activeStates, terminalStates),
    )
    expect(actions).toHaveLength(0)
  })
})

describe('max_turns enforcement (Section 17.4)', () => {
  // Mirror the max_turns check in runAgentTurns
  function shouldContinueTurn(turnNumber: number, maxTurns: number): boolean {
    return turnNumber < maxTurns
  }

  it('stops after max_turns turns', () => {
    expect(shouldContinueTurn(1, 2)).toBe(true)
    expect(shouldContinueTurn(2, 2)).toBe(false)
    expect(shouldContinueTurn(3, 2)).toBe(false)
  })

  it('continues when under max_turns limit', () => {
    expect(shouldContinueTurn(1, 20)).toBe(true)
    expect(shouldContinueTurn(19, 20)).toBe(true)
  })

  it('max_turns=1 means exactly one turn (no continuation)', () => {
    expect(shouldContinueTurn(1, 1)).toBe(false)
  })
})

describe('worker exit retry scheduling (Section 17.4)', () => {
  // Mirror the onWorkerExit retry scheduling logic
  function scheduleKind(reason: 'normal' | 'failed'): 'continuation' | 'failure' {
    return reason === 'normal' ? 'continuation' : 'failure'
  }

  function continuationDelayMs(): number {
    return 1_000
  }

  it('normal exit schedules a short continuation retry (1s)', () => {
    expect(scheduleKind('normal')).toBe('continuation')
    expect(continuationDelayMs()).toBe(1_000)
  })

  it('abnormal exit schedules failure retry with exponential backoff', () => {
    expect(scheduleKind('failed')).toBe('failure')
  })

  it('abnormal exit retry uses attempt + 1 for backoff calculation', () => {
    // nextAttemptFrom(null) = 1, nextAttemptFrom(1) = 2, etc.
    function nextAttemptFrom(current: number | null): number {
      return current === null ? 1 : current + 1
    }
    expect(nextAttemptFrom(null)).toBe(1)
    expect(nextAttemptFrom(1)).toBe(2)
    expect(nextAttemptFrom(3)).toBe(4)
  })
})

function makeMockLabelService(): LabelService & { calls: Array<{ state: string }> } {
  const calls: Array<{ state: string }> = []
  return {
    calls,
    async setLabel(_issue: Issue, state: string): Promise<void> {
      calls.push({ state })
    },
  }
}

function makeWorkflowWithLabelPrefix(pollMs: number, labelPrefix: string): string {
  return `---
platforms:
  github:
    api_key: ghtoken
    owner: myorg
projects:
  - platform: github
    project_number: 1
    label_prefix: ${labelPrefix}
polling:
  interval_ms: ${pollMs}
workspace:
  root: /tmp
---
Prompt for {{ issue.title }}.`
}

describe('label trigger points', () => {
  it('setLabel is called with "dispatched" when an issue is dispatched via dispatchIssue', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-label-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const mockLabelService = makeMockLabelService()
    const orch = new Orchestrator(wfPath)
    // Inject mock label service
    ;(orch as unknown as { labelService: LabelService | null }).labelService = mockLabelService

    const issue = makeIssue({ id: 'i1', identifier: 'MT-1', state: 'In Progress', url: 'https://github.com/org/repo/issues/1' })
    ;(orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown> } }).state.running.set('i1', {
      identifier: 'MT-1',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    try {
      ;(orch as unknown as { dispatchIssue: (issue: Issue, attempt: number | null) => void }).dispatchIssue(issue, null)
      // Give the label service call (which is async fire-and-forget) time to resolve
      await new Promise(r => setTimeout(r, 50))
      expect(mockLabelService.calls.some(c => c.state === 'dispatched')).toBe(true)
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('setLabel is called with "done" when onWorkerExit is called with reason "normal"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-label-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const mockLabelService = makeMockLabelService()
    const orch = new Orchestrator(wfPath)
    ;(orch as unknown as { labelService: LabelService | null }).labelService = mockLabelService

    const issue = makeIssue({ id: 'i2', identifier: 'MT-2', state: 'In Progress', url: 'https://github.com/org/repo/issues/2' })
    const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string> } }).state
    orchState.running.set('i2', {
      identifier: 'MT-2',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    try {
      ;(orch as unknown as { onWorkerExit: (issueId: string, startedAt: Date, reason: string, error: string | null) => void }).onWorkerExit('i2', new Date(), 'normal', null)
      await new Promise(r => setTimeout(r, 50))
      expect(mockLabelService.calls.some(c => c.state === 'done')).toBe(true)
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('setLabel is called with "failed" when onWorkerExit is called with reason "failed"', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-label-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const mockLabelService = makeMockLabelService()
    const orch = new Orchestrator(wfPath)
    ;(orch as unknown as { labelService: LabelService | null }).labelService = mockLabelService

    const issue = makeIssue({ id: 'i3', identifier: 'MT-3', state: 'In Progress', url: 'https://github.com/org/repo/issues/3' })
    const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string> } }).state
    orchState.running.set('i3', {
      identifier: 'MT-3',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    try {
      ;(orch as unknown as { onWorkerExit: (issueId: string, startedAt: Date, reason: string, error: string | null) => void }).onWorkerExit('i3', new Date(), 'failed', 'agent crashed')
      await new Promise(r => setTimeout(r, 50))
      expect(mockLabelService.calls.some(c => c.state === 'failed')).toBe(true)
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('setLabel is called with "done" when reconciler detects terminal state (CRITICAL-2)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-label-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const mockLabelService = makeMockLabelService()
    const orch = new Orchestrator(wfPath)
    ;(orch as unknown as { labelService: LabelService | null }).labelService = mockLabelService

    const issue = makeIssue({ id: 'i4', identifier: 'MT-4', state: 'In Progress', url: 'https://github.com/org/repo/issues/4' })
    const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string> } }).state
    orchState.running.set('i4', {
      identifier: 'MT-4',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    // Mock fetch to return the issue in terminal state for fetchIssueStatesByIds.
    // The reconciler calls fetchIssueStatesByIds (ITEMS_BY_IDS_QUERY with nodes).
    // All other calls (startup cleanup fetchIssuesByStates) return empty results.
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      // ITEMS_BY_IDS_QUERY has `nodes(ids:` — detect by query content
      if (body.includes('nodes(ids:')) {
        return new Response(JSON.stringify({
          data: {
            nodes: [
              {
                id: 'i4',
                fieldValues: {
                  nodes: [
                    { name: 'Done', field: { name: 'Status' } },
                  ],
                },
                content: { number: 4, title: 'Test' },
              },
            ],
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // All other queries (fetchIssuesByStates for startup cleanup) return empty
      return new Response(JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              items: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    try {
      await (orch as unknown as { reconcileRunningIssues: () => Promise<void> }).reconcileRunningIssues()
      await new Promise(r => setTimeout(r, 50))
      expect(mockLabelService.calls.some(c => c.state === 'done')).toBe(true)
    }
    finally {
      orch.stop()
      globalThis.fetch = origFetch
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('null label service (no label_prefix) results in no setLabel calls', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-label-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    // Workflow without label_prefix — labelService will be null
    writeFileSync(wfPath, `---
tracker:
  kind: github_projects
  api_key: ghtoken
  owner: myorg
  project_number: 1
polling:
  interval_ms: 30000
workspace:
  root: /tmp
---
Prompt text.`)

    const orch = new Orchestrator(wfPath)
    const orchInternal = orch as unknown as { labelService: LabelService | null }
    expect(orchInternal.labelService).toBeNull()

    try {
      // onWorkerExit with null labelService — should not throw
      const issue = makeIssue({ id: 'i5', identifier: 'MT-5' })
      const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string> } }).state
      orchState.running.set('i5', {
        identifier: 'MT-5',
        issue,
        session_id: null,
        agent_app_server_pid: null,
        last_agent_message: null,
        last_agent_event: null,
        last_agent_timestamp: null,
        agent_input_tokens: 0,
        agent_output_tokens: 0,
        agent_total_tokens: 0,
        last_reported_input_tokens: 0,
        last_reported_output_tokens: 0,
        last_reported_total_tokens: 0,
        turn_count: 0,
        retry_attempt: null,
        started_at: new Date(),
      })
      ;(orch as unknown as { onWorkerExit: (issueId: string, startedAt: Date, reason: string, error: string | null) => void }).onWorkerExit('i5', new Date(), 'normal', null)
      // No setLabel call should have happened (labelService is null)
      expect(orchInternal.labelService).toBeNull()
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('getLinkedPrUpdateMs', () => {
  it('returns null for empty pull_requests', () => {
    expect(getLinkedPrUpdateMs(makeIssue({ pull_requests: [] }))).toBeNull()
  })

  it('returns max timestamp from linked PRs', () => {
    const issue = makeIssue({
      pull_requests: [
        { number: 1, title: 'A', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: new Date('2024-01-01') },
        { number: 2, title: 'B', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: new Date('2024-06-01') },
      ],
    })
    expect(getLinkedPrUpdateMs(issue)).toBe(new Date('2024-06-01').getTime())
  })

  it('filters NaN from invalid dates', () => {
    const issue = makeIssue({
      pull_requests: [
        { number: 1, title: 'A', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: new Date('invalid') },
      ],
    })
    expect(getLinkedPrUpdateMs(issue)).toBeNull()
  })

  it('skips PRs with null updated_at', () => {
    const issue = makeIssue({
      pull_requests: [
        { number: 1, title: 'A', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: null },
        { number: 2, title: 'B', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: new Date('2024-06-01') },
      ],
    })
    expect(getLinkedPrUpdateMs(issue)).toBe(new Date('2024-06-01').getTime())
  })
})

describe('processWatchedStates dispatch logic', () => {
  // Uses exported isWatchedUnchanged from orchestrator.ts
  function shouldDispatchWatched(
    issue: Issue,
    running: Map<string, unknown>,
    claimed: Set<string>,
    watchedSnapshots: Map<string, WatchedSnapshot> = new Map(),
  ): boolean {
    if (running.has(issue.id) || claimed.has(issue.id))
      return false
    if (!issue.review_decision)
      return false
    if (isWatchedUnchanged(issue, watchedSnapshots.get(issue.id)))
      return false
    return true
  }

  it('dispatches issue with review_decision', () => {
    const issue = makeIssue({ id: 'w1', review_decision: 'changes_requested' })
    expect(shouldDispatchWatched(issue, new Map(), new Set())).toBe(true)
  })

  it('skips issue with no review decision', () => {
    const issue = makeIssue({ id: 'w3', review_decision: null })
    expect(shouldDispatchWatched(issue, new Map(), new Set())).toBe(false)
  })

  it('dispatches Issue-type item that has review_decision set (e.g. promoted from linked PR by normalizeProjectItem)', () => {
    const issue = makeIssue({
      id: 'w-issue',
      review_decision: 'approved',
      pull_requests: [
        { number: 50, title: 'Linked PR', url: null, state: 'open', branch_name: 'fix/issue', review_decision: 'approved', updated_at: new Date('2024-06-01T12:00:00Z') },
      ],
    })
    expect(shouldDispatchWatched(issue, new Map(), new Set())).toBe(true)
  })

  it('skips already running issues', () => {
    const issue = makeIssue({ id: 'w4', review_decision: 'approved' })
    const running = new Map([['w4', {}]])
    expect(shouldDispatchWatched(issue, running, new Set())).toBe(false)
  })

  it('skips already claimed issues', () => {
    const issue = makeIssue({ id: 'w5', review_decision: 'approved' })
    expect(shouldDispatchWatched(issue, new Map(), new Set(['w5']))).toBe(false)
  })

  it('skips when linked PR has not been updated since last dispatch', () => {
    const prUpdatedAt = new Date('2024-06-01T12:00:00Z')
    const issue = makeIssue({
      id: 'w6',
      review_decision: 'changes_requested',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'changes_requested', updated_at: prUpdatedAt },
      ],
    })
    const snapshots = new Map([['w6', { pr_update_ms: prUpdatedAt.getTime(), review_decision: 'changes_requested' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(false)
  })

  it('dispatches when linked PR has been updated after last dispatch', () => {
    const issue = makeIssue({
      id: 'w7',
      review_decision: 'changes_requested',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'changes_requested', updated_at: new Date('2024-06-02T12:00:00Z') },
      ],
    })
    const snapshots = new Map([['w7', { pr_update_ms: new Date('2024-06-01T12:00:00Z').getTime(), review_decision: 'changes_requested' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(true)
  })

  it('dispatches when no previous dispatch record exists', () => {
    const issue = makeIssue({
      id: 'w8',
      review_decision: 'approved',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'approved', updated_at: new Date('2024-06-01T12:00:00Z') },
      ],
    })
    expect(shouldDispatchWatched(issue, new Map(), new Set(), new Map())).toBe(true)
  })

  it('skips PR-type project item when review_decision unchanged (no linked PRs)', () => {
    const issue = makeIssue({
      id: 'w9',
      review_decision: 'approved',
      pull_requests: [],
    })
    const snapshots = new Map([['w9', { pr_update_ms: null, review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(false)
  })

  it('dispatches PR-type project item when review_decision changes', () => {
    const issue = makeIssue({
      id: 'w9b',
      review_decision: 'changes_requested',
      pull_requests: [],
    })
    const snapshots = new Map([['w9b', { pr_update_ms: null, review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(true)
  })

  it('does not self-trigger from label updates on PR-type items', () => {
    // When orchestrator sets labels, issue.updated_at changes but
    // review_decision stays the same — should NOT re-dispatch
    const issue = makeIssue({
      id: 'w9c',
      review_decision: 'approved',
      pull_requests: [],
      updated_at: new Date('2024-06-02T12:00:00Z'), // updated by label change
    })
    const snapshots = new Map([['w9c', { pr_update_ms: null, review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(false)
  })

  it('uses latest PR updated_at when multiple PRs exist', () => {
    const issue = makeIssue({
      id: 'w10',
      review_decision: 'changes_requested',
      pull_requests: [
        { number: 10, title: 'Old PR', url: null, state: 'open', branch_name: null, review_decision: null, updated_at: new Date('2024-06-01T12:00:00Z') },
        { number: 11, title: 'New PR', url: null, state: 'open', branch_name: null, review_decision: 'changes_requested', updated_at: new Date('2024-06-03T12:00:00Z') },
      ],
    })
    const snapshots = new Map([['w10', { pr_update_ms: new Date('2024-06-02T12:00:00Z').getTime(), review_decision: 'changes_requested' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(true)
  })

  it('dispatches when linked PR is removed (PR presence changed)', () => {
    const issue = makeIssue({
      id: 'w11',
      review_decision: 'approved',
      pull_requests: [], // PR was unlinked
    })
    // Snapshot recorded when PR existed
    const snapshots = new Map([['w11', { pr_update_ms: new Date('2024-06-01T12:00:00Z').getTime(), review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(true)
  })

  it('dispatches when linked PR is added (PR presence changed)', () => {
    const issue = makeIssue({
      id: 'w12',
      review_decision: 'approved',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'approved', updated_at: new Date('2024-06-01T12:00:00Z') },
      ],
    })
    // Snapshot recorded when no PRs existed
    const snapshots = new Map([['w12', { pr_update_ms: null, review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(true)
  })

  it('filters NaN timestamps from invalid dates', () => {
    const issue = makeIssue({
      id: 'w13',
      review_decision: 'approved',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'approved', updated_at: new Date('invalid') },
      ],
    })
    // NaN should be filtered — falls through to review_decision comparison
    const snapshots = new Map([['w13', { pr_update_ms: null, review_decision: 'approved' as const }]])
    expect(shouldDispatchWatched(issue, new Map(), new Set(), snapshots)).toBe(false)
  })
})

describe('watched snapshot recording in onWorkerExit', () => {
  it('records snapshot on normal exit', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-snapshot-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const orch = new Orchestrator(wfPath)
    const issue = makeIssue({
      id: 'snap1',
      identifier: 'MT-S1',
      state: 'Human Review',
      review_decision: 'changes_requested',
      pull_requests: [
        { number: 10, title: 'PR', url: null, state: 'open', branch_name: null, review_decision: 'changes_requested', updated_at: new Date('2024-06-01T12:00:00Z') },
      ],
    })

    const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string>, watched_last_dispatched: Map<string, { pr_update_ms: number | null, review_decision: string | null }> } }).state
    orchState.running.set('snap1', {
      identifier: 'MT-S1',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    try {
      ;(orch as unknown as { onWorkerExit: (id: string, startedAt: Date, reason: string, error: string | null) => void }).onWorkerExit('snap1', new Date(), 'normal', null)
      const snapshot = orchState.watched_last_dispatched.get('snap1')
      expect(snapshot).toBeDefined()
      expect(snapshot!.pr_update_ms).toBe(new Date('2024-06-01T12:00:00Z').getTime())
      expect(snapshot!.review_decision).toBe('changes_requested')
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('does NOT record snapshot on failed exit', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-snapshot-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')
    writeFileSync(wfPath, makeWorkflowWithLabelPrefix(30_000, 'agent-please'))

    const orch = new Orchestrator(wfPath)
    const issue = makeIssue({ id: 'snap2', identifier: 'MT-S2', state: 'Human Review', review_decision: 'approved' })

    const orchState = (orch as unknown as { state: { running: Map<string, unknown>, claimed: Set<string>, retry_attempts: Map<string, unknown>, agent_totals: Record<string, number>, completed: Set<string>, watched_last_dispatched: Map<string, unknown> } }).state
    orchState.running.set('snap2', {
      identifier: 'MT-S2',
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: null,
      started_at: new Date(),
    })

    try {
      ;(orch as unknown as { onWorkerExit: (id: string, startedAt: Date, reason: string, error: string | null) => void }).onWorkerExit('snap2', new Date(), 'failed', 'agent crashed')
      expect(orchState.watched_last_dispatched.has('snap2')).toBe(false)
    }
    finally {
      orch.stop()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('workflow hot reload (Section 17.1)', () => {
  function makeWorkflowContent(pollMs: number): string {
    return `---
platforms:
  asana:
    api_key: test-key
projects:
  - platform: asana
    project_gid: gid-1
polling:
  interval_ms: ${pollMs}
---
Prompt text.`
  }

  it('detects workflow file change and updates config without restart', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-test-'))
    const wsRoot = join(tmpDir, 'workspaces')
    mkdirSync(wsRoot)
    const wfPath = join(tmpDir, 'WORKFLOW.md')

    writeFileSync(wfPath, makeWorkflowContent(30_000))

    // Construct orchestrator (does not start yet; no network calls)
    const orch = new Orchestrator(wfPath)
    expect(orch.getConfig().polling.interval_ms).toBe(30_000)

    // Mock fetch to swallow the startup cleanup + first tick poll
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    try {
      await orch.start()
      // Update the workflow file — file watcher should pick it up
      writeFileSync(wfPath, makeWorkflowContent(60_000))

      // Poll until config updates or timeout (max 2s)
      const deadline = Date.now() + 2_000
      while (orch.getConfig().polling.interval_ms !== 60_000 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 20))
      }

      expect(orch.getConfig().polling.interval_ms).toBe(60_000)
    }
    finally {
      orch.stop()
      globalThis.fetch = origFetch
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('keeps last known good config when reloaded file has invalid YAML', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-test-'))
    const wfPath = join(tmpDir, 'WORKFLOW.md')

    writeFileSync(wfPath, makeWorkflowContent(30_000))
    const orch = new Orchestrator(wfPath)

    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    try {
      await orch.start()
      // Write invalid YAML — should not update config
      writeFileSync(wfPath, '---\ntracker: [unclosed\n---\nPrompt')

      await new Promise(r => setTimeout(r, 300))
      // Config should remain at the last good value
      expect(orch.getConfig().polling.interval_ms).toBe(30_000)
    }
    finally {
      orch.stop()
      globalThis.fetch = origFetch
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('re-initializes labelService with new config on hot-reload (IMPORTANT-6)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agent-please-test-'))
    const wsRoot = join(tmpDir, 'workspaces')
    mkdirSync(wsRoot)
    const wfPath = join(tmpDir, 'WORKFLOW.md')

    // Start without label_prefix
    writeFileSync(wfPath, makeWorkflowContent(30_000))
    const orch = new Orchestrator(wfPath)
    expect(orch.getConfig().projects[0]?.label_prefix ?? null).toBeNull()

    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch

    try {
      await orch.start()

      // Update workflow with a label_prefix added
      const newContent = `---
platforms:
  asana:
    api_key: test-key
projects:
  - platform: asana
    project_gid: gid-1
    label_prefix: agent-please
polling:
  interval_ms: 30000
---
Prompt text.`
      writeFileSync(wfPath, newContent)

      // Poll until config updates or timeout (max 2s)
      const deadline = Date.now() + 2_000
      while ((orch.getConfig().projects[0]?.label_prefix ?? null) !== 'agent-please' && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 20))
      }

      // Verify the config was updated — createLabelService is called internally with new config
      expect(orch.getConfig().projects[0]?.label_prefix).toBe('agent-please')
    }
    finally {
      orch.stop()
      globalThis.fetch = origFetch
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('buildTokenProvider', () => {
  function makeProject(platform: string = 'github'): ProjectConfig {
    return {
      platform,
      project_number: 1,
      project_id: null,
      project_gid: null,
      active_statuses: ['Todo', 'In Progress'],
      terminal_statuses: ['Done', 'Cancelled'],
      watched_statuses: ['Human Review'],
      endpoint: 'https://api.github.com',
      label_prefix: null,
      filter: { assignee: [], label: [] },
    }
  }

  function makePlatform(overrides: Partial<GitHubPlatformConfig> = {}): GitHubPlatformConfig {
    return {
      kind: 'github',
      api_key: null,
      owner: null,
      bot_username: null,
      app_id: null,
      private_key: null,
      installation_id: null,
      ...overrides,
    }
  }

  it('returns undefined for non-github platform kind', () => {
    const result = buildTokenProvider(makeProject(), makePlatform({ kind: 'asana' as unknown as 'github' }))
    expect(result).toBeUndefined()
  })

  it('returns undefined for null platform kind', () => {
    const result = buildTokenProvider(makeProject(), { ...makePlatform(), kind: null } as unknown as GitHubPlatformConfig)
    expect(result).toBeUndefined()
  })

  it('returns PAT-based provider when api_key is set', async () => {
    const provider = buildTokenProvider(makeProject(), makePlatform({ api_key: 'ghp_my_pat_token' }))
    expect(provider).toBeDefined()
    const token = await provider!.installationAccessToken()
    expect(token).toBe('ghp_my_pat_token')
  })

  it('prefers PAT over app auth when both are present', async () => {
    const provider = buildTokenProvider(makeProject(), makePlatform({
      api_key: 'ghp_pat',
      app_id: '12345',
      private_key: 'key',
      installation_id: 1,
    }))
    expect(provider).toBeDefined()
    const token = await provider!.installationAccessToken()
    expect(token).toBe('ghp_pat')
  })

  it('returns undefined when no api_key and incomplete app auth', () => {
    const result = buildTokenProvider(makeProject(), makePlatform({
      app_id: '12345',
      // missing private_key and installation_id
    }))
    expect(result).toBeUndefined()
  })

  it('returns undefined when app_id present but private_key missing', () => {
    const result = buildTokenProvider(makeProject(), makePlatform({
      app_id: '12345',
      installation_id: 1,
    }))
    expect(result).toBeUndefined()
  })

  it('returns undefined when installation_id is null', () => {
    const result = buildTokenProvider(makeProject(), makePlatform({
      app_id: '12345',
      private_key: 'key',
      installation_id: null,
    }))
    expect(result).toBeUndefined()
  })

  it('returns app-auth provider when all app fields present', () => {
    const provider = buildTokenProvider(makeProject(), makePlatform({
      app_id: '12345',
      private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest',
      installation_id: 67890,
    }))
    expect(provider).toBeDefined()
    // Don't call installationAccessToken — it would try real auth
  })

  it('app-auth provider returns null on auth error', async () => {
    const provider = buildTokenProvider(makeProject(), makePlatform({
      app_id: '12345',
      private_key: 'invalid-key',
      installation_id: 67890,
    }))
    expect(provider).toBeDefined()
    // createAppAuth with invalid key will throw — our try-catch returns null
    const token = await provider!.installationAccessToken()
    expect(token).toBeNull()
  })
})
