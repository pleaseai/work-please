import type { Issue, OrchestratorState, RetryEntry, RunningEntry } from '@pleaseai/agent-core'
import { ORPCError } from '@orpc/server'
import { createTrackerAdapter, fetchSessionMessages, isTrackerError, isValidSessionId, workspacePath } from '@pleaseai/agent-core'
import { authed } from './middleware'
import {
  boardLiveEventSchema,
  boardResponseSchema,
  issueDetailInputSchema,
  liveStateEventSchema,
  projectBoardInputSchema,
  projectsResponseSchema,
  refreshResponseSchema,
  sessionMessagesInputSchema,
  stateResponseSchema,
} from './schemas'

// --- Helpers (migrated from REST handlers) ---

function runningEntryPayload(r: RunningEntry) {
  return {
    issue_id: r.issue.id,
    issue_identifier: r.identifier,
    state: r.issue.state,
    session_id: r.session_id,
    turn_count: r.turn_count,
    last_event: r.last_agent_event,
    last_message: r.last_agent_message,
    started_at: r.started_at.toISOString(),
    last_event_at: r.last_agent_timestamp?.toISOString() ?? null,
    tokens: {
      input_tokens: r.agent_input_tokens,
      output_tokens: r.agent_output_tokens,
      total_tokens: r.agent_total_tokens,
    },
  }
}

function retryEntryPayload(r: RetryEntry) {
  return {
    issue_id: r.issue_id,
    issue_identifier: r.identifier,
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }
}

function computeLiveSecondsRunning(state: OrchestratorState): number {
  const now = Date.now()
  let total = 0
  for (const entry of state.running.values()) {
    total += (now - entry.started_at.getTime()) / 1000
  }
  return total
}

function findRunningByIdentifier(state: OrchestratorState, identifier: string): RunningEntry | undefined {
  for (const entry of state.running.values()) {
    if (entry.identifier === identifier)
      return entry
  }
  return undefined
}

function findRetryByIdentifier(state: OrchestratorState, identifier: string): RetryEntry | undefined {
  for (const entry of state.retry_attempts.values()) {
    if (entry.identifier === identifier)
      return entry
  }
  return undefined
}

function buildStateResponse(state: OrchestratorState) {
  const running = Array.from(state.running.values(), r => runningEntryPayload(r))
  const retrying = Array.from(state.retry_attempts.values(), r => retryEntryPayload(r))
  const liveSecondsRunning = computeLiveSecondsRunning(state)

  return {
    generated_at: new Date().toISOString(),
    counts: {
      running: running.length,
      retrying: retrying.length,
    },
    running,
    retrying,
    codex_totals: {
      input_tokens: state.agent_totals.input_tokens,
      output_tokens: state.agent_totals.output_tokens,
      total_tokens: state.agent_totals.total_tokens,
      seconds_running: state.agent_totals.seconds_running + liveSecondsRunning,
    },
    rate_limits: state.agent_rate_limits,
  }
}

// --- Orchestrator procedures ---

const getState = authed
  .route({ method: 'GET', path: '/state' })
  .output(stateResponseSchema)
  .handler(({ context }) => {
    const state = context.orchestrator.getState()
    return buildStateResponse(state)
  })

const refresh = authed
  .route({ method: 'POST', path: '/refresh' })
  .output(refreshResponseSchema)
  .handler(({ context }) => {
    context.orchestrator.triggerRefresh()
    return {
      queued: true as const,
      requested_at: new Date().toISOString(),
      operations: ['poll', 'reconcile'],
    }
  })

const live = authed
  .output(liveStateEventSchema)
  .handler(async function* ({ context, signal }) {
    // Yield initial state immediately
    const initialState = context.orchestrator.getState()
    yield buildStateResponse(initialState)

    // Then yield on interval until client disconnects
    while (!signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (signal?.aborted)
        break
      const state = context.orchestrator.getState()
      yield buildStateResponse(state)
    }
  })

// --- Issue procedures ---

const getIssueDetail = authed
  .route({ method: 'GET', path: '/issues/{identifier}' })
  .input(issueDetailInputSchema)
  .handler(({ input, context }) => {
    const state = context.orchestrator.getState()
    const config = context.orchestrator.getConfig()
    const wsPath = workspacePath(config, input.identifier)

    const running = findRunningByIdentifier(state, input.identifier)
    const retry = findRetryByIdentifier(state, input.identifier)

    if (!running && !retry) {
      throw new ORPCError('NOT_FOUND', { message: `Issue not found: ${input.identifier}` })
    }

    const issueId = running?.issue.id ?? retry?.issue_id ?? ''
    const status = running ? 'running' as const : 'retrying' as const

    return {
      issue_identifier: input.identifier,
      issue_id: issueId,
      status,
      workspace: { path: wsPath },
      attempts: {
        restart_count: Math.max((retry?.attempt ?? 0) - 1, 0),
        current_retry_attempt: retry?.attempt ?? 0,
      },
      running: running
        ? {
            session_id: running.session_id,
            turn_count: running.turn_count,
            state: running.issue.state,
            started_at: running.started_at.toISOString(),
            last_event: running.last_agent_event,
            last_message: running.last_agent_message,
            last_event_at: running.last_agent_timestamp?.toISOString() ?? null,
            tokens: {
              input_tokens: running.agent_input_tokens,
              output_tokens: running.agent_output_tokens,
              total_tokens: running.agent_total_tokens,
            },
          }
        : null,
      retry: retry
        ? {
            attempt: retry.attempt,
            due_at: new Date(retry.due_at_ms).toISOString(),
            error: retry.error,
          }
        : null,
      recent_events: running && running.last_agent_timestamp
        ? [{
            at: running.last_agent_timestamp.toISOString(),
            event: running.last_agent_event ?? '',
            message: running.last_agent_message,
          }]
        : [],
      last_error: retry?.error ?? null,
    }
  })

