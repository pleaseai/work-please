import type { ServiceConfig } from '../types'
import type { TrackerAdapter, TrackerError } from './types'
import { createAsanaAdapter } from './asana'
import { createGitHubAdapter } from './github'

export { isTrackerError } from './types'
export type { TrackerAdapter, TrackerError }

export function createTrackerAdapter(config: ServiceConfig): TrackerAdapter | TrackerError {
  const { kind } = config.tracker

  if (!kind)
    return { code: 'unsupported_tracker_kind', kind: '' }
  if (kind === 'asana')
    return createAsanaAdapter(config)
  if (kind === 'github_projects')
    return createGitHubAdapter(config)

  return { code: 'unsupported_tracker_kind', kind }
}
