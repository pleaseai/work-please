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
})
