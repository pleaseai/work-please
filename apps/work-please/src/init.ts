import type { WizardContext } from './init-wizard'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { graphql as createGraphql, GraphqlResponseError } from '@octokit/graphql'
import { generateWorkflowFromContext, runWizard } from './init-wizard'

const GITHUB_API_ENDPOINT = 'https://api.github.com'
const DEFAULT_TITLE = 'Work Please'
const WORKFLOW_FILE_NAME = 'WORKFLOW.md'

export interface InitOptions {
  owner: string
  title: string
  token: string
}

export interface InitResult {
  projectId: string
  projectNumber: number
  owner: string
  workflowPath: string
  statusConfigured: boolean
}

export type InitError
  = | { code: 'init_missing_owner' }
    | { code: 'init_missing_token' }
    | { code: 'init_workflow_exists', path: string }
    | { code: 'init_owner_not_found', owner: string }
    | { code: 'init_create_failed', cause: unknown }
    | { code: 'init_graphql_errors', errors: unknown }
    | { code: 'init_network_error', cause: unknown }
    | { code: 'init_write_failed', path: string, cause: string, projectNumber?: number }

export function isInitError(val: unknown): val is InitError {
  return typeof val === 'object' && val !== null && 'code' in val
}

async function runGraphql(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ data: unknown } | InitError> {
  try {
    const octokit = createGraphql.defaults({
      baseUrl: endpoint,
      headers: { authorization: `bearer ${token}` },
    })
    const data = await octokit(query, variables)
    return { data }
  }
  catch (err) {
    if (err instanceof GraphqlResponseError) {
      return { code: 'init_graphql_errors', errors: err.errors }
    }
    const e = err as { status?: number, response?: unknown }
    if (typeof e.status === 'number' && e.response !== undefined) {
      return { code: 'init_create_failed', cause: { status: e.status } }
    }
    return { code: 'init_network_error', cause: err }
  }
}

const RESOLVE_OWNER_QUERY = `
  query($login: String!) {
    repositoryOwner(login: $login) { id }
  }
`

export async function resolveOwnerId(
  token: string,
  owner: string,
  endpoint: string = GITHUB_API_ENDPOINT,
): Promise<string | InitError> {
  const result = await runGraphql(endpoint, token, RESOLVE_OWNER_QUERY, { login: owner })
  if ('code' in result)
    return result

  const data = result.data as { repositoryOwner?: { id?: string } }
  const id = data.repositoryOwner?.id
  if (!id) {
    return { code: 'init_owner_not_found', owner }
  }
  return id
}

const CREATE_PROJECT_MUTATION = `
  mutation($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 {
        id
        number
      }
    }
  }
`

export async function createProject(
  token: string,
  ownerId: string,
  title: string,
  endpoint: string = GITHUB_API_ENDPOINT,
): Promise<{ projectId: string, projectNumber: number } | InitError> {
  const result = await runGraphql(endpoint, token, CREATE_PROJECT_MUTATION, { ownerId, title })
  if ('code' in result)
    return result

  const data = result.data as { createProjectV2?: { projectV2?: { id?: string, number?: number } } }
  const project = data.createProjectV2?.projectV2
  if (!project?.id || project.number === undefined || project.number === null) {
    return { code: 'init_create_failed', cause: 'missing project fields in response' }
  }

  return { projectId: project.id, projectNumber: project.number }
}

const GET_STATUS_FIELD_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id }
        }
      }
    }
  }
`

const UPDATE_STATUS_FIELD_MUTATION = `
  mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
    updateProjectV2Field(input: {
      fieldId: $fieldId
      singleSelectOptions: $options
    }) {
      projectV2Field { ... on ProjectV2SingleSelectField { id } }
    }
  }
