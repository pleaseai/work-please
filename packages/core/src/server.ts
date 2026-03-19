import type { Orchestrator } from './orchestrator'
import type { ContentBlock } from './session-renderer'
import type { OrchestratorState, RetryEntry, RunningEntry } from './types'
import type { VerifySignature } from './webhook'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildSessionPageHtml, esc, fetchSessionMessages, findRunningBySessionId, isValidSessionId, parsePositiveInt } from './session-renderer'
import { createVerify, handleWebhook } from './webhook'
import { workspacePath } from './workspace'

const DEFAULT_HOST = '127.0.0.1'
const ISSUE_PATH_RE = /^\/api\/v1\/([^/]+)$/
const SESSION_PAGE_RE = /^\/sessions\/([^/]+)$/
const SESSION_MESSAGES_RE = /^\/api\/v1\/sessions\/([^/]+)\/messages$/

const __dirname = (import.meta as any).dir ?? (import.meta.dirname ?? resolve(fileURLToPath(import.meta.url), '..'))
const DASHBOARD_DIST = resolve(
  process.env.DASHBOARD_DIST
  ?? join(__dirname, '..', '..', '..', 'dashboard', 'dist'),
)
const DASHBOARD_DIST_PREFIX = DASHBOARD_DIST + sep

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

export class HttpServer {
  private server: { port: number, stop: () => void } | null = null
  private cachedVerify: VerifySignature | null = null
  private cachedSecret: string | null = null

  constructor(
    private orchestrator: Orchestrator,
    private port: number,
    private host: string = DEFAULT_HOST,
  ) {}

  start(): number {
    if (typeof globalThis.Bun === 'undefined') {
      throw new TypeError('HttpServer requires the Bun runtime')
    }
    const srv = globalThis.Bun.serve({
      hostname: this.host,
      port: this.port,
      fetch: (req: Request) => this.handleRequest(req),
    })
    this.server = { port: srv.port ?? this.port, stop: () => srv.stop() }
    return this.server.port
  }

  stop(): void {
    this.server?.stop()
    this.server = null
  }

  get boundPort(): number | null {
    return this.server?.port ?? null
  }

  private getVerify(secret: string | null): VerifySignature | null {
    if (!secret)
      return null
    if (secret !== this.cachedSecret) {
      this.cachedVerify = createVerify(secret)
      this.cachedSecret = secret
    }
    return this.cachedVerify
  }

  private handleRequest(req: Request): Response | Promise<Response> {
    try {
      const result = this.routeRequest(req)
      if (result instanceof Promise) {
        return result.catch((err) => {
          console.error(`[server] unhandled error in request handler: ${err}`)
          return errorResponse(500, 'internal_error', 'Internal server error')
        })
      }
      return result
    }
    catch (err) {
      console.error(`[server] unhandled error in request handler: ${err}`)
      return errorResponse(500, 'internal_error', 'Internal server error')
    }
  }

  private routeRequest(req: Request): Response | Promise<Response> {
    const orchestrator = this.orchestrator
    const url = new URL(req.url)
    const pathname = url.pathname

    // API routes
    if (pathname === '/api/v1/state') {
      if (req.method !== 'GET')
        return methodNotAllowed()
      return stateResponse(orchestrator)
    }

    if (pathname === '/api/v1/refresh') {
      if (req.method !== 'POST')
        return methodNotAllowed()
      return refreshResponse(orchestrator)
    }

    if (pathname === '/api/v1/webhook') {
      if (req.method !== 'POST')
        return methodNotAllowed()
      const config = orchestrator.getConfig()
      const { secret, events } = config.server.webhook
      const verify = this.getVerify(secret)
      return handleWebhook(req, verify, events, () => orchestrator.triggerRefresh())
    }

    const sessionResult = this.routeSessionRequest(req, pathname, url)
    if (sessionResult !== null)
      return sessionResult

    const issueMatch = pathname.match(ISSUE_PATH_RE)
    if (issueMatch) {
      if (req.method !== 'GET')
        return methodNotAllowed()
      const identifier = decodeURIComponent(issueMatch[1])
      return issueResponse(orchestrator, identifier)
    }

    // Unknown API routes return 404
    if (pathname.startsWith('/api/'))
      return notFound()

    // Static file serving from dashboard dist
    return this.serveStatic(pathname, orchestrator)
  }

