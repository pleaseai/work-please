import type { Client } from '@libsql/client'
import type { DispatchLockAdapter } from './dispatch-lock'
import type { LabelService } from './label'
import type { GitHubPlatformConfig, Issue, OrchestratorState, ProjectConfig, RetryEntry, RunningEntry, ServiceConfig, WorkflowDefinition } from './types'
import { watch } from 'node:fs'
import { resolveAgentEnv } from './agent-env'
import { AppServerClient } from './agent-runner'
import { buildConfig, getActiveStates, getTerminalStates, getWatchedStates, maxConcurrentForState, normalizeState, validateConfig } from './config'
import { createDbClient, insertRun, runMigrations } from './db'
import { toDispatchLockKey } from './dispatch-lock'
import { createLabelService } from './label'
import { createLogger } from './logger'
import { buildContinuationPrompt, buildPrompt, isPromptBuildError } from './prompt-builder'
import { createTrackerAdapter, formatTrackerError, isTrackerError } from './tracker/index'
import { isWorkflowError, loadWorkflow } from './workflow'
import { createWorkspace, removeWorkspace, runAfterRunHook, runBeforeRunHook } from './workspace'

const log = createLogger('orchestrator')

const CONTINUATION_RETRY_DELAY_MS = 1_000
const FAILURE_RETRY_BASE_MS = 10_000
const DISPATCH_LOCK_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DISPATCH_LOCK_EXTEND_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes

export class Orchestrator {
  private state: OrchestratorState
  private config: ServiceConfig
  private workflow: WorkflowDefinition
  private workflowPath: string
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private fileWatcher: ReturnType<typeof watch> | null = null
  private labelService: LabelService | null = null
  private db: Client | null = null
  private pendingDbWrites: Promise<void>[] = []
  private dispatchLockAdapter: DispatchLockAdapter | null = null

  constructor(workflowPath: string, options?: { dispatchLockAdapter?: DispatchLockAdapter }) {
    this.workflowPath = workflowPath

    const wf = loadWorkflow(workflowPath)
    if (isWorkflowError(wf)) {
      throw new Error(`Failed to load workflow: ${wf.code}`)
    }
    this.workflow = wf
    this.config = buildConfig(wf)
    this.labelService = createLabelService(this.config)
    this.dispatchLockAdapter = options?.dispatchLockAdapter ?? null

    this.state = {
      poll_interval_ms: this.config.polling.interval_ms,
      max_concurrent_agents: this.config.agent.max_concurrent_agents,
      running: new Map(),
      claimed: new Set(),
      retry_attempts: new Map(),
      completed: new Set(),
      watched_last_dispatched: new Map(),
      agent_totals: { input_tokens: 0, output_tokens: 0, total_tokens: 0, seconds_running: 0 },
      agent_rate_limits: null,
    }
  }

  async start(): Promise<void> {
    // Validate config before starting
    const validationErr = validateConfig(this.config)
    if (validationErr) {
      throw new Error(`Config validation failed: ${validationErr.code}`)
    }

    // Initialize database for run history
    this.db = createDbClient(this.config.db, this.config.workspace.root)
    if (this.db) {
      const migrated = await runMigrations(this.db)
      if (!migrated) {
        log.warn('db migration failed — disabling run history')
        this.db.close()
        this.db = null
      }
    }

    // Startup terminal workspace cleanup
    await this.startupTerminalWorkspaceCleanup()

    // Watch workflow file for changes
    this.startFileWatcher()

    const { mode, interval_ms } = this.config.polling
    log.info(`starting mode=${mode} interval_ms=${interval_ms}`)

    // Schedule immediate first tick
    this.scheduleTick(0)
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
    }
    // Stop all running agents
    for (const [issueId] of this.state.running) {
      this.terminateRunningIssue(issueId, false)
    }
    // Clear retry timers
    for (const entry of this.state.retry_attempts.values()) {
      if (entry.timer_handle)
        clearTimeout(entry.timer_handle)
    }
    this.state.retry_attempts.clear()
    // Flush pending DB writes before closing
    if (this.pendingDbWrites.length > 0) {
      await Promise.allSettled(this.pendingDbWrites)
      this.pendingDbWrites = []
    }
    // Close database
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  getState(): OrchestratorState {
    return this.state
  }

  getConfig(): ServiceConfig {
    return this.config
  }

  getWorkflow(): WorkflowDefinition {
    return this.workflow
  }

