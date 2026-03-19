import type { OrchestratorState, RetryEntry, RunningEntry } from '@pleaseai/core'

export default defineEventHandler((event) => {
  const orchestrator = useOrchestrator(event)
  const state = orchestrator.getState()

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
})

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
