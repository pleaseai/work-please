import type { GitHubPlatformConfig, Issue, IssueFilter, LinkedPR, ProjectConfig } from '../types'
import type { CandidateAndWatchedResult, TrackerAdapter, TrackerError } from './types'
import { GraphqlResponseError } from '@octokit/graphql'
import { normalizeState } from '../config'
import { deduplicateByNormalized, hasFilter, splitCandidatesAndWatched } from '../filter'
import { createLogger } from '../logger'
import { createAuthenticatedGraphql } from './github-auth'
import { createStatusUpdateContext } from './github-status-update'

const log = createLogger('github')

const PAGE_SIZE = 50

export function createGitHubAdapter(project: ProjectConfig, platform: GitHubPlatformConfig): TrackerAdapter {
  const owner = platform.owner ?? ''
  const projectNumber = project.project_number ?? 0
  const projectId = project.project_id ?? null
  const activeStatuses = project.active_statuses ?? ['Todo', 'In Progress']
  const filter = project.filter

  const octokit = createAuthenticatedGraphql(project, platform)

  async function runGraphql(query: string, variables: Record<string, unknown> = {}): Promise<{ data: unknown } | TrackerError> {
    try {
      const data = await octokit(query, variables)
      return { data }
    }
    catch (err) {
      if (err instanceof GraphqlResponseError) {
        return { code: 'github_projects_graphql_errors', errors: err.errors }
      }
      const e = err as { status?: number, response?: unknown }
      if (typeof e.status === 'number' && e.response !== undefined) {
        return { code: 'github_projects_api_status', status: e.status, body: null }
      }
      return { code: 'github_projects_api_request', cause: err }
    }
  }

  const PROJECT_ITEMS_QUERY = `
    query($owner: String!, $number: Int!, $cursor: String, $search: String) {
      repositoryOwner(login: $owner) {
        ... on Organization {
          projectV2(number: $number) {
            items(first: ${PAGE_SIZE}, after: $cursor, query: $search) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
                content {
                  ... on Issue {
                    number title body url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                    createdAt updatedAt
                    closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
                      nodes { number title url state headRefName reviewDecision updatedAt }
                    }
                  }
                  ... on PullRequest {
                    number title body url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                    createdAt updatedAt
                    headRefName
                    reviewDecision
                  }
                }
              }
            }
          }
        }
        ... on User {
          projectV2(number: $number) {
            items(first: ${PAGE_SIZE}, after: $cursor, query: $search) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
                content {
                  ... on Issue {
                    number title body url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                    createdAt updatedAt
                    closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
                      nodes { number title url state headRefName reviewDecision updatedAt }
                    }
                  }
                  ... on PullRequest {
                    number title body url
                    repository { nameWithOwner }
                    labels(first: 20) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                    createdAt updatedAt
                    headRefName
                    reviewDecision
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  const PROJECT_BY_ID_QUERY = `
    query($projectId: ID!, $cursor: String, $search: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: ${PAGE_SIZE}, after: $cursor, query: $search) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
              content {
                ... on Issue {
                  number title body url
                  repository { nameWithOwner }
                  labels(first: 20) { nodes { name } }
                  assignees(first: 10) { nodes { login } }
                  createdAt updatedAt
                  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
                    nodes { number title url state headRefName reviewDecision updatedAt }
                  }
                }
                ... on PullRequest {
                  number title body url
                  repository { nameWithOwner }
                  labels(first: 20) { nodes { name } }
                  assignees(first: 10) { nodes { login } }
                  createdAt updatedAt
                  headRefName
                  reviewDecision
                }
              }
            }
          }
        }
      }
    }
  `

  const ITEMS_BY_IDS_QUERY = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProjectV2Item {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
          content {
            ... on Issue { number title repository { nameWithOwner } }
            ... on PullRequest {
              number title headRefName reviewDecision
              repository { nameWithOwner }
            }
          }
        }
      }
    }
  `

  async function fetchAllItems(statusFilter: string[], search = ''): Promise<Issue[] | TrackerError> {
    const issues: Issue[] = []
    let cursor: string | null = null

    do {
      const result = projectId
        ? await runGraphql(PROJECT_BY_ID_QUERY, { projectId, cursor, search })
        : await runGraphql(PROJECT_ITEMS_QUERY, { owner, number: projectNumber, cursor, search })
      if ('code' in result)
        return result

      const payload = result.data as Record<string, unknown>
      const projectData = extractProjectData(payload)
      if (!projectData) {
        return { code: 'github_projects_unknown_payload', payload }
      }

      const { items } = projectData
      if (!items)
        return { code: 'github_projects_unknown_payload', payload }

      const nodes = items.nodes
      if (!Array.isArray(nodes))
        return { code: 'github_projects_unknown_payload', payload }

      for (const node of nodes) {
        if (!node.content)
          continue
        const status = extractStatus(node)
        if (!status)
          continue

        const statusMatches = statusFilter.length === 0
          || statusFilter.some(s => normalizeState(s) === normalizeState(status))

        if (statusMatches) {
          issues.push(normalizeProjectItem(node, status, owner, projectNumber))
        }
      }

      const pageInfo = items.pageInfo
      if (pageInfo?.hasNextPage) {
        if (!pageInfo.endCursor) {
          return { code: 'github_projects_missing_end_cursor' }
        }
        cursor = pageInfo.endCursor
      }
      else {
        cursor = null
      }
    } while (cursor !== null)

    return issues
  }

  const statusCtx = createStatusUpdateContext(runGraphql, owner, projectNumber, projectId)

  return {
    async fetchCandidateIssues() {
      return fetchAllItems(activeStatuses, buildQueryString(filter))
    },

    async fetchCandidateAndWatchedIssues(watchedStates: string[]): Promise<CandidateAndWatchedResult | TrackerError> {
      if (watchedStates.length === 0) {
        // No watched states — just fetch candidates with server-side filter
        const candidates = await fetchAllItems(activeStatuses, buildQueryString(filter))
        if ('code' in candidates)
          return candidates
        return { candidates, watched: [] }
      }

      if (hasFilter(filter)) {
        // When filter is active, use server-side search for candidates to avoid
        // missing issues whose labels/assignees exceed the GraphQL pagination limits
        // (20 labels, 10 assignees per item).
        // Handle each result independently so one failure does not block the other.
        const [candidatesResult, watchedResult] = await Promise.all([
          fetchAllItems(activeStatuses, buildQueryString(filter)),
          fetchAllItems(watchedStates),
        ])
        const candidates = 'code' in candidatesResult ? [] : candidatesResult
        const watched = 'code' in watchedResult ? [] : watchedResult
        if ('code' in candidatesResult)
          log.warn(`candidate fetch failed: ${candidatesResult.code}`)
        if ('code' in watchedResult)
          log.warn(`watched fetch failed: ${watchedResult.code}`)
        // Only return error if both failed
        if ('code' in candidatesResult && 'code' in watchedResult)
          return candidatesResult
        return { candidates, watched }
      }

      // No filter — fetch all items once with combined statuses, split client-side
      const combinedStatuses = deduplicateByNormalized([...activeStatuses, ...watchedStates])
      const allIssues = await fetchAllItems(combinedStatuses)
      if ('code' in allIssues)
        return allIssues

      return splitCandidatesAndWatched(allIssues, activeStatuses, watchedStates, filter)
    },

    async fetchIssuesByStates(states: string[]) {
      if (states.length === 0)
        return []
      // Filter is intentionally not applied here: this method is used for blocker
      // revalidation and reconciliation, which must see all issues regardless of filter.
      return fetchAllItems(states)
    },

    async fetchIssueStatesByIds(ids: string[]) {
      if (ids.length === 0)
        return []

      const result = await runGraphql(ITEMS_BY_IDS_QUERY, { ids })
      if ('code' in result)
        return result

      const payload = result.data as { nodes?: Array<Record<string, unknown> | null> }
      if (!Array.isArray(payload?.nodes)) {
        return { code: 'github_projects_unknown_payload', payload }
      }

      return payload.nodes
        .filter(Boolean)
        .map((node) => {
          const n = node as Record<string, unknown>
          const status = extractStatus(n) ?? ''
          return normalizeProjectItem(n, status, owner, projectNumber)
        })
    },

    updateItemStatus: statusCtx.updateItemStatus,
    resolveStatusField: statusCtx.resolveStatusField,
  }
}

