/* eslint-disable no-template-curly-in-string */
import type { AuthConfig, GitHubPlatformConfig, SlackPlatformConfig, WorkflowDefinition } from './types'
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

  it('parses asana platform and project config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        asana: {
          api_key: 'token123',
        },
      },
      projects: [
        {
          platform: 'asana',
          project_gid: 'gid456',
          active_statuses: ['Todo', 'In Progress'],
        },
      ],
    }))
    expect(config.projects[0].platform).toBe('asana')
    const asana = config.platforms.asana as { api_key: string | null }
    expect(asana.api_key).toBe('token123')
    expect(config.projects[0].project_gid).toBe('gid456')
    expect(config.projects[0].active_statuses).toEqual(['Todo', 'In Progress'])
  })

  it('parses github platform and project config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        github: {
          api_key: 'ghtoken',
          owner: 'myorg',
        },
      },
      projects: [
        {
          platform: 'github',
          project_number: 42,
        },
      ],
    }))
    expect(config.projects[0].platform).toBe('github')
    const gh = config.platforms.github as GitHubPlatformConfig
    expect(gh.api_key).toBe('ghtoken')
    expect(gh.owner).toBe('myorg')
    expect(config.projects[0].project_number).toBe(42)
  })

  it('resolves $VAR env references for platform api_key', () => {
    process.env.TEST_API_KEY = 'resolved-token'
    const config = buildConfig(makeWorkflow({
      platforms: {
        asana: { api_key: '$TEST_API_KEY' },
      },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    const asana = config.platforms.asana as { api_key: string | null }
    expect(asana.api_key).toBe('resolved-token')
    delete process.env.TEST_API_KEY
  })

  it('parses comma-separated active_statuses string for asana project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', active_statuses: 'Todo, In Progress, Review' }],
    }))
    expect(config.projects[0].active_statuses).toEqual(['Todo', 'In Progress', 'Review'])
  })

  it('accepts active_sections as alias for active_statuses (asana project)', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', active_sections: ['Todo', 'In Progress'] }],
    }))
    expect(config.projects[0].active_statuses).toEqual(['Todo', 'In Progress'])
  })

  it('defaults polling.mode to "poll"', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.polling.mode).toBe('poll')
  })

  it('parses polling.mode "webhook"', () => {
    const config = buildConfig(makeWorkflow({ polling: { mode: 'webhook' } }))
    expect(config.polling.mode).toBe('webhook')
  })

  it('falls back to "poll" for invalid polling.mode', () => {
    const config = buildConfig(makeWorkflow({ polling: { mode: 'invalid' } }))
    expect(config.polling.mode).toBe('poll')
  })

  it('parses polling.mode case-insensitively', () => {
    const config = buildConfig(makeWorkflow({ polling: { mode: 'Webhook' } }))
    expect(config.polling.mode).toBe('webhook')
  })

  it('parses polling.mode "relay"', () => {
    const config = buildConfig(makeWorkflow({ polling: { mode: 'relay' } }))
    expect(config.polling.mode).toBe('relay')
  })

  it('parses relay config from YAML', () => {
    const config = buildConfig(makeWorkflow({
      relay: {
        url: 'https://my-relay.workers.dev',
        token: '$TEST_RELAY_TOKEN_PARSE',
        room: 'my-project',
        secret: 'webhook-secret',
      },
    }))
    expect(config.relay.url).toBe('https://my-relay.workers.dev')
    expect(config.relay.room).toBe('my-project')
    expect(config.relay.secret).toBe('webhook-secret')
  })

  it('defaults relay config to all nulls', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.relay.url).toBeNull()
    expect(config.relay.token).toBeNull()
    expect(config.relay.room).toBeNull()
    expect(config.relay.secret).toBeNull()
  })

  it('resolves $ENV_VAR in relay.token', () => {
    process.env.TEST_RELAY_TOKEN = 'resolved-token'
    const config = buildConfig(makeWorkflow({
      relay: { token: '$TEST_RELAY_TOKEN' },
    }))
    expect(config.relay.token).toBe('resolved-token')
    delete process.env.TEST_RELAY_TOKEN
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

describe('buildConfig - claude.sandbox', () => {
  it('defaults sandbox to null when not configured', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.claude.sandbox).toBeNull()
  })

  it('returns null for non-object sandbox values', () => {
    expect(buildConfig(makeWorkflow({ claude: { sandbox: 'yes' } })).claude.sandbox).toBeNull()
    expect(buildConfig(makeWorkflow({ claude: { sandbox: 42 } })).claude.sandbox).toBeNull()
    expect(buildConfig(makeWorkflow({ claude: { sandbox: true } })).claude.sandbox).toBeNull()
    expect(buildConfig(makeWorkflow({ claude: { sandbox: [] } })).claude.sandbox).toBeNull()
  })

  it('returns null for empty sandbox object', () => {
    const config = buildConfig(makeWorkflow({ claude: { sandbox: {} } }))
    expect(config.claude.sandbox).toBeNull()
  })

  it('parses enabled flag', () => {
    const config = buildConfig(makeWorkflow({ claude: { sandbox: { enabled: true } } }))
    expect(config.claude.sandbox?.enabled).toBe(true)
  })

  it('parses autoAllowBashIfSandboxed flag', () => {
    const config = buildConfig(makeWorkflow({ claude: { sandbox: { enabled: true, autoAllowBashIfSandboxed: true } } }))
    expect(config.claude.sandbox?.autoAllowBashIfSandboxed).toBe(true)
  })

  it('parses network configuration', () => {
    const config = buildConfig(makeWorkflow({
      claude: {
        sandbox: {
          enabled: true,
          network: {
            allowedDomains: ['api.github.com', 'registry.npmjs.org'],
            allowLocalBinding: true,
            allowUnixSockets: ['/var/run/docker.sock'],
          },
        },
      },
    }))
    expect(config.claude.sandbox?.network?.allowedDomains).toEqual(['api.github.com', 'registry.npmjs.org'])
    expect(config.claude.sandbox?.network?.allowLocalBinding).toBe(true)
    expect(config.claude.sandbox?.network?.allowUnixSockets).toEqual(['/var/run/docker.sock'])
  })

  it('parses filesystem configuration', () => {
    const config = buildConfig(makeWorkflow({
      claude: {
        sandbox: {
          enabled: true,
          filesystem: {
            allowWrite: ['/tmp'],
            denyRead: ['/etc/shadow'],
          },
        },
      },
    }))
    expect(config.claude.sandbox?.filesystem?.allowWrite).toEqual(['/tmp'])
    expect(config.claude.sandbox?.filesystem?.denyRead).toEqual(['/etc/shadow'])
  })

  it('parses excludedCommands as array', () => {
    const config = buildConfig(makeWorkflow({
      claude: {
        sandbox: { enabled: true, excludedCommands: ['rm', 'curl'] },
      },
    }))
    expect(config.claude.sandbox?.excludedCommands).toEqual(['rm', 'curl'])
  })

  it('parses ripgrep configuration', () => {
    const config = buildConfig(makeWorkflow({
      claude: {
        sandbox: { enabled: true, ripgrep: { command: '/usr/bin/rg', args: ['--hidden'] } },
      },
    }))
    expect(config.claude.sandbox?.ripgrep).toEqual({ command: '/usr/bin/rg', args: ['--hidden'] })
  })

  it('ignores non-boolean enabled values', () => {
    const config = buildConfig(makeWorkflow({
      claude: { sandbox: { enabled: 'yes', autoAllowBashIfSandboxed: true } },
    }))
    expect(config.claude.sandbox?.enabled).toBeUndefined()
    expect(config.claude.sandbox?.autoAllowBashIfSandboxed).toBe(true)
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
      platforms: {
        github: {
          app_id: 'app-123',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest',
          installation_id: 456,
          owner: 'myorg',
        },
      },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const gh = config.platforms.github as GitHubPlatformConfig
    expect(gh.app_id).toBe('app-123')
    expect(gh.private_key).toBe('-----BEGIN RSA PRIVATE KEY-----\ntest')
    expect(gh.installation_id).toBe(456)
  })

  it('resolves app_id from $VAR env reference', () => {
    process.env.TEST_GITHUB_APP_ID = 'env-app-id'
    const config = buildConfig(makeWorkflow({
      platforms: { github: { app_id: '$TEST_GITHUB_APP_ID', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const gh = config.platforms.github as GitHubPlatformConfig
    expect(gh.app_id).toBe('env-app-id')
    delete process.env.TEST_GITHUB_APP_ID
  })

  it('falls back to GITHUB_APP_ID env var when app_id is absent', () => {
    const orig = process.env.GITHUB_APP_ID
    process.env.GITHUB_APP_ID = 'fallback-app-id'
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { github: { owner: 'org' } },
        projects: [{ platform: 'github', project_number: 1 }],
      }))
      const gh = config.platforms.github as GitHubPlatformConfig
      expect(gh.app_id).toBe('fallback-app-id')
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
        platforms: { github: { owner: 'org' } },
        projects: [{ platform: 'github', project_number: 1 }],
      }))
      const gh = config.platforms.github as GitHubPlatformConfig
      expect(gh.installation_id).toBe(9999)
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
      platforms: { github: { installation_id: '$TEST_INSTALLATION_ID', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const gh = config.platforms.github as GitHubPlatformConfig
    expect(gh.installation_id).toBe(12345)
    delete process.env.TEST_INSTALLATION_ID
  })
})

describe('validateConfig', () => {
  it('returns null for valid asana config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns null for valid github config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns no_projects_configured when no projects are configured', () => {
    const config = buildConfig(makeWorkflow({}))
    const err = validateConfig(config)
    expect(err).not.toBeNull()
    expect(err?.code).toBe('no_projects_configured')
  })

  it('returns unknown_platform_reference when project references unknown platform', () => {
    const config = buildConfig(makeWorkflow({
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const err = validateConfig(config)
    expect(err?.code).toBe('unknown_platform_reference')
    if (err?.code === 'unknown_platform_reference') {
      expect(err.platform).toBe('github')
      expect(err.context).toBe('project')
    }
  })

  it('returns null for valid github config with app auth (no api_key)', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        github: {
          app_id: 'app-123',
          private_key: '-----BEGIN RSA PRIVATE KEY-----\nkey',
          installation_id: 456,
          owner: 'myorg',
        },
      },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns incomplete_platform_app_config when only some app fields are present', () => {
    const origToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { github: { app_id: 'app-123', owner: 'myorg' } },
        projects: [{ platform: 'github', project_number: 1 }],
      }))
      const err = validateConfig(config)
      expect(err?.code).toBe('incomplete_platform_app_config')
      if (err?.code === 'incomplete_platform_app_config') {
        expect(err.missing).toContain('private_key')
        expect(err.missing).toContain('installation_id')
      }
    }
    finally {
      if (origToken !== undefined)
        process.env.GITHUB_TOKEN = origToken
    }
  })

  it('returns missing_platform_api_key when api_key is absent and no app fields', () => {
    const origToken = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { github: { owner: 'org' } },
        projects: [{ platform: 'github', project_number: 1 }],
      }))
      const err = validateConfig(config)
      expect(err?.code).toBe('missing_platform_api_key')
      if (err?.code === 'missing_platform_api_key') {
        expect(err.platform).toBe('github')
      }
    }
    finally {
      if (origToken !== undefined)
        process.env.GITHUB_TOKEN = origToken
    }
  })

  it('returns null for webhook mode (port validation deferred to CLI)', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
      polling: { mode: 'webhook' },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns missing_claude_command when claude.command is blank (Section 17.1)', () => {
    // buildConfig always applies default when command is empty, so we test validateConfig
    // directly with a ServiceConfig that has a blank command
    const baseConfig = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    const configWithBlankCommand = {
      ...baseConfig,
      claude: { ...baseConfig.claude, command: '   ' },
    }
    const err = validateConfig(configWithBlankCommand)
    expect(err?.code).toBe('missing_claude_command')
  })

  it('returns unknown_platform_reference when channel references unknown platform', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
      channels: [{ platform: 'slack' }],
    }))
    const err = validateConfig(config)
    expect(err?.code).toBe('unknown_platform_reference')
    if (err?.code === 'unknown_platform_reference') {
      expect(err.platform).toBe('slack')
      expect(err.context).toBe('channel')
    }
  })

  it('returns no_projects_configured when projects array is empty', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok' } },
      projects: [],
    }))
    const err = validateConfig(config)
    expect(err).not.toBeNull()
    expect(err?.code).toBe('no_projects_configured')
  })

  it('returns missing_github_project_config when github project has no project_id and no owner+project_number', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: null } },
      projects: [{ platform: 'github' }],
    }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_github_project_config')
  })

  it('returns null for github project with project_id (no owner/project_number required)', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token' } },
      projects: [{ platform: 'github', project_id: 'PVT_kwABC123' }],
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns null for github project with owner and project_number', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'myorg' } },
      projects: [{ platform: 'github', project_number: 5 }],
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns missing_asana_project_config when asana project has no project_gid', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana' }],
    }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_asana_project_config')
  })

  it('returns null for valid asana project with project_gid', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana', project_gid: 'gid123' }],
    }))
    expect(validateConfig(config)).toBeNull()
  })
})

