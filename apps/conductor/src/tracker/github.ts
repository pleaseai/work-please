import type { Issue, ServiceConfig } from '../types'
import type { TrackerAdapter, TrackerError } from './types'
import { normalizeState } from '../config'

const PAGE_SIZE = 50
const NETWORK_TIMEOUT_MS = 30_000
const TRAILING_SLASH_RE = /\/$/

export function createGitHubAdapter(config: ServiceConfig): TrackerAdapter {
  const endpoint = (config.tracker.endpoint ?? 'https://api.github.com').replace(TRAILING_SLASH_RE, '')
  const graphqlEndpoint = `${endpoint}/graphql`
  const apiKey = config.tracker.api_key ?? ''
  const owner = config.tracker.owner ?? ''
  const projectNumber = config.tracker.project_number ?? 0
  const activeStatuses = config.tracker.active_statuses ?? ['Todo', 'In Progress']

  function headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  async function graphql(query: string, variables: Record<string, unknown> = {}): Promise<{ data: unknown } | TrackerError> {
    let response: Response
    try {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS)
      response = await fetch(graphqlEndpoint, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      })
      clearTimeout(timeout)
    }
    catch (cause) {
      return { code: 'github_projects_api_request', cause }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      return { code: 'github_projects_api_status', status: response.status, body }
    }

    const body = await response.json().catch(() => null) as { errors?: unknown, data?: unknown }
    if (body?.errors) {
      return { code: 'github_projects_graphql_errors', errors: body.errors }
    }

    return { data: body?.data }
  }

  const PROJECT_ITEMS_QUERY = `
    query($owner: String!, $number: Int!, $cursor: String) {
      user(login: $owner) {
        projectV2(number: $number) {
          items(first: ${PAGE_SIZE}, after: $cursor) {
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
                  labels(first: 20) { nodes { name } }
                  createdAt updatedAt
                }
                ... on PullRequest {
                  number title body url
                  labels(first: 20) { nodes { name } }
                  createdAt updatedAt
                }
              }
            }
          }
        }
      }
      organization(login: $owner) {
        projectV2(number: $number) {
          items(first: ${PAGE_SIZE}, after: $cursor) {
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
                  labels(first: 20) { nodes { name } }
                  createdAt updatedAt
                }
                ... on PullRequest {
                  number title body url
                  labels(first: 20) { nodes { name } }
                  createdAt updatedAt
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
            ... on Issue { number title }
            ... on PullRequest { number title }
          }
        }
      }
    }
  `

  async function fetchAllItems(statusFilter: string[]): Promise<Issue[] | TrackerError> {
    const issues: Issue[] = []
    let cursor: string | null = null

    do {
      const result = await graphql(PROJECT_ITEMS_QUERY, {
        owner,
        number: projectNumber,
        cursor,
      })
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

        const matchesFilter = statusFilter.length === 0
          || statusFilter.some(s => normalizeState(s) === normalizeState(status))

        if (matchesFilter) {
          issues.push(normalizeProjectItem(node, status))
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

  return {
    async fetchCandidateIssues() {
      return fetchAllItems(activeStatuses)
    },

    async fetchIssuesByStates(states: string[]) {
      if (states.length === 0)
        return []
      return fetchAllItems(states)
    },

    async fetchIssueStatesByIds(ids: string[]) {
      if (ids.length === 0)
        return []

      const result = await graphql(ITEMS_BY_IDS_QUERY, { ids })
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
          return normalizeProjectItem(n, status)
        })
    },
  }
}

interface ProjectItems {
  nodes?: Array<Record<string, unknown>>
  pageInfo?: { hasNextPage?: boolean, endCursor?: string }
}

function extractProjectData(payload: Record<string, unknown>): { items: ProjectItems } | null {
  const org = (payload.organization as Record<string, unknown> | null)?.projectV2 as Record<string, unknown> | null
  const user = (payload.user as Record<string, unknown> | null)?.projectV2 as Record<string, unknown> | null

  if (org?.items)
    return { items: org.items as ProjectItems }
  if (user?.items)
    return { items: user.items as ProjectItems }
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

function normalizeProjectItem(node: Record<string, unknown>, status: string): Issue {
  const content = node.content as Record<string, unknown>
  const number = content?.number
  const identifier = number ? `#${number}` : String(node.id ?? '')
  const labels = Array.isArray((content?.labels as { nodes?: Array<{ name?: string }> })?.nodes)
    ? ((content.labels as { nodes: Array<{ name?: string }> }).nodes).map(l => (l.name ?? '').toLowerCase()).filter(Boolean)
    : []

  return {
    id: String(node.id ?? ''),
    identifier,
    title: String(content?.title ?? ''),
    description: content?.body ? String(content.body) : null,
    priority: null,
    state: status,
    branch_name: null,
    url: content?.url ? String(content.url) : null,
    labels,
    blocked_by: [],
    created_at: content?.createdAt ? new Date(String(content.createdAt)) : null,
    updated_at: content?.updatedAt ? new Date(String(content.updatedAt)) : null,
  }
}
