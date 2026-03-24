import type { StateAdapter } from 'chat'
import type { StateConfig } from './types'
import { createLogger } from './logger'

const log = createLogger('state')

const ADAPTER_PACKAGES: Record<string, string> = {
  memory: '@chat-adapter/state-memory',
  redis: '@chat-adapter/state-redis',
  ioredis: '@chat-adapter/state-ioredis',
  postgres: '@chat-adapter/state-pg',
}

/**
 * Create a Chat SDK StateAdapter from the parsed StateConfig.
 * Uses dynamic imports so packages/core has no hard dependency on any adapter package.
 */
export async function createStateFromConfig(config: StateConfig): Promise<StateAdapter> {
  const { adapter, url, key_prefix: keyPrefix } = config
  const pkg = ADAPTER_PACKAGES[adapter]

  if (!pkg) {
    log.warn(`unknown state adapter "${adapter}", falling back to memory`)
    return importAndCreate('memory', null, keyPrefix)
  }

  return importAndCreate(adapter, url, keyPrefix)
}

async function importAndCreate(adapter: string, url: string | null, keyPrefix: string): Promise<StateAdapter> {
  const pkg = ADAPTER_PACKAGES[adapter]!

  try {
    const mod = await import(pkg)

    switch (adapter) {
      case 'memory':
        return mod.createMemoryState()

      case 'redis':
        return mod.createRedisState({
          ...(url ? { url } : {}),
          keyPrefix,
        })

      case 'ioredis':
        return mod.createIoRedisState({
          ...(url ? { url } : {}),
          keyPrefix,
        })

      case 'postgres':
        return mod.createPostgresState({
          ...(url ? { url } : {}),
          keyPrefix,
        })

      default:
        throw new Error(`unsupported state adapter: ${adapter}`)
    }
  }
  catch (err: unknown) {
    if (isModuleNotFound(err)) {
      throw new Error(
        `State adapter '${adapter}' requires package '${pkg}'. Install it with: bun add ${pkg}`,
      )
    }
    throw err
  }
}

function isModuleNotFound(err: unknown): boolean {
  const msg = err instanceof Error
    ? err.message
    : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : ''
  if (!msg)
    return false
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code: unknown }).code
    : undefined
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND')
    return true
  // Bun uses ResolveMessage (not instanceof Error) with "Cannot find module" text
  return msg.startsWith('Cannot find module') || msg.startsWith('Cannot find package')
}
