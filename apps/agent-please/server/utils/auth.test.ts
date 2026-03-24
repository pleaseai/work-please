import type { Kysely } from 'kysely'
import { LibsqlDialect } from '@libsql/kysely-libsql'
import { Kysely as KyselyClass } from 'kysely'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Polyfill: createError is a Nitro auto-import, not available in test context
// ---------------------------------------------------------------------------
beforeAll(() => {
  globalThis.createError = ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) => {
    const err = new Error(statusMessage) as Error & { statusCode: number, statusMessage: string }
    err.statusCode = statusCode
    err.statusMessage = statusMessage
    return err
  }
})

// Import after polyfill is registered
const { initAuth, isAuthEnabled, resetAuth, useAuth } = await import('./auth')

// ---------------------------------------------------------------------------
// Helper: create an in-memory Kysely instance for tests
// ---------------------------------------------------------------------------
function makeInMemoryDb(): Kysely<any> {
  return new KyselyClass({ dialect: new LibsqlDialect({ url: ':memory:' }) })
}

// ---------------------------------------------------------------------------
// Shared test config
// ---------------------------------------------------------------------------

function makeAuthConfig(overrides?: {
  githubClientId?: string | null
  githubClientSecret?: string | null
  secret?: string | null
  trustedOrigins?: string[]
}) {
  return {
    secret: overrides !== undefined && 'secret' in overrides ? overrides.secret : 'test-secret',
    github: {
      client_id: overrides?.githubClientId ?? null,
      client_secret: overrides?.githubClientSecret ?? null,
    },
    admin: {
      email: null,
      password: null,
    },
    base_url: null,
    trusted_origins: overrides?.trustedOrigins ?? [],
  }
}

// ---------------------------------------------------------------------------
// Cleanup between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  resetAuth()
})

// ---------------------------------------------------------------------------
// isAuthEnabled
// ---------------------------------------------------------------------------

