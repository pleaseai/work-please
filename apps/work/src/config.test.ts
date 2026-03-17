/* eslint-disable no-template-curly-in-string */
import type { WorkflowDefinition } from './types'
import process from 'node:process'
import { describe, expect, it } from 'bun:test'
import { buildConfig, getActiveStates, getTerminalStates, getWatchedStates, maxConcurrentForState, normalizeState, validateConfig } from './config'

function makeWorkflow(config: Record<string, unknown>): WorkflowDefinition {
  return { config, prompt_template: '' }
}

describe('buildConfig', () => {
  it('applies defaults when config is empty', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.polling.interval_ms).toBe(30_000)
    expect(config.agent.max_concurrent_agents).toBe(10)
    expect(config.agent.max_turns).toBe(20)
    expect(config.agent.max_retry_backoff_ms).toBe(300_000)
    expect(config.claude.model).toBeNull()
    expect(config.claude.command).toBe('claude')
    expect(config.claude.turn_timeout_ms).toBe(3_600_000)
    expect(config.claude.read_timeout_ms).toBe(5_000)
    expect(config.claude.stall_timeout_ms).toBe(300_000)
    expect(config.hooks.timeout_ms).toBe(60_000)
    expect(config.claude.setting_sources).toEqual(['project', 'local', 'user'])
    expect(config.hooks.after_create).toBeNull()
    expect(config.hooks.before_run).toBeNull()
  })

  it('parses asana tracker config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'asana',
        api_key: 'token123',
        project_gid: 'gid456',
        active_sections: ['Todo', 'In Progress'],
      },
    }))
    expect(config.tracker.kind).toBe('asana')
    expect(config.tracker.api_key).toBe('token123')
    expect(config.tracker.project_gid).toBe('gid456')
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress'])
  })

  it('parses github_projects tracker config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'ghtoken',
        owner: 'myorg',
        project_number: 42,
      },
    }))
    expect(config.tracker.kind).toBe('github_projects')
    expect(config.tracker.api_key).toBe('ghtoken')
    expect(config.tracker.owner).toBe('myorg')
    expect(config.tracker.project_number).toBe(42)
  })

  it('resolves $VAR env references for api_key', () => {
    process.env.TEST_API_KEY = 'resolved-token'
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: '$TEST_API_KEY', project_gid: 'gid' },
    }))
    expect(config.tracker.api_key).toBe('resolved-token')
    delete process.env.TEST_API_KEY
  })

  it('parses comma-separated active_sections string', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_sections: 'Todo, In Progress, Review' },
    }))
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress', 'Review'])
  })

  it('accepts active_states as alias for active_sections (asana)', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_states: ['Todo', 'In Progress'] },
    }))
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress'])
  })

  it('parses string integer for polling interval', () => {
    const config = buildConfig(makeWorkflow({ polling: { interval_ms: '60000' } }))
    expect(config.polling.interval_ms).toBe(60_000)
  })

  it('normalizes state keys in max_concurrent_agents_by_state', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents_by_state: {
          'In Progress': 3,
          'Todo': '2',
        },
      },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBe(3)
    expect(config.agent.max_concurrent_agents_by_state.todo).toBe(2)
  })

  it('ignores invalid (non-positive) values in max_concurrent_agents_by_state', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents_by_state: {
          'In Progress': -1,
          'Todo': 'invalid',
        },
      },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.todo).toBeUndefined()
  })

  it('preserves hook scripts with trimEnd', () => {
    const config = buildConfig(makeWorkflow({
      hooks: { before_run: 'git pull\n' },
    }))
    expect(config.hooks.before_run).toBe('git pull')
  })

  it('returns null for empty hook scripts', () => {
    const config = buildConfig(makeWorkflow({
      hooks: { before_run: '  ' },
    }))
    expect(config.hooks.before_run).toBeNull()
  })

  it('parses claude.model from config (Section 17.1)', () => {
    const config = buildConfig(makeWorkflow({
      claude: { model: 'claude-sonnet-4-6' },
    }))
    expect(config.claude.model).toBe('claude-sonnet-4-6')
  })

  it('coerces empty or whitespace-only claude.model to null (Section 17.1)', () => {
    expect(buildConfig(makeWorkflow({ claude: { model: '' } })).claude.model).toBeNull()
    expect(buildConfig(makeWorkflow({ claude: { model: '   ' } })).claude.model).toBeNull()
  })

  it('does not resolve $VAR for claude.model (no env expansion for model field)', () => {
    const orig = process.env.TEST_CLAUDE_MODEL
    process.env.TEST_CLAUDE_MODEL = 'claude-haiku-4-5'
    try {
      const config = buildConfig(makeWorkflow({ claude: { model: '$TEST_CLAUDE_MODEL' } }))
      expect(config.claude.model).toBe('$TEST_CLAUDE_MODEL')
    }
    finally {
      if (orig !== undefined)
        process.env.TEST_CLAUDE_MODEL = orig
      else
        delete process.env.TEST_CLAUDE_MODEL
    }
  })

  it('defaults claude.system_prompt to preset claude_code when omitted', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.claude.system_prompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('defaults claude.system_prompt to preset claude_code when null', () => {
    const config = buildConfig(makeWorkflow({ claude: { system_prompt: null } }))
    expect(config.claude.system_prompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('parses claude.system_prompt string as custom type', () => {
    const config = buildConfig(makeWorkflow({ claude: { system_prompt: 'You are a specialized agent.' } }))
    expect(config.claude.system_prompt).toEqual({ type: 'custom', value: 'You are a specialized agent.' })
  })

  it('parses claude.system_prompt preset object with append', () => {
    const config = buildConfig(makeWorkflow({
      claude: { system_prompt: { type: 'preset', preset: 'claude_code', append: 'Extra instructions.' } },
    }))
    expect(config.claude.system_prompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Extra instructions.' })
  })

  it('parses claude.system_prompt preset object without append', () => {
    const config = buildConfig(makeWorkflow({
      claude: { system_prompt: { type: 'preset', preset: 'claude_code' } },
    }))
    expect(config.claude.system_prompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('parses claude.system_prompt custom object form', () => {
    const config = buildConfig(makeWorkflow({
      claude: { system_prompt: { type: 'custom', value: 'You are a specialized agent.' } },
    }))
    expect(config.claude.system_prompt).toEqual({ type: 'custom', value: 'You are a specialized agent.' })
  })

  it('falls back to default when claude.system_prompt custom object value is blank', () => {
    const config = buildConfig(makeWorkflow({ claude: { system_prompt: { type: 'custom', value: '   ' } } }))
    expect(config.claude.system_prompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('defaults claude.effort to "high" when not specified', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.claude.effort).toBe('high')
  })

  it('parses valid effort values', () => {
    for (const effort of ['low', 'medium', 'high', 'max'] as const) {
      const config = buildConfig(makeWorkflow({ claude: { effort } }))
      expect(config.claude.effort).toBe(effort)
    }
  })

  it('falls back to "high" for invalid effort value', () => {
    const config = buildConfig(makeWorkflow({ claude: { effort: 'turbo' } }))
    expect(config.claude.effort).toBe('high')
  })

  it('preserves claude.command as shell command string including spaces (Section 17.1)', () => {
    const config = buildConfig(makeWorkflow({
      claude: { command: 'claude --permission-mode full --no-ansi' },
    }))
    expect(config.claude.command).toBe('claude --permission-mode full --no-ansi')
  })

  it('resolves $VAR for workspace root path (Section 17.1)', () => {
    process.env.TEST_WORKSPACE_ROOT = '/tmp/test-workspaces'
    const config = buildConfig(makeWorkflow({
      workspace: { root: '$TEST_WORKSPACE_ROOT' },
    }))
    expect(config.workspace.root).toBe('/tmp/test-workspaces')
    delete process.env.TEST_WORKSPACE_ROOT
  })

  it('parses setting_sources array from YAML', () => {
    const config = buildConfig(makeWorkflow({
      claude: { setting_sources: ['project', 'user'] },
    }))
    expect(config.claude.setting_sources).toEqual(['project', 'user'])
  })

  it('filters out non-string values from setting_sources', () => {
    const config = buildConfig(makeWorkflow({
      claude: { setting_sources: ['project', 42, null, 'local'] },
    }))
    expect(config.claude.setting_sources).toEqual(['project', 'local'])
  })

  it('filters out invalid string values from setting_sources', () => {
    const config = buildConfig(makeWorkflow({
      claude: { setting_sources: ['project', 'invalid', 'user', 'enterprise'] },
    }))
    expect(config.claude.setting_sources).toEqual(['project', 'user'])
  })

  it('defaults setting_sources to [project, local, user] when explicitly set to null', () => {
    const config = buildConfig(makeWorkflow({
      claude: { setting_sources: null },
    }))
    expect(config.claude.setting_sources).toEqual(['project', 'local', 'user'])
  })

  it('filters out blank string values from setting_sources', () => {
    const config = buildConfig(makeWorkflow({
      claude: { setting_sources: ['project', '', '  ', 'local'] },
    }))
    expect(config.claude.setting_sources).toEqual(['project', 'local'])
  })
})

describe('buildConfig - claude.settings.attribution', () => {
  it('defaults attribution to null when not configured', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.claude.settings.attribution.commit).toBeNull()
    expect(config.claude.settings.attribution.pr).toBeNull()
  })

  it('parses commit attribution from claude.settings.attribution', () => {
    const config = buildConfig(makeWorkflow({
      claude: { settings: { attribution: { commit: 'Made with My Bot' } } },
    }))
    expect(config.claude.settings.attribution.commit).toBe('Made with My Bot')
    expect(config.claude.settings.attribution.pr).toBeNull()
  })

  it('parses pr attribution from claude.settings.attribution', () => {
    const config = buildConfig(makeWorkflow({
      claude: { settings: { attribution: { pr: 'PR by My Bot' } } },
    }))
    expect(config.claude.settings.attribution.pr).toBe('PR by My Bot')
    expect(config.claude.settings.attribution.commit).toBeNull()
  })

  it('parses both commit and pr attribution together', () => {
    const config = buildConfig(makeWorkflow({
      claude: { settings: { attribution: { commit: 'commit text', pr: 'pr text' } } },
    }))
    expect(config.claude.settings.attribution.commit).toBe('commit text')
    expect(config.claude.settings.attribution.pr).toBe('pr text')
  })

  it('coerces empty attribution string to null', () => {
    const config = buildConfig(makeWorkflow({
      claude: { settings: { attribution: { commit: '', pr: '   ' } } },
    }))
    expect(config.claude.settings.attribution.commit).toBeNull()
    expect(config.claude.settings.attribution.pr).toBeNull()
  })
})

describe('buildConfig - github app auth fields', () => {
  it('parses app_id, private_key, and installation_id from YAML', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        app_id: 'app-123',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest',
        installation_id: 456,
        owner: 'myorg',
        project_number: 1,
      },
    }))
    expect(config.tracker.app_id).toBe('app-123')
    expect(config.tracker.private_key).toBe('-----BEGIN RSA PRIVATE KEY-----\ntest')
    expect(config.tracker.installation_id).toBe(456)
  })

  it('resolves app_id from $VAR env reference', () => {
    process.env.TEST_GITHUB_APP_ID = 'env-app-id'
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', app_id: '$TEST_GITHUB_APP_ID', owner: 'org', project_number: 1 },
    }))
    expect(config.tracker.app_id).toBe('env-app-id')
    delete process.env.TEST_GITHUB_APP_ID
  })

  it('falls back to GITHUB_APP_ID env var when app_id is absent', () => {
    const orig = process.env.GITHUB_APP_ID
    process.env.GITHUB_APP_ID = 'fallback-app-id'
    try {
      const config = buildConfig(makeWorkflow({
        tracker: { kind: 'github_projects', owner: 'org', project_number: 1 },
      }))
      expect(config.tracker.app_id).toBe('fallback-app-id')
    }
    finally {
      if (orig !== undefined)
        process.env.GITHUB_APP_ID = orig
      else
        delete process.env.GITHUB_APP_ID
    }
  })

  it('falls back to GITHUB_APP_INSTALLATION_ID env var when installation_id is absent', () => {
    const orig = process.env.GITHUB_APP_INSTALLATION_ID
    process.env.GITHUB_APP_INSTALLATION_ID = '9999'
    try {
      const config = buildConfig(makeWorkflow({
        tracker: { kind: 'github_projects', owner: 'org', project_number: 1 },
      }))
      expect(config.tracker.installation_id).toBe(9999)
    }
    finally {
      if (orig !== undefined)
        process.env.GITHUB_APP_INSTALLATION_ID = orig
      else
        delete process.env.GITHUB_APP_INSTALLATION_ID
    }
  })

  it('resolves installation_id from $VAR env reference', () => {
    process.env.TEST_INSTALLATION_ID = '12345'
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', installation_id: '$TEST_INSTALLATION_ID', owner: 'org', project_number: 1 },
    }))
    expect(config.tracker.installation_id).toBe(12345)
    delete process.env.TEST_INSTALLATION_ID
  })
})