interface ProjectItems {
  nodes?: Array<Record<string, unknown>>
  pageInfo?: { hasNextPage?: boolean, endCursor?: string }
}

function extractProjectData(payload: Record<string, unknown>): { items: ProjectItems } | null {
  // project_id path: node(id: $projectId) { ... on ProjectV2 { items } }
  const node = payload.node as Record<string, unknown> | null
  if (node?.items)
    return { items: node.items as ProjectItems }

  // owner/number path: repositoryOwner { ... { projectV2 { items } } }
  const owner = payload.repositoryOwner as Record<string, unknown> | null
  const project = owner?.projectV2 as Record<string, unknown> | null
  if (project?.items)
    return { items: project.items as ProjectItems }

  return null
}

function extractStatus(node: Record<string, unknown>): string | null {
  const fieldValues = (node.fieldValues as { nodes?: Array<Record<string, unknown>> })?.nodes
  if (!Array.isArray(fieldValues))
    return null

  for (const fv of fieldValues) {
    const fieldName = (fv.field as { name?: string })?.name
    if (fieldName && normalizeState(fieldName) === 'status' && typeof fv.name === 'string') {
      return fv.name
    }
  }
  return null
}

function buildQueryString(filter: IssueFilter): string {
  const parts: string[] = []
  if (filter.assignee.length > 0)
    parts.push(`assignee:${filter.assignee.join(',')}`)
  if (filter.label.length > 0)
    parts.push(`label:${filter.label.join(',')}`)
  return parts.join(' ')
}

