/* eslint-disable no-template-curly-in-string */
import type { ServiceConfig } from './types'
import process from 'node:process'
import { describe, expect, it } from 'bun:test'
import { resolveAgentEnv } from './agent-env'
import { buildConfig } from './config'

function makeConfig(overrides: Record<string, unknown> = {}): ServiceConfig {
  return buildConfig({ config: overrides, prompt_template: '' })
}

describe('resolveAgentEnv', () => {
  it('returns process.env merged with literal env vars', async () => {
    const config = makeConfig({ env: { CUSTOM: 'value' } })
    const result = await resolveAgentEnv(config)
    expect(result.CUSTOM).toBe('value')
    // process.env keys should also be present
    expect(result.PATH).toBe(process.env.PATH!)
  })

  it('custom env vars override process.env', async () => {
    const config = makeConfig({ env: { PATH: '/custom/path' } })
    const result = await resolveAgentEnv(config)
    expect(result.PATH).toBe('/custom/path')
  })

  it('returns only process.env when no env configured', async () => {
    const config = makeConfig({})
    const result = await resolveAgentEnv(config)
    expect(result.PATH).toBe(process.env.PATH!)
  })

  it('resolves ${INSTALLATION_ACCESS_TOKEN} using tokenProvider', async () => {
    const config = makeConfig({
      env: {
        GH_TOKEN: '${INSTALLATION_ACCESS_TOKEN}',
        GITHUB_PERSONAL_ACCESS_TOKEN: '${INSTALLATION_ACCESS_TOKEN}',
        LITERAL: 'keep-me',
      },
    })
    const result = await resolveAgentEnv(config, {
      installationAccessToken: async () => 'ghs_test_token_123',
    })
    expect(result.GH_TOKEN).toBe('ghs_test_token_123')
    expect(result.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghs_test_token_123')
    expect(result.LITERAL).toBe('keep-me')
  })

  it('drops ${INSTALLATION_ACCESS_TOKEN} entries when no tokenProvider given', async () => {
    const config = makeConfig({
      env: {
        GH_TOKEN: '${INSTALLATION_ACCESS_TOKEN}',
        LITERAL: 'keep-me',
      },
    })
    const result = await resolveAgentEnv(config)
    expect(result.GH_TOKEN).toBeUndefined()
    expect(result.LITERAL).toBe('keep-me')
  })

  it('drops ${INSTALLATION_ACCESS_TOKEN} entries when tokenProvider returns null', async () => {
    const config = makeConfig({
      env: { GH_TOKEN: '${INSTALLATION_ACCESS_TOKEN}' },
    })
    const result = await resolveAgentEnv(config, {
      installationAccessToken: async () => null,
    })
    expect(result.GH_TOKEN).toBeUndefined()
  })

  it('drops unknown ${RUNTIME_VAR} references', async () => {
    const config = makeConfig({
      env: { FOO: '${UNKNOWN_RUNTIME_VAR}' },
    })
    const result = await resolveAgentEnv(config)
    expect(result.FOO).toBeUndefined()
  })

  it('calls tokenProvider only once for multiple ${INSTALLATION_ACCESS_TOKEN} refs', async () => {
    let callCount = 0
    const config = makeConfig({
      env: {
        A: '${INSTALLATION_ACCESS_TOKEN}',
        B: '${INSTALLATION_ACCESS_TOKEN}',
      },
    })
    const result = await resolveAgentEnv(config, {
      installationAccessToken: async () => {
        callCount++
        return 'token'
      },
    })
    expect(result.A).toBe('token')
    expect(result.B).toBe('token')
    expect(callCount).toBe(1)
  })

  it('propagates tokenProvider errors to caller', async () => {
    const config = makeConfig({
      env: { GH_TOKEN: '${INSTALLATION_ACCESS_TOKEN}' },
    })
    await expect(resolveAgentEnv(config, {
      installationAccessToken: async () => { throw new Error('auth_failed') },
    })).rejects.toThrow('auth_failed')
  })

  describe('default agent env overrides', () => {
    it('injects GH_TOKEN and GITHUB_TOKEN defaults when tokenProvider is available and env not set', async () => {
      const config = makeConfig({})
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'ghs_default_token',
      })
      expect(result.GH_TOKEN).toBe('ghs_default_token')
      expect(result.GITHUB_TOKEN).toBe('ghs_default_token')
    })

    it('injects GIT_AUTHOR/COMMITTER identity from botIdentity when available', async () => {
      const config = makeConfig({})
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'ghs_token',
        botIdentity: async () => ({ name: 'my-app[bot]', email: '12345+my-app[bot]@users.noreply.github.com' }),
      })
      expect(result.GIT_AUTHOR_NAME).toBe('my-app[bot]')
      expect(result.GIT_AUTHOR_EMAIL).toBe('12345+my-app[bot]@users.noreply.github.com')
      expect(result.GIT_COMMITTER_NAME).toBe('my-app[bot]')
      expect(result.GIT_COMMITTER_EMAIL).toBe('12345+my-app[bot]@users.noreply.github.com')
    })

    it('does not inject git identity when botIdentity is not provided', async () => {
      const config = makeConfig({})
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'ghs_token',
      })
      expect(result.GIT_AUTHOR_NAME).toBeUndefined()
      expect(result.GIT_AUTHOR_EMAIL).toBeUndefined()
    })

    it('does not inject git identity when botIdentity returns null', async () => {
      const config = makeConfig({})
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'ghs_token',
        botIdentity: async () => null,
      })
      expect(result.GIT_AUTHOR_NAME).toBeUndefined()
      expect(result.GIT_AUTHOR_EMAIL).toBeUndefined()
    })

    it('user-defined env overrides defaults', async () => {
      const config = makeConfig({
        env: {
          GH_TOKEN: 'my-explicit-token',
          GIT_AUTHOR_NAME: 'Custom Author',
        },
      })
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'ghs_token',
        botIdentity: async () => ({ name: 'bot[bot]', email: 'bot@noreply.github.com' }),
      })
      expect(result.GH_TOKEN).toBe('my-explicit-token')
      expect(result.GIT_AUTHOR_NAME).toBe('Custom Author')
      // GITHUB_TOKEN not explicitly set, so default applies
      expect(result.GITHUB_TOKEN).toBe('ghs_token')
    })

    it('does not inject defaults when no tokenProvider', async () => {
      const config = makeConfig({})
      const result = await resolveAgentEnv(config)
      expect(result.GH_TOKEN).toBeUndefined()
      expect(result.GITHUB_TOKEN).toBeUndefined()
      expect(result.GIT_AUTHOR_NAME).toBeUndefined()
    })

    it('does not call botIdentity when git identity keys are all user-defined', async () => {
      let called = false
      const config = makeConfig({
        env: {
          GIT_AUTHOR_NAME: 'A',
          GIT_AUTHOR_EMAIL: 'a@b.com',
          GIT_COMMITTER_NAME: 'A',
          GIT_COMMITTER_EMAIL: 'a@b.com',
        },
      })
      const result = await resolveAgentEnv(config, {
        installationAccessToken: async () => 'token',
        botIdentity: async () => {
          called = true
          return { name: 'bot', email: 'bot@x.com' }
        },
      })
      expect(called).toBe(false)
      expect(result.GIT_AUTHOR_NAME).toBe('A')
    })
  })

  describe('commit signing env injection', () => {
    it('injects GIT_CONFIG_* env vars when mode is ssh and sshSigningKeyPath is provided', async () => {
      const config = makeConfig({
        commit_signing: { mode: 'ssh', ssh_signing_key: 'key-content' },
      })
      const result = await resolveAgentEnv(config, { sshSigningKeyPath: '/written/path/to/key' })
      expect(result.GIT_CONFIG_COUNT).toBe('3')
      expect(result.GIT_CONFIG_KEY_0).toBe('gpg.format')
      expect(result.GIT_CONFIG_VALUE_0).toBe('ssh')
      expect(result.GIT_CONFIG_KEY_1).toBe('user.signingkey')
      expect(result.GIT_CONFIG_VALUE_1).toBe('/written/path/to/key')
      expect(result.GIT_CONFIG_KEY_2).toBe('commit.gpgsign')
      expect(result.GIT_CONFIG_VALUE_2).toBe('true')
    })

    it('does not inject GIT_CONFIG_* env vars when mode is none', async () => {
      const config = makeConfig({ commit_signing: { mode: 'none' } })
      const result = await resolveAgentEnv(config, { sshSigningKeyPath: '/path/to/key' })
      expect(result.GIT_CONFIG_COUNT).toBeUndefined()
      expect(result.GIT_CONFIG_KEY_0).toBeUndefined()
    })

    it('does not inject GIT_CONFIG_* env vars when mode is api', async () => {
      const config = makeConfig({ commit_signing: { mode: 'api' } })
      const result = await resolveAgentEnv(config)
      expect(result.GIT_CONFIG_COUNT).toBeUndefined()
      expect(result.GIT_CONFIG_KEY_0).toBeUndefined()
    })

    it('does not inject GIT_CONFIG_* env vars when sshSigningKeyPath is not provided', async () => {
      const config = makeConfig({ commit_signing: { mode: 'ssh', ssh_signing_key: 'key-content' } })
      const result = await resolveAgentEnv(config)
      expect(result.GIT_CONFIG_COUNT).toBeUndefined()
      expect(result.GIT_CONFIG_KEY_0).toBeUndefined()
    })

    it('does not inject GIT_CONFIG_* env vars when user defines GIT_CONFIG_* in env', async () => {
      const config = makeConfig({
        commit_signing: { mode: 'ssh', ssh_signing_key: 'key-content' },
        env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'custom' },
      })
      const result = await resolveAgentEnv(config, { sshSigningKeyPath: '/path/to/key' })
      expect(result.GIT_CONFIG_COUNT).toBe('1')
      expect(result.GIT_CONFIG_KEY_0).toBe('user.name')
      expect(result.GIT_CONFIG_VALUE_0).toBe('custom')
    })
  })
})
