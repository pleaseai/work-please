import type { StateConfig } from './types'
import { describe, expect, it, mock } from 'bun:test'

// Mock adapter packages to simulate MODULE_NOT_FOUND errors.
// These packages may be installed as optional peer deps, so we override
// them to throw the expected error for testing the descriptive error path.

function notFoundError(pkg: string) {
  const err = new Error(`Cannot find package '${pkg}'`)
  ;(err as any).code = 'MODULE_NOT_FOUND'
  return err
}

mock.module('@chat-adapter/state-memory', () => ({
  createMemoryState: () => ({ _mock: 'memory' }),
}))

mock.module('@chat-adapter/state-redis', () => {
  throw notFoundError('@chat-adapter/state-redis')
})

mock.module('@chat-adapter/state-ioredis', () => {
  throw notFoundError('@chat-adapter/state-ioredis')
})

mock.module('@chat-adapter/state-pg', () => {
  throw notFoundError('@chat-adapter/state-pg')
})

const { createStateFromConfig } = await import('./state')

function makeStateConfig(overrides: Partial<StateConfig> = {}): StateConfig {
  return {
    adapter: 'memory',
    url: null,
    key_prefix: 'chat-sdk',
    on_lock_conflict: 'drop',
    ...overrides,
  }
}

describe('createStateFromConfig — missing package error path', () => {
  it('throws descriptive error when redis package is not installed', async () => {
    await expect(
      createStateFromConfig(makeStateConfig({ adapter: 'redis', url: 'redis://localhost:6379' })),
    ).rejects.toThrow('State adapter \'redis\' requires package \'@chat-adapter/state-redis\'')
  })

  it('throws descriptive error when ioredis package is not installed', async () => {
    await expect(
      createStateFromConfig(makeStateConfig({ adapter: 'ioredis', url: 'redis://localhost:6379' })),
    ).rejects.toThrow('State adapter \'ioredis\' requires package \'@chat-adapter/state-ioredis\'')
  })

  it('throws descriptive error when postgres package is not installed', async () => {
    await expect(
      createStateFromConfig(makeStateConfig({ adapter: 'postgres', url: 'postgres://localhost:5432/db' })),
    ).rejects.toThrow('State adapter \'postgres\' requires package \'@chat-adapter/state-pg\'')
  })
})
