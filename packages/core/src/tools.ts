import type { AnyZodRawShape, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { ServiceConfig } from './types'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { GraphqlResponseError } from '@octokit/graphql'
import { z } from 'zod'
import { createLogger } from './logger'
import { createAuthenticatedGraphql } from './tracker/github-auth'

const log = createLogger('tools')

const NETWORK_TIMEOUT_MS = 30_000
const MULTIPLE_OPERATIONS_RE = /\b(query|mutation|subscription)\b/gi
const TRAILING_SLASH_RE = /\/$/

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  contentItems: Array<{ type: 'inputText', text: string }>
}

const ASANA_API_SPEC: ToolSpec = {
  name: 'asana_api',
  description: 'Execute a raw REST API call against Asana using Agent Please\'s configured auth.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['method', 'path'],
    properties: {
      method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE, PATCH).' },
      path: { type: 'string', description: 'API path starting with /.' },
      params: {
        type: ['object', 'null'],
        description: 'Optional query parameters (GET) or request body (POST/PUT/PATCH).',
        additionalProperties: true,
      },
    },
  },
}

const GITHUB_GRAPHQL_SPEC: ToolSpec = {
  name: 'github_graphql',
  description: 'Execute a raw GraphQL query or mutation against GitHub using Agent Please\'s configured auth.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'GraphQL query or mutation document (single operation).' },
      variables: {
        type: ['object', 'null'],
        description: 'Optional GraphQL variables object.',
        additionalProperties: true,
      },
    },
  },
}

export function getToolSpecs(config: ServiceConfig): ToolSpec[] {
  if (!config.projects.length) {
    log.warn('no projects configured, tool specs unavailable')
    return []
  }
  const hasAsana = config.projects.some(p => config.platforms[p.platform]?.kind === 'asana')
  const hasGithub = config.projects.some(p => config.platforms[p.platform]?.kind === 'github')
  const specs: ToolSpec[] = []
  if (hasAsana)
    specs.push(ASANA_API_SPEC)
  if (hasGithub)
    specs.push(GITHUB_GRAPHQL_SPEC)
  return specs
}

export async function executeTool(
  config: ServiceConfig,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  if (!config.projects.length) {
    return failureResult({
      error: { message: 'No projects configured — cannot execute tracker tools. Check your WORKFLOW.md projects section.' },
    })
  }

  const hasAsana = config.projects.some(p => config.platforms[p.platform]?.kind === 'asana')
  const hasGithub = config.projects.some(p => config.platforms[p.platform]?.kind === 'github')

  if (toolName === 'asana_api' && hasAsana) {
    return executeAsanaApi(config, rawArgs)
  }

  if (toolName === 'github_graphql' && hasGithub) {
    return executeGitHubGraphql(config, rawArgs)
  }

  return failureResult({
    error: {
      message: `Unsupported tool: ${toolName}`,
      supportedTools: getToolSpecs(config).map(s => s.name),
    },
  })
}

// --- asana_api ---

async function executeAsanaApi(config: ServiceConfig, rawArgs: unknown): Promise<ToolResult> {
  const args = parseAsanaArgs(rawArgs)
  if ('error' in args)
    return failureResult({ error: args.error })

  const { method, path, params } = args
  const rawAsana = config.platforms.asana
  const asanaPlatform = rawAsana?.kind === 'asana' ? rawAsana : null
  const apiKey = asanaPlatform?.api_key ?? null
  if (!apiKey) {
    return failureResult({ error: { message: 'Asana auth not configured. Set platforms.asana.api_key or ASANA_ACCESS_TOKEN.' } })
  }

  const firstProject = config.projects.find(p => config.platforms[p.platform]?.kind === 'asana')
  const base = ((firstProject?.endpoint) ?? 'https://app.asana.com/api/1.0').replace(TRAILING_SLASH_RE, '')
  const url = buildAsanaUrl(base, path, method, params)
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  }

  if (params && method !== 'GET') {
    init.headers = { ...init.headers as Record<string, string>, 'Content-Type': 'application/json' }
    init.body = JSON.stringify({ data: params })
  }

  let response: Response
  try {
    response = await fetch(url, init)
  }
  catch (err) {
    return failureResult({ error: { message: `Asana API request failed: ${err}` } })
  }

  let body: unknown
  try {
    body = await response.json()
  }
  catch {
    body = await response.text().catch(() => null)
  }

  if (!response.ok) {
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: JSON.stringify({ http_status: response.status, body }, null, 2) }],
    }
  }

  return {
    success: true,
    contentItems: [{ type: 'inputText', text: JSON.stringify(body, null, 2) }],
  }
}

function buildAsanaUrl(base: string, path: string, method: string, params: Record<string, unknown> | null): string {
  const url = new URL(base + path)
  if (method === 'GET' && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) {
        url.searchParams.set(k, String(v))
      }
    }
  }
  return url.toString()
}