describe('getActiveStates / getTerminalStates', () => {
  it('returns asana project active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', active_statuses: ['Todo'] }],
    }))
    expect(getActiveStates(config.projects[0])).toEqual(['Todo'])
  })

  it('returns github project active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', active_statuses: ['In Progress'] }],
    }))
    expect(getActiveStates(config.projects[0])).toEqual(['In Progress'])
  })

  it('includes "Rework" and "Merging" in default github project active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(getActiveStates(config.projects[0])).toContain('Rework')
    expect(getActiveStates(config.projects[0])).toContain('Merging')
  })

  it('does not include "Human Review" in default github project active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(getActiveStates(config.projects[0])).not.toContain('Human Review')
  })

  it('returns defaults when not configured (asana terminal statuses)', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana' }],
    }))
    expect(getTerminalStates(config.projects[0])).toEqual(['Done', 'Cancelled'])
  })
})

describe('normalizeState', () => {
  it('lowercases and trims state names', () => {
    expect(normalizeState('  In Progress  ')).toBe('in progress')
    expect(normalizeState('DONE')).toBe('done')
  })
})

describe('label_prefix parsing', () => {
  it('parses label_prefix from github project config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'myorg' } },
      projects: [{ platform: 'github', project_number: 1, label_prefix: 'agent-please' }],
    }))
    expect(config.projects[0].label_prefix).toBe('agent-please')
  })

  it('defaults label_prefix to null when omitted', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'myorg' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(config.projects[0].label_prefix).toBeNull()
  })

  it('parses label_prefix from asana project config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana', project_gid: 'gid', label_prefix: 'ci' }],
    }))
    expect(config.projects[0].label_prefix).toBe('ci')
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

