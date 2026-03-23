import type { DispatchLock } from './dispatch-lock'

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

export interface GitHubPlatformConfig {
  kind: 'github'
  api_key: string | null
  owner: string | null
  bot_username: string | null
  // GitHub App auth (alternative to api_key)
  app_id: string | null
  private_key: string | null
  installation_id: number | null
}

export interface SlackPlatformConfig {
  kind: 'slack'
  bot_token: string | null
  signing_secret: string | null
}

export interface AsanaPlatformConfig {
  kind: 'asana'
  api_key: string | null
  bot_username: string | null
  webhook_secret: string | null
}

export type PlatformConfig = GitHubPlatformConfig | SlackPlatformConfig | AsanaPlatformConfig

export interface ProjectConfig {
  platform: string
  // platform-specific project identifiers
  project_number?: number | null // GitHub
  project_id?: string | null // GitHub
  project_gid?: string | null // Asana
  // status mappings
  active_statuses: string[]
  terminal_statuses: string[]
  watched_statuses: string[]
  // endpoint override
  endpoint: string
  // label prefix for orchestrator labels
  label_prefix: string | null
  // filter
  filter: IssueFilter
}

export interface ChannelConfig {
  platform: string
  allowed_associations?: AuthorAssociation[] // GitHub-specific
}

export type SettingSource = 'user' | 'project' | 'local'

export type PollingMode = 'poll' | 'webhook'

export interface SandboxConfig {
  /** SDK's SandboxSettings uses z.core.$loose, producing an index signature. Required for assignability. */
  [key: string]: unknown
  enabled?: boolean
  autoAllowBashIfSandboxed?: boolean
  allowUnsandboxedCommands?: boolean
  network?: {
    allowedDomains?: string[]
    allowManagedDomainsOnly?: boolean
    allowUnixSockets?: string[]
    allowAllUnixSockets?: boolean
    allowLocalBinding?: boolean
    httpProxyPort?: number
    socksProxyPort?: number
  }
  filesystem?: {
    allowWrite?: string[]
    denyWrite?: string[]
    denyRead?: string[]
  }
  ignoreViolations?: Record<string, string[]>
  enableWeakerNestedSandbox?: boolean
  enableWeakerNetworkIsolation?: boolean
  excludedCommands?: string[]
  ripgrep?: {
    command: string
    args?: string[]
  }
}

export interface AuthConfig {
  secret: string | null
  github: {
    client_id: string | null
    client_secret: string | null
  }
  admin: {
    email: string | null
    password: string | null
  }
}

export interface DbConfig {
  path: string
  turso_url: string | null
  turso_auth_token: string | null
}

export type StateAdapterKind = 'memory' | 'redis' | 'ioredis' | 'postgres'

export interface StateConfig {
  adapter: StateAdapterKind
  url: string | null
  key_prefix: string
  on_lock_conflict: 'force' | 'drop'
}

export type AgentRunStatus = 'success' | 'failure' | 'terminated'

export interface AgentRunRecord {
  id: number
  issue_id: string
  identifier: string
  issue_state: string
  session_id: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  status: AgentRunStatus
  error: string | null
  turn_count: number
  retry_attempt: number | null
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

export type AuthorAssociation = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIMER' | 'FIRST_TIME_CONTRIBUTOR' | 'NONE'

export const DEFAULT_ALLOWED_ASSOCIATIONS: AuthorAssociation[] = ['OWNER', 'MEMBER', 'COLLABORATOR']

export interface ServiceConfig {
  platforms: Record<string, PlatformConfig>
  projects: ProjectConfig[]
  channels: ChannelConfig[]
  polling: { mode: PollingMode, interval_ms: number }
  workspace: {
    root: string
    branch_prefix: string | null
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
    sandbox: SandboxConfig | null
    system_prompt: SystemPromptConfig
    settings: {
      attribution: {
        commit: string | null
        pr: string | null
      }
    }
  }
  auth: AuthConfig
  env: Record<string, string>
  db: DbConfig
  state: StateConfig
  server: {
    port: number | null
    webhook: {
      secret: string | null
      events: string[] | null
    }
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
  dispatch_lock: DispatchLock | null
  dispatch_lock_timer: ReturnType<typeof setInterval> | null
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
