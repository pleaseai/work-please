import type { graphql as GraphqlInstance } from '@octokit/graphql'
import type { ServiceConfig } from '../types'
import { createAppAuth } from '@octokit/auth-app'
import { graphql as createGraphql } from '@octokit/graphql'

const NETWORK_TIMEOUT_MS = 30_000
const TRAILING_SLASH_RE = /\/$/

/**
 * Creates an authenticated @octokit/graphql instance from config.
 * Supports both PAT (api_key) and GitHub App (app_id + private_key + installation_id).
 * PAT takes precedence when both are provided.
 */
export function createAuthenticatedGraphql(config: ServiceConfig): typeof GraphqlInstance {
  const endpoint = (config.tracker.endpoint ?? 'https://api.github.com').replace(TRAILING_SLASH_RE, '')
  const { api_key, app_id, private_key, installation_id } = config.tracker

  if (api_key) {
    return createGraphql.defaults({
      baseUrl: endpoint,
      headers: { authorization: `bearer ${api_key}` },
      request: { timeout: NETWORK_TIMEOUT_MS },
    })
  }

  const auth = createAppAuth({
    appId: app_id!,
    privateKey: private_key!,
    installationId: installation_id!,
  })

  return createGraphql.defaults({
    baseUrl: endpoint,
    request: {
      hook: auth.hook,
      timeout: NETWORK_TIMEOUT_MS,
    },
  })
}