function normalizePrState(raw: unknown): LinkedPR['state'] {
  const s = String(raw ?? '').toLowerCase()
  return s === 'closed' || s === 'merged' ? s : 'open'
}

function normalizeReviewDecision(raw: unknown): Issue['review_decision'] {
  if (raw == null)
    return null
  const s = String(raw).toUpperCase()
  switch (s) {
    case 'APPROVED': return 'approved'
    case 'CHANGES_REQUESTED': return 'changes_requested'
    case 'COMMENTED': return 'commented'
    case 'REVIEW_REQUIRED': return 'review_required'
    default:
      log.warn(`unknown reviewDecision value: ${s}`)
      return null
  }
}

function normalizeProjectItem(node: Record<string, unknown>, status: string, projectOwner?: string, projectNum?: number): Issue {
  const content = node.content as Record<string, unknown>
  const number = content?.number
  const repo = (content?.repository as { nameWithOwner?: string })?.nameWithOwner
  let identifier: string
  if (number && repo) {
    identifier = `${repo}#${number}`
  }
  else if (number) {
    identifier = `#${number}`
  }
  else {
    identifier = String(node.id ?? '')
  }
  const labels = Array.isArray((content?.labels as { nodes?: Array<{ name?: string }> })?.nodes)
    ? ((content.labels as { nodes: Array<{ name?: string }> }).nodes).map(l => (l.name ?? '').toLowerCase()).filter(Boolean)
    : []
  const assigneeNodes = (content?.assignees as { nodes?: Array<{ login?: string }> })?.nodes
  const assignees = Array.isArray(assigneeNodes)
    ? assigneeNodes.map(n => n.login ?? '').filter(Boolean)
    : []

  const prRefNodes = (content?.closedByPullRequestsReferences as { nodes?: Array<Record<string, unknown> | null> })?.nodes
  const pullRequests: LinkedPR[] = Array.isArray(prRefNodes)
    ? prRefNodes
        .filter((pr): pr is Record<string, unknown> & { number: number } =>
          pr !== null && typeof pr === 'object' && typeof pr.number === 'number' && pr.number > 0)
        .map(pr => ({
          number: pr.number,
          title: String(pr.title ?? ''),
          url: pr.url ? String(pr.url) : null,
          state: normalizePrState(pr.state),
          branch_name: pr.headRefName ? String(pr.headRefName) : null,
          review_decision: normalizeReviewDecision(pr.reviewDecision),
          updated_at: pr.updatedAt ? new Date(String(pr.updatedAt)) : null,
        }))
    : []

  const headRefName = content?.headRefName ? String(content.headRefName) : null
  const reviewDecision = normalizeReviewDecision(content?.reviewDecision)
    ?? pullRequests.find(pr => pr.state === 'open' && pr.review_decision)?.review_decision
    ?? null

  return {
    id: String(node.id ?? ''),
    identifier,
    title: String(content?.title ?? ''),
    description: content?.body ? String(content.body) : null,
    priority: null,
    state: status,
    branch_name: headRefName,
    url: content?.url ? String(content.url) : null,
    assignees,
    labels,
    blocked_by: [],
    pull_requests: pullRequests,
    review_decision: reviewDecision,
    created_at: content?.createdAt ? new Date(String(content.createdAt)) : null,
    updated_at: content?.updatedAt ? new Date(String(content.updatedAt)) : null,
    project: (projectOwner || projectNum)
      ? { owner: projectOwner ?? '', number: projectNum ?? 0, project_id: null, item_id: String(node.id ?? ''), field_id: null, status_options: [] }
      : null,
  }
}