describe('validateConfig', () => {
  it('returns null for valid asana config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'token', project_gid: 'gid' },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns null for valid github_projects config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'token', owner: 'org', project_number: 1 },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns missing_tracker_kind when kind is absent', () => {
    const config = buildConfig(makeWorkflow({}))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_kind')
  })

  it('returns unsupported_tracker_kind for unknown tracker', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'linear' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('unsupported_tracker_kind')
  })

  it('returns null for valid github_projects config with app auth (no api_key)', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        app_id: 'app-123',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nkey',
        installation_id: 456,
        owner: 'myorg',
        project_number: 1,
      },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns incomplete_github_app_config when only some app fields are present', () => {
    const origToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      const config = buildConfig(makeWorkflow({
        tracker: { kind: 'github_projects', app_id: 'app-123', owner: 'myorg', project_number: 1 },
      }))
      const err = validateConfig(config)
      expect(err?.code).toBe('incomplete_github_app_config')
      if (err?.code === 'incomplete_github_app_config') {
        expect(err.missing).toContain('private_key')
        expect(err.missing).toContain('installation_id')
      }
    }
    finally {
      if (origToken !== undefined)
        process.env.GITHUB_TOKEN = origToken
    }
  })

  it('returns missing_tracker_api_key when api_key is absent and no app fields', () => {
    const origToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      const config = buildConfig(makeWorkflow({ tracker: { kind: 'github_projects', owner: 'org', project_number: 1 } }))
      const err = validateConfig(config)
      expect(err?.code).toBe('missing_tracker_api_key')
    }
    finally {
      if (origToken !== undefined)
        process.env.GITHUB_TOKEN = origToken
    }
  })

  it('returns missing_tracker_api_key when api_key is absent', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana', project_gid: 'gid' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_api_key')
  })

  it('returns missing_tracker_project_config when asana project_gid missing', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana', api_key: 'tok' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_project_config')
  })

  it('returns missing_claude_command when claude.command is blank (Section 17.1)', () => {
    // buildConfig always applies default when command is empty, so we test validateConfig
    // directly with a ServiceConfig that has a blank command
    const baseConfig = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
    }))
    const configWithBlankCommand = {
      ...baseConfig,
      claude: { ...baseConfig.claude, command: '   ' },
    }
    const err = validateConfig(configWithBlankCommand)
    expect(err?.code).toBe('missing_claude_command')
  })
})