describe('isAuthEnabled', () => {
  it('returns false before initAuth is called', () => {
    expect(isAuthEnabled()).toBe(false)
  })

  it('returns true after initAuth is called', () => {
    initAuth(makeAuthConfig(), makeInMemoryDb())
    expect(isAuthEnabled()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// initAuth
// ---------------------------------------------------------------------------

describe('initAuth', () => {
  it('returns an auth instance', () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    expect(auth).toBeDefined()
    expect(typeof auth).toBe('object')
  })

  it('sets isAuthEnabled to true', () => {
    expect(isAuthEnabled()).toBe(false)
    initAuth(makeAuthConfig(), makeInMemoryDb())
    expect(isAuthEnabled()).toBe(true)
  })

  it('falls back to http://localhost:3000 when no baseURL is given', () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    // The baseURL should be reflected in the auth options
    expect((auth as any).options?.baseURL).toBe('http://localhost:3000')
  })

  it('uses provided baseURL when given', () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb(), 'http://example.com:4000')
    expect((auth as any).options?.baseURL).toBe('http://example.com:4000')
  })

  it('includes github social provider when both credentials are provided', () => {
    const auth = initAuth(
      makeAuthConfig({ githubClientId: 'gh-id', githubClientSecret: 'gh-secret' }),
      makeInMemoryDb(),
    )
    const providers = (auth as any).options?.socialProviders
    expect(providers).toBeDefined()
    expect(providers.github).toBeDefined()
    expect(providers.github.clientId).toBe('gh-id')
    expect(providers.github.clientSecret).toBe('gh-secret')
  })

  it('excludes github social provider when client_id is missing', () => {
    const auth = initAuth(
      makeAuthConfig({ githubClientId: null, githubClientSecret: 'gh-secret' }),
      makeInMemoryDb(),
    )
    const providers = (auth as any).options?.socialProviders
    expect(providers?.github).toBeUndefined()
  })

  it('excludes github social provider when client_secret is missing', () => {
    const auth = initAuth(
      makeAuthConfig({ githubClientId: 'gh-id', githubClientSecret: null }),
      makeInMemoryDb(),
    )
    const providers = (auth as any).options?.socialProviders
    expect(providers?.github).toBeUndefined()
  })

  it('excludes github social provider when both credentials are missing', () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    const providers = (auth as any).options?.socialProviders
    expect(providers?.github).toBeUndefined()
  })

  it('passes secret from config', () => {
    const auth = initAuth(makeAuthConfig({ secret: 'my-secret' }), makeInMemoryDb())
    expect((auth as any).options?.secret).toBe('my-secret')
  })

  it('passes undefined secret when config secret is null', () => {
    const auth = initAuth(makeAuthConfig({ secret: null }), makeInMemoryDb())
    expect((auth as any).options?.secret).toBeUndefined()
  })

  it('passes trustedOrigins when trusted_origins is non-empty', () => {
    const origins = ['https://dora.passionfactory.ai', 'http://localhost:3000']
    const auth = initAuth(makeAuthConfig({ trustedOrigins: origins }), makeInMemoryDb())
    expect((auth as any).options?.trustedOrigins).toEqual(origins)
  })

  it('does not pass trustedOrigins when trusted_origins is empty', () => {
    const auth = initAuth(makeAuthConfig({ trustedOrigins: [] }), makeInMemoryDb())
    expect((auth as any).options?.trustedOrigins).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// useAuth
// ---------------------------------------------------------------------------

describe('useAuth', () => {
  it('throws with status 503 when auth is not initialized', () => {
    expect(() => useAuth()).toThrow()
    try {
      useAuth()
    }
    catch (err: any) {
      expect(err.statusCode).toBe(503)
      expect(err.statusMessage).toBe('Auth not initialized')
    }
  })

  it('returns the auth instance after initAuth is called', () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    const result = useAuth()
    expect(result).toBe(auth)
  })
})

// ---------------------------------------------------------------------------
// resetAuth
// ---------------------------------------------------------------------------

describe('resetAuth', () => {
  it('clears the auth instance so useAuth throws afterward', () => {
    initAuth(makeAuthConfig(), makeInMemoryDb())
    expect(() => useAuth()).not.toThrow()
    resetAuth()
    expect(() => useAuth()).toThrow()
  })

  it('sets isAuthEnabled to false after reset', () => {
    initAuth(makeAuthConfig(), makeInMemoryDb())
    expect(isAuthEnabled()).toBe(true)
    resetAuth()
    expect(isAuthEnabled()).toBe(false)
  })

  it('is idempotent — calling twice does not throw', () => {
    resetAuth()
    expect(() => resetAuth()).not.toThrow()
    expect(isAuthEnabled()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Admin seeding via auth.api.createUser (integration)
// ---------------------------------------------------------------------------

describe('auth.api.createUser', () => {
  it('can create a user and returns user data', async () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    await (await (auth as any).$context).runMigrations()

    const response = await auth.api.createUser({
      body: {
        email: 'admin@example.com',
        password: 'password123',
        name: 'Admin User',
        role: 'admin',
      },
    })
    expect(response).toBeDefined()
    const body = response as any
    expect(body.user?.email).toBe('admin@example.com')
  })

  it('throws when creating a duplicate user', async () => {
    const auth = initAuth(makeAuthConfig(), makeInMemoryDb())
    await (await (auth as any).$context).runMigrations()

    await auth.api.createUser({
      body: {
        email: 'duplicate@example.com',
        password: 'password123',
        name: 'First User',
        role: 'user',
      },
    })

    let caught: any = null
    try {
      await auth.api.createUser({
        body: {
          email: 'duplicate@example.com',
          password: 'password456',
          name: 'Second User',
          role: 'user',
        },
      })
    }
    catch (err) {
      caught = err
    }

    expect(caught).not.toBeNull()
    const body = caught?.body ?? caught?.message ?? JSON.stringify(caught)
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
    expect(bodyStr).toContain('USER_ALREADY_EXISTS')
  })
})
