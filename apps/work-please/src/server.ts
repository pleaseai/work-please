import type { Orchestrator } from './orchestrator'
import type { OrchestratorState, RetryEntry, RunningEntry } from './types'
import { handleWebhook } from './webhook'
import { workspacePath } from './workspace'

const DEFAULT_HOST = '127.0.0.1'
const ISSUE_PATH_RE = /^\/api\/v1\/([^/]+)$/
const ESC_AMP_RE = /&/g
const ESC_LT_RE = /</g
const ESC_GT_RE = />/g
const ESC_QUOT_RE = /"/g

export class HttpServer {
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(
    private orchestrator: Orchestrator,
    private port: number,
    private host: string = DEFAULT_HOST,
  ) {}

  start(): number {
    this.server = Bun.serve({
      hostname: this.host,
      port: this.port,
      fetch: req => this.handleRequest(req),
    })
    return this.server.port as number
  }

  stop(): void {
    this.server?.stop()
    this.server = null
  }

  get boundPort(): number | null {
    return this.server?.port ?? null
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

    if (pathname === '/') {
      return dashboardResponse(orchestrator)
    }

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
      return handleWebhook(req, secret, events, () => orchestrator.triggerRefresh())
    }

    const issueMatch = pathname.match(ISSUE_PATH_RE)
    if (issueMatch) {
      if (req.method !== 'GET')
        return methodNotAllowed()
      const identifier = decodeURIComponent(issueMatch[1])
      return issueResponse(orchestrator, identifier)
    }

    return notFound()
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

function dashboardResponse(orchestrator: Orchestrator): Response {
  const state = orchestrator.getState()
  const running = [...state.running.values()]
  const retrying = [...state.retry_attempts.values()]

  const runningRows = running
    .map(r => `<tr>
      <td>${esc(r.identifier)}</td>
      <td>${esc(r.issue.state)}</td>
      <td>${r.turn_count}</td>
      <td>${esc(r.session_id ?? '')}</td>
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
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
    headers: { 'Content-Type': 'application/json' },
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

function esc(s: string): string {
  return s
    .replace(ESC_AMP_RE, '&amp;')
    .replace(ESC_LT_RE, '&lt;')
    .replace(ESC_GT_RE, '&gt;')
    .replace(ESC_QUOT_RE, '&quot;')
}