describe('getActiveStates / getTerminalStates', () => {
  it('returns asana active_sections', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_sections: ['Todo'] },
    }))
    expect(getActiveStates(config)).toEqual(['Todo'])
  })

  it('returns github_projects active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', active_statuses: ['In Progress'] },
    }))
    expect(getActiveStates(config)).toEqual(['In Progress'])
  })

  it('includes "Rework" and "Merging" in default github_projects active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', owner: 'org', project_number: 1 },
    }))
    expect(getActiveStates(config)).toContain('Rework')
    expect(getActiveStates(config)).toContain('Merging')
  })

  it('does not include "Human Review" in default github_projects active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', owner: 'org', project_number: 1 },
    }))
    expect(getActiveStates(config)).not.toContain('Human Review')
  })

  it('returns defaults when not configured', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana' } }))
    expect(getTerminalStates(config)).toEqual(['Done', 'Cancelled'])
  })
})

describe('normalizeState', () => {
  it('lowercases and trims state names', () => {
    expect(normalizeState('  In Progress  ')).toBe('in progress')
    expect(normalizeState('DONE')).toBe('done')
  })
})

describe('label_prefix parsing', () => {
  it('parses label_prefix from github_projects config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'token',
        owner: 'myorg',
        project_number: 1,
        label_prefix: 'please-work',
      },
    }))
    expect(config.tracker.label_prefix).toBe('please-work')
  })

  it('defaults label_prefix to null when omitted', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'token', owner: 'myorg', project_number: 1 },
    }))
    expect(config.tracker.label_prefix).toBeNull()
  })

  it('parses label_prefix from asana config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'token', project_gid: 'gid', label_prefix: 'ci' },
    }))
    expect(config.tracker.label_prefix).toBe('ci')
  })
})