describe('project filter config', () => {
  it('defaults to empty assignee and label arrays when filter section absent', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    expect(config.projects[0].filter).toEqual({ assignee: [], label: [] })
  })

  it('defaults to empty arrays when filter fields are missing', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, filter: {} }],
    }))
    expect(config.projects[0].filter).toEqual({ assignee: [], label: [] })
  })

  it('parses filter.assignee from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid', filter: { assignee: 'user1, user2' } }],
    }))
    expect(config.projects[0].filter?.assignee).toEqual(['user1', 'user2'])
  })

  it('parses filter.assignee from YAML array', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, filter: { assignee: ['alice', 'bob'] } }],
    }))
    expect(config.projects[0].filter?.assignee).toEqual(['alice', 'bob'])
  })

  it('parses filter.label from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid', filter: { label: 'bug, feature' } }],
    }))
    expect(config.projects[0].filter?.label).toEqual(['bug', 'feature'])
  })

  it('parses filter.label from YAML array', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, filter: { label: ['bug', 'enhancement'] } }],
    }))
    expect(config.projects[0].filter?.label).toEqual(['bug', 'enhancement'])
  })

  it('parses both assignee and label together', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid', filter: { assignee: 'user1', label: 'bug' } }],
    }))
    expect(config.projects[0].filter?.assignee).toEqual(['user1'])
    expect(config.projects[0].filter?.label).toEqual(['bug'])
  })
})