  getDb(): Client | null {
    return this.db
  }

  setDispatchLockAdapter(adapter: DispatchLockAdapter): void {
    this.dispatchLockAdapter = adapter
  }

  triggerRefresh(): void {
    this.scheduleTick(0)
  }

  private scheduleTick(delayMs: number): void {
    if (this.pollTimer)
      clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => this.tick(), delayMs)
  }

  private scheduleNextPoll(): void {
    // state.poll_interval_ms is kept in sync by reloadWorkflow().
    // In webhook mode it acts as a long fallback safety net;
    // the primary trigger is webhook → triggerRefresh() → scheduleTick(0).
    this.scheduleTick(this.state.poll_interval_ms)
  }

  private async tick(): Promise<void> {
    // 1. Reconcile running issues
    await this.reconcileRunningIssues()

    // 2. Validate config before dispatch
    const validationErr = validateConfig(this.config)
    if (validationErr) {
      log.error(`config validation failed: ${validationErr.code} — skipping dispatch`)
      this.scheduleNextPoll()
      return
    }

    // 3. Fetch candidate issues — iterate over configured projects
    const allCandidates: Issue[] = []
    const allWatched: Issue[] = []
    let activeStates: string[] = []
    let terminalStates: string[] = []

    for (const project of this.config.projects) {
      const platform = this.config.platforms[project.platform]
      if (!platform) {
        log.warn(`unknown platform "${project.platform}" for project, skipping`)
        continue
      }

      const adapter = createTrackerAdapter(project, platform)
      if (isTrackerError(adapter)) {
        log.error(`tracker adapter error (project=${project.platform}): ${formatTrackerError(adapter)}`)
        continue
      }

      const watchedStates = getWatchedStates(project)
      const combinedResult = await adapter.fetchCandidateAndWatchedIssues(watchedStates)
      if (isTrackerError(combinedResult)) {
        log.error(`tracker fetch failed (project=${project.platform}, candidates + watched dispatch skipped): ${formatTrackerError(combinedResult)}`)
        continue
      }

      allCandidates.push(...combinedResult.candidates)
      allWatched.push(...combinedResult.watched)
      activeStates = [...activeStates, ...getActiveStates(project)]
      terminalStates = [...terminalStates, ...getTerminalStates(project)]
    }

    // Deduplicate states
    activeStates = [...new Set(activeStates)]
    terminalStates = [...new Set(terminalStates)]

    // 3c. Process watched issues (dispatch agents for review activity)
    this.dispatchWatchedIssues(allWatched)

    // 4. Sort by dispatch priority
    const sorted = sortForDispatch(allCandidates)

    // 5. Dispatch eligible issues
    for (const issue of sorted) {
      if (this.availableSlots() === 0)
        break
      if (this.shouldDispatch(issue, activeStates, terminalStates)) {
        this.dispatchIssue(issue, null)
      }
    }

    // 6. Schedule next tick
    this.scheduleNextPoll()
  }

  private availableSlots(): number {
    return Math.max(this.config.agent.max_concurrent_agents - this.state.running.size, 0)
  }

  private shouldDispatch(issue: Issue, activeStates: string[], terminalStates: string[]): boolean {
    if (!issue.id || !issue.identifier || !issue.title || !issue.state)
      return false

    const normalizedState = normalizeState(issue.state)
    const isActive = activeStates.some(s => normalizeState(s) === normalizedState)
    const isTerminal = terminalStates.some(s => normalizeState(s) === normalizedState)

    if (!isActive || isTerminal)
      return false
    if (this.state.running.has(issue.id))
      return false
    if (this.state.claimed.has(issue.id))
      return false

    // Check per-state concurrency
    const stateLimit = maxConcurrentForState(this.config, issue.state)
    const runningInState = countRunningInState(this.state.running, issue.state)
    if (runningInState >= stateLimit)
      return false

    // Blocker rule: don't dispatch Todo issues with non-terminal blockers
    if (normalizedState === 'todo' && hasNonTerminalBlockers(issue, terminalStates))
      return false

    return true
  }

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    this.state.claimed.add(issue.id)
    this.state.retry_attempts.delete(issue.id)

    const entry: RunningEntry = {
      identifier: issue.identifier,
      issue,
      session_id: null,
      agent_app_server_pid: null,
      last_agent_message: null,
      last_agent_event: null,
      last_agent_timestamp: null,
      agent_input_tokens: 0,
      agent_output_tokens: 0,
      agent_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
      retry_attempt: attempt,
      started_at: new Date(),
      dispatch_lock: null,
      dispatch_lock_timer: null,
    }
    this.state.running.set(issue.id, entry)

    log.info(`dispatching issue_id=${issue.id} issue_identifier=${issue.identifier} attempt=${attempt ?? 'first'}`)

    this.labelService?.setLabel(issue, 'dispatched').catch((err) => {
      log.warn(`label service error issue_id=${issue.id}: ${err}`)
    })

    // Run in background
    this.runWorker(issue, attempt).catch((err) => {
      log.error(`worker uncaught error issue_id=${issue.id}: ${err}`)
    })
  }

  private async runWorker(issue: Issue, attempt: number | null): Promise<void> {
    const startedAt = new Date()

    // Acquire dispatch lock (if adapter configured)
    if (this.dispatchLockAdapter) {
      const lockKey = toDispatchLockKey(issue)
      let lock: Awaited<ReturnType<DispatchLockAdapter['acquireLock']>>
      try {
        lock = await this.dispatchLockAdapter.acquireLock(lockKey, DISPATCH_LOCK_TTL_MS)
      }
      catch (err) {
        log.error(`dispatch lock acquire threw issue_id=${issue.id}: ${err}`)
        this.state.running.delete(issue.id)
        this.state.claimed.delete(issue.id)
        return
      }
      if (!lock) {
        log.info(`dispatch lock held for ${lockKey} — skipping issue_id=${issue.id}`)
        this.state.running.delete(issue.id)
        this.state.claimed.delete(issue.id)
        return
      }
      const entry = this.state.running.get(issue.id)
      if (!entry) {
        log.warn(`dispatch lock acquired but entry already removed — releasing lock issue_id=${issue.id}`)
        this.dispatchLockAdapter.releaseLock(lock).catch((err) => {
          log.warn(`dispatch lock release (orphaned) failed issue_id=${issue.id}: ${err}`)
        })
        return
      }
      entry.dispatch_lock = lock
      entry.dispatch_lock_timer = setInterval(() => {
        this.dispatchLockAdapter!.extendLock(lock!, DISPATCH_LOCK_TTL_MS).catch((err) => {
          log.warn(`dispatch lock extend failed issue_id=${issue.id}: ${err}`)
        })
      }, DISPATCH_LOCK_EXTEND_INTERVAL_MS)
    }

    try {
      await this.executeAgentRun(issue, attempt)
    }
    catch (err) {
      log.error(`worker failed issue_id=${issue.id}: ${err}`)
      this.onWorkerExit(issue.id, startedAt, 'failed', String(err))
      return
    }

    this.onWorkerExit(issue.id, startedAt, 'normal', null)
  }

  private async executeAgentRun(issue: Issue, attempt: number | null): Promise<void> {
    // Create/reuse workspace
    const wsResult = await createWorkspace(this.config, issue.identifier, issue)
    if (wsResult instanceof Error) {
      throw wsResult
    }
    log.debug(`workspace ready issue_id=${issue.id} path=${wsResult.path} created_now=${wsResult.created_now}`)

    // Before-run hook
    const beforeRunErr = await runBeforeRunHook(this.config, wsResult.path, issue)
    if (beforeRunErr) {
      log.warn(`before_run hook failed issue_id=${issue.id}: ${beforeRunErr}`)
      await runAfterRunHook(this.config, wsResult.path, issue)
      throw beforeRunErr
    }

    // Resolve agent environment variables (including runtime tokens)
    const client = new AppServerClient(this.config, wsResult.path)
    const agentEnv = await resolveAgentEnv(this.config, this.buildTokenProvider())
    client.setAgentEnv(agentEnv)

    // Start agent session
    const session = await client.startSession()
    if (session instanceof Error) {
      await runAfterRunHook(this.config, wsResult.path, issue)
      throw session
    }

    try {
      // Resolve project status field metadata for prompt context
      await this.populateProjectContext(issue)
      await this.runAgentTurns(client, session, issue, attempt)
    }
    finally {
      client.stopSession()
      await runAfterRunHook(this.config, wsResult.path, issue)
    }
  }

  private async populateProjectContext(issue: Issue): Promise<void> {
    if (!issue.project)
      return
    try {
      const project = this.config.projects[0]
      if (!project) {
        log.warn(`no projects configured — cannot populate project context for issue_id=${issue.id}`)
        return
      }
      const platform = this.config.platforms[project.platform]
      if (!platform) {
        log.warn(`platform "${project.platform}" not found — cannot populate project context for issue_id=${issue.id}`)
        return
      }
      const adapter = createTrackerAdapter(project, platform)
      if (isTrackerError(adapter) || !adapter.resolveStatusField) {
        log.warn(`cannot resolve project context issue_id=${issue.id}: tracker does not support resolveStatusField`)
        return
      }
      const fieldInfo = await adapter.resolveStatusField()
      if (fieldInfo) {
        issue.project.project_id = fieldInfo.project_id
        issue.project.field_id = fieldInfo.field_id
        issue.project.status_options = fieldInfo.options
      }
    }
    catch (err) {
      log.warn(`failed to populate project context issue_id=${issue.id}: ${err}`)
    }
  }

  private async runAgentTurns(
    client: AppServerClient,
    session: import('./agent-runner').AgentSession,
    issue: Issue,
    attempt: number | null,
  ): Promise<void> {
    const maxTurns = this.config.agent.max_turns
    let currentIssue = issue
    let turnNumber = 1

    while (true) {
      // Build prompt
      const promptResult = turnNumber === 1
        ? await buildPrompt(this.workflow, currentIssue, attempt)
        : buildContinuationPrompt(turnNumber, maxTurns)

      if (isPromptBuildError(promptResult)) {
        throw new Error(`prompt_error: ${promptResult.code}`)
      }
      log.debug(`prompt built issue_id=${currentIssue.id} turn=${turnNumber} length=${promptResult.length}`)

      // Run turn
      const running = this.state.running.get(currentIssue.id)
      if (running)
        running.turn_count = turnNumber

      const turnResult = await client.runTurn(session, promptResult, currentIssue, (msg) => {
        this.handleAgentMessage(currentIssue.id, msg)
      })

      if (turnResult instanceof Error) {
        throw turnResult
      }

      log.info(`turn completed issue_id=${currentIssue.id} session_id=${turnResult.session_id} turn=${turnNumber}/${maxTurns}`)

      // Refresh issue state after turn
      const firstProject = this.config.projects[0]
      const firstPlatform = firstProject ? this.config.platforms[firstProject.platform] : undefined
      if (!firstProject || !firstPlatform) {
        log.warn(`no project/platform configured — cannot refresh issue state after turn issue_id=${currentIssue.id}`)
        break
      }
      const adapter = createTrackerAdapter(firstProject, firstPlatform)
      if (isTrackerError(adapter))
        break

      const refreshed = await adapter.fetchIssueStatesByIds([currentIssue.id])
      if (isTrackerError(refreshed) || refreshed.length === 0) {
        throw new Error('issue_state_refresh_failed')
      }

      const refreshedIssue = refreshed[0]
      const activeStates = getActiveStates(firstProject)
      const isActive = activeStates.some(s => normalizeState(s) === normalizeState(refreshedIssue.state))

      if (!isActive)
        break
      if (turnNumber >= maxTurns) {
        log.warn(`max_turns reached issue_id=${currentIssue.id}`)
        break
      }

      currentIssue = refreshedIssue
      turnNumber++
    }
  }

  private handleAgentMessage(issueId: string, msg: import('./types').AgentMessage): void {
    const running = this.state.running.get(issueId)
    if (!running)
      return

    running.last_agent_event = msg.event
    running.last_agent_timestamp = msg.timestamp
    if (msg.agent_app_server_pid)
      running.agent_app_server_pid = msg.agent_app_server_pid
    if (msg.session_id)
      running.session_id = msg.session_id
    if (msg.payload) {
      running.last_agent_message = String(msg.event)
    }

    // Track latest rate limit payload
    if (msg.rate_limits) {
      this.state.agent_rate_limits = msg.rate_limits
    }

    // Update token counts
    if (msg.usage) {
      const { input_tokens = 0, output_tokens = 0, total_tokens = 0 } = msg.usage

      // Use absolute totals (delta tracking)
      if (total_tokens > running.last_reported_total_tokens) {
        const inputDelta = input_tokens - running.last_reported_input_tokens
        const outputDelta = output_tokens - running.last_reported_output_tokens
        const totalDelta = total_tokens - running.last_reported_total_tokens

        running.agent_input_tokens += inputDelta
        running.agent_output_tokens += outputDelta
        running.agent_total_tokens += totalDelta
        running.last_reported_input_tokens = input_tokens
        running.last_reported_output_tokens = output_tokens
        running.last_reported_total_tokens = total_tokens
      }
    }
  }

  private onWorkerExit(issueId: string, _startedAt: Date, reason: 'normal' | 'failed', error: string | null): void {
    const running = this.state.running.get(issueId)
    if (!running)
      return

    // Release dispatch lock
    this.releaseDispatchLock(running)

    this.state.running.delete(issueId)

    // Add runtime seconds to totals
    const secondsRunning = (Date.now() - running.started_at.getTime()) / 1000
    this.state.agent_totals.seconds_running += secondsRunning
    this.state.agent_totals.input_tokens += running.agent_input_tokens
    this.state.agent_totals.output_tokens += running.agent_output_tokens
    this.state.agent_totals.total_tokens += running.agent_total_tokens

    // Record agent run to DB (tracked for graceful shutdown flush)
    const finishedAt = new Date()
    const insertPromise = insertRun(this.db, {
      issue_id: issueId,
      identifier: running.identifier,
      issue_state: running.issue.state,
      session_id: running.session_id,
      started_at: running.started_at,
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - running.started_at.getTime(),
      status: reason === 'normal' ? 'success' : 'failure',
      error,
      turn_count: running.turn_count,
      retry_attempt: running.retry_attempt,
      input_tokens: running.agent_input_tokens,
      output_tokens: running.agent_output_tokens,
      total_tokens: running.agent_total_tokens,
    })
    this.pendingDbWrites.push(insertPromise)
    void insertPromise.finally(() => {
      const idx = this.pendingDbWrites.indexOf(insertPromise)
      if (idx !== -1)
        this.pendingDbWrites.splice(idx, 1)
    })

    if (reason === 'normal') {
      this.labelService?.setLabel(running.issue, 'done').catch((err) => {
        log.warn(`label service error issue_id=${issueId}: ${err}`)
      })
      this.state.completed.add(issueId)

      // Record watched state snapshot only on success to allow retry on failure.
      // Uses dispatch-time PR timestamp (stale but correct): if a review happened
      // during the agent run, its updated_at > stale timestamp → re-dispatch.
      this.state.watched_last_dispatched.set(issueId, {
        pr_update_ms: getLinkedPrUpdateMs(running.issue),
        review_decision: running.issue.review_decision,
      })

      this.scheduleRetry(issueId, running.identifier, 1, null, 'continuation')
    }
    else {
      this.labelService?.setLabel(running.issue, 'failed').catch((err) => {
        log.warn(`label service error issue_id=${issueId}: ${err}`)
      })
      const nextAttempt = nextAttemptFrom(running.retry_attempt)
      this.scheduleRetry(issueId, running.identifier, nextAttempt, error, 'failure')
    }
  }

  private scheduleRetry(
    issueId: string,
    identifier: string,
    attempt: number,
    error: string | null,
    type: 'continuation' | 'failure',
  ): void {
    // Cancel existing retry timer
    const existing = this.state.retry_attempts.get(issueId)
    if (existing?.timer_handle)
      clearTimeout(existing.timer_handle)

    const delayMs = type === 'continuation'
      ? CONTINUATION_RETRY_DELAY_MS
      : retryBackoffMs(attempt, this.config.agent.max_retry_backoff_ms)

    const dueAt = Date.now() + delayMs
    const timer = setTimeout(() => this.onRetryTimer(issueId), delayMs)

    const entry: RetryEntry = {
      issue_id: issueId,
      identifier,
      attempt,
      due_at_ms: dueAt,
      timer_handle: timer,
      error,
    }
    this.state.retry_attempts.set(issueId, entry)

    log.info(`retry scheduled issue_id=${issueId} attempt=${attempt} delay_ms=${delayMs} error=${error ?? 'none'}`)
  }

  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId)
    if (!retryEntry)
      return
    this.state.retry_attempts.delete(issueId)

    // Fetch active candidates
    const firstProject = this.config.projects[0]
    const firstPlatform = firstProject ? this.config.platforms[firstProject.platform] : undefined
    if (!firstProject || !firstPlatform) {
      log.warn(`no project/platform configured — cannot retry issue_id=${issueId}`)
      this.state.claimed.delete(issueId)
      return
    }
    const adapter = createTrackerAdapter(firstProject, firstPlatform)
    if (isTrackerError(adapter)) {
      this.state.claimed.delete(issueId)
      return
    }

    const candidatesResult = await adapter.fetchCandidateIssues()
    if (isTrackerError(candidatesResult)) {
      // requeue
      this.scheduleRetry(issueId, retryEntry.identifier, retryEntry.attempt + 1, 'retry poll failed', 'failure')
      return
    }

    const issue = candidatesResult.find(i => i.id === issueId)
    if (!issue) {
      this.state.claimed.delete(issueId)
      log.info(`releasing claim (issue not found in active candidates) issue_id=${issueId}`)
      return
    }

    // Dispatch revalidation: re-check blocker eligibility with fresh candidate data
    const terminalStates = getTerminalStates(firstProject)
    if (normalizeState(issue.state) === 'todo' && hasNonTerminalBlockers(issue, terminalStates)) {
      this.state.claimed.delete(issueId)
      log.info(`dispatch revalidation: skipping blocked issue issue_id=${issueId}`)
      return
    }

    if (this.availableSlots() === 0) {
      this.scheduleRetry(issueId, issue.identifier, retryEntry.attempt + 1, 'no available orchestrator slots', 'failure')
      return
    }

    this.state.claimed.add(issueId)
    this.dispatchIssue(issue, retryEntry.attempt)
  }

  private async reconcileRunningIssues(): Promise<void> {
    // Part A: stall detection
    const stallTimeoutMs = this.config.claude.stall_timeout_ms
    if (stallTimeoutMs > 0) {
      const now = Date.now()
      for (const [issueId, entry] of this.state.running) {
        const lastActivity = entry.last_agent_timestamp ?? entry.started_at
        const elapsed = now - lastActivity.getTime()
        if (elapsed > stallTimeoutMs) {
          log.warn(`stall detected issue_id=${issueId} elapsed_ms=${elapsed}`)
          this.terminateRunningIssue(issueId, false)
          this.scheduleRetry(issueId, entry.identifier, nextAttemptFrom(entry.retry_attempt), 'stall timeout', 'failure')
        }
      }
    }

    // Part B: tracker state refresh
    const runningIds = [...this.state.running.keys()]
    if (runningIds.length === 0)
      return

    const firstProject = this.config.projects[0]
    const firstPlatform = firstProject ? this.config.platforms[firstProject.platform] : undefined
    if (!firstProject || !firstPlatform) {
      log.warn('no project/platform configured — cannot refresh running issue states')
      return
    }

    const adapter = createTrackerAdapter(firstProject, firstPlatform)
    if (isTrackerError(adapter))
      return

    const refreshed = await adapter.fetchIssueStatesByIds(runningIds)
    if (isTrackerError(refreshed)) {
      log.warn(`state refresh failed: ${formatTrackerError(refreshed)} — keeping workers running`)
      return
    }

    const activeStates = getActiveStates(firstProject)
    const watchedStates = getWatchedStates(firstProject)
    const terminalStates = getTerminalStates(firstProject)

    for (const issue of refreshed) {
      const normalizedState = normalizeState(issue.state)
      const isTerminal = terminalStates.some(s => normalizeState(s) === normalizedState)
      const isActive = activeStates.some(s => normalizeState(s) === normalizedState)
        || watchedStates.some(s => normalizeState(s) === normalizedState)

      if (isTerminal) {
        log.info(`issue terminal, stopping worker issue_id=${issue.id} state=${issue.state}`)
        const runningEntry = this.state.running.get(issue.id)
        if (runningEntry) {
          this.labelService?.setLabel(runningEntry.issue, 'done').catch((err) => {
            log.warn(`label service error issue_id=${issue.id}: ${err}`)
          })
        }
        this.terminateRunningIssue(issue.id, true)
      }
      else if (isActive) {
        const entry = this.state.running.get(issue.id)
        if (entry)
          entry.issue = issue
      }
      else {
        log.info(`issue non-active, stopping worker issue_id=${issue.id} state=${issue.state}`)
        this.terminateRunningIssue(issue.id, false)
      }
    }
  }

  private terminateRunningIssue(issueId: string, cleanupWorkspace: boolean): void {
    const entry = this.state.running.get(issueId)
    if (!entry)
      return

    // Release dispatch lock
    this.releaseDispatchLock(entry)

    this.state.running.delete(issueId)
    this.state.claimed.delete(issueId)

    // Record terminated run to DB (tracked for graceful shutdown flush)
    const finishedAt = new Date()
    const insertPromise = insertRun(this.db, {
      issue_id: issueId,
      identifier: entry.identifier,
      issue_state: entry.issue.state,
      session_id: entry.session_id,
      started_at: entry.started_at,
      finished_at: finishedAt,
      duration_ms: finishedAt.getTime() - entry.started_at.getTime(),
      status: 'terminated',
      error: null,
      turn_count: entry.turn_count,
      retry_attempt: entry.retry_attempt,
      input_tokens: entry.agent_input_tokens,
      output_tokens: entry.agent_output_tokens,
      total_tokens: entry.agent_total_tokens,
    })
    this.pendingDbWrites.push(insertPromise)
    void insertPromise.finally(() => {
      const idx = this.pendingDbWrites.indexOf(insertPromise)
      if (idx !== -1)
        this.pendingDbWrites.splice(idx, 1)
    })

    if (cleanupWorkspace) {
      removeWorkspace(this.config, entry.identifier, entry.issue).catch((err) => {
        log.error(`workspace cleanup failed issue_id=${issueId}: ${err}`)
      })
    }
  }

  private releaseDispatchLock(entry: RunningEntry): void {
    if (entry.dispatch_lock_timer) {
      clearInterval(entry.dispatch_lock_timer)
      entry.dispatch_lock_timer = null
    }
    if (entry.dispatch_lock && this.dispatchLockAdapter) {
      this.dispatchLockAdapter.releaseLock(entry.dispatch_lock).catch((err) => {
        log.warn(`dispatch lock release failed: ${err}`)
      })
      entry.dispatch_lock = null
    }
  }

  private dispatchWatchedIssues(watchedIssues: Issue[]): void {
    if (watchedIssues.length === 0)
      return

    for (const issue of sortForDispatch(watchedIssues)) {
      if (this.state.running.has(issue.id) || this.state.claimed.has(issue.id))
        continue

      // Only dispatch if there's a review decision (approved, changes_requested, etc.)
      if (!issue.review_decision)
        continue

      // Skip if nothing has changed since last dispatch
      if (isWatchedUnchanged(issue, this.state.watched_last_dispatched.get(issue.id)))
        continue

      if (this.availableSlots() === 0)
        break

      // Respect per-state concurrency limits
      const stateLimit = maxConcurrentForState(this.config, issue.state)
      const runningInState = countRunningInState(this.state.running, issue.state)
      if (runningInState >= stateLimit)
        continue

      try {
        log.info(`dispatching watched issue: ${issue.identifier} state=${issue.state} review=${issue.review_decision}`)
        this.dispatchIssue(issue, null)
      }
      catch (err) {
        log.error(`dispatchWatchedIssues failed for ${issue.identifier}:`, err)
      }
    }
  }

  private async startupTerminalWorkspaceCleanup(): Promise<void> {
    const firstProject = this.config.projects[0]
    if (!firstProject) {
      log.warn('no projects configured — skipping startup terminal workspace cleanup')
      return
    }
    const firstPlatform = this.config.platforms[firstProject.platform]
    if (!firstPlatform) {
      log.warn(`platform "${firstProject.platform}" not found — skipping startup terminal workspace cleanup`)
      return
    }

    const terminalStates = getTerminalStates(firstProject)

    const adapter = createTrackerAdapter(firstProject, firstPlatform)
    if (isTrackerError(adapter)) {
      log.warn(`startup cleanup: adapter error ${formatTrackerError(adapter)}`)
      return
    }

    const result = await adapter.fetchIssuesByStates(terminalStates)
    if (isTrackerError(result)) {
      log.warn(`startup terminal cleanup failed: ${formatTrackerError(result)}`)
      return
    }

    for (const issue of result) {
      await removeWorkspace(this.config, issue.identifier, issue).catch((err) => {
        log.error(`startup cleanup workspace removal failed: ${err}`)
      })
    }
    log.info(`startup cleanup: removed ${result.length} terminal workspaces`)
  }

  private startFileWatcher(): void {
    try {
      this.fileWatcher = watch(this.workflowPath, () => {
        this.reloadWorkflow()
      })
    }
    catch (err) {
      log.warn(`could not watch workflow file: ${err}`)
    }
  }

  private buildTokenProvider(): import('./agent-env').TokenProvider | undefined {
    const firstProject = this.config.projects[0]
    if (!firstProject)
      return undefined
    const platform = this.config.platforms[firstProject.platform]
    if (!platform || platform.kind !== 'github')
      return undefined
    return buildTokenProvider(firstProject, platform)
  }

  private reloadWorkflow(): void {
    const wf = loadWorkflow(this.workflowPath)
    if (isWorkflowError(wf)) {
      log.error(`workflow reload failed: ${wf.code} — keeping last known good config`)
      return
    }

    const newConfig = buildConfig(wf)
    const validationErr = validateConfig(newConfig)
    if (validationErr) {
      log.error(`reloaded config invalid: ${validationErr.code} — keeping last known good config`)
      return
    }

    this.workflow = wf
    this.config = newConfig
    this.labelService = createLabelService(newConfig)
    this.state.poll_interval_ms = newConfig.polling.interval_ms
    this.state.max_concurrent_agents = newConfig.agent.max_concurrent_agents

    log.success('workflow reloaded successfully')
  }
}