describe('path expansion', () => {
  it('expands ~ to HOME directory', () => {
    const home = process.env.HOME ?? '/home/user'
    const config = buildConfig(makeWorkflow({ workspace: { root: '~/workspaces' } }))
    expect(config.workspace.root).toBe(`${home}/workspaces`)
  })

  it('preserves absolute paths unchanged', () => {
    const config = buildConfig(makeWorkflow({ workspace: { root: '/tmp/myworkspaces' } }))
    expect(config.workspace.root).toBe('/tmp/myworkspaces')
  })
})

describe('per-state concurrency limits', () => {
  it('normalizes state keys to lowercase', () => {
    const config = buildConfig(makeWorkflow({
      agent: { max_concurrent_agents_by_state: { 'In Progress': 2, 'TODO': 1 } },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBe(2)
    expect(config.agent.max_concurrent_agents_by_state.todo).toBe(1)
  })

  it('ignores non-positive values', () => {
    const config = buildConfig(makeWorkflow({
      agent: { max_concurrent_agents_by_state: { done: 0, active: -1, running: 3 } },
    }))
    expect(config.agent.max_concurrent_agents_by_state.done).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.active).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.running).toBe(3)
  })

  it('maxConcurrentForState falls back to global limit for unknown states', () => {
    const config = buildConfig(makeWorkflow({ agent: { max_concurrent_agents: 5 } }))
    expect(maxConcurrentForState(config, 'unknown state')).toBe(5)
  })

  it('maxConcurrentForState returns per-state limit when configured', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents: 10,
        max_concurrent_agents_by_state: { 'in progress': 2 },
      },
    }))
    expect(maxConcurrentForState(config, 'In Progress')).toBe(2)
  })
})

