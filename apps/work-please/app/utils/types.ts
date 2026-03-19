export interface RunningEntryPayload {
  issue_id: string
  issue_identifier: string
  state: string
  session_id: string | null
  turn_count: number
  last_event: string | null
  last_message: string | null
  started_at: string
  last_event_at: string | null
  tokens: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
}

export interface RetryEntryPayload {
  issue_id: string
  issue_identifier: string
  attempt: number
  due_at: string
  error: string | null
}

export interface StateResponse {
  generated_at: string
  counts: { running: number, retrying: number }
  running: RunningEntryPayload[]
  retrying: RetryEntryPayload[]
  codex_totals: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    seconds_running: number
  }
  rate_limits: unknown
}

export interface IssueDetailResponse {
  issue_identifier: string
  issue_id: string
  status: 'running' | 'retrying'
  workspace: { path: string }
  attempts: {
    restart_count: number
    current_retry_attempt: number
  }
  running: {
    session_id: string | null
    turn_count: number
    state: string
    started_at: string
    last_event: string | null
    last_message: string | null
    last_event_at: string | null
    tokens: {
      input_tokens: number
      output_tokens: number
      total_tokens: number
    }
  } | null
  retry: {
    attempt: number
    due_at: string
    error: string | null
  } | null
  recent_events: Array<{
    at: string
    event: string
    message: string | null
  }>
  last_error: string | null
}