  private routeSessionRequest(req: Request, pathname: string, url: URL): Response | Promise<Response> | null {
    const orchestrator = this.orchestrator

    const sessionMsgMatch = pathname.match(SESSION_MESSAGES_RE)
    if (sessionMsgMatch) {
      if (req.method !== 'GET')
        return methodNotAllowed()
      const sessionId = decodeURIComponent(sessionMsgMatch[1])
      if (!isValidSessionId(sessionId))
        return errorResponse(400, 'invalid_session_id', 'Invalid session ID')
      return sessionMessagesResponse(orchestrator, sessionId, url)
    }

    // Session page (non-API HTML route)
    const sessionPageMatch = pathname.match(SESSION_PAGE_RE)
    if (sessionPageMatch) {
      if (req.method !== 'GET')
        return methodNotAllowed()
      const sessionId = decodeURIComponent(sessionPageMatch[1])
      if (!isValidSessionId(sessionId))
        return errorResponse(400, 'invalid_session_id', 'Invalid session ID')
      return sessionPageResponse(orchestrator, sessionId)
    }

    return null
  }

  private serveStatic(pathname: string, orchestrator: Orchestrator): Response {
    const resolved = normalize(join(DASHBOARD_DIST, pathname))
    if (resolved !== DASHBOARD_DIST && !resolved.startsWith(DASHBOARD_DIST_PREFIX))
      return notFound()

    if (existsSync(resolved)) {
      try {
        if (statSync(resolved).isDirectory()) {
          // fall through to SPA index
        }
        else {
          const ext = extname(resolved)
          const content = readFileSync(resolved)
          return new Response(content, {
            headers: { ...SECURITY_HEADERS, 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' },
          })
        }
      }
      catch (err) {
        console.error('[server] static file read failed for %s: %s', resolved, err)
        return errorResponse(500, 'static_file_read_failed', 'Failed to read static asset')
      }
    }

    // SPA fallback: serve index.html for client-side routing
    const indexPath = join(DASHBOARD_DIST, 'index.html')
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath)
      return new Response(content, {
        headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // No dashboard build — fall back to inline HTML
    console.warn('[server] Dashboard dist not found at %s — serving inline HTML fallback', DASHBOARD_DIST)
    return dashboardResponse(orchestrator)
  }
}

function stateResponse(orchestrator: Orchestrator): Response {
  const state = orchestrator.getState()
  const generatedAt = new Date().toISOString()

  const running = Array.from(state.running.values(), r => runningEntryPayload(r))
  const retrying = Array.from(state.retry_attempts.values(), r => retryEntryPayload(r))

  const liveSecondsRunning = computeLiveSecondsRunning(state)

  const body = {
    generated_at: generatedAt,
    counts: {
      running: running.length,
      retrying: retrying.length,
    },
    running,
    retrying,
    codex_totals: {
      input_tokens: state.agent_totals.input_tokens,
      output_tokens: state.agent_totals.output_tokens,
      total_tokens: state.agent_totals.total_tokens,
      seconds_running: state.agent_totals.seconds_running + liveSecondsRunning,
    },
    rate_limits: state.agent_rate_limits,
  }

  return jsonResponse(body)
}

function issueResponse(orchestrator: Orchestrator, identifier: string): Response {
  const state = orchestrator.getState()
  const config = orchestrator.getConfig()
  const wsPath = workspacePath(config, identifier)

  const running = findRunningByIdentifier(state, identifier)
  const retry = findRetryByIdentifier(state, identifier)

  if (!running && !retry) {
    return errorResponse(404, 'issue_not_found', `Issue not found: ${identifier}`)
  }

  const issueId = running?.issue.id ?? retry?.issue_id ?? ''
  const status = running ? 'running' : 'retrying'

  const body = {
    issue_identifier: identifier,
    issue_id: issueId,
    status,
    workspace: { path: wsPath },
    attempts: {
      restart_count: Math.max((retry?.attempt ?? 0) - 1, 0),
      current_retry_attempt: retry?.attempt ?? 0,
    },
    running: running ? runningIssuePayload(running) : null,
    retry: retry ? retryIssuePayload(retry) : null,
    logs: { codex_session_logs: [] },
    recent_events: running ? recentEventsPayload(running) : [],
    last_error: retry?.error ?? null,
    tracked: {},
  }

  return jsonResponse(body)
}

function refreshResponse(orchestrator: Orchestrator): Response {
  orchestrator.triggerRefresh()
  const body = {
    queued: true,
    coalesced: false,
    requested_at: new Date().toISOString(),
    operations: ['poll', 'reconcile'],
  }
  return jsonResponse(body, 202)
}

async function sessionMessagesResponse(orchestrator: Orchestrator, sessionId: string, url: URL): Promise<Response> {
  const config = orchestrator.getConfig()
  const limit = parsePositiveInt(url.searchParams.get('limit'))
  const offset = parsePositiveInt(url.searchParams.get('offset'))

  try {
    const messages = await fetchSessionMessages(sessionId, config.workspace.root, { limit, offset })
    return jsonResponse(messages)
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.toLowerCase().includes('not found'))
      return jsonResponse([])
    console.error('[server] sessionMessagesResponse error:', err)
    return errorResponse(500, 'session_load_error', 'Failed to load session messages')
  }
}

const SESSION_PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'`

async function sessionPageResponse(orchestrator: Orchestrator, sessionId: string): Promise<Response> {
  const state = orchestrator.getState()
  const config = orchestrator.getConfig()
  const running = findRunningBySessionId(state, sessionId)
  const sessionHeaders = { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SESSION_PAGE_CSP }

  let messages: Array<{ type: string, uuid: string, content: ContentBlock[] }> = []
  let loadError: string | undefined
  try {
    messages = await fetchSessionMessages(sessionId, config.workspace.root)
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.toLowerCase().includes('not found')) {
      // session not found — render empty page normally
    }
    else {
      console.error('[server] sessionPageResponse error:', err)
      loadError = 'Failed to load session messages'
      const html = buildSessionPageHtml(sessionId, running, [], loadError)
      return new Response(html, { status: 500, headers: sessionHeaders })
    }
  }

