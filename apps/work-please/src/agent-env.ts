import type { ServiceConfig } from './types'
import process from 'node:process'

const RUNTIME_VAR_RE = /^\$\{(\w+)\}$/

export interface TokenProvider {
  installationAccessToken: () => Promise<string | null>
}

export async function resolveAgentEnv(
  config: ServiceConfig,
  tokenProvider?: TokenProvider,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  let cachedToken: string | null | undefined

  for (const [key, val] of Object.entries(config.env)) {
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
            console.warn(`[agent-env] dropping env.${key}: token provider returned null`)
          }
        }
        else {
          console.warn(`[agent-env] dropping env.${key}: no token provider available (tracker may not be github_projects)`)
        }
      }
      else {
        console.warn(`[agent-env] dropping env.${key}: unknown runtime variable \${${varName}}`)
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