describe('watched_statuses parsing', () => {
  it('defaults to ["Human Review"] for github project when not configured', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    expect(config.projects[0].watched_statuses).toEqual(['Human Review'])
  })

  it('defaults to [] for asana project when not configured', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    expect(config.projects[0].watched_statuses).toEqual([])
  })

  it('parses watched_statuses from YAML array for github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      projects: [{
        platform: 'github',
        project_number: 1,
        watched_statuses: ['Human Review', 'Blocked'],
      }],
    }))
    expect(config.projects[0].watched_statuses).toEqual(['Human Review', 'Blocked'])
  })

  it('parses watched_statuses from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      projects: [{
        platform: 'github',
        project_number: 1,
        watched_statuses: 'Human Review, Blocked',
      }],
    }))
    expect(config.projects[0].watched_statuses).toEqual(['Human Review', 'Blocked'])
  })
})

describe('getWatchedStates', () => {
  it('returns watched_statuses for github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      projects: [{
        platform: 'github',
        project_number: 1,
        watched_statuses: ['Human Review'],
      }],
    }))
    expect(getWatchedStates(config.projects[0])).toEqual(['Human Review'])
  })

  it('returns empty array for asana project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'token' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    expect(getWatchedStates(config.projects[0])).toEqual([])
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

describe('webhook config', () => {
  it('defaults to null secret and null events when missing', () => {
    const prev = process.env.WEBHOOK_SECRET
    delete process.env.WEBHOOK_SECRET
    try {
      const config = buildConfig(makeWorkflow({}))
      expect(config.server.webhook.secret).toBeNull()
      expect(config.server.webhook.events).toBeNull()
    }
    finally {
      if (prev === undefined)
        delete process.env.WEBHOOK_SECRET
      else
        process.env.WEBHOOK_SECRET = prev
    }
  })

  it('parses webhook secret directly', () => {
    const config = buildConfig(makeWorkflow({
      server: { webhook: { secret: 'my-webhook-secret' } },
    }))
    expect(config.server.webhook.secret).toBe('my-webhook-secret')
  })

  it('resolves webhook secret from env var', () => {
    const prev = process.env.WEBHOOK_SECRET
    process.env.WEBHOOK_SECRET = 'env-secret-value'
    try {
      const config = buildConfig(makeWorkflow({
        server: { webhook: { secret: '$WEBHOOK_SECRET' } },
      }))
      expect(config.server.webhook.secret).toBe('env-secret-value')
    }
    finally {
      if (prev === undefined)
        delete process.env.WEBHOOK_SECRET
      else
        process.env.WEBHOOK_SECRET = prev
    }
  })

  it('parses events as array', () => {
    const config = buildConfig(makeWorkflow({
      server: { webhook: { events: ['issues', 'pull_request'] } },
    }))
    expect(config.server.webhook.events).toEqual(['issues', 'pull_request'])
  })

  it('parses events as CSV string', () => {
    const config = buildConfig(makeWorkflow({
      server: { webhook: { events: 'issues, pull_request, projects_v2_item' } },
    }))
    expect(config.server.webhook.events).toEqual(['issues', 'pull_request', 'projects_v2_item'])
  })

  it('falls back to WEBHOOK_SECRET env when secret not set', () => {
    const prev = process.env.WEBHOOK_SECRET
    process.env.WEBHOOK_SECRET = 'fallback-secret'
    try {
      const config = buildConfig(makeWorkflow({
        server: { webhook: {} },
      }))
      expect(config.server.webhook.secret).toBe('fallback-secret')
    }
    finally {
      if (prev === undefined)
        delete process.env.WEBHOOK_SECRET
      else
        process.env.WEBHOOK_SECRET = prev
    }
  })
})

describe('buildConfig db section', () => {
  it('applies defaults when db section is absent', () => {
    const prevUrl = process.env.TURSO_DATABASE_URL
    const prevToken = process.env.TURSO_AUTH_TOKEN
    try {
      delete process.env.TURSO_DATABASE_URL
      delete process.env.TURSO_AUTH_TOKEN
      const config = buildConfig(makeWorkflow({}))
      expect(config.db.path).toBe('.agent-please/agent_runs.db')
      expect(config.db.turso_url).toBeNull()
      expect(config.db.turso_auth_token).toBeNull()
    }
    finally {
      if (prevUrl === undefined)
        delete process.env.TURSO_DATABASE_URL
      else
        process.env.TURSO_DATABASE_URL = prevUrl
      if (prevToken === undefined)
        delete process.env.TURSO_AUTH_TOKEN
      else
        process.env.TURSO_AUTH_TOKEN = prevToken
    }
  })

  it('uses custom db path when provided', () => {
    const config = buildConfig(makeWorkflow({ db: { path: 'data/runs.db' } }))
    expect(config.db.path).toBe('data/runs.db')
  })

  it('resolves $VAR for turso_url', () => {
    const orig = process.env.MY_TURSO_URL
    try {
      process.env.MY_TURSO_URL = 'libsql://my-db.turso.io'
      const config = buildConfig(makeWorkflow({ db: { turso_url: '$MY_TURSO_URL' } }))
      expect(config.db.turso_url).toBe('libsql://my-db.turso.io')
    }
    finally {
      if (orig === undefined)
        delete process.env.MY_TURSO_URL
      else process.env.MY_TURSO_URL = orig
    }
  })

  it('resolves $VAR for turso_auth_token', () => {
    const orig = process.env.MY_TURSO_TOKEN
    try {
      process.env.MY_TURSO_TOKEN = 'secret-token'
      const config = buildConfig(makeWorkflow({ db: { turso_auth_token: '$MY_TURSO_TOKEN' } }))
      expect(config.db.turso_auth_token).toBe('secret-token')
    }
    finally {
      if (orig === undefined)
        delete process.env.MY_TURSO_TOKEN
      else process.env.MY_TURSO_TOKEN = orig
    }
  })

  it('falls back to TURSO_DATABASE_URL env var when turso_url is absent', () => {
    const orig = process.env.TURSO_DATABASE_URL
    try {
      process.env.TURSO_DATABASE_URL = 'libsql://fallback.turso.io'
      const config = buildConfig(makeWorkflow({}))
      expect(config.db.turso_url).toBe('libsql://fallback.turso.io')
    }
    finally {
      if (orig === undefined)
        delete process.env.TURSO_DATABASE_URL
      else process.env.TURSO_DATABASE_URL = orig
    }
  })

  it('uses literal turso_url when no $VAR prefix', () => {
    const config = buildConfig(makeWorkflow({ db: { turso_url: 'libsql://direct.turso.io' } }))
    expect(config.db.turso_url).toBe('libsql://direct.turso.io')
  })
})

describe('buildConfig - platforms.github bot_username', () => {
  it('parses bot_username from github platform config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        github: { api_key: 'token', owner: 'myorg', bot_username: 'my-bot' },
      },
    }))
    const gh = config.platforms.github as GitHubPlatformConfig
    expect(gh.bot_username).toBe('my-bot')
  })

  it('resolves $VAR for bot_username', () => {
    const orig = process.env.TEST_BOT_USER
    process.env.TEST_BOT_USER = 'env-bot-name'
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { github: { api_key: 'token', bot_username: '$TEST_BOT_USER' } },
      }))
      const gh = config.platforms.github as GitHubPlatformConfig
      expect(gh.bot_username).toBe('env-bot-name')
    }
    finally {
      if (orig !== undefined)
        process.env.TEST_BOT_USER = orig
      else
        delete process.env.TEST_BOT_USER
    }
  })

  it('falls back to CHAT_BOT_USERNAME env when bot_username absent', () => {
    const orig = process.env.CHAT_BOT_USERNAME
    process.env.CHAT_BOT_USERNAME = 'fallback-bot'
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { github: { api_key: 'token' } },
      }))
      const gh = config.platforms.github as GitHubPlatformConfig
      expect(gh.bot_username).toBe('fallback-bot')
    }
    finally {
      if (orig !== undefined)
        process.env.CHAT_BOT_USERNAME = orig
      else
        delete process.env.CHAT_BOT_USERNAME
    }
  })
})

