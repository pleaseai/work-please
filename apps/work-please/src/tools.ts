import type { ServiceConfig } from './types'

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
  description: 'Execute a raw REST API call against Asana using Work Please\'s configured auth.',
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
  description: 'Execute a raw GraphQL query or mutation against GitHub using Work Please\'s configured auth.',
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
  const { kind } = config.tracker
  if (kind === 'asana')
    return [ASANA_API_SPEC]
  if (kind === 'github_projects')
    return [GITHUB_GRAPHQL_SPEC]
  return []
}

export async function executeTool(
  config: ServiceConfig,
  toolName: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const { kind } = config.tracker

  if (toolName === 'asana_api' && kind === 'asana') {
    return executeAsanaApi(config, rawArgs)
  }

  if (toolName === 'github_graphql' && kind === 'github_projects') {
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
  const apiKey = config.tracker.api_key
  if (!apiKey) {
    return failureResult({ error: { message: 'Asana auth not configured. Set tracker.api_key or ASANA_ACCESS_TOKEN.' } })
  }

  const base = (config.tracker.endpoint ?? 'https://app.asana.com/api/1.0').replace(TRAILING_SLASH_RE, '')
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
  const apiKey = config.tracker.api_key
  if (!apiKey) {
    return failureResult({ error: { message: 'GitHub auth not configured. Set tracker.api_key or GITHUB_TOKEN.' } })
  }

  const base = (config.tracker.endpoint ?? 'https://api.github.com').replace(TRAILING_SLASH_RE, '')
  const graphqlUrl = `${base}/graphql`

  let response: Response
  try {
    response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    })
  }
  catch (err) {
    return failureResult({ error: { message: `GitHub GraphQL request failed: ${err}` } })
  }

  let body: unknown
  try {
    body = await response.json()
  }
  catch {
    body = await response.text().catch(() => null)
  }

  if (!response.ok) {
    return failureResult({ error: { message: `GitHub GraphQL HTTP ${response.status}`, body } })
  }

  const hasErrors = hasGraphqlErrors(body)
  return {
    success: !hasErrors,
    contentItems: [{ type: 'inputText', text: JSON.stringify(body, null, 2) }],
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

function hasGraphqlErrors(body: unknown): boolean {
  if (!body || typeof body !== 'object')
    return false
  const b = body as Record<string, unknown>
  return Array.isArray(b.errors) && b.errors.length > 0
}

function failureResult(payload: unknown): ToolResult {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: JSON.stringify(payload, null, 2) }],
  }
}
