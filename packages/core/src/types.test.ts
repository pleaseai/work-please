import type {
  AsanaPlatformConfig,
  ChannelConfig,
  GitHubPlatformConfig,
  PlatformConfig,
  ProjectConfig,
  ServiceConfig,
  SlackPlatformConfig,
} from './types'
import { describe, expect, it } from 'bun:test'

describe('platform-centric config types', () => {
  it('ServiceConfig accepts platforms, projects, channels shape', () => {
    const github: GitHubPlatformConfig = {
      api_key: 'token',
      owner: 'my-org',
      bot_username: 'please-bot',
      app_id: null,
      private_key: null,
      installation_id: null,
    }

    const slack: SlackPlatformConfig = {
      bot_token: 'xoxb-token',
      signing_secret: 'secret',
    }

    const asana: AsanaPlatformConfig = {
      api_key: 'asana-key',
      bot_username: null,
    }

    const platforms: Record<string, PlatformConfig> = {
      github,
      slack,
      asana,
    }

    const project: ProjectConfig = {
      platform: 'github',
      project_number: 1,
      project_id: null,
      project_gid: null,
      active_statuses: ['In Progress'],
      terminal_statuses: ['Done'],
      watched_statuses: [],
      endpoint: 'https://api.github.com/graphql',
      label_prefix: null,
      filter: { assignee: [], label: [] },
    }

    const channel: ChannelConfig = {
      platform: 'github',
      allowed_associations: ['OWNER', 'MEMBER'],
    }

    const config: Partial<ServiceConfig> = {
      platforms,
      projects: [project],
      channels: [channel],
    }

    expect(config.platforms).toBeDefined()
    expect(config.projects).toHaveLength(1)
    expect(config.channels).toHaveLength(1)
    expect(config.projects![0].platform).toBe('github')
    expect(config.channels![0].platform).toBe('github')
  })

  it('SlackPlatformConfig has bot_token and signing_secret', () => {
    const slackPlatform: SlackPlatformConfig = {
      bot_token: null,
      signing_secret: null,
    }
    expect(slackPlatform).toBeDefined()
  })

  it('AsanaPlatformConfig has api_key and bot_username', () => {
    const asanaPlatform: AsanaPlatformConfig = {
      api_key: null,
      bot_username: null,
    }
    expect(asanaPlatform).toBeDefined()
  })

  it('ChannelConfig allows no allowed_associations', () => {
    const channel: ChannelConfig = {
      platform: 'slack',
    }
    expect(channel.platform).toBe('slack')
    expect(channel.allowed_associations).toBeUndefined()
  })
})