describe('buildConfig - channels config', () => {
  it('defaults to empty channels array when channels section absent', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.channels).toEqual([])
  })

  it('returns github channel with default allowed_associations when github channel present', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github' }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'MEMBER', 'COLLABORATOR'])
  })

  it('parses allowed_associations from github channel config', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github', allowed_associations: ['OWNER', 'CONTRIBUTOR'] }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'CONTRIBUTOR'])
  })

  it('parses allowed_associations from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github', allowed_associations: 'OWNER, MEMBER' }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'MEMBER'])
  })

  it('normalizes allowed_associations to uppercase', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github', allowed_associations: ['owner', 'member'] }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'MEMBER'])
  })

  it('filters out invalid association values', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github', allowed_associations: ['OWNER', 'INVALID', 'MEMBER'] }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'MEMBER'])
  })

  it('falls back to defaults when all associations are invalid', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'token', owner: 'org' } },
      channels: [{ platform: 'github', allowed_associations: ['INVALID'] }],
    }))
    expect(config.channels[0].allowed_associations).toEqual(['OWNER', 'MEMBER', 'COLLABORATOR'])
  })

  it('parses slack platform config with bot_token and signing_secret', () => {
    const prevToken = process.env.SLACK_BOT_TOKEN
    const prevSecret = process.env.SLACK_SIGNING_SECRET
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_SIGNING_SECRET
    try {
      const config = buildConfig(makeWorkflow({
        platforms: {
          slack: {
            bot_token: 'xoxb-test-token',
            signing_secret: 'slack-secret',
          },
        },
        channels: [{ platform: 'slack' }],
      }))
      const slack = config.platforms.slack as SlackPlatformConfig
      expect(slack.bot_token).toBe('xoxb-test-token')
      expect(slack.signing_secret).toBe('slack-secret')
    }
    finally {
      if (prevToken !== undefined)
        process.env.SLACK_BOT_TOKEN = prevToken
      if (prevSecret !== undefined)
        process.env.SLACK_SIGNING_SECRET = prevSecret
    }
  })

  it('resolves $VAR for slack platform config fields', () => {
    const origToken = process.env.TEST_SLACK_TOKEN
    const origSecret = process.env.TEST_SLACK_SECRET
    process.env.TEST_SLACK_TOKEN = 'resolved-slack-token'
    process.env.TEST_SLACK_SECRET = 'resolved-slack-secret'
    try {
      const config = buildConfig(makeWorkflow({
        platforms: {
          slack: {
            bot_token: '$TEST_SLACK_TOKEN',
            signing_secret: '$TEST_SLACK_SECRET',
          },
        },
        channels: [{ platform: 'slack' }],
      }))
      const slack = config.platforms.slack as SlackPlatformConfig
      expect(slack.bot_token).toBe('resolved-slack-token')
      expect(slack.signing_secret).toBe('resolved-slack-secret')
    }
    finally {
      if (origToken !== undefined)
        process.env.TEST_SLACK_TOKEN = origToken
      else delete process.env.TEST_SLACK_TOKEN
      if (origSecret !== undefined)
        process.env.TEST_SLACK_SECRET = origSecret
      else delete process.env.TEST_SLACK_SECRET
    }
  })

  it('falls back to SLACK_BOT_TOKEN env when slack.bot_token absent', () => {
    const prevToken = process.env.SLACK_BOT_TOKEN
    const prevSecret = process.env.SLACK_SIGNING_SECRET
    process.env.SLACK_BOT_TOKEN = 'env-slack-token'
    delete process.env.SLACK_SIGNING_SECRET
    try {
      const config = buildConfig(makeWorkflow({
        platforms: { slack: {} },
        channels: [{ platform: 'slack' }],
      }))
      const slack = config.platforms.slack as SlackPlatformConfig
      expect(slack.bot_token).toBe('env-slack-token')
    }
    finally {
      if (prevToken !== undefined)
        process.env.SLACK_BOT_TOKEN = prevToken
      else delete process.env.SLACK_BOT_TOKEN
      if (prevSecret !== undefined)
        process.env.SLACK_SIGNING_SECRET = prevSecret
    }
  })
})

