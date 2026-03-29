import type { CacheConfig, PlatformConfig, ProjectConfig } from '../types'
import type { TrackerAdapter, TrackerError } from './types'
import { createCachedFetch } from '../cached-fetch'
import { createAsanaAdapter } from './asana'
import { createGitHubAdapter } from './github'

export { formatTrackerError, isTrackerError } from './types'
export type { TrackerAdapter, TrackerError }

export interface TrackerAdapterOptions {
  cache?: CacheConfig
}

export function createTrackerAdapter(project: ProjectConfig, platform: PlatformConfig, options?: TrackerAdapterOptions): TrackerAdapter | TrackerError {
  const cachedFetch = options?.cache
    ? createCachedFetch(options.cache.path) as unknown as typeof fetch
    : undefined

  if (platform.kind === 'github')
    return createGitHubAdapter(project, platform, { cachedFetch })
  if (platform.kind === 'asana')
    return createAsanaAdapter(project, platform, { cachedFetch })

  return { code: 'unsupported_tracker_kind', kind: platform.kind }
}
