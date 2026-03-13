import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { AgentMessage, Issue, ServiceConfig } from './types'
import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import { createToolsMcpServer, getToolSpecs } from './tools'

export interface SessionResult {
  turn_id: string
  session_id: string
}

export interface AgentSession {
  sessionId: string
  workspace: string
}

type QueryFn = (params: { prompt: string, options?: Options }) => AsyncIterable<unknown>

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const NEWLINE_PATTERN = /[\r\n]/g

// Minimal discriminated shape for SDK messages received in the for-await loop
interface SdkMsgBase { type: string }
interface SdkMsgInit extends SdkMsgBase { type: 'system', subtype: 'init', session_id: string }
interface SdkMsgSuccess extends SdkMsgBase { type: 'result', subtype: 'success', usage: { input_tokens: number, output_tokens: number } }
interface SdkMsgError extends SdkMsgBase { type: 'result', subtype: string, errors: string[] }
interface SdkMsgRateLimit extends SdkMsgBase { type: 'rate_limit_event', rate_limit_info: unknown }
type SdkMsg = SdkMsgInit | SdkMsgSuccess | SdkMsgError | SdkMsgRateLimit | SdkMsgBase

export class AppServerClient {
  private assignedSessionId: string | null = null
  private sessionId: string | null = null
  private abortController: AbortController | null = null
  private workspace: string
  private config: ServiceConfig
  private queryFn: QueryFn

  constructor(config: ServiceConfig, workspace: string, queryFn: QueryFn = sdkQuery) {
    this.config = config
    this.workspace = workspace
    this.queryFn = queryFn
  }

  async startSession(sessionId?: string): Promise<AgentSession | Error> {
    // Reset state unconditionally to prevent stale fields on instance reuse or retry
    this.assignedSessionId = null
    this.sessionId = null

    if (sessionId !== undefined && !UUID_PATTERN.test(sessionId)) {
      const preview = String(sessionId).slice(0, 64).replace(NEWLINE_PATTERN, ' ')
      return new Error(`invalid_session_id: expected UUID format, got "${preview}"`)
    }

    const validationErr = this.validateWorkspaceCwd()
    if (validationErr)
      return validationErr

    const id = sessionId ?? randomUUID()
    this.assignedSessionId = id
    // Set sessionId immediately so runTurn uses options.resume (cross-restart resume path).
    // The SDK has NOT confirmed this session — it may reject if the session no longer exists.
    this.sessionId = sessionId ?? null
    return { sessionId: id, workspace: this.workspace }
  }

  async runTurn(
    session: AgentSession,
    prompt: string,
    _issue: Issue,
    onMessage: (msg: AgentMessage) => void,
  ): Promise<SessionResult | Error> {
    const controller = new AbortController()
    this.abortController = controller

    const timeoutHandle = setTimeout(
      () => controller.abort(new Error('turn_timeout')),
      this.config.claude.turn_timeout_ms,
    )

    const options: Options = {
      cwd: session.workspace,
      permissionMode: this.config.claude.permission_mode as Options['permissionMode'],
      abortController: controller,
    }

    if (this.config.claude.permission_mode === 'bypassPermissions') {
      options.allowDangerouslySkipPermissions = true
    }

    if (this.config.claude.allowed_tools.length > 0) {
      options.allowedTools = this.config.claude.allowed_tools
    }

    if (this.sessionId) {
      options.resume = this.sessionId
    }
    else if (this.assignedSessionId) {
      options.sessionId = this.assignedSessionId as `${string}-${string}-${string}-${string}-${string}`
    }

    if (this.config.claude.command !== 'claude') {
      options.pathToClaudeCodeExecutable = this.config.claude.command
    }

    if (this.config.claude.model) {
      options.model = this.config.claude.model
    }

    const sp = this.config.claude.system_prompt
    if (sp.type === 'custom') {
      options.systemPrompt = sp.value
    }
    else {
      options.systemPrompt = sp
    }

    const toolSpecs = getToolSpecs(this.config)
    if (toolSpecs.length > 0) {
      options.mcpServers = {
        'work-please-tools': createToolsMcpServer(this.config),
      }
    }

    if (this.config.claude.setting_sources.length > 0) {
      options.settingSources = this.config.claude.setting_sources
    }

    const turnId = randomUUID()
    let sessionId: string | null = null
    let gotError = false

    try {
      const q = this.queryFn({ prompt, options })

      for await (const rawMsg of q) {
        const msg = rawMsg as SdkMsg
        if (msg.type === 'system' && (msg as SdkMsgInit).subtype === 'init') {
          const initMsg = msg as SdkMsgInit
          sessionId = initMsg.session_id
          this.sessionId = sessionId
          this.assignedSessionId = null // SDK confirmed — proposed ID no longer needed
          onMessage({
            event: 'session_started',
            timestamp: new Date(),
            session_id: sessionId,
            turn_id: turnId,
          })
        }
        else if (msg.type === 'result') {
          const resultMsg = msg as SdkMsgSuccess | SdkMsgError
          if (resultMsg.subtype === 'success') {
            const successMsg = resultMsg as SdkMsgSuccess
            onMessage({
              event: 'turn_completed',
              timestamp: new Date(),
              usage: {
                input_tokens: successMsg.usage.input_tokens,
                output_tokens: successMsg.usage.output_tokens,
                total_tokens: successMsg.usage.input_tokens + successMsg.usage.output_tokens,
              },
            })
          }
          else {
            const errMsg = resultMsg as SdkMsgError
            gotError = true
            onMessage({
              event: 'turn_failed',
              timestamp: new Date(),
              payload: { subtype: errMsg.subtype, errors: errMsg.errors },
            })
          }
        }
        else if (msg.type === 'rate_limit_event') {
          const rlMsg = msg as SdkMsgRateLimit
          onMessage({
            event: 'notification',
            timestamp: new Date(),
            rate_limits: rlMsg.rate_limit_info,
          })
        }
        else {
          onMessage({
            event: 'notification',
            timestamp: new Date(),
            payload: rawMsg,
          })
        }
      }

      clearTimeout(timeoutHandle)

      if (gotError) {
        return new Error('turn_failed')
      }

      if (!sessionId) {
        const err = new Error('no_session_started')
        onMessage({
          event: 'startup_failed',
          timestamp: new Date(),
          payload: { reason: err.message },
        })
        return err
      }

      return { turn_id: turnId, session_id: sessionId }
    }
    catch (err) {
      clearTimeout(timeoutHandle)
      const error = err instanceof Error ? err : new Error(String(err))
      // If init was never received, the session never started — report startup_failed
      // and clear stale resume state so the next runTurn does not retry a poisoned session.
      // If init was already received and the turn was aborted mid-execution, report turn_failed
      // so callers can distinguish a startup failure from a mid-turn failure.
      if (!sessionId) {
        // Preserve resume state on transient pre-init failures so the next turn can retry.
        // Only clear state for new sessions where no session was ever confirmed.
        if (!options.resume) {
          this.sessionId = null
          this.assignedSessionId = null
        }
      }
      onMessage({
        event: sessionId ? 'turn_failed' : 'startup_failed',
        timestamp: new Date(),
        payload: { reason: error.message },
      })
      return error
    }
  }