// --- helpers ---

function sortForDispatch(issues: Issue[]): Issue[] {
  return issues.toSorted((a, b) => {
    // Priority ascending (null sorts last)
    const pa = a.priority ?? 999
    const pb = b.priority ?? 999
    if (pa !== pb)
      return pa - pb

    // created_at oldest first
    const ca = a.created_at?.getTime() ?? 0
    const cb = b.created_at?.getTime() ?? 0
    if (ca !== cb)
      return ca - cb

    // identifier lexicographic
    return (a.identifier ?? '').localeCompare(b.identifier ?? '')
  })
}

function countRunningInState(running: Map<string, RunningEntry>, state: string): number {
  let count = 0
  const normalized = normalizeState(state)
  for (const entry of running.values()) {
    if (normalizeState(entry.issue.state) === normalized)
      count++
  }
  return count
}

export function getLinkedPrUpdateMs(issue: Issue): number | null {
  const prTimes = issue.pull_requests
    .map(pr => pr.updated_at?.getTime())
    .filter((ms): ms is number => ms != null && !Number.isNaN(ms))

  return prTimes.length > 0 ? Math.max(...prTimes) : null
}

export function isWatchedUnchanged(issue: Issue, snapshot: import('./types').WatchedSnapshot | undefined): boolean {
  if (!snapshot)
    return false

  const currentPrMs = getLinkedPrUpdateMs(issue)
  const hadPrs = snapshot.pr_update_ms != null
  const hasPrs = currentPrMs != null

  // PR presence changed (gained or lost linked PRs) — treat as changed
  if (hadPrs !== hasPrs)
    return false

  // For items with linked PRs: compare PR update timestamps
  if (hasPrs)
    return currentPrMs <= snapshot.pr_update_ms!

  // For PR-type project items (no linked PRs): compare review_decision
  return issue.review_decision === snapshot.review_decision
}