`

const STATUS_OPTIONS = [
  { name: 'Todo', description: 'Not started', color: 'GRAY' },
  { name: 'In Progress', description: 'Currently being worked on', color: 'YELLOW' },
  { name: 'In Review', description: 'PR created, awaiting human review', color: 'BLUE' },
  { name: 'Done', description: 'Completed', color: 'GREEN' },
  { name: 'Cancelled', description: 'Will not be done', color: 'RED' },
]

export async function getStatusFieldId(
  token: string,
  projectId: string,
  endpoint: string = GITHUB_API_ENDPOINT,
): Promise<string | InitError> {
  const result = await runGraphql(endpoint, token, GET_STATUS_FIELD_QUERY, { projectId })
  if ('code' in result)
    return result

  const data = result.data as { node?: { field?: { id?: string } } }
  const id = data.node?.field?.id
  if (!id) {
    return { code: 'init_create_failed', cause: 'Status field not found in project' }
  }
  return id
}

export async function configureStatusField(
  token: string,
  projectId: string,
  endpoint: string = GITHUB_API_ENDPOINT,
): Promise<true | InitError> {
  const fieldIdResult = await getStatusFieldId(token, projectId, endpoint)
  if (isInitError(fieldIdResult))
    return fieldIdResult

  const result = await runGraphql(endpoint, token, UPDATE_STATUS_FIELD_MUTATION, {
    fieldId: fieldIdResult,
    options: STATUS_OPTIONS,
  })
  if ('code' in result)
    return result

  return true
}

export function generateWorkflow(owner: string, projectNumber: number): string {
  return generateWorkflowFromContext({
    token: '',
    owner,
    title: '',
    projectNumber,
    pollingIntervalMs: 30000,
    workspaceRoot: '~/workspaces',
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null },
    agent: { max_concurrent_agents: 5, max_turns: 20 },
    claude: { permission_mode: 'bypassPermissions', effort: 'high', model: null },
    serverPort: null,
  })
}

export async function initProject(
  options: InitOptions,
  endpoint: string = GITHUB_API_ENDPOINT,
  cwd: string = process.cwd(),
): Promise<InitResult | InitError> {
  const workflowPath = resolve(cwd, WORKFLOW_FILE_NAME)

  if (existsSync(workflowPath)) {
    return { code: 'init_workflow_exists', path: workflowPath }
  }

  const ownerIdResult = await resolveOwnerId(options.token, options.owner, endpoint)
  if (isInitError(ownerIdResult))
    return ownerIdResult

  const projectResult = await createProject(options.token, ownerIdResult, options.title, endpoint)
  if (isInitError(projectResult))
    return projectResult

  const statusResult = await configureStatusField(options.token, projectResult.projectId, endpoint)
  const statusConfigured = statusResult === true

  const workflowContent = generateWorkflow(options.owner, projectResult.projectNumber)
  try {
    writeFileSync(workflowPath, workflowContent, 'utf-8')
  }
  catch (err) {
    return {
      code: 'init_write_failed',
      path: workflowPath,
      cause: err instanceof Error ? err.message : String(err),
      projectNumber: projectResult.projectNumber,
    }
  }

  return {
    projectId: projectResult.projectId,
    projectNumber: projectResult.projectNumber,
    owner: options.owner,
    workflowPath,
    statusConfigured,
  }
}

export function formatInitError(error: InitError): string {
  switch (error.code) {
    case 'init_missing_owner':
      return 'Error: --owner is required (or run in a terminal for interactive mode)'
    case 'init_missing_token':
      return 'Error: --token is required or set GITHUB_TOKEN environment variable'
    case 'init_workflow_exists':
      return `Error: ${WORKFLOW_FILE_NAME} already exists at ${error.path}`
    case 'init_owner_not_found':
      return `Error: GitHub owner '${error.owner}' not found. Check the --owner value.`
    case 'init_create_failed':
      return `Error: Failed to create GitHub Projects v2 board. ${error.cause}`
    case 'init_graphql_errors':
      return `Error: GitHub API returned GraphQL errors: ${JSON.stringify(error.errors)}`
    case 'init_network_error':
      return `Error: A network error occurred: ${error.cause}`
    case 'init_write_failed': {
      const hint = error.projectNumber !== undefined
        ? ` Note: GitHub project #${error.projectNumber} was already created.`
        : ''
      return `Error: Failed to write ${error.path}: ${error.cause}.${hint}`
    }
  }
}

