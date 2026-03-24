import type { ServiceConfig } from './types'
import process from 'node:process'
import { createLogger } from './logger'

const log = createLogger('agent-env')

const RUNTIME_VAR_RE = /^\$\{(\w+)\}$/

export interface BotIdentity {
  name: string
  email: string
}

export interface TokenProvider {
  installationAccessToken: () => Promise<string | null>
  botIdentity?: () => Promise<BotIdentity | null>
}

const TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'] as const
const GIT_IDENTITY_KEYS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const

export interface ResolveAgentEnvOptions {
  tokenProvider?: TokenProvider
  sshSigningKeyPath?: string | null
}

export async function resolveAgentEnv(
  config: ServiceConfig,
  tokenProviderOrOptions?: TokenProvider | ResolveAgentEnvOptions,
): Promise<Record<string, string>> {
  // Support both old signature (tokenProvider) and new options object
  const options: ResolveAgentEnvOptions = tokenProviderOrOptions && 'installationAccessToken' in tokenProviderOrOptions
    ? { tokenProvider: tokenProviderOrOptions }
    : (tokenProviderOrOptions as ResolveAgentEnvOptions | undefined) ?? {}
  const { tokenProvider, sshSigningKeyPath } = options

  const resolved: Record<string, string> = {}
  let cachedToken: string | null | undefined

  // Build defaults from tokenProvider (only when available)
  const defaults = await buildDefaults(config, tokenProvider, sshSigningKeyPath ?? null)

  // Merge defaults first, then user-defined env on top
  const merged = { ...defaults, ...config.env }

  for (const [key, val] of Object.entries(merged)) {
    const runtimeMatch = val.match(RUNTIME_VAR_RE)
    if (runtimeMatch) {
      const varName = runtimeMatch[1]
      if (varName === 'INSTALLATION_ACCESS_TOKEN') {
        if (tokenProvider) {
          if (cachedToken === undefined) {
            cachedToken = await tokenProvider.installationAccessToken()
          }
          if (cachedToken) {
            resolved[key] = cachedToken
          }
          else {
            log.warn(`dropping env.${key}: token provider returned null`)
          }
        }
        else {
          log.warn(`dropping env.${key}: no token provider available (tracker may not be github_projects)`)
        }
      }
      else {
        log.warn(`dropping env.${key}: unknown runtime variable \${${varName}}`)
      }
      continue
    }
    resolved[key] = val
  }

  // Merge: process.env as base, custom env overlay on top
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return { ...baseEnv, ...resolved }
}

async function buildDefaults(
  config: ServiceConfig,
  tokenProvider?: TokenProvider,
  sshSigningKeyPath?: string | null,
): Promise<Record<string, string>> {
  const userEnv = config.env
  const defaults: Record<string, string> = {}

  if (tokenProvider) {
    // Inject GH_TOKEN / GITHUB_TOKEN defaults
    for (const key of TOKEN_ENV_KEYS) {
      if (!(key in userEnv)) {
        // eslint-disable-next-line no-template-curly-in-string
        defaults[key] = '${INSTALLATION_ACCESS_TOKEN}'
      }
    }

    // Only inject git identity when GitHub credentials will be available
    // (either via default token injection above, or via user-defined token env)
    const hasTokenEnv = TOKEN_ENV_KEYS.some(k => k in userEnv || k in defaults)

    // Inject git identity defaults from botIdentity (skip if all keys are user-defined)
    const needsIdentity = GIT_IDENTITY_KEYS.some(k => !(k in userEnv))
    if (hasTokenEnv && needsIdentity && tokenProvider.botIdentity) {
      const identity = await tokenProvider.botIdentity()
      if (identity) {
        for (const key of GIT_IDENTITY_KEYS) {
          if (!(key in userEnv)) {
            switch (key) {
              case 'GIT_AUTHOR_NAME':
              case 'GIT_COMMITTER_NAME':
                defaults[key] = identity.name
                break
              case 'GIT_AUTHOR_EMAIL':
              case 'GIT_COMMITTER_EMAIL':
                defaults[key] = identity.email
                break
            }
          }
        }
      }
    }
  }

  // Inject git commit signing config when SSH mode is active
  // sshSigningKeyPath is the path to the key file on disk (written by orchestrator),
  // NOT the raw key content from config.commit_signing.ssh_signing_key
  const GIT_CONFIG_PREFIX = 'GIT_CONFIG_'
  const hasUserGitConfig = Object.keys(userEnv).some(k => k.startsWith(GIT_CONFIG_PREFIX))
  if (config.commit_signing.mode === 'ssh' && sshSigningKeyPath && !hasUserGitConfig) {
    defaults.GIT_CONFIG_COUNT = '3'
    defaults.GIT_CONFIG_KEY_0 = 'gpg.format'
    defaults.GIT_CONFIG_VALUE_0 = 'ssh'
    defaults.GIT_CONFIG_KEY_1 = 'user.signingkey'
    defaults.GIT_CONFIG_VALUE_1 = sshSigningKeyPath
    defaults.GIT_CONFIG_KEY_2 = 'commit.gpgsign'
    defaults.GIT_CONFIG_VALUE_2 = 'true'
  }

  return defaults
}
