import type { AsanaPlatformConfig, Issue, ProjectConfig } from '../types'
import type { CandidateAndWatchedResult, StatusFieldInfo, TrackerAdapter, TrackerError } from './types'
import { normalizeState } from '../config'
import { deduplicateByNormalized, matchesFilter, splitCandidatesAndWatched } from '../filter'
import { createLogger } from '../logger'
import { isTrackerError } from './types'

const log = createLogger('asana')

const PAGE_SIZE = 50
const NETWORK_TIMEOUT_MS = 30_000

export interface AsanaAdapterOptions {
  /** Optional cached fetch for ETag/Last-Modified conditional requests on GET calls */
  cachedFetch?: typeof fetch
}

export function createAsanaAdapter(project: ProjectConfig, platform: AsanaPlatformConfig, options?: AsanaAdapterOptions): TrackerAdapter {
  const endpoint = project.endpoint ?? 'https://app.asana.com/api/1.0'
  const apiKey = platform.api_key
  const projectGid = project.project_gid ?? ''
  const activeSections = project.active_statuses ?? ['To Do', 'In Progress']
  const filter = project.filter

  function headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    }
  }

  function getFetch(): typeof fetch {
    return options?.cachedFetch ?? globalThis.fetch
  }

  async function request(url: string, init?: RequestInit): Promise<{ data: unknown } | TrackerError> {
    let response: Response
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS)
    try {
      response = await getFetch()(url, { headers: headers(), signal: ctrl.signal, ...init })
    }
    catch (cause) {
      clearTimeout(timeout)
      return { code: 'asana_api_request', cause }
    }
    clearTimeout(timeout)

    // Log cache status when using cached fetch (make-fetch-happen adds x-local-cache headers)
    const cacheStatus = response.headers?.get?.('x-local-cache-status')
    if (cacheStatus) {
      const cacheHit = cacheStatus === 'hit' || cacheStatus === 'revalidated'
      log.info(`fetch url=${url} cache=${cacheHit ? 'hit' : 'miss'} x-local-cache-status=${cacheStatus}`)
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      return { code: 'asana_api_status', status: response.status, body }
    }

    const body = await response.json().catch(() => null)
    return { data: body }
  }

  function fetchJson(url: string): Promise<{ data: unknown } | TrackerError> {
    return request(url)
  }

  function postJson(url: string, payload: unknown): Promise<{ data: unknown } | TrackerError> {
    return request(url, { method: 'POST', body: JSON.stringify(payload) })
  }

  async function fetchSections(): Promise<Array<{ gid: string, name: string }> | TrackerError> {
    const result = await fetchJson(
      `${endpoint}/projects/${projectGid}/sections?opt_fields=name,gid`,
    )
    if ('code' in result)
      return result

    const payload = result.data as { data?: Array<{ gid: string, name: string }> }
    if (!Array.isArray(payload?.data)) {
      return { code: 'asana_unknown_payload', payload }
    }

    return payload.data
  }

  async function fetchTasks(sectionNames: string[]): Promise<Issue[] | TrackerError> {
    const sections = await fetchSections()
    if ('code' in sections)
      return sections

    const targetSections = sections.filter(s =>
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

    async fetchCandidateAndWatchedIssues(watchedStates: string[]): Promise<CandidateAndWatchedResult | TrackerError> {
      // Always safe to combine for Asana: tasks are fetched per-section (no server-side
      // search query), so client-side filtering via matchesFilter is equivalent.
      const combinedSections = deduplicateByNormalized([...activeSections, ...watchedStates])
      const allIssues = await fetchTasks(combinedSections)
      if (isTrackerError(allIssues))
        return allIssues

      return splitCandidatesAndWatched(allIssues, activeSections, watchedStates, filter)
    },

    async updateItemStatus(itemId: string, targetState: string): Promise<true | TrackerError> {
      const sections = await fetchSections()
      if ('code' in sections)
        return sections

      const targetSection = sections.find(s =>
        normalizeState(s.name) === normalizeState(targetState),
      )
      if (!targetSection) {
        return { code: 'asana_api_status', status: 404, body: { message: `Section "${targetState}" not found in project` } }
      }

      const result = await postJson(
        `${endpoint}/sections/${targetSection.gid}/addTask`,
        { data: { task: itemId } },
      )
      if ('code' in result)
        return result

      return true
    },

    async resolveStatusField(): Promise<StatusFieldInfo | null> {
      const sections = await fetchSections()
      if ('code' in sections)
        return null

      return {
        project_id: projectGid,
        field_id: 'section',
        options: sections.map(s => ({ name: s.name, id: s.gid })),
      }
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
          created_at: null,
          updated_at: null,
          project: null,
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
    created_at: task.created_at ? new Date(String(task.created_at)) : null,
    updated_at: task.modified_at ? new Date(String(task.modified_at)) : null,
    project: null,
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
