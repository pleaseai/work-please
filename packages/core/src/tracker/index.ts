import type { AsanaPlatformConfig, GitHubPlatformConfig, PlatformConfig, ProjectConfig } from '../types'
import type { TrackerAdapter, TrackerError } from './types'
import { createAsanaAdapter } from './asana'
import { createGitHubAdapter } from './github'

export { formatTrackerError, isTrackerError } from './types'
export type { TrackerAdapter, TrackerError }

export function createTrackerAdapter(project: ProjectConfig, platform: PlatformConfig): TrackerAdapter | TrackerError {
  const kind = project.platform

  if (kind === 'github')
    return createGitHubAdapter(project, platform as GitHubPlatformConfig)
  if (kind === 'asana')
    return createAsanaAdapter(project, platform as AsanaPlatformConfig)

  return { code: 'unsupported_tracker_kind', kind }
}
