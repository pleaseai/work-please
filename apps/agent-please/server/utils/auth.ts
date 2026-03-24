import type { AuthConfig } from '@pleaseai/agent-core'
import type { Kysely } from 'kysely'
import { betterAuth } from 'better-auth'
import { admin, username } from 'better-auth/plugins'

type Auth = ReturnType<typeof betterAuth>

let _auth: Auth | null = null
let _authEnabled = false

export function isAuthEnabled(): boolean {
  return _authEnabled
}

export function useAuth(): Auth {
  if (!_auth) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Auth not initialized',
    })
  }
  return _auth
}

export function resetAuth(): void {
  _auth = null
  _authEnabled = false
}

export function initAuth(authConfig: AuthConfig, db: Kysely<any>, baseURL?: string): Auth {
  const socialProviders: Record<string, { clientId: string, clientSecret: string }> = {}
  if (authConfig.github.client_id && authConfig.github.client_secret) {
    socialProviders.github = {
      clientId: authConfig.github.client_id,
      clientSecret: authConfig.github.client_secret,
    }
  }

  const trustedOrigins = authConfig.trusted_origins.length > 0
    ? authConfig.trusted_origins
    : undefined

  _auth = betterAuth({
    baseURL: baseURL || 'http://localhost:3000',
    database: { db, type: 'sqlite' as const },
    secret: authConfig.secret ?? undefined,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    socialProviders,
    plugins: [admin(), username()],
  })

  _authEnabled = true
  return _auth
}