describe('buildConfig state section', () => {
  it('defaults to memory adapter when no state config', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.state).toEqual({
      adapter: 'memory',
      url: null,
      key_prefix: 'chat-sdk',
      on_lock_conflict: 'drop',
    })
  })

  it('parses explicit redis adapter config', () => {
    const config = buildConfig(makeWorkflow({
      state: { adapter: 'redis', url: 'redis://localhost:6379', key_prefix: 'my-bot' },
    }))
    expect(config.state.adapter).toBe('redis')
    expect(config.state.url).toBe('redis://localhost:6379')
    expect(config.state.key_prefix).toBe('my-bot')
  })

  it('resolves $REDIS_URL env reference for redis adapter', () => {
    const prev = process.env.TEST_STATE_REDIS_URL
    process.env.TEST_STATE_REDIS_URL = 'redis://env-host:6379'
    try {
      const config = buildConfig(makeWorkflow({
        state: { adapter: 'redis', url: '$TEST_STATE_REDIS_URL' },
      }))
      expect(config.state.url).toBe('redis://env-host:6379')
    }
    finally {
      if (prev !== undefined)
        process.env.TEST_STATE_REDIS_URL = prev
      else delete process.env.TEST_STATE_REDIS_URL
    }
  })

  it('falls back to REDIS_URL env var for redis adapter when url is omitted', () => {
    const prev = process.env.REDIS_URL
    process.env.REDIS_URL = 'redis://fallback:6379'
    try {
      const config = buildConfig(makeWorkflow({
        state: { adapter: 'redis' },
      }))
      expect(config.state.url).toBe('redis://fallback:6379')
    }
    finally {
      if (prev !== undefined)
        process.env.REDIS_URL = prev
      else delete process.env.REDIS_URL
    }
  })

  it('falls back to POSTGRES_URL env var for postgres adapter', () => {
    const prev = process.env.POSTGRES_URL
    process.env.POSTGRES_URL = 'postgres://fallback:5432/db'
    try {
      const config = buildConfig(makeWorkflow({
        state: { adapter: 'postgres' },
      }))
      expect(config.state.adapter).toBe('postgres')
      expect(config.state.url).toBe('postgres://fallback:5432/db')
    }
    finally {
      if (prev !== undefined)
        process.env.POSTGRES_URL = prev
      else delete process.env.POSTGRES_URL
    }
  })

  it('defaults to memory on invalid adapter kind', () => {
    const config = buildConfig(makeWorkflow({
      state: { adapter: 'invalid-adapter' },
    }))
    expect(config.state.adapter).toBe('memory')
  })

  it('parses on_lock_conflict: force', () => {
    const config = buildConfig(makeWorkflow({
      state: { adapter: 'memory', on_lock_conflict: 'force' },
    }))
    expect(config.state.on_lock_conflict).toBe('force')
  })

  it('defaults on_lock_conflict to drop for unknown value', () => {
    const config = buildConfig(makeWorkflow({
      state: { adapter: 'memory', on_lock_conflict: 'unknown' },
    }))
    expect(config.state.on_lock_conflict).toBe('drop')
  })

  it('parses ioredis adapter with REDIS_URL fallback', () => {
    const prev = process.env.REDIS_URL
    process.env.REDIS_URL = 'redis://ioredis-host:6379'
    try {
      const config = buildConfig(makeWorkflow({
        state: { adapter: 'ioredis' },
      }))
      expect(config.state.adapter).toBe('ioredis')
      expect(config.state.url).toBe('redis://ioredis-host:6379')
    }
    finally {
      if (prev !== undefined)
        process.env.REDIS_URL = prev
      else delete process.env.REDIS_URL
    }
  })
})

