import type { PlatformConfig, WorkflowDefinition } from './types'
import process from 'node:process'
import { describe, expect, it } from 'bun:test'
import {
  buildChannelsConfig,
  buildConfig,
  buildPlatformsConfig,
  buildProjectsConfig,
  getActiveStates,
  getTerminalStates,
  getWatchedStates,
  validateConfig,
} from './config'

function makeWorkflow(config: Record<string, unknown>): WorkflowDefinition {
  return { config, prompt_template: '' }
}

// -------------------------
// buildPlatformsConfig
// -------------------------
describe('buildPlatformsConfig', () => {
  it('returns empty record when platforms section is missing', () => {
    const result = buildPlatformsConfig({})
    expect(result).toEqual({})
  })

  it('parses github platform with api_key literal', () => {
    const result = buildPlatformsConfig({
      platforms: {
        github: {
          api_key: 'gh-token',
          owner: 'myorg',
          bot_username: 'my-bot',
        },
      },
    })
    expect(result.github).toBeDefined()
    const gh = result.github as any
    expect(gh.api_key).toBe('gh-token')
    expect(gh.owner).toBe('myorg')
    expect(gh.bot_username).toBe('my-bot')
  })

  it('resolves $ENV_VAR reference in github api_key', () => {
    const savedMytest = process.env.MYTEST_GITHUB_TOKEN
    process.env.MYTEST_GITHUB_TOKEN = 'env-token'
    const result = buildPlatformsConfig({
      platforms: {
        github: { api_key: '$MYTEST_GITHUB_TOKEN' },
      },
    })
    if (savedMytest === undefined)
      delete process.env.MYTEST_GITHUB_TOKEN
    else
      process.env.MYTEST_GITHUB_TOKEN = savedMytest
    const gh = result.github as any
    expect(gh.api_key).toBe('env-token')
  })

  it('falls back to GITHUB_TOKEN env var for github api_key', () => {
    const saved = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'fallback-token'
    const result = buildPlatformsConfig({
      platforms: {
        github: { owner: 'org' },
      },
    })
    if (saved === undefined)
      delete process.env.GITHUB_TOKEN
    else
      process.env.GITHUB_TOKEN = saved
    const gh = result.github as any
    expect(gh.api_key).toBe('fallback-token')
  })

  it('parses slack platform', () => {
    const result = buildPlatformsConfig({
      platforms: {
        slack: {
          bot_token: 'xoxb-token',
          signing_secret: 'secret',
        },
      },
    })
    const slack = result.slack as any
    expect(slack.bot_token).toBe('xoxb-token')
    expect(slack.signing_secret).toBe('secret')
  })

  it('resolves $ENV_VAR reference in slack bot_token', () => {
    const savedMytest = process.env.MYTEST_SLACK_TOKEN
    process.env.MYTEST_SLACK_TOKEN = 'slack-env-token'
    const result = buildPlatformsConfig({
      platforms: {
        slack: { bot_token: '$MYTEST_SLACK_TOKEN' },
      },
    })
    if (savedMytest === undefined)
      delete process.env.MYTEST_SLACK_TOKEN
    else
      process.env.MYTEST_SLACK_TOKEN = savedMytest
    const slack = result.slack as any
    expect(slack.bot_token).toBe('slack-env-token')
  })

  it('falls back to SLACK_BOT_TOKEN env var', () => {
    const saved = process.env.SLACK_BOT_TOKEN
    process.env.SLACK_BOT_TOKEN = 'slack-fallback'
    const result = buildPlatformsConfig({
      platforms: {
        slack: {},
      },
    })
    if (saved === undefined)
      delete process.env.SLACK_BOT_TOKEN
    else
      process.env.SLACK_BOT_TOKEN = saved
    const slack = result.slack as any
    expect(slack.bot_token).toBe('slack-fallback')
  })

  it('parses github with app auth fields', () => {
    const result = buildPlatformsConfig({
      platforms: {
        github: {
          app_id: '123',
          private_key: 'pem-content',
          installation_id: 456,
        },
      },
    })
    const gh = result.github as any
    expect(gh.app_id).toBe('123')
    expect(gh.private_key).toBe('pem-content')
    expect(gh.installation_id).toBe(456)
  })

  it('parses multiple platforms', () => {
    const result = buildPlatformsConfig({
      platforms: {
        github: { api_key: 'gh', owner: 'org' },
        slack: { bot_token: 'xoxb' },
      },
    })
    expect(Object.keys(result)).toHaveLength(2)
    expect(result.github).toBeDefined()
    expect(result.slack).toBeDefined()
  })
})

