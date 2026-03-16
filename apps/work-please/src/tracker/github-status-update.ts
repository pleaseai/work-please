import type { StatusFieldInfo, TrackerError } from './types'
import { createLogger } from '../logger'

const log = createLogger('github-status')

const RESOLVE_PROJECT_ID_QUERY = `
  query($owner: String!, $number: Int!) {
    repositoryOwner(login: $owner) {
      ... on Organization { projectV2(number: $number) { id } }
      ... on User { projectV2(number: $number) { id } }
    }
  }
`

const STATUS_FIELD_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            options { id name }
          }
        }
      }
    }
  }
`

const UPDATE_ITEM_STATUS_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`

type RunGraphql = (query: string, variables?: Record<string, unknown>) => Promise<{ data: unknown } | TrackerError>

export interface StatusUpdateContext {
  updateItemStatus: (itemId: string, targetState: string) => Promise<true | TrackerError>
  resolveStatusField: () => Promise<StatusFieldInfo | null>
}

export function createStatusUpdateContext(
  runGraphql: RunGraphql,
  owner: string,
  projectNumber: number,
  projectId: string | null,
): StatusUpdateContext {
  let resolvedProjectId: string | null = projectId
  let cachedFieldId: string | null = null
  let cachedOptions: Map<string, string> | null = null
  let cachedOptionsArray: Array<{ name: string, id: string }> | null = null

  async function ensureProjectId(): Promise<string | TrackerError> {
    if (resolvedProjectId)
      return resolvedProjectId

    const result = await runGraphql(RESOLVE_PROJECT_ID_QUERY, { owner, number: projectNumber })
    if ('code' in result)
      return result

    const payload = result.data as Record<string, unknown>
    const repoOwner = payload.repositoryOwner as Record<string, unknown> | null
    const project = repoOwner?.projectV2 as { id?: string } | null
    if (!project?.id) {
      return { code: 'github_projects_unknown_payload', payload }
    }

    resolvedProjectId = project.id
    return resolvedProjectId
  }

  async function ensureStatusField(pid: string): Promise<{ fieldId: string, options: Map<string, string> } | TrackerError> {
    if (cachedFieldId && cachedOptions) {
      return { fieldId: cachedFieldId, options: cachedOptions }
    }

    const result = await runGraphql(STATUS_FIELD_QUERY, { projectId: pid })
    if ('code' in result)
      return result

    const payload = result.data as Record<string, unknown>
    const node = payload.node as Record<string, unknown> | null
    const field = node?.field as { id?: string, options?: Array<{ id: string, name: string }> } | null
    if (!field?.id || !Array.isArray(field.options)) {
      return { code: 'github_projects_unknown_payload', payload }
    }

    cachedFieldId = field.id
    cachedOptionsArray = field.options.map(o => ({ name: o.name, id: o.id }))
    cachedOptions = new Map(field.options.map(o => [o.name, o.id]))
    return { fieldId: cachedFieldId, options: cachedOptions }
  }

  return {
    async updateItemStatus(itemId: string, targetState: string): Promise<true | TrackerError> {
      const pidOrError = await ensureProjectId()
      if (typeof pidOrError !== 'string')
        return pidOrError

      const fieldOrError = await ensureStatusField(pidOrError)
      if ('code' in fieldOrError)
        return fieldOrError

      const { fieldId, options } = fieldOrError
      const optionId = options.get(targetState)
      if (!optionId) {
        return {
          code: 'github_projects_status_update_failed' as const,
          cause: new Error(`No option found for status: ${targetState}`),
        }
      }

      const result = await runGraphql(UPDATE_ITEM_STATUS_MUTATION, {
        projectId: pidOrError,
        itemId,
        fieldId,
        optionId,
      })
      if ('code' in result)
        return result

      return true as const
    },

    async resolveStatusField(): Promise<StatusFieldInfo | null> {
      const pidOrError = await ensureProjectId()
      if (typeof pidOrError !== 'string') {
        log.warn(`failed to resolve project ID: ${pidOrError.code}`)
        return null
      }

      const fieldOrError = await ensureStatusField(pidOrError)
      if ('code' in fieldOrError) {
        log.warn(`failed to resolve status field: ${fieldOrError.code}`)
        return null
      }

      return {
        project_id: pidOrError,
        field_id: fieldOrError.fieldId,
        options: cachedOptionsArray ?? [],
      }
    },
  }
}

/** @deprecated Use createStatusUpdateContext instead */
export function createUpdateItemStatus(
  runGraphql: RunGraphql,
  owner: string,
  projectNumber: number,
  projectId: string | null,
): (itemId: string, targetState: string) => Promise<true | TrackerError> {
  const ctx = createStatusUpdateContext(runGraphql, owner, projectNumber, projectId)
  return ctx.updateItemStatus
}
