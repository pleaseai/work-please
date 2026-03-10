import type { Issue } from '../types'

export interface TrackerAdapter {
  fetchCandidateIssues: () => Promise<Issue[] | TrackerError>
  fetchIssuesByStates: (states: string[]) => Promise<Issue[] | TrackerError>
  fetchIssueStatesByIds: (ids: string[]) => Promise<Issue[] | TrackerError>
}

export type TrackerError
  = | { code: 'unsupported_tracker_kind', kind: string }
    | { code: 'missing_tracker_api_key' }
    | { code: 'missing_tracker_project_config', field: string }
  // asana
    | { code: 'asana_api_request', cause: unknown }
    | { code: 'asana_api_status', status: number, body: unknown }
    | { code: 'asana_unknown_payload', payload: unknown }
    | { code: 'asana_missing_next_page' }
  // github
    | { code: 'github_projects_api_request', cause: unknown }
    | { code: 'github_projects_api_status', status: number, body: unknown }
    | { code: 'github_projects_graphql_errors', errors: unknown }
    | { code: 'github_projects_unknown_payload', payload: unknown }
    | { code: 'github_projects_missing_end_cursor' }

export function isTrackerError(val: unknown): val is TrackerError {
  return typeof val === 'object' && val !== null && 'code' in val
}