// --- Session procedures ---

const getSessionMessages = authed
  .route({ method: 'GET', path: '/sessions/{sessionId}/messages' })
  .input(sessionMessagesInputSchema)
  .handler(async ({ input, context }) => {
    if (!isValidSessionId(input.sessionId)) {
      throw new ORPCError('BAD_REQUEST', { message: 'Invalid session ID' })
    }

    const config = context.orchestrator.getConfig()

    try {
      return await fetchSessionMessages(input.sessionId, config.workspace.root, {
        limit: input.limit ?? null,
        offset: input.offset ?? null,
      })
    }
    catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as any).code : undefined
      const msg = err instanceof Error ? err.message : String(err)
      if (code === 'ENOENT' || msg.toLowerCase().includes('not found'))
        return []
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to load session messages' })
    }
  })

// --- Project helpers ---

function buildProjectPayload(project: import('@pleaseai/agent-core').ProjectConfig, index: number) {
  return {
    index,
    platform: project.platform,
    project_number: project.project_number ?? null,
    project_id: project.project_id ?? null,
    active_statuses: project.active_statuses,
    terminal_statuses: project.terminal_statuses,
    watched_statuses: project.watched_statuses,
  }
}

function buildBoardIssue(issue: Issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state,
    priority: issue.priority,
    url: issue.url,
    assignees: issue.assignees,
    labels: issue.labels,
  }
}

async function fetchBoardData(context: { orchestrator: import('@pleaseai/agent-core').Orchestrator }, projectIndex: number) {
  const config = context.orchestrator.getConfig()
  const project = config.projects[projectIndex]
  if (!project) {
    throw new ORPCError('NOT_FOUND', { message: `Project not found at index ${projectIndex}` })
  }

  const platform = config.platforms[project.platform]
  if (!platform) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `Platform '${project.platform}' not configured` })
  }

  // Only GitHub is supported for board view
  if (platform.kind !== 'github') {
    throw new ORPCError('BAD_REQUEST', { message: `Board view is only supported for GitHub projects (got '${platform.kind}')` })
  }

  const adapter = createTrackerAdapter(project, platform)
  if (isTrackerError(adapter)) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `Failed to create tracker adapter: ${adapter.code}` })
  }

  const allStatuses = [...project.active_statuses, ...project.watched_statuses, ...project.terminal_statuses]
  const issues = await adapter.fetchIssuesByStates(allStatuses)
  if (isTrackerError(issues)) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: `Failed to fetch issues: ${issues.code}` })
  }

  // Group issues by status into columns
  const columnMap = new Map<string, Issue[]>()
  for (const status of allStatuses) {
    columnMap.set(status, [])
  }
  for (const issue of issues) {
    const bucket = columnMap.get(issue.state)
    if (bucket) {
      bucket.push(issue)
    }
    else {
      // Issue has an unknown status — create a column for it
      columnMap.set(issue.state, [issue])
    }
  }

  const columns = Array.from(columnMap.entries(), ([status, statusIssues]) => ({
    status,
    issues: statusIssues.map(buildBoardIssue),
    count: statusIssues.length,
  }))

  return {
    project: buildProjectPayload(project, projectIndex),
    columns,
    generated_at: new Date().toISOString(),
  }
}

// --- Project procedures ---

const listProjects = authed
  .route({ method: 'GET', path: '/projects' })
  .output(projectsResponseSchema)
  .handler(({ context }) => {
    const config = context.orchestrator.getConfig()
    const projects = config.projects.map((p, i) => buildProjectPayload(p, i))
    return { projects }
  })

const getProjectBoard = authed
  .route({ method: 'GET', path: '/projects/{id}/board' })
  .input(projectBoardInputSchema)
  .output(boardResponseSchema)
  .handler(async ({ input, context }) => {
    return fetchBoardData(context, input.id)
  })

const liveProjectBoard = authed
  .input(projectBoardInputSchema)
  .output(boardLiveEventSchema)
  .handler(async function* ({ input, context, signal }) {
    // Yield initial board state
    yield await fetchBoardData(context, input.id)

    // Poll and yield updates until client disconnects
    while (!signal?.aborted) {
      await new Promise(resolve => setTimeout(resolve, 10000))
      if (signal?.aborted)
        break
      yield await fetchBoardData(context, input.id)
    }
  })

// --- Router ---

export const router = {
  orchestrator: {
    state: getState,
    refresh,
    live,
  },
  issues: {
    detail: getIssueDetail,
  },
  sessions: {
    messages: getSessionMessages,
  },
  projects: {
    list: listProjects,
    board: getProjectBoard,
    live: liveProjectBoard,
  },
}