function hasNonTerminalBlockers(issue: Issue, terminalStates: string[]): boolean {
  return issue.blocked_by.some((blocker) => {
    if (!blocker.state)
      return false
    const norm = normalizeState(blocker.state)
    return !terminalStates.some(ts => normalizeState(ts) === norm)
  })
}

function retryBackoffMs(attempt: number, maxMs: number): number {
  const delay = FAILURE_RETRY_BASE_MS * (2 ** (attempt - 1))
  return Math.min(delay, maxMs)
}

function nextAttemptFrom(currentAttempt: number | null): number {
  return currentAttempt === null ? 1 : currentAttempt + 1
}

export function buildTokenProvider(project: ProjectConfig, platform: GitHubPlatformConfig): import('./agent-env').TokenProvider | undefined {
  if (platform.kind !== 'github')
    return undefined

  const { api_key, app_id, private_key, installation_id } = platform

  // PAT auth: provide the api_key directly as the token
  if (api_key) {
    return {
      installationAccessToken: async () => api_key,
    }
  }

  // App auth: requires all three fields
  if (!app_id || !private_key || installation_id == null)
    return undefined

  return {
    installationAccessToken: async () => {
      try {
        const { createAppAuth } = await import('@octokit/auth-app')
        const auth = createAppAuth({
          appId: app_id,
          privateKey: private_key,
          installationId: installation_id,
        })
        const { token } = await auth({ type: 'installation' })
        return token
      }
      catch (err) {
        log.error(`failed to generate installation access token: ${err}`)
        return null
      }
    },
  }
}
