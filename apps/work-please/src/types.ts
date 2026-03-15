export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max'

export interface BlockerRef {
  id: string | null
  identifier: string | null
  state: string | null
}

export interface LinkedPR {
  number: number
  title: string
  url: string | null
  state: 'open' | 'closed' | 'merged'
  branch_name: string | null
  review_decision: Issue['review_decision']
  updated_at: Date | null
}

export interface ProjectItemContext {
  owner: string
  number: number
  project_id: string | null
  item_id: string
  field_id: string | null
  status_options: Array<{ name: string, id: string }>
}

export interface Issue {
  id: string
  identifier: string
  title: string
  description: string | null
  priority: number | null
  state: string
  branch_name: string | null
  url: string | null
  assignees: string[]
  labels: string[]
  blocked_by: BlockerRef[]
  pull_requests: LinkedPR[]
  review_decision: 'approved' | 'changes_requested' | 'commented' | 'review_required' | null
  created_at: Date | null
  updated_at: Date | null
  project: ProjectItemContext | null
}

export type SystemPromptConfig
  = | { type: 'preset', preset: 'claude_code', append?: string }
    | { type: 'custom', value: string }

export interface WorkflowDefinition {
  config: Record<string, unknown>
  prompt_template: string
}

export interface IssueFilter {
  assignee: string[]
  label: string[]
}

export interface TrackerConfig {
  kind: string | null
  endpoint: string
  api_key: string | null
  // asana
  project_gid?: string | null
  active_sections?: string[]
  terminal_sections?: string[]
  // github_projects
  owner?: string | null
  project_number?: number | null
  project_id?: string | null
  active_statuses?: string[]
  terminal_statuses?: string[]
  // github_projects — app auth (alternative to api_key)
  app_id?: string | null
  private_key?: string | null
  installation_id?: number | null
  label_prefix: string | null
  // shared filter
  filter: IssueFilter
  // watched states (shared)
  watched_statuses?: string[]
}

export type SettingSource = 'user' | 'project' | 'local'

export interface ServiceConfig {
  tracker: TrackerConfig
  polling: { interval_ms: number }
  workspace: {
    root: string
  }
  hooks: {
    after_create: string | null
    before_run: string | null
    after_run: string | null
    before_remove: string | null
    timeout_ms: number
  }
  agent: {
    max_concurrent_agents: number
    max_turns: number
    max_retry_backoff_ms: number
    max_concurrent_agents_by_state: Record<string, number>
  }
  claude: {
    /** null = use the Claude CLI default model */
    model: string | null
    effort: ClaudeEffort
    command: string
    permission_mode: string
    allowed_tools: string[]
    setting_sources: SettingSource[]
    turn_timeout_ms: number
    read_timeout_ms: number
    stall_timeout_ms: number
    system_prompt: SystemPromptConfig
    settings: {
      attribution: {
        commit: string | null
        pr: string | null
      }
    }
  }
  env: Record<string, string>
  server: {
    port: number | null
  }
}

export interface Workspace {
  path: string
  workspace_key: string
  created_now: boolean
}

export interface LiveSession {
  session_id: string
  turn_id: string
  agent_app_server_pid: string | null
  last_agent_event: string | null
  last_agent_timestamp: Date | null
  last_agent_message: string | null
  agent_input_tokens: number
  agent_output_tokens: number
  agent_total_tokens: number
  last_reported_input_tokens: number
  last_reported_output_tokens: number
  last_reported_total_tokens: number
  turn_count: number
}

export interface RetryEntry {
  issue_id: string
  identifier: string
  attempt: number
  due_at_ms: number
  timer_handle: ReturnType<typeof setTimeout> | null
  error: string | null
}

export interface RunningEntry {
  identifier: string
  issue: Issue
  session_id: string | null
  agent_app_server_pid: string | null
  last_agent_message: string | null
  last_agent_event: string | null
  last_agent_timestamp: Date | null
  agent_input_tokens: number
  agent_output_tokens: number
  agent_total_tokens: number
  last_reported_input_tokens: number
  last_reported_output_tokens: number
  last_reported_total_tokens: number
  turn_count: number
  retry_attempt: number | null
  started_at: Date
}

export interface AgentTotals {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  seconds_running: number
}

export interface WatchedSnapshot {
  /** Linked PR update timestamp (null when no linked PRs) */
  pr_update_ms: number | null
  /** Review decision at dispatch time (for PR-type project items) */
  review_decision: Issue['review_decision']
}

export interface OrchestratorState {
  poll_interval_ms: number
  max_concurrent_agents: number
  running: Map<string, RunningEntry>
  claimed: Set<string>
  retry_attempts: Map<string, RetryEntry>
  completed: Set<string>
  watched_last_dispatched: Map<string, WatchedSnapshot>
  agent_totals: AgentTotals
  agent_rate_limits: unknown
}

export type WorkflowError
  = | { code: 'missing_workflow_file', path: string, cause: unknown }
    | { code: 'workflow_parse_error', cause: unknown }
    | { code: 'workflow_front_matter_not_a_map' }
    | { code: 'template_parse_error', cause: unknown }
    | { code: 'template_render_error', cause: unknown }

export type AgentEvent
  = | 'session_started'
    | 'startup_failed'
    | 'turn_completed'
    | 'turn_failed'
    | 'turn_cancelled'
    | 'turn_ended_with_error'
    | 'turn_input_required'
    | 'approval_auto_approved'
    | 'unsupported_tool_call'
    | 'tool_call_failed'
    | 'notification'
    | 'other_message'
    | 'malformed'

export interface AgentMessage {
  event: AgentEvent
  timestamp: Date
  agent_app_server_pid?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  rate_limits?: unknown
  session_id?: string
  turn_id?: string
  payload?: unknown
  raw?: string
}