function parseAsanaArgs(raw: unknown): { method: string, path: string, params: Record<string, unknown> | null } | { error: { message: string } } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: { message: 'asana_api requires a JSON object with method and path fields.' } }
  }

  const args = raw as Record<string, unknown>
  const method = typeof args.method === 'string' ? args.method.trim().toUpperCase() : ''
  const path = typeof args.path === 'string' ? args.path.trim() : ''

  if (!method)
    return { error: { message: 'asana_api: method must be a non-empty string (e.g. GET, POST).' } }
  if (!path.startsWith('/'))
    return { error: { message: 'asana_api: path must be a non-empty string beginning with /.' } }

  const params = args.params && typeof args.params === 'object' && !Array.isArray(args.params)
    ? args.params as Record<string, unknown>
    : null

  return { method, path, params }
}

// --- github_graphql ---

async function executeGitHubGraphql(config: ServiceConfig, rawArgs: unknown): Promise<ToolResult> {
  const args = parseGitHubArgs(rawArgs)
  if ('error' in args)
    return failureResult({ error: args.error })

  const { query, variables } = args
  const firstProject = config.projects.find(p => config.platforms[p.platform]?.kind === 'github')
  const rawGithub = firstProject ? config.platforms[firstProject.platform] : null
  const githubPlatform = rawGithub?.kind === 'github' ? rawGithub : null
  if (!githubPlatform) {
    return failureResult({ error: { message: 'GitHub auth not configured. No github platform found.' } })
  }
  const { api_key, app_id, private_key, installation_id } = githubPlatform
  const hasAuth = api_key || (app_id && private_key && installation_id != null)
  if (!hasAuth) {
    return failureResult({ error: { message: 'GitHub auth not configured. Set platforms.github.api_key or GITHUB_TOKEN, or configure app_id, private_key, and installation_id.' } })
  }

  try {
    const octokit = createAuthenticatedGraphql(firstProject!, githubPlatform)
    const data = await octokit(query, variables ?? {})
    return {
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify({ data }, null, 2) }],
    }
  }
  catch (err) {
    if (err instanceof GraphqlResponseError) {
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: JSON.stringify({ data: err.data, errors: err.errors }, null, 2) }],
      }
    }
    const e = err as { status?: number, response?: unknown }
    if (typeof e.status === 'number' && e.response !== undefined) {
      return failureResult({ error: { message: `GitHub GraphQL HTTP ${e.status}` } })
    }
    return failureResult({ error: { message: `GitHub GraphQL request failed: ${err}` } })
  }
}

function parseGitHubArgs(raw: unknown): { query: string, variables: Record<string, unknown> | null } | { error: { message: string } } {
  // Accept raw string shorthand
  if (typeof raw === 'string') {
    const query = raw.trim()
    if (!query)
      return { error: { message: 'github_graphql: query must be a non-empty string.' } }
    return { query, variables: null }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: { message: 'github_graphql requires a JSON object with a query field.' } }
  }

  const args = raw as Record<string, unknown>
  const query = typeof args.query === 'string' ? args.query.trim() : ''

  if (!query)
    return { error: { message: 'github_graphql: query must be a non-empty string.' } }

  const operationMatches = query.match(MULTIPLE_OPERATIONS_RE)
  if (operationMatches && operationMatches.length > 1) {
    return { error: { message: 'github_graphql: query must contain exactly one GraphQL operation.' } }
  }

  if (args.variables !== undefined && args.variables !== null) {
    if (typeof args.variables !== 'object' || Array.isArray(args.variables)) {
      return { error: { message: 'github_graphql.variables must be a JSON object when provided.' } }
    }
  }

  const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
    ? args.variables as Record<string, unknown>
    : null

  return { query, variables }
}

function failureResult(payload: unknown): ToolResult {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: JSON.stringify(payload, null, 2) }],
  }
}

export function createToolsMcpServer(config: ServiceConfig): ReturnType<typeof createSdkMcpServer> {
  const hasAsana = config.projects.some(p => config.platforms[p.platform]?.kind === 'asana')
  const hasGithub = config.projects.some(p => config.platforms[p.platform]?.kind === 'github')
  const tools: SdkMcpToolDefinition<AnyZodRawShape>[] = []

  if (hasAsana) {
    tools.push(tool(
      'asana_api',
      ASANA_API_SPEC.description,
      {
        method: z.string(),
        path: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
      },
      async (args) => {
        const result = await executeTool(config, 'asana_api', args)
        return {
          content: [{ type: 'text' as const, text: result.contentItems[0]?.text ?? '' }],
          isError: !result.success,
        }
      },
    ) as unknown as SdkMcpToolDefinition<AnyZodRawShape>)
  }

  if (hasGithub) {
    tools.push(tool(
      'github_graphql',
      GITHUB_GRAPHQL_SPEC.description,
      {
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).optional(),
      },
      async (args) => {
        const result = await executeTool(config, 'github_graphql', args)
        return {
          content: [{ type: 'text' as const, text: result.contentItems[0]?.text ?? '' }],
          isError: !result.success,
        }
      },
    ) as unknown as SdkMcpToolDefinition<AnyZodRawShape>)
  }

  return createSdkMcpServer({ name: 'agent-please-tools', tools })
}