// -------------------------
// buildProjectsConfig
// -------------------------
describe('buildProjectsConfig', () => {
  it('returns empty array when projects section is missing', () => {
    const result = buildProjectsConfig({}, {})
    expect(result).toEqual([])
  })

  it('parses github project with project_number', () => {
    const platforms = { github: { api_key: 'gh', owner: 'org' } } as unknown as Record<string, PlatformConfig>
    const result = buildProjectsConfig({
      projects: [
        {
          platform: 'github',
          project_number: 42,
          active_statuses: ['Todo', 'In Progress'],
          terminal_statuses: ['Done'],
          watched_statuses: ['Human Review'],
        },
      ],
    }, platforms)
    expect(result).toHaveLength(1)
    const proj = result[0]
    expect(proj.platform).toBe('github')
    expect(proj.project_number).toBe(42)
    expect(proj.active_statuses).toEqual(['Todo', 'In Progress'])
    expect(proj.terminal_statuses).toEqual(['Done'])
    expect(proj.watched_statuses).toEqual(['Human Review'])
  })

  it('applies github defaults for status arrays', () => {
    const platforms = { github: { kind: 'github' } } as unknown as Record<string, PlatformConfig>
    const result = buildProjectsConfig({
      projects: [{ platform: 'github', project_number: 1 }],
    }, platforms)
    const proj = result[0]
    expect(proj.active_statuses).toContain('Todo')
    expect(proj.terminal_statuses).toContain('Done')
    expect(proj.watched_statuses).toContain('Human Review')
  })

  it('applies asana defaults for status arrays', () => {
    const platforms = { asana: { kind: 'asana' } } as unknown as Record<string, PlatformConfig>
    const result = buildProjectsConfig({
      projects: [{ platform: 'asana', project_gid: 'gid123' }],
    }, platforms)
    const proj = result[0]
    expect(proj.active_statuses).toContain('To Do')
    expect(proj.terminal_statuses).toContain('Done')
  })

  it('parses filter config', () => {
    const result = buildProjectsConfig({
      projects: [
        {
          platform: 'github',
          project_number: 1,
          filter: { label: ['agent'], assignee: ['bob'] },
        },
      ],
    }, { github: {} } as unknown as Record<string, PlatformConfig>)
    expect(result[0].filter.label).toEqual(['agent'])
    expect(result[0].filter.assignee).toEqual(['bob'])
  })

  it('uses default endpoint for github', () => {
    const result = buildProjectsConfig({
      projects: [{ platform: 'github', project_number: 1 }],
    }, { github: {} } as unknown as Record<string, PlatformConfig>)
    expect(result[0].endpoint).toBe('https://api.github.com')
  })

  it('parses custom endpoint', () => {
    const result = buildProjectsConfig({
      projects: [{ platform: 'github', project_number: 1, endpoint: 'https://custom.api' }],
    }, { github: {} } as unknown as Record<string, PlatformConfig>)
    expect(result[0].endpoint).toBe('https://custom.api')
  })

  it('skips entries without platform field', () => {
    const result = buildProjectsConfig({
      projects: [{ project_number: 1 }, { platform: 'github', project_number: 2 }],
    }, { github: {} } as unknown as Record<string, PlatformConfig>)
    expect(result).toHaveLength(1)
    expect(result[0].project_number).toBe(2)
  })

  it('parses label_prefix', () => {
    const result = buildProjectsConfig({
      projects: [{ platform: 'github', project_number: 1, label_prefix: 'ap' }],
    }, { github: {} } as unknown as Record<string, PlatformConfig>)
    expect(result[0].label_prefix).toBe('ap')
  })
})

