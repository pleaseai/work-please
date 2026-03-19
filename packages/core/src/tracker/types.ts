import type { Issue } from '../types'

export interface StatusFieldInfo {
  project_id: string
  field_id: string
  options: Array<{ name: string, id: string }>
}

export interface CandidateAndWatchedResult {
  candidates: Issue[]
  watched: Issue[]
}

export interface TrackerAdapter {
  fetchCandidateIssues: () => Promise<Issue[] | TrackerError>
  fetchCandidateAndWatchedIssues: (watchedStates: string[]) => Promise<CandidateAndWatchedResult | TrackerError>
  fetchIssuesByStates: (states: string[]) => Promise<Issue[] | TrackerError>
  fetchIssueStatesByIds: (ids: string[]) => Promise<Issue[] | TrackerError>
  updateItemStatus?: (itemId: string, targetState: string) => Promise<true | TrackerError>
  resolveStatusField?: () => Promise<StatusFieldInfo | null>
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
    | { code: 'github_projects_status_update_failed', cause: unknown }
    | { code: 'tracker_write_not_supported' }

export function isTrackerError(val: unknown): val is TrackerError {
  return typeof val === 'object' && val !== null && 'code' in val
}

function serializeCause(cause: unknown): string {
  if (cause instanceof Error)
    return cause.message
  if (typeof cause === 'string')
    return cause
  try {
    return JSON.stringify(cause) ?? String(cause)
  }
  catch {
    return String(cause)
  }
}

export function formatTrackerError(err: TrackerError): string {
  switch (err.code) {
    case 'github_projects_api_status':
    case 'asana_api_status':
      return `${err.code} (HTTP ${err.status})`
    case 'github_projects_graphql_errors':
      return `${err.code}: ${JSON.stringify(err.errors)}`
    case 'github_projects_api_request':
    case 'asana_api_request':
    case 'github_projects_status_update_failed':
      return `${err.code}: ${serializeCause(err.cause)}`
    default:
      return err.code
  }
}