describe('tracker filter config', () => {
  it('defaults to empty assignee and label arrays when filter section absent', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
    }))
    expect(config.tracker.filter).toEqual({ assignee: [], label: [] })
  })

  it('defaults to empty arrays when filter fields are missing', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'tok', owner: 'org', project_number: 1, filter: {} },
    }))
    expect(config.tracker.filter).toEqual({ assignee: [], label: [] })
  })

  it('parses filter.assignee from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid', filter: { assignee: 'user1, user2' } },
    }))
    expect(config.tracker.filter?.assignee).toEqual(['user1', 'user2'])
  })

  it('parses filter.assignee from YAML array', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'tok', owner: 'org', project_number: 1, filter: { assignee: ['alice', 'bob'] } },
    }))
    expect(config.tracker.filter?.assignee).toEqual(['alice', 'bob'])
  })

  it('parses filter.label from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid', filter: { label: 'bug, feature' } },
    }))
    expect(config.tracker.filter?.label).toEqual(['bug', 'feature'])
  })

  it('parses filter.label from YAML array', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'tok', owner: 'org', project_number: 1, filter: { label: ['bug', 'enhancement'] } },
    }))
    expect(config.tracker.filter?.label).toEqual(['bug', 'enhancement'])
  })

  it('parses both assignee and label together', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid', filter: { assignee: 'user1', label: 'bug' } },
    }))
    expect(config.tracker.filter?.assignee).toEqual(['user1'])
    expect(config.tracker.filter?.label).toEqual(['bug'])
  })
})

