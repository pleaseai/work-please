import type { TokenProvider } from './agent-env'
import type { DispatchLock, DispatchLockAdapter } from './dispatch-lock'
import type { AuthorAssociation, Issue, ServiceConfig, WorkflowDefinition } from './types'
import { resolveAgentEnv } from './agent-env'
import { AppServerClient } from './agent-runner'
import { toDispatchLockKey } from './dispatch-lock'
import { createLogger } from './logger'
import { buildPrompt, isPromptBuildError } from './prompt-builder'
import { DEFAULT_ALLOWED_ASSOCIATIONS } from './types'
import { configureRemoteAuth, createWorkspace, removeRemoteAuth, runAfterRunHook, runBeforeRunHook } from './workspace'

const log = createLogger('issue-comment')

export interface IssueCommentPayload {
  action: string
  comment: {
    id: number
    body: string
    user: { login: string }
    author_association: string
    node_id: string
  }
  issue: {
    number: number
    title: string
    body: string | null
    labels: Array<{ name: string }>
    state: string
    assignees: Array<{ login: string }>
    pull_request?: unknown
  }
  repository: {
    owner: { login: string }
    name: string
    full_name: string
    clone_url: string
  }
}

export interface GitHubApi {
  addReaction: (owner: string, repo: string, commentId: number, reaction: string) => Promise<{ id: number }>
  removeReaction: (owner: string, repo: string, commentId: number, reactionId: number) => Promise<void>
  postComment: (owner: string, repo: string, issueNumber: number, body: string) => Promise<void>
}

export interface IssueCommentHandlerDeps {
  config: ServiceConfig
  workflow: WorkflowDefinition
  github: GitHubApi
  tokenProvider?: TokenProvider
  dispatchLockAdapter?: DispatchLockAdapter
}

/**
 * Detect @mention of botUsername in comment body.
 * Returns the prompt text (body with @mention stripped) or null if no mention.
 */
export function extractMentionPrompt(body: string, botUsername: string): string | null {
  // Match @botUsername with left boundary (not preceded by alphanumeric/hyphen/dot)
  // and right boundary (followed by end-of-string, whitespace, or punctuation — but not alphanumeric or hyphen)
  const pattern = new RegExp(`(?<![\\w.-])@${escapeRegex(botUsername)}(?=[\\s,.:;!?)\\]}>]|$)`, 'gi')
  if (!pattern.test(body))
    return null
  // Reset lastIndex after test() with global flag
  pattern.lastIndex = 0
  const stripped = body.replace(pattern, '').trim()
  return stripped || null
}

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g

function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL_CHARS, '\\$&')
}

/**
 * Check if the payload is a plain issue comment (not PR) with @mention of bot,
 * from an authorized author association.
 */
export function shouldHandleComment(
  payload: IssueCommentPayload,
  botUsername: string,
  allowedAssociations: AuthorAssociation[] = DEFAULT_ALLOWED_ASSOCIATIONS,
): boolean {
  if (payload.action !== 'created')
    return false
  if (payload.issue.pull_request)
    return false
  if (payload.comment.user.login.toLowerCase() === botUsername.toLowerCase())
    return false
  const association = payload.comment.author_association.toUpperCase() as AuthorAssociation
  if (!allowedAssociations.includes(association)) {
    log.info(`rejecting comment from ${payload.comment.user.login} (association: ${payload.comment.author_association}, allowed: ${allowedAssociations.join(', ')})`)
    return false
  }
  return extractMentionPrompt(payload.comment.body, botUsername) !== null
}

/**
 * Handle a plain issue comment @mention by dispatching an agent run.
 * This function runs asynchronously — call it without awaiting from the webhook handler.
 */
