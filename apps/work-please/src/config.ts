import type { AutoTransitions, ClaudeEffort, IssueFilter, ServiceConfig, SettingSource, SystemPromptConfig, WorkflowDefinition } from './types'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'

const ENV_VAR_RE = /^\$([A-Z_]\w*)$/i
const VALID_SETTING_SOURCES = new Set<string>(['user', 'project', 'local'])

const DEFAULTS = {
  POLL_INTERVAL_MS: 30_000,
  WORKSPACE_ROOT: join(tmpdir(), 'work-please_workspaces'),
  HOOK_TIMEOUT_MS: 60_000,
  MAX_CONCURRENT_AGENTS: 10,
  AGENT_MAX_TURNS: 20,
  MAX_RETRY_BACKOFF_MS: 300_000,
  CLAUDE_EFFORT: 'high' as ClaudeEffort,
  CLAUDE_COMMAND: 'claude',
  CLAUDE_PERMISSION_MODE: 'bypassPermissions',
  CLAUDE_ALLOWED_TOOLS: [] as string[],
  CLAUDE_SETTING_SOURCES: ['project', 'local', 'user'] as SettingSource[],
  CLAUDE_TURN_TIMEOUT_MS: 3_600_000,
  CLAUDE_READ_TIMEOUT_MS: 5_000,
  CLAUDE_STALL_TIMEOUT_MS: 300_000,
  ASANA_ENDPOINT: 'https://app.asana.com/api/1.0',
  ASANA_ACTIVE_SECTIONS: ['To Do', 'In Progress'] as string[],
  ASANA_TERMINAL_SECTIONS: ['Done', 'Cancelled'] as string[],
  GITHUB_ENDPOINT: 'https://api.github.com',
  GITHUB_ACTIVE_STATUSES: ['Todo', 'In Progress', 'Merging', 'Rework'] as string[],
  GITHUB_TERMINAL_STATUSES: ['Closed', 'Cancelled', 'Canceled', 'Duplicate', 'Done'] as string[],
  GITHUB_WATCHED_STATUSES: ['Human Review'] as string[],
  ASANA_WATCHED_SECTIONS: [] as string[],
  AUTO_TRANSITIONS: { human_review_to_rework: true, human_review_to_merging: true, include_bot_reviews: true } as AutoTransitions,
}

export function buildConfig(workflow: WorkflowDefinition): ServiceConfig {
  const raw = workflow.config
  const tracker = sectionMap(raw, 'tracker')
  const polling = sectionMap(raw, 'polling')
  const workspace = sectionMap(raw, 'workspace')
  const hooks = sectionMap(raw, 'hooks')
  const agent = sectionMap(raw, 'agent')
  const claude = sectionMap(raw, 'claude')
  const server = sectionMap(raw, 'server')

  const kind = normalizeTrackerKind(stringValue(tracker.kind))

  return {
    tracker: buildTrackerConfig(kind, tracker),
    polling: {
      interval_ms: intValue(polling.interval_ms, DEFAULTS.POLL_INTERVAL_MS),
    },
    workspace: {
      root: resolvePathValue(stringValue(workspace.root), DEFAULTS.WORKSPACE_ROOT),
    },
    hooks: {
      after_create: hookScriptValue(hooks.after_create),
      before_run: hookScriptValue(hooks.before_run),
      after_run: hookScriptValue(hooks.after_run),
      before_remove: hookScriptValue(hooks.before_remove),
      timeout_ms: posIntValue(hooks.timeout_ms, DEFAULTS.HOOK_TIMEOUT_MS),
    },
    agent: {
      max_concurrent_agents: intValue(agent.max_concurrent_agents, DEFAULTS.MAX_CONCURRENT_AGENTS),
      max_turns: posIntValue(agent.max_turns, DEFAULTS.AGENT_MAX_TURNS),
      max_retry_backoff_ms: posIntValue(agent.max_retry_backoff_ms, DEFAULTS.MAX_RETRY_BACKOFF_MS),
      max_concurrent_agents_by_state: stateLimitsValue(agent.max_concurrent_agents_by_state),
    },
    claude: buildClaudeConfig(claude),
    server: {
      port: nonNegIntOrNull(server.port),
    },
  }
}