describe('watched_statuses parsing', () => {
  it('defaults to ["Human Review"] for github_projects when not configured', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'token', owner: 'org', project_number: 1 },
    }))
    expect(config.tracker.watched_statuses).toEqual(['Human Review'])
  })

  it('defaults to [] for asana when not configured', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'token', project_gid: 'gid' },
    }))
    expect(config.tracker.watched_statuses).toEqual([])
  })

  it('parses watched_statuses from YAML array for github_projects', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'token',
        owner: 'org',
        project_number: 1,
        watched_statuses: ['Human Review', 'Blocked'],
      },
    }))
    expect(config.tracker.watched_statuses).toEqual(['Human Review', 'Blocked'])
  })

  it('parses watched_statuses from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'token',
        owner: 'org',
        project_number: 1,
        watched_statuses: 'Human Review, Blocked',
      },
    }))
    expect(config.tracker.watched_statuses).toEqual(['Human Review', 'Blocked'])
  })
})

describe('getWatchedStates', () => {
  it('returns watched_statuses for github_projects', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'token',
        owner: 'org',
        project_number: 1,
        watched_statuses: ['Human Review'],
      },
    }))
    expect(getWatchedStates(config)).toEqual(['Human Review'])
  })

  it('returns empty array for asana', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'token', project_gid: 'gid' },
    }))
    expect(getWatchedStates(config)).toEqual([])
  })

  it('returns empty array for unknown tracker kind', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'linear' } }))
    expect(getWatchedStates(config)).toEqual([])
  })
})

describe('buildConfig - env section', () => {
  it('defaults to empty object when env section absent', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.env).toEqual({})
  })

  it('parses literal string values', () => {
    const config = buildConfig(makeWorkflow({
      env: { MY_VAR: 'hello', OTHER: 'world' },
    }))
    expect(config.env).toEqual({ MY_VAR: 'hello', OTHER: 'world' })
  })

  it('resolves $VAR references from process.env', () => {
    const orig = process.env.TEST_ENV_VALUE
    process.env.TEST_ENV_VALUE = 'resolved-val'
    try {
      const config = buildConfig(makeWorkflow({
        env: { MY_VAR: '$TEST_ENV_VALUE' },
      }))
      expect(config.env.MY_VAR).toBe('resolved-val')
    }
    finally {
      if (orig !== undefined)
        process.env.TEST_ENV_VALUE = orig
      else
        delete process.env.TEST_ENV_VALUE
    }
  })

  it('removes entries where $VAR reference cannot be resolved', () => {
    delete process.env.NONEXISTENT_VAR_12345
    const config = buildConfig(makeWorkflow({
      env: { GOOD: 'literal', BAD: '$NONEXISTENT_VAR_12345' },
    }))
    expect(config.env.GOOD).toBe('literal')
    expect(config.env.BAD).toBeUndefined()
  })

  it('preserves ${INSTALLATION_ACCESS_TOKEN} as-is for runtime resolution', () => {
    const config = buildConfig(makeWorkflow({
      env: { GH_TOKEN: '${INSTALLATION_ACCESS_TOKEN}' },
    }))
    expect(config.env.GH_TOKEN).toBe('${INSTALLATION_ACCESS_TOKEN}')
  })

  it('coerces numeric values to strings', () => {
    const config = buildConfig(makeWorkflow({
      env: { PORT: 3000 },
    }))
    expect(config.env.PORT).toBe('3000')
  })

  it('coerces boolean values to strings', () => {
    const config = buildConfig(makeWorkflow({
      env: { DEBUG: true },
    }))
    expect(config.env.DEBUG).toBe('true')
  })

  it('ignores non-object env section', () => {
    const config = buildConfig(makeWorkflow({ env: 'not-an-object' }))
    expect(config.env).toEqual({})
  })

  it('ignores array env section', () => {
    const config = buildConfig(makeWorkflow({ env: ['a', 'b'] }))
    expect(config.env).toEqual({})
  })

  it('rejects invalid env key names', () => {
    const config = buildConfig(makeWorkflow({
      env: { 'VALID_KEY': 'ok', '': 'empty', 'has space': 'bad', '123start': 'bad', 'ALSO_VALID': 'ok' },
    }))
    expect(config.env.VALID_KEY).toBe('ok')
    expect(config.env.ALSO_VALID).toBe('ok')
    expect(Object.keys(config.env)).toHaveLength(2)
  })
})
