import type { Issue, ServiceConfig } from '../types'
import type { TrackerAdapter, TrackerError } from './types'
import { normalizeState } from '../config'
import { matchesFilter } from '../filter'
import { isTrackerError } from './types'

const PAGE_SIZE = 50
const NETWORK_TIMEOUT_MS = 30_000

export function createAsanaAdapter(config: ServiceConfig): TrackerAdapter {
  const endpoint = config.tracker.endpoint ?? 'https://app.asana.com/api/1.0'
  const apiKey = config.tracker.api_key
  const projectGid = config.tracker.project_gid ?? ''
  const activeSections = config.tracker.active_sections ?? ['To Do', 'In Progress']
  const filter = config.tracker.filter

  function headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
  }

  async function fetchJson(url: string): Promise<{ data: unknown } | TrackerError> {
    let response: Response
    try {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS)
      response = await fetch(url, { headers: headers(), signal: ctrl.signal })
      clearTimeout(timeout)
    }
    catch (cause) {
      return { code: 'asana_api_request', cause }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      return { code: 'asana_api_status', status: response.status, body }
    }

    const body = await response.json().catch(() => null)
    return { data: body }
  }

  async function fetchTasks(sectionNames: string[]): Promise<Issue[] | TrackerError> {
    // First, get sections for the project to map section names to GIDs
    const sectionsResult = await fetchJson(
      `${endpoint}/projects/${projectGid}/sections?opt_fields=name,gid`,
    )
    if ('code' in sectionsResult)
      return sectionsResult

    const sectionsPayload = sectionsResult.data as { data?: Array<{ gid: string, name: string }> }
    if (!Array.isArray(sectionsPayload?.data)) {
      return { code: 'asana_unknown_payload', payload: sectionsPayload }
    }

    const targetSections = sectionsPayload.data.filter(s =>
      sectionNames.some(name => normalizeState(name) === normalizeState(s.name)),
    )

    const allIssues: Issue[] = []

    for (const section of targetSections) {
      const tasksResult = await fetchTasksInSection(section.gid, section.name)
      if ('code' in tasksResult)
        return tasksResult
      allIssues.push(...tasksResult)
    }

    return allIssues
  }

  async function fetchTasksInSection(sectionGid: string, sectionName: string): Promise<Issue[] | TrackerError> {
    const issues: Issue[] = []
    let offset: string | null = null

    const fields = 'gid,name,notes,dependencies,tags,created_at,modified_at,custom_fields,memberships.section.name,assignee,assignee.email'

    do {
      const url = offset
        ? `${endpoint}/sections/${sectionGid}/tasks?opt_fields=${fields}&limit=${PAGE_SIZE}&offset=${encodeURIComponent(offset)}`
        : `${endpoint}/sections/${sectionGid}/tasks?opt_fields=${fields}&limit=${PAGE_SIZE}`

      const result = await fetchJson(url)
      if ('code' in result)
        return result

      const payload = result.data as { data?: unknown[], next_page?: { offset?: string } }
      if (!Array.isArray(payload?.data)) {
        return { code: 'asana_unknown_payload', payload }
      }

      for (const task of payload.data) {
        issues.push(normalizeAsanaTask(task as Record<string, unknown>, sectionName))
      }

      offset = payload.next_page?.offset ?? null
    } while (offset !== null)

    return issues
  }

  return {
    async fetchCandidateIssues() {
      const issues = await fetchTasks(activeSections)
      if (isTrackerError(issues))
        return issues
      return issues.filter(issue => matchesFilter(issue, filter))
    },

    async updateItemStatus(_itemId: string, _targetState: string): Promise<true | TrackerError> {
      return { code: 'tracker_write_not_supported' }
    },

    async fetchIssuesByStates(states: string[]) {
      if (states.length === 0)
        return []
      // Filter is intentionally not applied here: this method is used for blocker
      // revalidation and reconciliation, which must see all issues regardless of filter.
      return fetchTasks(states)
    },

    async fetchIssueStatesByIds(ids: string[]) {
      if (ids.length === 0)
        return []

      const results: Issue[] = []
      for (const id of ids) {
        const url = `${endpoint}/tasks/${id}?opt_fields=gid,name,memberships.section.name`
        const result = await fetchJson(url)
        if ('code' in result)
          return result

        const payload = result.data as { data?: Record<string, unknown> }
        if (!payload?.data || typeof payload.data !== 'object') {
          return { code: 'asana_unknown_payload', payload }
        }

        const task = payload.data
        const state = extractTaskState(task)
        results.push({
          id: String(task.gid ?? id),
          identifier: String(task.gid ?? id),
          title: String(task.name ?? ''),
          description: null,
          priority: null,
          state: state ?? '',
          branch_name: null,
          url: null,
          assignees: [],
          labels: [],
          blocked_by: [],
          pull_requests: [],
          review_decision: null,
          has_unresolved_threads: false,
          has_unresolved_human_threads: false,
          created_at: null,
          updated_at: null,
        })
      }
      return results
    },
  }
}

function normalizeAsanaTask(task: Record<string, unknown>, sectionName: string): Issue {
  const gid = String(task.gid ?? '')
  const labels = Array.isArray(task.tags)
    ? (task.tags as Array<{ name?: string }>).map(t => (t.name ?? '').toLowerCase()).filter(Boolean)
    : []

  const blockedBy = Array.isArray(task.dependencies)
    ? (task.dependencies as Array<Record<string, unknown>>).map(dep => ({
        id: String(dep.gid ?? ''),
        identifier: String(dep.gid ?? ''),
        state: null,
      }))
    : []

  const assigneeObj = task.assignee as { email?: string } | null | undefined
  const assignees = assigneeObj?.email ? [assigneeObj.email] : []

  return {
    id: gid,
    identifier: gid,
    title: String(task.name ?? ''),
    description: task.notes ? String(task.notes) : null,
    priority: null,
    state: sectionName,
    branch_name: null,
    url: null,
    assignees,
    labels,
    blocked_by: blockedBy,
    pull_requests: [],
    review_decision: null,
    has_unresolved_threads: false,
    has_unresolved_human_threads: false,
    created_at: task.created_at ? new Date(String(task.created_at)) : null,
    updated_at: task.modified_at ? new Date(String(task.modified_at)) : null,
  }
}

function extractTaskState(task: Record<string, unknown>): string | null {
  const memberships = task.memberships
  if (!Array.isArray(memberships))
    return null

  for (const m of memberships as Array<Record<string, unknown>>) {
    const section = m.section as Record<string, unknown> | undefined
    if (section?.name)
      return String(section.name)
  }
  return null
}
