import type { AuthConfig, AuthorAssociation, ChannelConfig, ClaudeEffort, DbConfig, IssueFilter, PlatformConfig, PollingMode, ProjectConfig, SandboxConfig, ServiceConfig, SettingSource, StateAdapterKind, StateConfig, SystemPromptConfig, WorkflowDefinition } from './types'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
import { createLogger } from './logger'
import { DEFAULT_ALLOWED_ASSOCIATIONS } from './types'

const log = createLogger('config')

const ENV_VAR_RE = /^\$([A-Z_]\w*)$/i
const ENV_KEY_RE = /^[A-Z_]\w*$/i
const RUNTIME_VAR_RE = /^\$\{\w+\}$/
const VALID_SETTING_SOURCES = new Set<string>(['user', 'project', 'local'])

const DEFAULTS = {
  POLL_INTERVAL_MS: 30_000,
  WORKSPACE_ROOT: join(tmpdir(), 'agent-please_workspaces'),
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
}

export function buildConfig(workflow: WorkflowDefinition): ServiceConfig {
  const raw = workflow.config
  const polling = sectionMap(raw, 'polling')
  const workspace = sectionMap(raw, 'workspace')
  const hooks = sectionMap(raw, 'hooks')
  const agent = sectionMap(raw, 'agent')
  const claude = sectionMap(raw, 'claude')
  const db = sectionMap(raw, 'db')
  const state = sectionMap(raw, 'state')
  const server = sectionMap(raw, 'server')

  const platforms = buildPlatformsConfig(raw)

  return {
    platforms,
    projects: buildProjectsConfig(raw, platforms),
    channels: buildChannelsConfig(raw),
    polling: {
      mode: pollingModeValue(polling.mode),
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
    auth: buildAuthConfig(sectionMap(raw, 'auth')),
    env: buildEnvConfig(raw),
    db: buildDbConfig(db),
    state: buildStateConfig(state),
    server: {
      port: nonNegIntOrNull(server.port),
      webhook: buildWebhookConfig(sectionMap(server, 'webhook')),
    },
  }
}

export function buildPlatformsConfig(raw: Record<string, unknown>): Record<string, PlatformConfig> {
  const platforms = sectionMap(raw, 'platforms')
  const result: Record<string, PlatformConfig> = {}

  for (const [key, val] of Object.entries(platforms)) {
    if (!val || typeof val !== 'object' || Array.isArray(val))
      continue
    const sec = val as Record<string, unknown>

    if (key === 'slack' || (sec.bot_token !== undefined && sec.api_key === undefined)) {
      result[key] = {
        kind: 'slack',
        bot_token: resolveEnvValue(stringValue(sec.bot_token), process.env.SLACK_BOT_TOKEN),
        signing_secret: resolveEnvValue(stringValue(sec.signing_secret), process.env.SLACK_SIGNING_SECRET),
      }
    }
    else if (key === 'asana') {
      result[key] = {
        kind: 'asana',
        api_key: resolveEnvValue(stringValue(sec.api_key), process.env.ASANA_ACCESS_TOKEN),
        bot_username: resolveEnvValue(
          stringValue(sec.bot_username),
          process.env.CHAT_BOT_USERNAME ?? process.env.GITHUB_BOT_USERNAME,
        ),
        webhook_secret: resolveEnvValue(stringValue(sec.webhook_secret), process.env.ASANA_WEBHOOK_SECRET),
      }
    }
    else {
      // github (or any unknown platform key) — treat as GitHub-style
      result[key] = {
        kind: 'github',
        api_key: resolveEnvValue(stringValue(sec.api_key), process.env.GITHUB_TOKEN),
        owner: stringValue(sec.owner),
        bot_username: resolveEnvValue(
          stringValue(sec.bot_username),
          process.env.CHAT_BOT_USERNAME ?? process.env.GITHUB_BOT_USERNAME,
        ),
        app_id: resolveEnvValue(stringValue(sec.app_id), process.env.GITHUB_APP_ID),
        private_key: resolveEnvValue(stringValue(sec.private_key), process.env.GITHUB_APP_PRIVATE_KEY),
        installation_id: resolveInstallationId(sec.installation_id),
      }
    }
  }

  return result
}

function buildProjectStatusDefaults(sec: Record<string, unknown>, isAsana: boolean) {
  if (isAsana) {
    return {
      active_statuses: csvValue(sec.active_statuses) ?? csvValue(sec.active_sections) ?? DEFAULTS.ASANA_ACTIVE_SECTIONS,
      terminal_statuses: csvValue(sec.terminal_statuses) ?? csvValue(sec.terminal_sections) ?? DEFAULTS.ASANA_TERMINAL_SECTIONS,
      watched_statuses: csvValue(sec.watched_statuses) ?? DEFAULTS.ASANA_WATCHED_SECTIONS,
      endpoint: stringValue(sec.endpoint) ?? DEFAULTS.ASANA_ENDPOINT,
    }
  }
  return {
    active_statuses: csvValue(sec.active_statuses) ?? csvValue(sec.active_states) ?? DEFAULTS.GITHUB_ACTIVE_STATUSES,
    terminal_statuses: csvValue(sec.terminal_statuses) ?? csvValue(sec.terminal_states) ?? DEFAULTS.GITHUB_TERMINAL_STATUSES,
    watched_statuses: csvValue(sec.watched_statuses) ?? csvValue(sec.watched_states) ?? DEFAULTS.GITHUB_WATCHED_STATUSES,
    endpoint: stringValue(sec.endpoint) ?? DEFAULTS.GITHUB_ENDPOINT,
  }
}

export function buildProjectsConfig(
  raw: Record<string, unknown>,
  _platforms: Record<string, PlatformConfig>,
): ProjectConfig[] {
  const projectsRaw = raw.projects
  if (!Array.isArray(projectsRaw))
    return []

  const result: ProjectConfig[] = []

  for (const item of projectsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      continue
    const sec = item as Record<string, unknown>
    const platform = stringValue(sec.platform)
    if (!platform)
      continue

    const platformKind = _platforms[platform]?.kind
    const defaults = buildProjectStatusDefaults(sec, platformKind === 'asana')

    result.push({
      platform,
      project_number: posIntValue(sec.project_number, null as unknown as number) ?? null,
      project_id: stringValue(sec.project_id) ?? null,
      project_gid: stringValue(sec.project_gid) ?? null,
      ...defaults,
      label_prefix: stringValue(sec.label_prefix) ?? null,
      filter: buildFilterConfig(sectionMap(sec, 'filter')),
    })
  }

  return result
}

const VALID_ASSOCIATIONS = new Set<AuthorAssociation>([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIMER',
  'FIRST_TIME_CONTRIBUTOR',
  'NONE',
])

export function buildChannelsConfig(raw: Record<string, unknown>): ChannelConfig[] {
  const channelsRaw = raw.channels
  if (!Array.isArray(channelsRaw))
    return []

  const result: ChannelConfig[] = []

  for (const item of channelsRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      continue
    const sec = item as Record<string, unknown>
    const platform = stringValue(sec.platform)
    if (!platform)
      continue

    if (platform === 'github') {
      const raw_assoc = sec.allowed_associations
      if (!raw_assoc) {
        result.push({ platform, allowed_associations: DEFAULT_ALLOWED_ASSOCIATIONS })
      }
      else {
        const list = csvValue(raw_assoc) ?? []
        const valid = list
          .map(s => s.toUpperCase() as AuthorAssociation)
          .filter(s => VALID_ASSOCIATIONS.has(s))
        result.push({
          platform,
          allowed_associations: valid.length > 0 ? valid : DEFAULT_ALLOWED_ASSOCIATIONS,
        })
      }
    }
    else {
      result.push({ platform })
    }
  }

  return result
}

function buildAuthConfig(auth: Record<string, unknown>): AuthConfig {
  const github = sectionMap(auth, 'github')
  const admin = sectionMap(auth, 'admin')
  return {
    secret: resolveEnvValue(stringValue(auth.secret), process.env.BETTER_AUTH_SECRET),
    github: {
      client_id: resolveEnvValue(stringValue(github.client_id), process.env.AUTH_GITHUB_CLIENT_ID),
      client_secret: resolveEnvValue(stringValue(github.client_secret), process.env.AUTH_GITHUB_CLIENT_SECRET),
    },
    admin: {
      email: resolveEnvValue(stringValue(admin.email), process.env.AUTH_ADMIN_EMAIL),
      password: resolveEnvValue(stringValue(admin.password), process.env.AUTH_ADMIN_PASSWORD),
    },
  }
}

const DEFAULT_DB_PATH = '.agent-please/agent_runs.db'

function buildDbConfig(db: Record<string, unknown>): DbConfig {
  return {
    path: resolvePathValue(stringValue(db.path), DEFAULT_DB_PATH),
    turso_url: resolveEnvValue(stringValue(db.turso_url), process.env.TURSO_DATABASE_URL),
    turso_auth_token: resolveEnvValue(stringValue(db.turso_auth_token), process.env.TURSO_AUTH_TOKEN),
  }
}

const VALID_STATE_ADAPTERS = new Set<StateAdapterKind>(['memory', 'redis', 'ioredis', 'postgres'])

function buildStateConfig(sec: Record<string, unknown>): StateConfig {
  const raw = stringValue(sec.adapter)
  const adapter: StateAdapterKind = raw && VALID_STATE_ADAPTERS.has(raw as StateAdapterKind)
    ? raw as StateAdapterKind
    : 'memory'

  let envFallback: string | undefined
  if (adapter === 'redis' || adapter === 'ioredis') {
    envFallback = process.env.REDIS_URL
  }
  else if (adapter === 'postgres') {
    envFallback = process.env.POSTGRES_URL || process.env.DATABASE_URL
  }

  return {
    adapter,
    url: resolveEnvValue(stringValue(sec.url), envFallback),
    key_prefix: stringValue(sec.key_prefix) || 'chat-sdk',
    on_lock_conflict: stringValue(sec.on_lock_conflict) === 'force' ? 'force' : 'drop',
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
    sandbox: sandboxValue(claude.sandbox),
    system_prompt: systemPromptValue(claude.system_prompt),
    settings: {
      attribution: {
        commit: stringValue(attributionSec.commit),
        pr: stringValue(attributionSec.pr),
      },
    },
  }
}

function buildWebhookConfig(webhook: Record<string, unknown>): ServiceConfig['server']['webhook'] {
  return {
    secret: resolveEnvValue(stringValue(webhook.secret), process.env.WEBHOOK_SECRET),
    events: csvValue(webhook.events) ?? null,
  }
}

function buildFilterConfig(filter: Record<string, unknown>): IssueFilter {
  return {
    assignee: csvValue(filter.assignee) ?? [],
    label: csvValue(filter.label) ?? [],
  }
}

export type ValidationError
  = | { code: 'missing_claude_command' }
    | { code: 'no_projects_configured' }
    | { code: 'unknown_platform_reference', platform: string, context: string }
    | { code: 'missing_platform_api_key', platform: string }
    | { code: 'incomplete_platform_app_config', platform: string, missing: string[] }
    | { code: 'missing_github_project_config' }
    | { code: 'missing_asana_project_config' }

export function validateConfig(config: ServiceConfig): ValidationError | null {
  if (config.projects.length === 0)
    return { code: 'no_projects_configured' }

  // Validate each project references a known platform
  for (const project of config.projects) {
    if (!(project.platform in config.platforms)) {
      return { code: 'unknown_platform_reference', platform: project.platform, context: 'project' }
    }

    const platform = config.platforms[project.platform]
    const isSlack = platform.kind === 'slack'
    const isAsana = platform.kind === 'asana'

    // For github-like platforms: require api_key or complete app auth
    if (!isSlack && !isAsana) {
      const gh = platform as import('./types').GitHubPlatformConfig
      if (!gh.api_key) {
        const hasAny = gh.app_id || gh.private_key || (gh.installation_id != null)
        if (!hasAny)
          return { code: 'missing_platform_api_key', platform: project.platform }
        const missing: string[] = []
        if (!gh.app_id)
          missing.push('app_id')
        if (!gh.private_key)
          missing.push('private_key')
        if (gh.installation_id == null)
          missing.push('installation_id')
        if (missing.length > 0)
          return { code: 'incomplete_platform_app_config', platform: project.platform, missing }
      }
      // Require at least project_id or (owner + project_number)
      if (!project.project_id && !(gh.owner && project.project_number)) {
        return { code: 'missing_github_project_config' }
      }
    }

    // For Asana projects: require project_gid
    if (isAsana && !project.project_gid) {
      return { code: 'missing_asana_project_config' }
    }
  }

  // Validate each channel references a known platform
  for (const channel of config.channels) {
    if (!(channel.platform in config.platforms)) {
      return { code: 'unknown_platform_reference', platform: channel.platform, context: 'channel' }
    }
  }

  if (!config.claude.command.trim())
    return { code: 'missing_claude_command' }

  return null
}

export function getActiveStates(project: ProjectConfig): string[] {
  return project.active_statuses
}

export function getTerminalStates(project: ProjectConfig): string[] {
  return project.terminal_statuses
}

export function getWatchedStates(project: ProjectConfig): string[] {
  return project.watched_statuses
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

function sandboxValue(val: unknown): SandboxConfig | null {
  if (val == null || typeof val !== 'object' || Array.isArray(val))
    return null
  const obj = val as Record<string, unknown>
  const result: SandboxConfig = {}
  let hasField = false

  if (typeof obj.enabled === 'boolean') {
    result.enabled = obj.enabled
    hasField = true
  }
  if (typeof obj.autoAllowBashIfSandboxed === 'boolean') {
    result.autoAllowBashIfSandboxed = obj.autoAllowBashIfSandboxed
    hasField = true
  }
  if (typeof obj.allowUnsandboxedCommands === 'boolean') {
    result.allowUnsandboxedCommands = obj.allowUnsandboxedCommands
    hasField = true
  }
  if (typeof obj.enableWeakerNestedSandbox === 'boolean') {
    result.enableWeakerNestedSandbox = obj.enableWeakerNestedSandbox
    hasField = true
  }
  if (typeof obj.enableWeakerNetworkIsolation === 'boolean') {
    result.enableWeakerNetworkIsolation = obj.enableWeakerNetworkIsolation
    hasField = true
  }

  const network = parseSandboxNetwork(obj.network)
  if (network) {
    result.network = network
    hasField = true
  }
  const filesystem = parseSandboxFilesystem(obj.filesystem)
  if (filesystem) {
    result.filesystem = filesystem
    hasField = true
  }
  const violations = parseSandboxIgnoreViolations(obj.ignoreViolations)
  if (violations) {
    result.ignoreViolations = violations
    hasField = true
  }
  const excluded = csvValue(obj.excludedCommands)
  if (excluded) {
    result.excludedCommands = excluded
    hasField = true
  }
  const rg = parseSandboxRipgrep(obj.ripgrep)
  if (rg) {
    result.ripgrep = rg
    hasField = true
  }

  return hasField ? result : null
}

function parseSandboxNetwork(val: unknown): SandboxConfig['network'] | null {
  if (val == null || typeof val !== 'object' || Array.isArray(val))
    return null
  const obj = val as Record<string, unknown>
  const result: NonNullable<SandboxConfig['network']> = {}
  let hasField = false

  const domains = csvValue(obj.allowedDomains)
  if (domains) {
    result.allowedDomains = domains
    hasField = true
  }
  if (typeof obj.allowManagedDomainsOnly === 'boolean') {
    result.allowManagedDomainsOnly = obj.allowManagedDomainsOnly
    hasField = true
  }
  const sockets = csvValue(obj.allowUnixSockets)
  if (sockets) {
    result.allowUnixSockets = sockets
    hasField = true
  }
  if (typeof obj.allowAllUnixSockets === 'boolean') {
    result.allowAllUnixSockets = obj.allowAllUnixSockets
    hasField = true
  }
  if (typeof obj.allowLocalBinding === 'boolean') {
    result.allowLocalBinding = obj.allowLocalBinding
    hasField = true
  }
  if (typeof obj.httpProxyPort === 'number') {
    result.httpProxyPort = obj.httpProxyPort
    hasField = true
  }
  if (typeof obj.socksProxyPort === 'number') {
    result.socksProxyPort = obj.socksProxyPort
    hasField = true
  }

  return hasField ? result : null
}

function parseSandboxFilesystem(val: unknown): SandboxConfig['filesystem'] | null {
  if (val == null || typeof val !== 'object' || Array.isArray(val))
    return null
  const obj = val as Record<string, unknown>
  const result: NonNullable<SandboxConfig['filesystem']> = {}
  let hasField = false

  const allowWrite = csvValue(obj.allowWrite)
  if (allowWrite) {
    result.allowWrite = allowWrite
    hasField = true
  }
  const denyWrite = csvValue(obj.denyWrite)
  if (denyWrite) {
    result.denyWrite = denyWrite
    hasField = true
  }
  const denyRead = csvValue(obj.denyRead)
  if (denyRead) {
    result.denyRead = denyRead
    hasField = true
  }

  return hasField ? result : null
}

function parseSandboxIgnoreViolations(val: unknown): Record<string, string[]> | null {
  if (val == null || typeof val !== 'object' || Array.isArray(val))
    return null
  const result: Record<string, string[]> = {}
  let hasField = false
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    const arr = csvValue(v)
    if (arr) {
      result[k] = arr
      hasField = true
    }
  }
  return hasField ? result : null
}

function parseSandboxRipgrep(val: unknown): SandboxConfig['ripgrep'] | null {
  if (val == null || typeof val !== 'object' || Array.isArray(val))
    return null
  const obj = val as Record<string, unknown>
  const cmd = stringValue(obj.command)
  if (!cmd)
    return null
  const args = csvValue(obj.args)
  return args ? { command: cmd, args } : { command: cmd }
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

function pollingModeValue(val: unknown): PollingMode {
  const s = typeof val === 'string' ? val.trim().toLowerCase() : ''
  return s === 'webhook' ? 'webhook' : 'poll'
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

function buildEnvConfig(raw: Record<string, unknown>): Record<string, string> {
  const envSection = raw.env
  if (!envSection || typeof envSection !== 'object' || Array.isArray(envSection))
    return {}

  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(envSection as Record<string, unknown>)) {
    if (!ENV_KEY_RE.test(key)) {
      log.warn(`ignoring invalid env key: ${JSON.stringify(key)}`)
      continue
    }
    let str: string | null = null
    if (typeof val === 'string')
      str = val
    else if (typeof val === 'number' || typeof val === 'boolean')
      str = String(val)
    if (str === null)
      continue

    // Preserve ${RUNTIME_VAR} references for later resolution
    if (RUNTIME_VAR_RE.test(str)) {
      result[key] = str
      continue
    }

    // Resolve $VAR from process.env
    const envRefMatch = str.match(ENV_VAR_RE)
    if (envRefMatch) {
      const envVal = process.env[envRefMatch[1]]?.trim()
      if (envVal) {
        result[key] = envVal
      }
      else {
        log.warn(`env.${key} references $${envRefMatch[1]} which is not set — dropping`)
      }
      continue
    }

    result[key] = str
  }
  return result
}
