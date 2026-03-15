import type { LabelService } from './label'
import type { TrackerAdapter } from './tracker/types'
import type { Issue, OrchestratorState, RetryEntry, RunningEntry, ServiceConfig, WorkflowDefinition } from './types'
import { watch } from 'node:fs'
import { resolveAgentEnv } from './agent-env'
import { AppServerClient } from './agent-runner'
import { buildConfig, getActiveStates, getTerminalStates, getWatchedStates, maxConcurrentForState, normalizeState, validateConfig } from './config'
import { createLabelService } from './label'
import { buildContinuationPrompt, buildPrompt, isPromptBuildError } from './prompt-builder'
import { createTrackerAdapter, formatTrackerError, isTrackerError } from './tracker/index'
import { isWorkflowError, loadWorkflow } from './workflow'
import { createWorkspace, removeWorkspace, runAfterRunHook, runBeforeRunHook } from './workspace'

const CONTINUATION_RETRY_DELAY_MS = 1_000
const FAILURE_RETRY_BASE_MS = 10_000

export class Orchestrator {
  private state: OrchestratorState
  private config: ServiceConfig
  private workflow: WorkflowDefinition
  private workflowPath: string
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private fileWatcher: ReturnType<typeof watch> | null = null
  private labelService: LabelService | null = null

  constructor(workflowPath: string) {
    this.workflowPath = workflowPath

    const wf = loadWorkflow(workflowPath)
    if (isWorkflowError(wf)) {
      throw new Error(`Failed to load workflow: ${wf.code}`)
    }
    this.workflow = wf
    this.config = buildConfig(wf)
    this.labelService = createLabelService(this.config)

    this.state = {
      poll_interval_ms: this.config.polling.interval_ms,
      max_concurrent_agents: this.config.agent.max_concurrent_agents,
      running: new Map(),
      claimed: new Set(),
      retry_attempts: new Map(),
      completed: new Set(),
      watched_last_dispatched_at: new Map(),
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

    // Startup terminal workspace cleanup
    await this.startupTerminalWorkspaceCleanup()

    // Watch workflow file for changes
    this.startFileWatcher()

    // Schedule immediate first tick
    this.scheduleTick(0)
  }

  stop(): void {
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
  }

  getState(): OrchestratorState {
    return this.state
  }

  getConfig(): ServiceConfig {
    return this.config
  }

  triggerRefresh(): void {
    this.scheduleTick(0)
  }

  private scheduleTick(delayMs: number): void {
    if (this.pollTimer)
      clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => this.tick(), delayMs)
  }

  private async tick(): Promise<void> {
    // 1. Reconcile running issues
    await this.reconcileRunningIssues()

    // 2. Validate config before dispatch
    const validationErr = validateConfig(this.config)
    if (validationErr) {
      console.error(`[orchestrator] config validation failed: ${validationErr.code} — skipping dispatch`)
      this.scheduleTick(this.state.poll_interval_ms)
      return
    }

    // 3. Fetch candidate issues
    const adapter = createTrackerAdapter(this.config)
    if (isTrackerError(adapter)) {
      console.error(`[orchestrator] tracker adapter error: ${formatTrackerError(adapter)}`)
      this.scheduleTick(this.state.poll_interval_ms)
      return
    }

    // 3b. Process watched states (dispatch agents for review activity)
    try {
      await this.processWatchedStates(adapter)
    }
    catch (err) {
      console.error('[orchestrator] processWatchedStates error:', err)
    }

    const candidatesResult = await adapter.fetchCandidateIssues()
    if (isTrackerError(candidatesResult)) {
      console.error(`[orchestrator] tracker fetch failed: ${formatTrackerError(candidatesResult)}`)
      this.scheduleTick(this.state.poll_interval_ms)
      return
    }

    // 4. Sort by dispatch priority
    const sorted = sortForDispatch(candidatesResult)

    // 5. Dispatch eligible issues
    const activeStates = getActiveStates(this.config)
    const terminalStates = getTerminalStates(this.config)

    for (const issue of sorted) {
      if (this.availableSlots() === 0)
        break
      if (this.shouldDispatch(issue, activeStates, terminalStates)) {
        this.dispatchIssue(issue, null)
      }
    }

    // 6. Schedule next tick
    this.scheduleTick(this.state.poll_interval_ms)
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
    }
    this.state.running.set(issue.id, entry)