describe('buildConfig — commit_signing', () => {
  it('defaults to mode none and null ssh_signing_key when commit_signing absent', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.commit_signing.mode).toBe('none')
    expect(config.commit_signing.ssh_signing_key).toBeNull()
  })

  it('parses mode ssh', () => {
    const config = buildConfig(makeWorkflow({ commit_signing: { mode: 'ssh', ssh_signing_key: '/path/to/key' } }))
    expect(config.commit_signing.mode).toBe('ssh')
  })

  it('parses mode api', () => {
    const config = buildConfig(makeWorkflow({ commit_signing: { mode: 'api' } }))
    expect(config.commit_signing.mode).toBe('api')
  })

  it('parses explicit mode none', () => {
    const config = buildConfig(makeWorkflow({ commit_signing: { mode: 'none' } }))
    expect(config.commit_signing.mode).toBe('none')
  })

  it('falls back to none for invalid mode', () => {
    const config = buildConfig(makeWorkflow({ commit_signing: { mode: 'gpg' } }))
    expect(config.commit_signing.mode).toBe('none')
  })

  it('resolves $ENV_VAR for ssh_signing_key when mode is ssh', () => {
    const orig = process.env.TEST_SSH_SIGNING_KEY
    process.env.TEST_SSH_SIGNING_KEY = '/home/user/.ssh/signing_key'
    try {
      const config = buildConfig(makeWorkflow({
        commit_signing: { mode: 'ssh', ssh_signing_key: '$TEST_SSH_SIGNING_KEY' },
      }))
      expect(config.commit_signing.ssh_signing_key).toBe('/home/user/.ssh/signing_key')
    }
    finally {
      if (orig !== undefined)
        process.env.TEST_SSH_SIGNING_KEY = orig
      else
        delete process.env.TEST_SSH_SIGNING_KEY
    }
  })

  it('returns null for ssh_signing_key when mode is not ssh', () => {
    const config = buildConfig(makeWorkflow({
      commit_signing: { mode: 'api', ssh_signing_key: '/path/to/key' },
    }))
    expect(config.commit_signing.ssh_signing_key).toBeNull()
  })

  it('falls back to SSH_SIGNING_KEY env var when ssh_signing_key not specified and mode is ssh', () => {
    const orig = process.env.SSH_SIGNING_KEY
    process.env.SSH_SIGNING_KEY = '/env/ssh/signing_key'
    try {
      const config = buildConfig(makeWorkflow({ commit_signing: { mode: 'ssh' } }))
      expect(config.commit_signing.ssh_signing_key).toBe('/env/ssh/signing_key')
    }
    finally {
      if (orig !== undefined)
        process.env.SSH_SIGNING_KEY = orig
      else
        delete process.env.SSH_SIGNING_KEY
    }
  })
})