export async function handleIssueCommentMention(
  payload: IssueCommentPayload,
  deps: IssueCommentHandlerDeps,
): Promise<void> {
  const { config, workflow, github, tokenProvider, dispatchLockAdapter } = deps
  // Resolve bot_username from the first github platform (by kind, not key name)
  const githubPlatform = Object.values(config.platforms).find((platform): platform is import('./types').GitHubPlatformConfig => platform.kind === 'github')
  const botUsername = githubPlatform?.bot_username || 'agent-please'
  const { owner: { login: owner }, name: repo } = payload.repository
  const commentId = payload.comment.id
  const issueNumber = payload.issue.number

  const prompt = extractMentionPrompt(payload.comment.body, botUsername)
  if (!prompt) {
    log.warn(`no mention found in comment ${commentId} — skipping`)
    return
  }

  // Acquire dispatch lock (if adapter configured)
  let dispatchLock: DispatchLock | null = null
  let lockExtendTimer: ReturnType<typeof setInterval> | null = null
  if (dispatchLockAdapter) {
    const issue = payloadToIssue(payload)
    const lockKey = toDispatchLockKey(issue)
    try {
      dispatchLock = await dispatchLockAdapter.acquireLock(lockKey, 5 * 60 * 1000)
    }
    catch (err) {
      log.error(`dispatch lock acquire failed for ${lockKey}: ${err}`)
      return
    }
    if (!dispatchLock) {
      log.info(`dispatch lock held for ${lockKey} — skipping comment handler`)
      return
    }
    // Extend lock periodically for long-running agent sessions
    const lockRef = dispatchLock
    lockExtendTimer = setInterval(() => {
      dispatchLockAdapter!.extendLock(lockRef, 5 * 60 * 1000).catch((err) => {
        log.warn(`dispatch lock extend failed for ${lockKey}: ${err}`)
      })
    }, 2 * 60 * 1000)
  }

  log.info(`handling @mention in ${owner}/${repo}#${issueNumber} comment=${commentId}`)

  // 1. Add eyes reaction to acknowledge
  let eyesReactionId: number | null = null
  try {
    const reaction = await github.addReaction(owner, repo, commentId, 'eyes')
    eyesReactionId = reaction.id
  }
  catch (err) {
    log.error(`failed to add eyes reaction: ${err}`)
  }

  try {
    // 2. Build an Issue-like object from the webhook payload
    const issue = payloadToIssue(payload)

    // 3. Create/reuse workspace (with token for authenticated clone/fetch)
    const cloneToken = tokenProvider ? await tokenProvider.installationAccessToken() : null
    const wsResult = await createWorkspace(config, issue.identifier, issue, cloneToken)
    if (wsResult instanceof Error) {
      throw wsResult
    }

    // Configure authenticated remote URL on worktree for push operations
    if (cloneToken) {
      configureRemoteAuth(wsResult.path, cloneToken)
    }

    // 4. Before-run hook
    const beforeRunErr = await runBeforeRunHook(config, wsResult.path, issue)
    if (beforeRunErr) {
      log.warn(`before_run hook failed: ${beforeRunErr}`)
      if (cloneToken) {
        removeRemoteAuth(wsResult.path)
      }
      await runAfterRunHook(config, wsResult.path, issue)
      throw beforeRunErr
    }

    // 5. Build full prompt with workflow template + comment text
    const fullPrompt = await buildAgentPrompt(workflow, issue, prompt)

    // 6. Run Claude Code agent
    const client = new AppServerClient(config, wsResult.path)
    if (tokenProvider) {
      const agentEnv = await resolveAgentEnv(config, tokenProvider)
      client.setAgentEnv(agentEnv)
    }

    const session = await client.startSession()
    if (session instanceof Error) {
      if (cloneToken) {
        removeRemoteAuth(wsResult.path)
      }
      await runAfterRunHook(config, wsResult.path, issue)
      throw session
    }

    const messages: string[] = []
    try {
      const result = await client.runTurn(session, fullPrompt, issue, (msg) => {
        if (msg.event === 'notification' && msg.payload) {
          const p = msg.payload as Record<string, unknown>
          if (p.type === 'assistant' && typeof p.message === 'object' && p.message !== null) {
            const content = (p.message as Record<string, unknown>).content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text') {
                  messages.push((block as Record<string, unknown>).text as string)
                }
              }
            }
          }
        }
      })

      if (result instanceof Error) {
        throw result
      }
    }
    finally {
      client.stopSession()
      // Remove credentials from remote URL to prevent token leakage in .git/config
      if (cloneToken) {
        removeRemoteAuth(wsResult.path)
      }
      await runAfterRunHook(config, wsResult.path, issue)
    }

    // 7. Post agent response as new issue comment
    const responseBody = messages.length > 0
      ? messages.join('\n\n')
      : '_Agent completed but produced no text output._'

    await github.postComment(owner, repo, issueNumber, responseBody)
    log.info(`posted response to ${owner}/${repo}#${issueNumber}`)

    // 8. Replace eyes with rocket
    if (eyesReactionId) {
      try {
        await github.removeReaction(owner, repo, commentId, eyesReactionId)
      }
      catch (err) {
        log.warn(`failed to remove eyes reaction: ${err}`)
      }
    }
    try {
      await github.addReaction(owner, repo, commentId, 'rocket')
    }
    catch (err) {
      log.warn(`failed to add rocket reaction: ${err}`)
    }
  }
  catch (err) {
    log.error(`issue comment handler failed for ${owner}/${repo}#${issueNumber}: ${err}`)

    // Replace eyes with confused on failure
    if (eyesReactionId) {
      try {
        await github.removeReaction(owner, repo, commentId, eyesReactionId)
      }
      catch (cleanupErr) {
        log.warn(`failed to remove eyes reaction during error cleanup: ${cleanupErr}`)
      }
    }
    try {
      await github.addReaction(owner, repo, commentId, 'confused')
    }
    catch (cleanupErr) {
      log.warn(`failed to add confused reaction during error cleanup: ${cleanupErr}`)
    }

    // Post error comment
    try {
      await github.postComment(
        owner,
        repo,
        issueNumber,
        'I encountered an error while processing your request. Please check the server logs for details.',
      )
    }
    catch (postErr) {
      log.error(`failed to post error comment: ${postErr}`)
    }
  }
  finally {
    // Clear lock extend timer and release dispatch lock
    if (lockExtendTimer) {
      clearInterval(lockExtendTimer)
    }
    if (dispatchLock && dispatchLockAdapter) {
      await dispatchLockAdapter.releaseLock(dispatchLock).catch((err) => {
        log.warn(`dispatch lock release failed: ${err}`)
      })
    }
  }
}

function payloadToIssue(payload: IssueCommentPayload): Issue {
  const { repository, issue } = payload
  return {
    id: `${repository.full_name}#${issue.number}`,
    identifier: `${repository.full_name}#${issue.number}`,
    title: issue.title,
    description: issue.body,
    priority: null,
    state: issue.state,
    branch_name: null,
    url: `https://github.com/${repository.full_name}/issues/${issue.number}`,
    assignees: issue.assignees.map(a => a.login),
    labels: issue.labels.map(l => l.name),
    blocked_by: [],
    pull_requests: [],
    review_decision: null,
    created_at: null,
    updated_at: null,
    project: null,
  }
}

async function buildAgentPrompt(
  workflow: WorkflowDefinition,
  issue: Issue,
  commentPrompt: string,
): Promise<string> {
  // Try building with the workflow template first
  const templatePrompt = await buildPrompt(workflow, issue)
  if (isPromptBuildError(templatePrompt)) {
    throw new Error(`prompt template ${templatePrompt.code}: ${String(templatePrompt.cause)}`)
  }
  const basePrompt = templatePrompt

  return `${basePrompt}

---

**Triggered by issue comment:**

${commentPrompt}`
}