// -------------------------
// buildChannelsConfig
// -------------------------
describe('buildChannelsConfig', () => {
  it('returns empty array when channels section is missing', () => {
    const result = buildChannelsConfig({})
    expect(result).toEqual([])
  })

  it('parses github channel with allowed_associations', () => {
    const result = buildChannelsConfig({
      channels: [
        { platform: 'github', allowed_associations: ['OWNER', 'MEMBER'] },
      ],
    })
    expect(result).toHaveLength(1)
    const ch = result[0]
    expect(ch.platform).toBe('github')
    expect(ch.allowed_associations).toEqual(['OWNER', 'MEMBER'])
  })

  it('applies default allowed_associations for github channel without explicit config', () => {
    const result = buildChannelsConfig({
      channels: [{ platform: 'github' }],
    })
    const ch = result[0]
    expect(ch.allowed_associations).toContain('OWNER')
    expect(ch.allowed_associations).toContain('MEMBER')
    expect(ch.allowed_associations).toContain('COLLABORATOR')
  })

  it('filters invalid association values', () => {
    const result = buildChannelsConfig({
      channels: [
        { platform: 'github', allowed_associations: ['OWNER', 'INVALID_VALUE'] },
      ],
    })
    const ch = result[0]
    expect(ch.allowed_associations).toEqual(['OWNER'])
  })

  it('parses slack channel', () => {
    const result = buildChannelsConfig({
      channels: [{ platform: 'slack' }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].platform).toBe('slack')
    expect(result[0].allowed_associations).toBeUndefined()
  })

  it('parses multiple channels', () => {
    const result = buildChannelsConfig({
      channels: [
        { platform: 'github', allowed_associations: ['OWNER'] },
        { platform: 'slack' },
      ],
    })
    expect(result).toHaveLength(2)
  })

  it('skips entries without platform field', () => {
    const result = buildChannelsConfig({
      channels: [{ allowed_associations: ['OWNER'] }, { platform: 'slack' }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].platform).toBe('slack')
  })
})

// -------------------------
// buildConfig integration
// -------------------------
describe('buildConfig with new platforms/projects/channels', () => {
  it('parses full new config shape', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        github: { api_key: 'gh-token', owner: 'myorg', bot_username: 'my-bot' },
        slack: { bot_token: 'xoxb', signing_secret: 'sec' },
      },
      projects: [
        {
          platform: 'github',
          project_number: 42,
          active_statuses: ['Todo', 'In Progress'],
          terminal_statuses: ['Done'],
          watched_statuses: ['Human Review'],
        },
      ],
      channels: [
        { platform: 'github', allowed_associations: ['OWNER', 'MEMBER'] },
        { platform: 'slack' },
      ],
    }))
    expect(config.platforms.github).toBeDefined()
    expect(config.platforms.slack).toBeDefined()
    expect(config.projects).toHaveLength(1)
    expect(config.projects[0].platform).toBe('github')
    expect(config.channels).toHaveLength(2)
  })

  it('returns empty platforms/projects/channels when not specified', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.platforms).toEqual({})
    expect(config.projects).toEqual([])
    expect(config.channels).toEqual([])
  })
})

// -------------------------
// validateConfig
// -------------------------
describe('validateConfig with new structure', () => {
  it('returns null for valid config with github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {
        github: { api_key: 'gh-token', owner: 'myorg' },
      },
      projects: [
        { platform: 'github', project_number: 42 },
      ],
    }))
    const error = validateConfig(config)
    expect(error).toBeNull()
  })

  it('returns error when project references unknown platform', () => {
    const config = buildConfig(makeWorkflow({
      platforms: {},
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const error = validateConfig(config)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('unknown_platform_reference')
  })

  it('returns error when channel references unknown platform', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
      channels: [{ platform: 'slack' }],
    }))
    const error = validateConfig(config)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('unknown_platform_reference')
  })

  it('returns error for missing claude command when explicitly overridden to blank', () => {
    // buildClaudeConfig replaces '' with the default 'claude', so to get a blank command
    // we must reach validateConfig with a config that somehow has an empty command.
    // This tests that the validation guard exists; in practice commandValue() applies defaults.
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    // Mutate the config to simulate a blank command (bypassing builder defaults)
    const mutated = { ...config, claude: { ...config.claude, command: '   ' } }
    const error = validateConfig(mutated)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('missing_claude_command')
  })

  it('returns no_projects_configured when platforms/projects/channels are all empty', () => {
    const config = buildConfig(makeWorkflow({}))
    const error = validateConfig(config)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('no_projects_configured')
  })

  it('returns error for missing github api_key when no app auth', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const error = validateConfig(config)
    expect(error).not.toBeNull()
    expect(error?.code).toBe('missing_platform_api_key')
  })
})

// -------------------------
// getActiveStates / getTerminalStates / getWatchedStates
// -------------------------
describe('getActiveStates with ProjectConfig', () => {
  it('returns active_statuses from github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, active_statuses: ['Todo', 'WIP'] }],
    }))
    const states = getActiveStates(config.projects[0])
    expect(states).toEqual(['Todo', 'WIP'])
  })

  it('returns defaults for github project without explicit active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1 }],
    }))
    const states = getActiveStates(config.projects[0])
    expect(states).toContain('Todo')
  })

  it('returns active_statuses from asana project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { asana: { api_key: 'tok' } },
      projects: [{ platform: 'asana', project_gid: 'gid' }],
    }))
    const states = getActiveStates(config.projects[0])
    expect(states).toContain('To Do')
  })
})

describe('getTerminalStates with ProjectConfig', () => {
  it('returns terminal_statuses from github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, terminal_statuses: ['Done'] }],
    }))
    const states = getTerminalStates(config.projects[0])
    expect(states).toEqual(['Done'])
  })
})

describe('getWatchedStates with ProjectConfig', () => {
  it('returns watched_statuses from github project', () => {
    const config = buildConfig(makeWorkflow({
      platforms: { github: { api_key: 'tok', owner: 'org' } },
      projects: [{ platform: 'github', project_number: 1, watched_statuses: ['Review'] }],
    }))
    const states = getWatchedStates(config.projects[0])
    expect(states).toEqual(['Review'])
  })
})