describe('buildConfig — auth', () => {
  it('returns all-null auth config when auth section is missing', () => {
    const prev = process.env.BETTER_AUTH_URL
    delete process.env.BETTER_AUTH_URL
    try {
      const config = buildConfig(makeWorkflow({}))
      expect(config.auth).toEqual({
        secret: null,
        github: { client_id: null, client_secret: null },
        admin: { email: null, password: null },
        base_url: null,
        trusted_origins: [],
      } satisfies AuthConfig)
    }
    finally {
      if (prev !== undefined)
        process.env.BETTER_AUTH_URL = prev
      else
        delete process.env.BETTER_AUTH_URL
    }
  })

  it('parses auth section with literal values', () => {
    const config = buildConfig(makeWorkflow({
      auth: {
        secret: 'my-secret-key-32-chars-long-xxxxx',
        github: {
          client_id: 'gh-client-id',
          client_secret: 'gh-client-secret',
        },
        admin: {
          email: 'admin@example.com',
          password: 'admin-pass',
        },
      },
    }))
    expect(config.auth.secret).toBe('my-secret-key-32-chars-long-xxxxx')
    expect(config.auth.github.client_id).toBe('gh-client-id')
    expect(config.auth.github.client_secret).toBe('gh-client-secret')
    expect(config.auth.admin.email).toBe('admin@example.com')
    expect(config.auth.admin.password).toBe('admin-pass')
  })

  it('resolves $ENV_VAR references in auth config', () => {
    const prev = {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      AUTH_GITHUB_CLIENT_ID: process.env.AUTH_GITHUB_CLIENT_ID,
      AUTH_GITHUB_CLIENT_SECRET: process.env.AUTH_GITHUB_CLIENT_SECRET,
      AUTH_ADMIN_EMAIL: process.env.AUTH_ADMIN_EMAIL,
      AUTH_ADMIN_PASSWORD: process.env.AUTH_ADMIN_PASSWORD,
    }
    process.env.BETTER_AUTH_SECRET = 'env-secret'
    process.env.AUTH_GITHUB_CLIENT_ID = 'env-gh-id'
    process.env.AUTH_GITHUB_CLIENT_SECRET = 'env-gh-secret'
    process.env.AUTH_ADMIN_EMAIL = 'env-admin@example.com'
    process.env.AUTH_ADMIN_PASSWORD = 'env-pass'
    try {
      const config = buildConfig(makeWorkflow({
        auth: {
          secret: '$BETTER_AUTH_SECRET',
          github: {
            client_id: '$AUTH_GITHUB_CLIENT_ID',
            client_secret: '$AUTH_GITHUB_CLIENT_SECRET',
          },
          admin: {
            email: '$AUTH_ADMIN_EMAIL',
            password: '$AUTH_ADMIN_PASSWORD',
          },
        },
      }))
      expect(config.auth.secret).toBe('env-secret')
      expect(config.auth.github.client_id).toBe('env-gh-id')
      expect(config.auth.github.client_secret).toBe('env-gh-secret')
      expect(config.auth.admin.email).toBe('env-admin@example.com')
      expect(config.auth.admin.password).toBe('env-pass')
    }
    finally {
      for (const [key, val] of Object.entries(prev)) {
        if (val !== undefined)
          process.env[key] = val
        else delete process.env[key]
      }
    }
  })

  it('falls back to env vars when auth section has no values', () => {
    const prev = {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      AUTH_GITHUB_CLIENT_ID: process.env.AUTH_GITHUB_CLIENT_ID,
    }
    process.env.BETTER_AUTH_SECRET = 'fallback-secret'
    process.env.AUTH_GITHUB_CLIENT_ID = 'fallback-id'
    try {
      const config = buildConfig(makeWorkflow({
        auth: {},
      }))
      expect(config.auth.secret).toBe('fallback-secret')
      expect(config.auth.github.client_id).toBe('fallback-id')
    }
    finally {
      for (const [key, val] of Object.entries(prev)) {
        if (val !== undefined)
          process.env[key] = val
        else delete process.env[key]
      }
    }
  })

  it('returns null for unresolvable $ENV_VAR references', () => {
    const prevSecret = process.env.NONEXISTENT_SECRET
    delete process.env.NONEXISTENT_SECRET
    try {
      const config = buildConfig(makeWorkflow({
        auth: {
          secret: '$NONEXISTENT_SECRET',
        },
      }))
      expect(config.auth.secret).toBeNull()
    }
    finally {
      if (prevSecret !== undefined)
        process.env.NONEXISTENT_SECRET = prevSecret
    }
  })

  it('parses base_url from auth config', () => {
    const config = buildConfig(makeWorkflow({
      auth: { base_url: 'https://dora.passionfactory.ai' },
    }))
    expect(config.auth.base_url).toBe('https://dora.passionfactory.ai')
  })

  it('resolves $VAR for auth.base_url', () => {
    const prev = process.env.TEST_AUTH_BASE_URL
    process.env.TEST_AUTH_BASE_URL = 'https://env-base.example.com'
    try {
      const config = buildConfig(makeWorkflow({
        auth: { base_url: '$TEST_AUTH_BASE_URL' },
      }))
      expect(config.auth.base_url).toBe('https://env-base.example.com')
    }
    finally {
      if (prev !== undefined)
        process.env.TEST_AUTH_BASE_URL = prev
      else delete process.env.TEST_AUTH_BASE_URL
    }
  })

  it('falls back to BETTER_AUTH_URL env var when base_url absent', () => {
    const prev = process.env.BETTER_AUTH_URL
    process.env.BETTER_AUTH_URL = 'https://fallback-auth.example.com'
    try {
      const config = buildConfig(makeWorkflow({ auth: {} }))
      expect(config.auth.base_url).toBe('https://fallback-auth.example.com')
    }
    finally {
      if (prev !== undefined)
        process.env.BETTER_AUTH_URL = prev
      else delete process.env.BETTER_AUTH_URL
    }
  })

  it('defaults base_url to null when not configured and no env var', () => {
    const prev = process.env.BETTER_AUTH_URL
    delete process.env.BETTER_AUTH_URL
    try {
      const config = buildConfig(makeWorkflow({}))
      expect(config.auth.base_url).toBeNull()
    }
    finally {
      if (prev !== undefined)
        process.env.BETTER_AUTH_URL = prev
      else delete process.env.BETTER_AUTH_URL
    }
  })

  it('parses trusted_origins from YAML array', () => {
    const config = buildConfig(makeWorkflow({
      auth: { trusted_origins: ['https://dora.passionfactory.ai', 'http://localhost:3000'] },
    }))
    expect(config.auth.trusted_origins).toEqual(['https://dora.passionfactory.ai', 'http://localhost:3000'])
  })

  it('parses trusted_origins from CSV string', () => {
    const config = buildConfig(makeWorkflow({
      auth: { trusted_origins: 'https://a.example.com, https://b.example.com' },
    }))
    expect(config.auth.trusted_origins).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('defaults trusted_origins to empty array when not configured', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.auth.trusted_origins).toEqual([])
  })

  it('resolves $VAR in trusted_origins array items', () => {
    const prev = process.env.TEST_TRUSTED_ORIGIN
    process.env.TEST_TRUSTED_ORIGIN = 'https://resolved.example.com'
    try {
      const config = buildConfig(makeWorkflow({
        auth: { trusted_origins: ['$TEST_TRUSTED_ORIGIN', 'https://literal.example.com'] },
      }))
      expect(config.auth.trusted_origins).toEqual(['https://resolved.example.com', 'https://literal.example.com'])
    }
    finally {
      if (prev !== undefined)
        process.env.TEST_TRUSTED_ORIGIN = prev
      else delete process.env.TEST_TRUSTED_ORIGIN
    }
  })

  it('resolves $VAR in trusted_origins CSV string', () => {
    const prev = process.env.TEST_ORIGINS_CSV
    process.env.TEST_ORIGINS_CSV = 'https://a.example.com, https://b.example.com'
    try {
      const config = buildConfig(makeWorkflow({
        auth: { trusted_origins: '$TEST_ORIGINS_CSV' },
      }))
      expect(config.auth.trusted_origins).toEqual(['https://a.example.com', 'https://b.example.com'])
    }
    finally {
      if (prev !== undefined)
        process.env.TEST_ORIGINS_CSV = prev
      else delete process.env.TEST_ORIGINS_CSV
    }
  })
})
