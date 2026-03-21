import type { StateConfig } from './types'
import { describe, expect, it, mock } from 'bun:test'

// NOTE: This file intentionally does NOT mock @chat-adapter/state-redis,
// @chat-adapter/state-ioredis, or @chat-adapter/state-pg so that dynamic
// imports of those packages fail with MODULE_NOT_FOUND, allowing us to
// verify the descriptive error message thrown by createStateFromConfig.

// Only memory adapter is installed; others are optional peer deps.
mock.module('@chat-adapter/state-memory', () => ({
  createMemoryState: () => ({ _mock: 'memory' }),
}))

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