function buildClaudeConfig(claude: Record<string, unknown>): ServiceConfig['claude'] {
  const settingsSec = sectionMap(claude, 'settings')
  const attributionSec = sectionMap(settingsSec, 'attribution')
  return {
    model: stringValue(claude.model),
    effort: effortValue(claude.effort, DEFAULTS.CLAUDE_EFFORT),
    command: commandValue(claude.command) ?? DEFAULTS.CLAUDE_COMMAND,
    permission_mode: stringValue(claude.permission_mode) ?? DEFAULTS.CLAUDE_PERMISSION_MODE,
    allowed_tools: stringArrayValue(claude.allowed_tools, DEFAULTS.CLAUDE_ALLOWED_TOOLS),
    setting_sources: stringArrayValue(claude.setting_sources, DEFAULTS.CLAUDE_SETTING_SOURCES)
      .filter((s): s is SettingSource => VALID_SETTING_SOURCES.has(s)),
    turn_timeout_ms: intValue(claude.turn_timeout_ms, DEFAULTS.CLAUDE_TURN_TIMEOUT_MS),
    read_timeout_ms: intValue(claude.read_timeout_ms, DEFAULTS.CLAUDE_READ_TIMEOUT_MS),
    stall_timeout_ms: intValue(claude.stall_timeout_ms, DEFAULTS.CLAUDE_STALL_TIMEOUT_MS),
    system_prompt: systemPromptValue(claude.system_prompt),
    settings: {
      attribution: {
        commit: stringValue(attributionSec.commit),
        pr: stringValue(attributionSec.pr),
      },
    },
  }
}

function buildTrackerConfig(kind: string | null, tracker: Record<string, unknown>): ServiceConfig['tracker'] {
  const label_prefix = stringValue(tracker.label_prefix) ?? null
  const filter = buildFilterConfig(sectionMap(tracker, 'filter'))

  if (kind === 'asana') {
    return {
      kind,
      endpoint: stringValue(tracker.endpoint) ?? DEFAULTS.ASANA_ENDPOINT,
      api_key: resolveEnvValue(stringValue(tracker.api_key), process.env.ASANA_ACCESS_TOKEN),
      project_gid: stringValue(tracker.project_gid) ?? null,
      active_sections: csvValue(tracker.active_sections) ?? csvValue(tracker.active_states) ?? DEFAULTS.ASANA_ACTIVE_SECTIONS,
      terminal_sections: csvValue(tracker.terminal_sections) ?? csvValue(tracker.terminal_states) ?? DEFAULTS.ASANA_TERMINAL_SECTIONS,
      watched_statuses: csvValue(tracker.watched_statuses) ?? DEFAULTS.ASANA_WATCHED_SECTIONS,
      auto_transitions: buildAutoTransitions(sectionMap(tracker, 'auto_transitions')),
      label_prefix,
      filter,
    }
  }

  if (kind === 'github_projects') {
    return {
      kind,
      endpoint: stringValue(tracker.endpoint) ?? DEFAULTS.GITHUB_ENDPOINT,
      api_key: resolveEnvValue(stringValue(tracker.api_key), process.env.GITHUB_TOKEN),
      owner: stringValue(tracker.owner) ?? null,
      project_number: posIntValue(tracker.project_number, null as unknown as number) ?? null,
      project_id: stringValue(tracker.project_id) ?? null,
      active_statuses: csvValue(tracker.active_statuses) ?? csvValue(tracker.active_states) ?? DEFAULTS.GITHUB_ACTIVE_STATUSES,
      terminal_statuses: csvValue(tracker.terminal_statuses) ?? csvValue(tracker.terminal_states) ?? DEFAULTS.GITHUB_TERMINAL_STATUSES,
      watched_statuses: csvValue(tracker.watched_statuses) ?? DEFAULTS.GITHUB_WATCHED_STATUSES,
      auto_transitions: buildAutoTransitions(sectionMap(tracker, 'auto_transitions')),
      app_id: resolveEnvValue(stringValue(tracker.app_id), process.env.GITHUB_APP_ID),
      private_key: resolveEnvValue(stringValue(tracker.private_key), process.env.GITHUB_APP_PRIVATE_KEY),
      installation_id: resolveInstallationId(tracker.installation_id),
      label_prefix,
      filter,
    }
  }

  return {
    kind,
    endpoint: stringValue(tracker.endpoint) ?? '',
    api_key: resolveEnvValue(stringValue(tracker.api_key), undefined),
    label_prefix,
    filter,
  }
}

function buildFilterConfig(filter: Record<string, unknown>): IssueFilter {
  return {
    assignee: csvValue(filter.assignee) ?? [],
    label: csvValue(filter.label) ?? [],
  }
}

export type ValidationError
  = | { code: 'missing_tracker_kind' }
    | { code: 'unsupported_tracker_kind', kind: string }
    | { code: 'missing_tracker_api_key' }
    | { code: 'incomplete_github_app_config', missing: string[] }
    | { code: 'missing_tracker_project_config', field: string }
    | { code: 'missing_claude_command' }

