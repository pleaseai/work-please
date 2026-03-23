import type { StateConfig } from './types'
import { describe, expect, it, mock } from 'bun:test'

function makeStateConfig(overrides: Partial<StateConfig> = {}): StateConfig {
  return {
    adapter: 'memory',
    url: null,
    key_prefix: 'chat-sdk',
    on_lock_conflict: 'drop',
    ...overrides,
  }
}

const mockMemoryState = { _mock: 'memory' } as any
const mockRedisState = { _mock: 'redis' } as any
const mockIORedisState = { _mock: 'ioredis' } as any
const mockPostgresState = { _mock: 'postgres' } as any

mock.module('@chat-adapter/state-memory', () => ({
  createMemoryState: () => mockMemoryState,
}))

mock.module('@chat-adapter/state-redis', () => ({
  createRedisState: (opts: unknown) => ({ ...mockRedisState, opts }),
}))

mock.module('@chat-adapter/state-ioredis', () => ({
  createIoRedisState: (opts: unknown) => ({ ...mockIORedisState, opts }),
}))

mock.module('@chat-adapter/state-pg', () => ({
  createPostgresState: (opts: unknown) => ({ ...mockPostgresState, opts }),
}))

// Import after mocks are set up
const { createStateFromConfig } = await import('./state')

describe('createStateFromConfig', () => {
  it('creates memory adapter with default config', async () => {
    const state = await createStateFromConfig(makeStateConfig())
    expect(state).toBe(mockMemoryState)
  })

  it('creates memory adapter when adapter is explicitly "memory"', async () => {
    const state = await createStateFromConfig(makeStateConfig({ adapter: 'memory' }))
    expect(state).toBe(mockMemoryState)
  })

  it('creates redis adapter with url and keyPrefix', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'redis',
      url: 'redis://localhost:6379',
      key_prefix: 'my-bot',
    })) as any
    expect(state._mock).toBe('redis')
    expect(state.opts).toEqual({ url: 'redis://localhost:6379', keyPrefix: 'my-bot' })
  })

  it('creates ioredis adapter with url and keyPrefix', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'ioredis',
      url: 'redis://localhost:6379',
      key_prefix: 'test-prefix',
    })) as any
    expect(state._mock).toBe('ioredis')
    expect(state.opts).toEqual({ url: 'redis://localhost:6379', keyPrefix: 'test-prefix' })
  })

  it('creates postgres adapter with url and keyPrefix', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'postgres',
      url: 'postgres://localhost:5432/db',
    })) as any
    expect(state._mock).toBe('postgres')
    expect(state.opts).toEqual({ url: 'postgres://localhost:5432/db', keyPrefix: 'chat-sdk' })
  })

  it('omits url from redis options when url is null', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'redis',
      url: null,
    })) as any
    expect(state.opts).toEqual({ keyPrefix: 'chat-sdk' })
  })

  it('omits url from ioredis options when url is null', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'ioredis',
      url: null,
    })) as any
    expect(state.opts).toEqual({ keyPrefix: 'chat-sdk' })
  })

  it('omits url from postgres options when url is null', async () => {
    const state = await createStateFromConfig(makeStateConfig({
      adapter: 'postgres',
      url: null,
    })) as any
    expect(state.opts).toEqual({ keyPrefix: 'chat-sdk' })
  })
})
