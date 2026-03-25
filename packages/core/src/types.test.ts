import type {
  AsanaPlatformConfig,
  ChannelConfig,
  GitHubPlatformConfig,
  PlatformConfig,
  PollingMode,
  ProjectConfig,
  RelayConfig,
  ServiceConfig,
  SlackPlatformConfig,
} from './types'
import { describe, expect, it } from 'bun:test'

describe('platform-centric config types', () => {
  it('ServiceConfig accepts platforms, projects, channels shape', () => {
    const github: GitHubPlatformConfig = {
      kind: 'github',
      api_key: 'token',
      owner: 'my-org',
      bot_username: 'please-bot',
      app_id: null,
      private_key: null,
      installation_id: null,
    }

    const slack: SlackPlatformConfig = {
      kind: 'slack',
      bot_token: 'xoxb-token',
      signing_secret: 'secret',
    }

    const asana: AsanaPlatformConfig = {
      kind: 'asana',
      api_key: 'asana-key',
      bot_username: null,
      webhook_secret: null,
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
      kind: 'slack',
      bot_token: null,
      signing_secret: null,
    }
    expect(slackPlatform).toBeDefined()
  })

  it('AsanaPlatformConfig has api_key and bot_username', () => {
    const asanaPlatform: AsanaPlatformConfig = {
      kind: 'asana',
      api_key: null,
      bot_username: null,
      webhook_secret: null,
    }
    expect(asanaPlatform).toBeDefined()
  })

  it('PollingMode includes relay', () => {
    const modes: PollingMode[] = ['poll', 'webhook', 'relay']
    expect(modes).toContain('relay')
  })

  it('RelayConfig has url, token, room, and secret fields', () => {
    const relay: RelayConfig = {
      url: 'https://my-relay.workers.dev',
      token: 'bearer-token',
      room: 'my-project',
      secret: 'webhook-secret',
    }
    expect(relay.url).toBe('https://my-relay.workers.dev')
    expect(relay.token).toBe('bearer-token')
    expect(relay.room).toBe('my-project')
    expect(relay.secret).toBe('webhook-secret')
  })

  it('RelayConfig allows null values', () => {
    const relay: RelayConfig = {
      url: null,
      token: null,
      room: null,
      secret: null,
    }
    expect(relay.url).toBeNull()
  })

  it('ServiceConfig includes relay field', () => {
    const config: Partial<ServiceConfig> = {
      relay: {
        url: 'https://relay.example.com',
        token: null,
        room: null,
        secret: null,
      },
    }
    expect(config.relay).toBeDefined()
    expect(config.relay!.url).toBe('https://relay.example.com')
  })

  it('ChannelConfig allows no allowed_associations', () => {
    const channel: ChannelConfig = {
      platform: 'slack',
    }
    expect(channel.platform).toBe('slack')
    expect(channel.allowed_associations).toBeUndefined()
  })
})