export function validateConfig(config: ServiceConfig): ValidationError | null {
  const { kind } = config.tracker

  if (!kind)
    return { code: 'missing_tracker_kind' }
  if (kind !== 'asana' && kind !== 'github_projects') {
    return { code: 'unsupported_tracker_kind', kind }
  }

  if (!config.tracker.api_key) {
    if (kind === 'github_projects') {
      const appId = config.tracker.app_id
      const privateKey = config.tracker.private_key
      const installationId = config.tracker.installation_id
      const hasAny = appId || privateKey || (installationId != null)
      if (!hasAny)
        return { code: 'missing_tracker_api_key' }
      const missing: string[] = []
      if (!appId)
        missing.push('app_id')
      if (!privateKey)
        missing.push('private_key')
      if (installationId == null)
        missing.push('installation_id')
      if (missing.length > 0)
        return { code: 'incomplete_github_app_config', missing }
      // Valid app auth — fall through
    }
    else {
      return { code: 'missing_tracker_api_key' }
    }
  }

  if (kind === 'asana' && !config.tracker.project_gid) {
    return { code: 'missing_tracker_project_config', field: 'project_gid' }
  }
  if (kind === 'github_projects' && !config.tracker.project_id) {
    if (!config.tracker.owner) {
      return { code: 'missing_tracker_project_config', field: 'owner' }
    }
    if (!config.tracker.project_number) {
      return { code: 'missing_tracker_project_config', field: 'project_number' }
    }
  }

  if (!config.claude.command.trim())
    return { code: 'missing_claude_command' }

  return null
}

export function getActiveStates(config: ServiceConfig): string[] {
  const { kind } = config.tracker
  if (kind === 'asana')
    return config.tracker.active_sections ?? DEFAULTS.ASANA_ACTIVE_SECTIONS
  if (kind === 'github_projects')
    return config.tracker.active_statuses ?? DEFAULTS.GITHUB_ACTIVE_STATUSES
  return []
}

export function getTerminalStates(config: ServiceConfig): string[] {
  const { kind } = config.tracker
  if (kind === 'asana')
    return config.tracker.terminal_sections ?? DEFAULTS.ASANA_TERMINAL_SECTIONS
  if (kind === 'github_projects')
    return config.tracker.terminal_statuses ?? DEFAULTS.GITHUB_TERMINAL_STATUSES
  return []
}

export function getWatchedStates(config: ServiceConfig): string[] {
  const { kind } = config.tracker
  if (kind === 'asana')
    return config.tracker.watched_statuses ?? DEFAULTS.ASANA_WATCHED_SECTIONS
  if (kind === 'github_projects')
    return config.tracker.watched_statuses ?? DEFAULTS.GITHUB_WATCHED_STATUSES
  return []
}

export function getAutoTransitions(config: ServiceConfig): Required<AutoTransitions> {
  const at = config.tracker.auto_transitions ?? {}
  const defaults = DEFAULTS.AUTO_TRANSITIONS as Required<AutoTransitions>
  return {
    human_review_to_rework: at.human_review_to_rework ?? defaults.human_review_to_rework,
    human_review_to_merging: at.human_review_to_merging ?? defaults.human_review_to_merging,
    include_bot_reviews: at.include_bot_reviews ?? defaults.include_bot_reviews,
  }
}

export function normalizeState(state: string): string {
  return state.trim().toLowerCase()
}

export function maxConcurrentForState(config: ServiceConfig, state: string): number {
  const normalized = normalizeState(state)
  const byState = config.agent.max_concurrent_agents_by_state
  return byState[normalized] ?? config.agent.max_concurrent_agents
}

// --- helpers ---

function buildAutoTransitions(raw: Record<string, unknown>): AutoTransitions {
  const defaults = DEFAULTS.AUTO_TRANSITIONS as Required<AutoTransitions>
  return {
    human_review_to_rework: booleanValue(raw.human_review_to_rework, defaults.human_review_to_rework),
    human_review_to_merging: booleanValue(raw.human_review_to_merging, defaults.human_review_to_merging),
    include_bot_reviews: booleanValue(raw.include_bot_reviews, defaults.include_bot_reviews),
  }
}

function booleanValue(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean')
    return val
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase()
    if (s === 'true')
      return true
    if (s === 'false')
      return false
  }
  return fallback
}

const DEFAULT_SYSTEM_PROMPT: SystemPromptConfig = { type: 'preset', preset: 'claude_code' }