  stopSession(): void {
    this.abortController?.abort()
    this.assignedSessionId = null
    this.sessionId = null
    this.abortController = null
  }

  private validateWorkspaceCwd(): Error | null {
    const wsPath = resolve(this.workspace)
    const root = resolve(this.config.workspace.root)
    const rootWithSep = root + sep

    if (wsPath === root)
      return new Error(`invalid_workspace_cwd: workspace_root ${wsPath}`)
    if (!wsPath.startsWith(rootWithSep))
      return new Error(`invalid_workspace_cwd: outside_workspace_root ${wsPath}`)
    return null
  }
}

// Utility exports (kept for backward compatibility with tests and orchestrator)
type JsonRpcMessage = Record<string, unknown>

export function extractRateLimits(payload: JsonRpcMessage): { rate_limits?: unknown } {
  const params = payload.params as Record<string, unknown> | undefined
  const candidates = [
    params?.rate_limits,
    (params?.msg as Record<string, unknown> | undefined)?.rate_limits,
    payload.rate_limits,
  ]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object')
      return { rate_limits: candidate }
  }
  return {}
}

export function extractUsage(payload: JsonRpcMessage): { usage?: AgentMessage['usage'] } {
  const params = payload.params as Record<string, unknown> | undefined
  const tokenUsage = params?.tokenUsage as Record<string, unknown> | undefined
  const usageRaw = (
    params?.usage
    ?? params?.total_token_usage
    ?? tokenUsage?.total
  ) as Record<string, unknown> | undefined
  if (!usageRaw)
    return {}
  return {
    usage: {
      input_tokens: Number(usageRaw.input_tokens ?? usageRaw.inputTokens ?? usageRaw.prompt_tokens ?? 0),
      output_tokens: Number(usageRaw.output_tokens ?? usageRaw.outputTokens ?? usageRaw.completion_tokens ?? 0),
      total_tokens: Number(usageRaw.total_tokens ?? usageRaw.totalTokens ?? 0),
    },
  }
}

export function isInputRequired(method: string, payload: JsonRpcMessage): boolean {
  const INPUT_METHODS = [
    'turn/input_required',
    'turn/needs_input',
    'turn/need_input',
    'turn/request_input',
    'turn/approval_required',
  ]
  if (INPUT_METHODS.includes(method))
    return true

  const params = payload.params as Record<string, unknown> | undefined
  const checks = [payload, params]
  return checks.some(obj =>
    obj?.requiresInput === true
    || obj?.needsInput === true
    || obj?.input_required === true
    || obj?.inputRequired === true,
  )
}
