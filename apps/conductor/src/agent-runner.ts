import type { AgentMessage, Issue, ServiceConfig } from './types'
import { spawn } from 'node:child_process'
import { resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { executeTool, getToolSpecs } from './tools'

const STDERR_ERROR_RE = /error|warn|fail|fatal/i

export interface SessionResult {
  thread_id: string
  turn_id: string
  session_id: string
}

export interface AgentSession {
  threadId: string
  workspace: string
}

type JsonRpcMessage = Record<string, unknown>

export class AppServerClient {
  private proc: ReturnType<typeof spawn> | null = null
  private pendingResponses = new Map<number | string, {
    resolve: (val: unknown) => void
    reject: (err: Error) => void
  }>()

  private messageHandler: ((msg: AgentMessage) => void) | null = null
  private workspace: string
  private config: ServiceConfig
  private onProcessExit: ((code: number | null) => void) | null = null

  constructor(config: ServiceConfig, workspace: string) {
    this.config = config
    this.workspace = workspace
  }

  async startSession(): Promise<AgentSession | Error> {
    const validationErr = this.validateWorkspaceCwd()
    if (validationErr)
      return validationErr

    const startErr = this.startProcess()
    if (startErr)
      return startErr

    const initErr = await this.sendInitialize()
    if (initErr instanceof Error)
      return initErr

    const threadResult = await this.startThread()
    if (threadResult instanceof Error)
      return threadResult

    return { threadId: threadResult, workspace: this.workspace }
  }

  async runTurn(
    session: AgentSession,
    prompt: string,
    issue: Issue,
    onMessage: (msg: AgentMessage) => void,
  ): Promise<SessionResult | Error> {
    this.messageHandler = onMessage

    const turnResult = await this.startTurn(session.threadId, prompt, issue)
    if (turnResult instanceof Error)
      return turnResult

    const turn_id = turnResult
    const session_id = `${session.threadId}-${turn_id}`

    onMessage({
      event: 'session_started',
      timestamp: new Date(),
      agent_app_server_pid: this.getProcessPid(),
      session_id,
      thread_id: session.threadId,
      turn_id,
    })

    const turnCompletion = await this.awaitTurnCompletion(onMessage)
    if (turnCompletion instanceof Error)
      return turnCompletion

    return { thread_id: session.threadId, turn_id, session_id }
  }

  stopSession(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM')
      }
      catch {}
      this.proc = null
    }
    this.pendingResponses.clear()
  }

  private validateWorkspaceCwd(): Error | null {
    const wsPath = resolve(this.workspace)
    const root = resolve(this.config.workspace.root)
    const rootWithSep = root + sep

    if (wsPath === root) {
      return new Error(`invalid_workspace_cwd: workspace_root ${wsPath}`)
    }
    if (!wsPath.startsWith(rootWithSep)) {
      return new Error(`invalid_workspace_cwd: outside_workspace_root ${wsPath}`)
    }
    return null
  }

  private startProcess(): Error | null {
    const { command } = this.config.claude
    try {
      this.proc = spawn('bash', ['-lc', command], {
        cwd: this.workspace,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.proc.on('exit', (code) => {
        this.onProcessExit?.(code)
        this.rejectAllPending(new Error(`port_exit: ${code}`))
      })

      if (!this.proc.stdout)
        return new Error('no stdout on subprocess')

      const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity })
      rl.on('line', line => this.handleLine(line))

      if (this.proc.stderr) {
        const errRl = createInterface({ input: this.proc.stderr, crlfDelay: Infinity })
        errRl.on('line', (line) => {
          const trimmed = line.trim()
          if (trimmed) {
            // log stderr but do not parse as protocol
            if (STDERR_ERROR_RE.test(trimmed)) {
              console.error(`[agent stderr] ${trimmed}`)
            }
          }
        })
      }

      return null
    }
    catch (err) {
      return err instanceof Error ? err : new Error(String(err))
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed)
      return

    let payload: JsonRpcMessage
    try {
      payload = JSON.parse(trimmed)
    }
    catch {
      this.messageHandler?.({
        event: 'malformed',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        raw: trimmed,
      })
      return
    }

    // Check if it's a response to a pending request
    const id = payload.id as number | string | undefined
    if (id !== undefined) {
      const pending = this.pendingResponses.get(id)
      if (pending) {
        this.pendingResponses.delete(id)
        if (payload.error) {
          pending.reject(new Error(`response_error: ${JSON.stringify(payload.error)}`))
        }
        else {
          pending.resolve(payload.result)
        }
        return
      }
    }

    // It's a notification/method call
    this.handleNotification(payload)
  }

  private handleNotification(payload: JsonRpcMessage): void {
    const method = payload.method as string | undefined
    if (!method) {
      this.messageHandler?.({
        event: 'other_message',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    // Turn completion signals
    if (method === 'turn/completed') {
      this.resolveTurnCompletion(null)
      this.messageHandler?.({
        event: 'turn_completed',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
        ...extractUsage(payload),
      })
      return
    }

    if (method === 'turn/failed') {
      const err = new Error(`turn_failed: ${JSON.stringify(payload.params)}`)
      this.resolveTurnCompletion(err)
      this.messageHandler?.({
        event: 'turn_failed',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    if (method === 'turn/cancelled') {
      const err = new Error(`turn_cancelled: ${JSON.stringify(payload.params)}`)
      this.resolveTurnCompletion(err)
      this.messageHandler?.({
        event: 'turn_cancelled',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    // Approval requests
    if (method === 'item/commandExecution/requestApproval'
      || method === 'execCommandApproval'
      || method === 'applyPatchApproval'
      || method === 'item/fileChange/requestApproval') {
      const id = payload.id as string | number
      this.sendMessage({ id, result: { decision: 'acceptForSession' } })
      this.messageHandler?.({
        event: 'approval_auto_approved',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    // Dynamic tool calls
    if (method === 'item/tool/call') {
      this.handleToolCall(payload)
      return
    }

    // User input required
    if (method === 'item/tool/requestUserInput' || isInputRequired(method, payload)) {
      const id = payload.id as string | number | undefined
      if (id !== undefined) {
        this.sendMessage({ id, result: { success: false, error: 'non_interactive_session' } })
      }
      const err = new Error(`turn_input_required`)
      this.resolveTurnCompletion(err)
      this.messageHandler?.({
        event: 'turn_input_required',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    // Thread token usage updates
    if (method === 'thread/tokenUsage/updated') {
      this.messageHandler?.({
        event: 'notification',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
        ...extractUsage(payload),
        ...extractRateLimits(payload),
      })
      return
    }

    // General notification
    this.messageHandler?.({
      event: 'notification',
      timestamp: new Date(),
      agent_app_server_pid: this.getProcessPid(),
      payload,
      ...extractUsage(payload),
      ...extractRateLimits(payload),
    })
  }

  // Turn completion promise
  private turnCompletionResolve: ((err: Error | null) => void) | null = null

  private awaitTurnCompletion(_onMessage: (msg: AgentMessage) => void): Promise<null | Error> {
    return new Promise((resolve) => {
      const timeoutMs = this.config.claude.turn_timeout_ms
      const timer = setTimeout(() => {
        this.turnCompletionResolve = null
        resolve(new Error('turn_timeout'))
      }, timeoutMs)

      this.turnCompletionResolve = (err) => {
        clearTimeout(timer)
        this.turnCompletionResolve = null
        resolve(err)
      }

      // Handle process exit during turn
      this.onProcessExit = (code) => {
        clearTimeout(timer)
        this.turnCompletionResolve = null
        resolve(new Error(`port_exit: ${code}`))
      }
    })
  }

  private resolveTurnCompletion(err: Error | null): void {
    this.turnCompletionResolve?.(err)
  }

  private handleToolCall(payload: JsonRpcMessage): void {
    const id = payload.id as string | number
    const params = payload.params as Record<string, unknown> | undefined
    const toolName = typeof params?.name === 'string' ? params.name : null
    const rawArgs = params?.arguments ?? params?.input ?? {}

    if (!toolName) {
      this.sendMessage({ id, result: { success: false, error: 'unsupported_tool_call' } })
      this.messageHandler?.({
        event: 'unsupported_tool_call',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    const toolSpecs = getToolSpecs(this.config)
    const isSupported = toolSpecs.some(s => s.name === toolName)

    if (!isSupported) {
      this.sendMessage({ id, result: { success: false, error: 'unsupported_tool_call' } })
      this.messageHandler?.({
        event: 'unsupported_tool_call',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload,
      })
      return
    }

    // Execute supported tool asynchronously; send result when done
    executeTool(this.config, toolName, rawArgs).then((result) => {
      this.sendMessage({ id, result })
      this.messageHandler?.({
        event: 'notification',
        timestamp: new Date(),
        agent_app_server_pid: this.getProcessPid(),
        payload: { tool: toolName, success: result.success },
      })
    }).catch((err) => {
      this.sendMessage({ id, result: { success: false, error: String(err) } })
    })
  }

  private async sendInitialize(): Promise<null | Error> {
    const result = await this.sendRequest(1, 'initialize', {
      capabilities: { experimentalApi: true },
      clientInfo: { name: 'conductor', version: '1.0' },
    })
    if (result instanceof Error)
      return result

    this.sendMessage({ method: 'initialized', params: {} })
    return null
  }

  private async startThread(): Promise<string | Error> {
    const { permission_mode } = this.config.claude
    const toolSpecs = getToolSpecs(this.config)
    const params: Record<string, unknown> = {
      approvalPolicy: permission_mode === 'bypassPermissions' ? 'never' : 'always',
      sandbox: 'workspace-write',
      cwd: this.workspace,
    }
    if (toolSpecs.length > 0) {
      params.dynamicTools = toolSpecs
    }
    const result = await this.sendRequest(2, 'thread/start', params)

    if (result instanceof Error)
      return result

    const thread = (result as { thread?: { id?: string } })?.thread
    if (!thread?.id) {
      return new Error(`invalid_thread_payload: ${JSON.stringify(result)}`)
    }
    return thread.id
  }

  private async startTurn(threadId: string, prompt: string, issue: Issue): Promise<string | Error> {
    const { permission_mode } = this.config.claude
    const result = await this.sendRequest(3, 'turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: this.workspace,
      title: `${issue.identifier}: ${issue.title}`,
      approvalPolicy: permission_mode === 'bypassPermissions' ? 'never' : 'always',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.workspace] },
    })

    if (result instanceof Error)
      return result

    const turn = (result as { turn?: { id?: string } })?.turn
    if (!turn?.id) {
      return new Error(`invalid_turn_payload: ${JSON.stringify(result)}`)
    }
    return turn.id
  }

  private sendRequest(id: number, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.claude.read_timeout_ms
      const timer = setTimeout(() => {
        this.pendingResponses.delete(id)
        reject(new Error('response_timeout'))
      }, timeoutMs)

      this.pendingResponses.set(id, {
        resolve: (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })

      this.sendMessage({ id, method, params })
    })
  }

  private sendMessage(msg: JsonRpcMessage): void {
    if (!this.proc?.stdin)
      return
    const line = `${JSON.stringify(msg)}\n`
    this.proc.stdin.write(line)
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pendingResponses.values()) {
      pending.reject(err)
    }
    this.pendingResponses.clear()
  }

  private getProcessPid(): string | null {
    return this.proc?.pid ? String(this.proc.pid) : null
  }
}

function extractRateLimits(payload: JsonRpcMessage): { rate_limits?: unknown } {
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

function extractUsage(payload: JsonRpcMessage): { usage?: AgentMessage['usage'] } {
  const params = payload.params as Record<string, unknown> | undefined
  const usageRaw = (params?.usage ?? params?.total_token_usage) as Record<string, unknown> | undefined
  if (!usageRaw)
    return {}
  return {
    usage: {
      input_tokens: Number(usageRaw.input_tokens ?? usageRaw.inputTokens ?? 0),
      output_tokens: Number(usageRaw.output_tokens ?? usageRaw.outputTokens ?? 0),
      total_tokens: Number(usageRaw.total_tokens ?? usageRaw.totalTokens ?? 0),
    },
  }
}

function isInputRequired(method: string, payload: JsonRpcMessage): boolean {
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
