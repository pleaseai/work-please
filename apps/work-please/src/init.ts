import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { graphql as createGraphql, GraphqlResponseError } from '@octokit/graphql'

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
}

export type InitError
  = | { code: 'init_missing_owner' }
    | { code: 'init_missing_token' }
    | { code: 'init_workflow_exists', path: string }
    | { code: 'init_owner_not_found', owner: string }
    | { code: 'init_create_failed', cause: unknown }
    | { code: 'init_graphql_errors', errors: unknown }
    | { code: 'init_network_error', cause: unknown }

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
    organization(login: $login) { id }
    user(login: $login) { id }
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

  const data = result.data as { organization?: { id?: string }, user?: { id?: string } }
  const id = data.organization?.id ?? data.user?.id
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

export function generateWorkflow(owner: string, projectNumber: number): string {
  return `---
tracker:
  kind: github_projects
  owner: "${owner}"
  project_number: ${projectNumber}
  api_key: $GITHUB_TOKEN
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: ~/workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/${owner}/<repo> .
    # bun install  # uncomment if needed
agent:
  max_concurrent_agents: 5
  max_turns: 20
claude:
  permission_mode: bypassPermissions
# server:
#   port: 3000
---

You are an autonomous task worker for issue \`{{ issue.identifier }}\`.

{% if attempt %}
## Continuation context

This is retry attempt #{{ attempt }}. The issue is still in an active state.

- Resume from the current workspace state; do not restart from scratch.
- Do not repeat already-completed work unless new changes require it.
- If you were blocked previously, re-evaluate whether the blocker has been resolved before stopping again.
{% endif %}

## Issue context

- **Identifier:** {{ issue.identifier }}
- **Title:** {{ issue.title }}
- **State:** {{ issue.state }}
- **URL:** {{ issue.url }}

**Description:**
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

{% if issue.blocked_by.size > 0 %}
## Blocked by

The following issues must be resolved before this one can proceed:

{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }}: {{ blocker.title }} ({{ blocker.state }})
{% endfor %}

If any blocker is still open, document it and stop.
{% endif %}

## Instructions

You are operating in an unattended session. Follow these rules:

1. **Read the issue** — understand the full description, acceptance criteria, and any linked resources before writing code.
2. **Create a feature branch** — branch from \`main\` (e.g. \`git checkout -b {{ issue.identifier | downcase }}-<short-slug>\`).
3. **Implement the changes** — follow the repository conventions in \`CLAUDE.md\` if present.
4. **Run tests and lint** — ensure all checks pass before committing.
5. **Commit using conventional format** — e.g. \`feat(scope): add new capability\`.
6. **Push and open a PR** — create or update a pull request linked to the issue URL.
7. **Operate autonomously** — never ask a human for follow-up actions. Complete the task end-to-end.
8. **Blocked?** — if blocked by missing auth, permissions, or secrets that cannot be resolved in-session, document the blocker clearly and stop. Do not loop indefinitely.
`
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

  const workflowContent = generateWorkflow(options.owner, projectResult.projectNumber)
  writeFileSync(workflowPath, workflowContent, 'utf-8')

  return {
    projectId: projectResult.projectId,
    projectNumber: projectResult.projectNumber,
    owner: options.owner,
    workflowPath,
  }
}

export async function runInit(options: {
  owner: string | null
  title: string | null
  token: string | null
}): Promise<void> {
  const token = options.token ?? process.env.GITHUB_TOKEN ?? null
  if (!token) {
    console.error('Error: --token is required or set GITHUB_TOKEN environment variable')
    process.exit(1)
  }

  if (!options.owner) {
    console.error('Error: --owner is required')
    process.exit(1)
  }

  const title = options.title ?? DEFAULT_TITLE

  const result = await initProject({ owner: options.owner, title, token })
  if ('code' in result) {
    if (result.code === 'init_workflow_exists') {
      console.error(`Error: ${WORKFLOW_FILE_NAME} already exists at ${result.path}`)
    }
    else {
      console.error(`Error: init failed: ${result.code}`)
    }
    process.exit(1)
  }

  console.warn(`[work-please] created GitHub Projects v2 board: #${result.projectNumber}`)
  console.warn(`[work-please] generated ${result.workflowPath}`)
  console.warn('[work-please] Note: add a "Cancelled" status to your project manually via GitHub UI if needed')
}