    console.warn(`[orchestrator] dispatching issue_id=${issue.id} issue_identifier=${issue.identifier} attempt=${attempt ?? 'first'}`)

    this.labelService?.setLabel(issue, 'dispatched').catch((err) => {
      console.warn(`[orchestrator] label service error issue_id=${issue.id}: ${err}`)
    })

    // Run in background
    this.runWorker(issue, attempt).catch((err) => {
      console.error(`[orchestrator] worker uncaught error issue_id=${issue.id}: ${err}`)
    })
  }

  private async runWorker(issue: Issue, attempt: number | null): Promise<void> {
    const startedAt = new Date()

    try {
      await this.executeAgentRun(issue, attempt)
    }
    catch (err) {
      console.error(`[orchestrator] worker failed issue_id=${issue.id}: ${err}`)
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

    // Before-run hook
    const beforeRunErr = await runBeforeRunHook(this.config, wsResult.path, issue)
    if (beforeRunErr) {
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
      const adapter = createTrackerAdapter(this.config)
      if (isTrackerError(adapter) || !adapter.resolveStatusField) {
        console.warn(`[orchestrator] cannot resolve project context issue_id=${issue.id}: tracker does not support resolveStatusField`)
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
      console.warn(`[orchestrator] failed to populate project context issue_id=${issue.id}: ${err}`)
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

      console.warn(`[orchestrator] turn completed issue_id=${currentIssue.id} session_id=${turnResult.session_id} turn=${turnNumber}/${maxTurns}`)

      // Refresh issue state after turn
      const adapter = createTrackerAdapter(this.config)
      if (isTrackerError(adapter))
        break

      const refreshed = await adapter.fetchIssueStatesByIds([currentIssue.id])
      if (isTrackerError(refreshed) || refreshed.length === 0) {
        throw new Error('issue_state_refresh_failed')
      }

      const refreshedIssue = refreshed[0]
      const activeStates = getActiveStates(this.config)
      const isActive = activeStates.some(s => normalizeState(s) === normalizeState(refreshedIssue.state))

      if (!isActive)
        break
      if (turnNumber >= maxTurns) {
        console.warn(`[orchestrator] max_turns reached issue_id=${currentIssue.id}`)
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

  private onWorkerExit(issueId: string, startedAt: Date, reason: 'normal' | 'failed', error: string | null): void {
    const running = this.state.running.get(issueId)
    if (!running)
      return

    this.state.running.delete(issueId)

    // Add runtime seconds to totals
    const secondsRunning = (Date.now() - startedAt.getTime()) / 1000
    this.state.agent_totals.seconds_running += secondsRunning
    this.state.agent_totals.input_tokens += running.agent_input_tokens
    this.state.agent_totals.output_tokens += running.agent_output_tokens
    this.state.agent_totals.total_tokens += running.agent_total_tokens

    if (reason === 'normal') {
      this.labelService?.setLabel(running.issue, 'done').catch((err) => {
        console.warn(`[orchestrator] label service error issue_id=${issueId}: ${err}`)
      })
      this.state.completed.add(issueId)

      // Record watched state timestamp only on success to allow retry on failure
      const updateMs = getWatchedUpdateMs(running.issue)
      if (updateMs != null)
        this.state.watched_last_dispatched_at.set(issueId, updateMs)

      this.scheduleRetry(issueId, running.identifier, 1, null, 'continuation')
    }
    else {
      this.labelService?.setLabel(running.issue, 'failed').catch((err) => {
        console.warn(`[orchestrator] label service error issue_id=${issueId}: ${err}`)
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

    console.warn(`[orchestrator] retry scheduled issue_id=${issueId} attempt=${attempt} delay_ms=${delayMs} error=${error ?? 'none'}`)
  }

  private async onRetryTimer(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId)
    if (!retryEntry)
      return
    this.state.retry_attempts.delete(issueId)

    // Fetch active candidates
    const adapter = createTrackerAdapter(this.config)
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
      console.warn(`[orchestrator] releasing claim (issue not found in active candidates) issue_id=${issueId}`)
      return
    }

    // Dispatch revalidation: re-check blocker eligibility with fresh candidate data
    const terminalStates = getTerminalStates(this.config)
    if (normalizeState(issue.state) === 'todo' && hasNonTerminalBlockers(issue, terminalStates)) {
      this.state.claimed.delete(issueId)
      console.warn(`[orchestrator] dispatch revalidation: skipping blocked issue issue_id=${issueId}`)
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
          console.warn(`[orchestrator] stall detected issue_id=${issueId} elapsed_ms=${elapsed}`)
          this.terminateRunningIssue(issueId, false)
          this.scheduleRetry(issueId, entry.identifier, nextAttemptFrom(entry.retry_attempt), 'stall timeout', 'failure')
        }
      }
    }

    // Part B: tracker state refresh
    const runningIds = [...this.state.running.keys()]
    if (runningIds.length === 0)
      return

    const adapter = createTrackerAdapter(this.config)
    if (isTrackerError(adapter))
      return

    const refreshed = await adapter.fetchIssueStatesByIds(runningIds)
    if (isTrackerError(refreshed)) {
      console.warn(`[orchestrator] state refresh failed: ${formatTrackerError(refreshed)} — keeping workers running`)
      return
    }

    const activeStates = getActiveStates(this.config)
    const watchedStates = getWatchedStates(this.config)
    const terminalStates = getTerminalStates(this.config)

    for (const issue of refreshed) {
      const normalizedState = normalizeState(issue.state)
      const isTerminal = terminalStates.some(s => normalizeState(s) === normalizedState)
      const isActive = activeStates.some(s => normalizeState(s) === normalizedState)
        || watchedStates.some(s => normalizeState(s) === normalizedState)

      if (isTerminal) {
        console.warn(`[orchestrator] issue terminal, stopping worker issue_id=${issue.id} state=${issue.state}`)
        const runningEntry = this.state.running.get(issue.id)
        if (runningEntry) {
          this.labelService?.setLabel(runningEntry.issue, 'done').catch((err) => {
            console.warn(`[orchestrator] label service error issue_id=${issue.id}: ${err}`)
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
        console.warn(`[orchestrator] issue non-active, stopping worker issue_id=${issue.id} state=${issue.state}`)
        this.terminateRunningIssue(issue.id, false)
      }
    }
  }

  private terminateRunningIssue(issueId: string, cleanupWorkspace: boolean): void {
    const entry = this.state.running.get(issueId)
    if (!entry)
      return

    this.state.running.delete(issueId)
    this.state.claimed.delete(issueId)

    if (cleanupWorkspace) {
      removeWorkspace(this.config, entry.identifier, entry.issue).catch((err) => {
        console.error(`[orchestrator] workspace cleanup failed issue_id=${issueId}: ${err}`)
      })
    }
  }

  private async processWatchedStates(adapter: TrackerAdapter): Promise<void> {
    const watchedStates = getWatchedStates(this.config)
    if (watchedStates.length === 0)
      return

    const result = await adapter.fetchIssuesByStates(watchedStates)
    if (isTrackerError(result)) {
      console.error(`[orchestrator] watched states fetch failed: ${formatTrackerError(result)}`)
      return
    }

    for (const issue of sortForDispatch(result)) {
      if (this.state.running.has(issue.id) || this.state.claimed.has(issue.id))
        continue

      // Only dispatch if there's a review decision (approved, changes_requested, etc.)
      if (!issue.review_decision)
        continue

      // Skip if issue has not been updated since last dispatch
      const lastDispatched = this.state.watched_last_dispatched_at.get(issue.id)
      if (lastDispatched != null) {
        const latestUpdate = getWatchedUpdateMs(issue)
        if (latestUpdate != null && latestUpdate <= lastDispatched)
          continue
      }

      if (this.availableSlots() === 0)
        break

      // Respect per-state concurrency limits
      const stateLimit = maxConcurrentForState(this.config, issue.state)
      const runningInState = countRunningInState(this.state.running, issue.state)
      if (runningInState >= stateLimit)
        continue

      console.warn(`[orchestrator] dispatching watched issue: ${issue.identifier} state=${issue.state} review=${issue.review_decision}`)
      this.dispatchIssue(issue, null)
    }
  }

  private async startupTerminalWorkspaceCleanup(): Promise<void> {
    const terminalStates = getTerminalStates(this.config)

    const adapter = createTrackerAdapter(this.config)
    if (isTrackerError(adapter)) {
      console.warn(`[orchestrator] startup cleanup: adapter error ${formatTrackerError(adapter)}`)
      return
    }

    const result = await adapter.fetchIssuesByStates(terminalStates)
    if (isTrackerError(result)) {
      console.warn(`[orchestrator] startup terminal cleanup failed: ${formatTrackerError(result)}`)
      return
    }

    for (const issue of result) {
      await removeWorkspace(this.config, issue.identifier, issue).catch((err) => {
        console.error(`[orchestrator] startup cleanup workspace removal failed: ${err}`)
      })
    }
    console.warn(`[orchestrator] startup cleanup: removed ${result.length} terminal workspaces`)
  }

  private startFileWatcher(): void {
    try {
      this.fileWatcher = watch(this.workflowPath, () => {
        this.reloadWorkflow()
      })
    }
    catch (err) {
      console.warn(`[orchestrator] could not watch workflow file: ${err}`)
    }
  }

  private buildTokenProvider(): import('./agent-env').TokenProvider | undefined {
    return buildTokenProvider(this.config.tracker)
  }

  private reloadWorkflow(): void {
    const wf = loadWorkflow(this.workflowPath)
    if (isWorkflowError(wf)) {
      console.error(`[orchestrator] workflow reload failed: ${wf.code} — keeping last known good config`)
      return
    }

    const newConfig = buildConfig(wf)
    const validationErr = validateConfig(newConfig)
    if (validationErr) {
      console.error(`[orchestrator] reloaded config invalid: ${validationErr.code} — keeping last known good config`)
      return
    }

    this.workflow = wf
    this.config = newConfig
    this.labelService = createLabelService(newConfig)
    this.state.poll_interval_ms = newConfig.polling.interval_ms
    this.state.max_concurrent_agents = newConfig.agent.max_concurrent_agents

    console.warn('[orchestrator] workflow reloaded successfully')
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

function getWatchedUpdateMs(issue: Issue): number | null {
  const prTimes = issue.pull_requests
    .map(pr => pr.updated_at?.getTime())
    .filter((ms): ms is number => ms != null)

  if (prTimes.length > 0)
    return Math.max(...prTimes)

  // Fallback to issue's own updated_at (for PR-type project items
  // where content is a PullRequest and pull_requests is empty)
  return issue.updated_at?.getTime() ?? null
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

export function buildTokenProvider(tracker: ServiceConfig['tracker']): import('./agent-env').TokenProvider | undefined {
  const { kind, api_key, app_id, private_key, installation_id } = tracker
  if (kind !== 'github_projects')
    return undefined

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
        console.error(`[orchestrator] failed to generate installation access token: ${err}`)
        return null
      }
    },
  }
}
