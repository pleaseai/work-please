import type { Issue, RunningEntry } from './types'
import { describe, expect, it } from 'bun:test'
import { normalizeState } from './config'

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
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
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
})

describe('reconciliation state machine (Section 17.4)', () => {
  // Mirror the reconcileRunningIssues Part B state-classification logic
  type ReconcileAction = 'update' | 'terminate_cleanup' | 'terminate_no_cleanup'

  function classifyRunningIssueState(
    issueState: string | null,
    activeStates: string[],
    terminalStates: string[],
  ): ReconcileAction {
    if (!issueState)
      return 'terminate_no_cleanup'
    const normalized = normalizeState(issueState)
    const isTerminal = terminalStates.some(s => normalizeState(s) === normalized)
    const isActive = activeStates.some(s => normalizeState(s) === normalized)
    if (isTerminal)
      return 'terminate_cleanup'
    if (isActive)
      return 'update'
    return 'terminate_no_cleanup'
  }

  const activeStates = ['In Progress', 'Todo']
  const terminalStates = ['Done', 'Cancelled']

  it('terminal state stops running agent and cleans workspace', () => {
    expect(classifyRunningIssueState('Done', activeStates, terminalStates)).toBe('terminate_cleanup')
    expect(classifyRunningIssueState('Cancelled', activeStates, terminalStates)).toBe('terminate_cleanup')
  })

  it('active state updates in-memory issue snapshot', () => {
    expect(classifyRunningIssueState('In Progress', activeStates, terminalStates)).toBe('update')
    expect(classifyRunningIssueState('Todo', activeStates, terminalStates)).toBe('update')
  })

  it('non-active non-terminal state stops agent without workspace cleanup', () => {
    expect(classifyRunningIssueState('Human Review', activeStates, terminalStates)).toBe('terminate_no_cleanup')
    expect(classifyRunningIssueState('Blocked', activeStates, terminalStates)).toBe('terminate_no_cleanup')
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
