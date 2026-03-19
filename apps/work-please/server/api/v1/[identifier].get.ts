import type { OrchestratorState, RetryEntry, RunningEntry } from '@pleaseai/core'
import { workspacePath } from '@pleaseai/core'

export default defineEventHandler((event) => {
  const orchestrator = useOrchestrator(event)
  const identifier = getRouterParam(event, 'identifier') ?? ''

  if (!identifier) {
    throw createError({ statusCode: 400, statusMessage: 'Missing identifier' })
  }

  const state = orchestrator.getState()
  const config = orchestrator.getConfig()
  const wsPath = workspacePath(config, identifier)

  const running = findRunningByIdentifier(state, identifier)
  const retry = findRetryByIdentifier(state, identifier)

  if (!running && !retry) {
    throw createError({ statusCode: 404, statusMessage: `Issue not found: ${identifier}` })
  }

  const issueId = running?.issue.id ?? retry?.issue_id ?? ''
  const status = running ? 'running' : 'retrying'

  return {
    issue_identifier: identifier,
    issue_id: issueId,
    status,
    workspace: { path: wsPath },
    attempts: {
      restart_count: Math.max((retry?.attempt ?? 0) - 1, 0),
      current_retry_attempt: retry?.attempt ?? 0,
    },
    running: running ? runningIssuePayload(running) : null,
    retry: retry ? retryIssuePayload(retry) : null,
    logs: { codex_session_logs: [] },
    recent_events: running ? recentEventsPayload(running) : [],
    last_error: retry?.error ?? null,
    tracked: {},
  }
})

function runningIssuePayload(r: RunningEntry) {
  return {
    session_id: r.session_id,
    turn_count: r.turn_count,
    state: r.issue.state,
    started_at: r.started_at.toISOString(),
    last_event: r.last_agent_event,
    last_message: r.last_agent_message,
    last_event_at: r.last_agent_timestamp?.toISOString() ?? null,
    tokens: {
      input_tokens: r.agent_input_tokens,
      output_tokens: r.agent_output_tokens,
      total_tokens: r.agent_total_tokens,
    },
  }
}

function retryIssuePayload(r: RetryEntry) {
  return {
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }
}

function recentEventsPayload(r: RunningEntry) {
  if (!r.last_agent_timestamp)
    return []
  return [{
    at: r.last_agent_timestamp.toISOString(),
    event: r.last_agent_event,
    message: r.last_agent_message,
  }]
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