  const html = buildSessionPageHtml(sessionId, running, messages)
  return new Response(html, {
    headers: sessionHeaders,
  })
}

function dashboardResponse(orchestrator: Orchestrator): Response {
  const state = orchestrator.getState()
  const running = [...state.running.values()]
  const retrying = [...state.retry_attempts.values()]

  const runningRows = running
    .map(r => `<tr>
      <td>${esc(r.identifier)}</td>
      <td>${esc(r.issue.state)}</td>
      <td>${r.turn_count}</td>
      <td>${r.session_id ? `<a href="/sessions/${esc(r.session_id)}">${esc(r.session_id)}</a>` : ''}</td>
      <td>${esc(r.started_at.toISOString())}</td>
      <td>${esc(r.last_agent_event ?? '')}</td>
      <td>${r.agent_total_tokens}</td>
    </tr>`)
    .join('')

  const retryRows = retrying
    .map(r => `<tr>
      <td>${esc(r.identifier)}</td>
      <td>${r.attempt}</td>
      <td>${new Date(r.due_at_ms).toISOString()}</td>
      <td>${esc(r.error ?? '')}</td>
    </tr>`)
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Work Please</title>
<style>
  body { font-family: monospace; margin: 2rem; background: #0f0f0f; color: #d4d4d4; }
  h1 { color: #cba6f7; } h2 { color: #89b4fa; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { padding: 0.4rem 0.8rem; border: 1px solid #313244; text-align: left; }
  th { background: #1e1e2e; color: #cdd6f4; }
  tr:nth-child(even) { background: #181825; }
  .stat { display: inline-block; margin-right: 2rem; }
  .stat-val { font-size: 1.4rem; color: #a6e3a1; }
</style>
</head>
<body>
<h1>Work Please</h1>
<p>
  <span class="stat"><span class="stat-val">${running.length}</span> running</span>
  <span class="stat"><span class="stat-val">${retrying.length}</span> retrying</span>
  <span class="stat"><span class="stat-val">${state.agent_totals.total_tokens}</span> total tokens</span>
</p>

<h2>Running</h2>
${running.length === 0
  ? '<p>None</p>'
  : `
<table>
  <thead><tr><th>Identifier</th><th>State</th><th>Turn</th><th>Session</th><th>Started</th><th>Last Event</th><th>Tokens</th></tr></thead>
  <tbody>${runningRows}</tbody>
</table>`}

<h2>Retry Queue</h2>
${retrying.length === 0
  ? '<p>None</p>'
  : `
<table>
  <thead><tr><th>Identifier</th><th>Attempt</th><th>Due At</th><th>Error</th></tr></thead>
  <tbody>${retryRows}</tbody>
</table>`}

<p style="color:#585b70;font-size:0.85rem">Generated ${new Date().toISOString()}</p>
</body>
</html>`

  return new Response(html, {
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': SESSION_PAGE_CSP },
  })
}

// --- helpers ---

function runningEntryPayload(r: RunningEntry) {
  return {
    issue_id: r.issue.id,
    issue_identifier: r.identifier,
    state: r.issue.state,
    session_id: r.session_id,
    turn_count: r.turn_count,
    last_event: r.last_agent_event,
    last_message: r.last_agent_message,
    started_at: r.started_at.toISOString(),
    last_event_at: r.last_agent_timestamp?.toISOString() ?? null,
    tokens: {
      input_tokens: r.agent_input_tokens,
      output_tokens: r.agent_output_tokens,
      total_tokens: r.agent_total_tokens,
    },
  }
}

function runningIssuePayload(r: RunningEntry) {
  return {
    session_id: r.session_id,
    turn_count: r.turn_count,
    state: r.issue.state,
    started_at: r.started_at.toISOString(),
    last_event: r.last_agent_event,
    last_message: r.last_agent_message,
    last_event_at: r.last_agent_timestamp?.toISOString() ?? null,
    tokens: {
      input_tokens: r.agent_input_tokens,
      output_tokens: r.agent_output_tokens,
      total_tokens: r.agent_total_tokens,
    },
  }
}

function retryEntryPayload(r: RetryEntry) {
  return {
    issue_id: r.issue_id,
    issue_identifier: r.identifier,
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }
}

function retryIssuePayload(r: RetryEntry) {
  return {
    attempt: r.attempt,
    due_at: new Date(r.due_at_ms).toISOString(),
    error: r.error,
  }
}

function recentEventsPayload(r: RunningEntry) {
  if (!r.last_agent_timestamp)
    return []
  return [{
    at: r.last_agent_timestamp.toISOString(),
    event: r.last_agent_event,
    message: r.last_agent_message,
  }]
}

function findRunningByIdentifier(state: OrchestratorState, identifier: string): RunningEntry | undefined {
  for (const entry of state.running.values()) {
    if (entry.identifier === identifier)
      return entry
  }
  return undefined
}

function findRetryByIdentifier(state: OrchestratorState, identifier: string): RetryEntry | undefined {
  for (const entry of state.retry_attempts.values()) {
    if (entry.identifier === identifier)
      return entry
  }
  return undefined
}

function computeLiveSecondsRunning(state: OrchestratorState): number {
  const now = Date.now()
  let total = 0
  for (const entry of state.running.values()) {
    total += (now - entry.started_at.getTime()) / 1000
  }
  return total
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } }, status)
}

function methodNotAllowed(): Response {
  return errorResponse(405, 'method_not_allowed', 'Method not allowed')
}

function notFound(): Response {
  return errorResponse(404, 'not_found', 'Route not found')
}