function isInteractiveTty(): boolean {
  return process.stdout.isTTY === true
}

function writeWorkflowFile(path: string, content: string, projectInfo?: string): void {
  try {
    writeFileSync(path, content, 'utf-8')
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: Failed to write ${path}: ${msg}`)
    if (projectInfo) {
      console.error(projectInfo)
    }
    process.exit(1)
  }
}

async function runWizardNewProject(ctx: WizardContext): Promise<void> {
  const result = await initProject(
    { owner: ctx.owner, title: ctx.title, token: ctx.token },
  )
  if (isInitError(result)) {
    console.error(formatInitError(result))
    process.exit(1)
  }

  const updatedCtx = { ...ctx, projectNumber: result.projectNumber }
  const workflowContent = generateWorkflowFromContext(updatedCtx)
  writeWorkflowFile(
    result.workflowPath,
    workflowContent,
    `Note: The GitHub project #${result.projectNumber} was already created successfully.`,
  )

  const projectUrl = `https://github.com/orgs/${ctx.owner}/projects/${result.projectNumber}`
  let linkText: string
  try {
    const terminalLink = (await import('terminal-link')).default
    linkText = terminalLink(projectUrl, projectUrl)
  }
  catch {
    linkText = projectUrl
  }
  console.warn(`[work-please] created GitHub Projects v2 board: #${result.projectNumber}`)
  console.warn(`[work-please] project URL: ${linkText}`)
  console.warn(`[work-please] generated ${result.workflowPath}`)
  if (result.statusConfigured) {
    console.warn('[work-please] configured Status field: Todo, In Progress, In Review, Done, Cancelled')
  }
  else {
    console.warn('[work-please] warning: could not configure Status field — add "In Review" and "Cancelled" statuses manually')
  }
}

function runWizardExistingProject(ctx: WizardContext, workflowPath: string): void {
  const workflowContent = generateWorkflowFromContext(ctx)
  writeWorkflowFile(workflowPath, workflowContent)
  console.warn(`[work-please] generated ${workflowPath}`)
  console.warn(`[work-please] using existing project #${ctx.projectNumber}`)
}

async function runInitWithWizard(options: {
  owner: string | null
  title: string | null
  token: string | null
}): Promise<void> {
  const ctx = await runWizard(options)
  if (!ctx) {
    process.exit(0)
  }

  const workflowPath = resolve(process.cwd(), WORKFLOW_FILE_NAME)
  if (existsSync(workflowPath)) {
    console.error(formatInitError({ code: 'init_workflow_exists', path: workflowPath }))
    process.exit(1)
  }

  if (ctx.projectNumber === null) {
    await runWizardNewProject(ctx)
  }
  else {
    runWizardExistingProject(ctx, workflowPath)
  }
}

export async function runInit(options: {
  owner: string | null
  title: string | null
  token: string | null
}): Promise<void> {
  if (!options.owner && isInteractiveTty()) {
    await runInitWithWizard(options)
    return
  }

  const token = options.token ?? process.env.GITHUB_TOKEN ?? null
  if (!token) {
    console.error('Error: --token is required or set GITHUB_TOKEN environment variable')
    process.exit(1)
  }

  if (!options.owner) {
    console.error('Error: --owner is required (or run in a terminal for interactive mode)')
    process.exit(1)
  }

  const title = options.title ?? DEFAULT_TITLE

  const result = await initProject({ owner: options.owner, title, token })
  if (isInitError(result)) {
    console.error(formatInitError(result))
    process.exit(1)
  }

  console.warn(`[work-please] created GitHub Projects v2 board: #${result.projectNumber}`)
  console.warn(`[work-please] generated ${result.workflowPath}`)
  if (result.statusConfigured) {
    console.warn('[work-please] configured Status field: Todo, In Progress, In Review, Done, Cancelled')
  }
  else {
    console.warn('[work-please] warning: could not configure Status field — add "In Review" and "Cancelled" statuses manually')
  }
}