function systemPromptValue(val: unknown): SystemPromptConfig {
  if (val == null)
    return DEFAULT_SYSTEM_PROMPT
  if (typeof val === 'string') {
    const trimmed = val.trim()
    return trimmed ? { type: 'custom', value: trimmed } : DEFAULT_SYSTEM_PROMPT
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>
    if (obj.type === 'preset' && obj.preset === 'claude_code') {
      return typeof obj.append === 'string'
        ? { type: 'preset', preset: 'claude_code', append: obj.append }
        : { type: 'preset', preset: 'claude_code' }
    }
    if (obj.type === 'custom' && typeof obj.value === 'string') {
      const trimmed = obj.value.trim()
      return trimmed ? { type: 'custom', value: trimmed } : DEFAULT_SYSTEM_PROMPT
    }
  }
  return DEFAULT_SYSTEM_PROMPT
}

function sectionMap(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const val = raw[key]
  return (val && typeof val === 'object' && !Array.isArray(val)) ? val as Record<string, unknown> : {}
}

function stringValue(val: unknown): string | null {
  if (typeof val === 'string')
    return val.trim() || null
  if (typeof val === 'number' || typeof val === 'boolean')
    return String(val)
  return null
}

function intValue(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isInteger(val))
    return val
  if (typeof val === 'string') {
    const parsed = Number.parseInt(val.trim(), 10)
    if (!Number.isNaN(parsed))
      return parsed
  }
  return fallback
}

function posIntValue(val: unknown, fallback: number): number {
  const n = intValue(val, -1)
  return n > 0 ? n : fallback
}

function nonNegIntOrNull(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0)
    return val
  if (typeof val === 'string') {
    const parsed = Number.parseInt(val.trim(), 10)
    if (!Number.isNaN(parsed) && parsed >= 0)
      return parsed
  }
  return null
}

function hookScriptValue(val: unknown): string | null {
  if (typeof val !== 'string')
    return null
  const trimmed = val.trimEnd()
  return trimmed === '' ? null : trimmed
}

function effortValue(val: unknown, fallback: ClaudeEffort): ClaudeEffort {
  const s = typeof val === 'string' ? val.trim() : val
  switch (s) {
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
      return s
    default:
      return fallback
  }
}

function commandValue(val: unknown): string | null {
  if (typeof val !== 'string')
    return null
  const trimmed = val.trim()
  return trimmed === '' ? null : trimmed
}

function csvValue(val: unknown): string[] | null {
  if (Array.isArray(val)) {
    const items = val.flatMap((v) => {
      const s = stringValue(v)
      return s ? [s] : []
    })
    return items.length > 0 ? items : null
  }
  if (typeof val === 'string') {
    const items = val.split(',').map(s => s.trim()).filter(Boolean)
    return items.length > 0 ? items : null
  }
  return null
}

function stringArrayValue(val: unknown, fallback: string[]): string[] {
  if (!Array.isArray(val))
    return fallback
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function stateLimitsValue(val: unknown): Record<string, number> {
  if (!val || typeof val !== 'object' || Array.isArray(val))
    return {}
  const result: Record<string, number> = {}
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    const n = posIntValue(v, -1)
    if (n > 0) {
      result[normalizeState(String(k))] = n
    }
  }
  return result
}

function resolveInstallationId(val: unknown): number | null {
  const strVal = resolveEnvValue(stringValue(val), process.env.GITHUB_APP_INSTALLATION_ID)
  if (!strVal)
    return null
  const n = nonNegIntOrNull(strVal)
  return n != null && n > 0 ? n : null
}

function resolveEnvValue(val: string | null, envFallback: string | undefined): string | null {
  if (!val)
    return envFallback?.trim() || null
  const envRefMatch = val.match(ENV_VAR_RE)
  if (envRefMatch) {
    const envName = envRefMatch[1]
    const envVal = process.env[envName]?.trim()
    return envVal || null
  }
  return val.trim() || null
}

function resolvePathValue(val: string | null, fallback: string): string {
  if (!val)
    return fallback
  // $VAR expansion
  const envRefMatch = val.match(ENV_VAR_RE)
  if (envRefMatch) {
    const envVal = process.env[envRefMatch[1]]?.trim()
    if (!envVal)
      return fallback
    return expandPath(envVal) || fallback
  }
  return expandPath(val) || fallback
}

function expandPath(val: string): string {
  if (val.startsWith('~')) {
    return join(process.env.HOME ?? '~', val.slice(1))
  }
  if (val.includes(sep) || val.includes('/')) {
    return val
  }
  // bare relative name — preserve as-is
  return val
}

function normalizeTrackerKind(kind: string | null): string | null {
  if (!kind)
    return null
  const normalized = kind.trim().toLowerCase()
  return normalized || null
}
