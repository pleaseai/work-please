import type { TokenProvider } from './agent-env'
import type { Issue, ServiceConfig, WorkflowDefinition } from './types'
import { resolveAgentEnv } from './agent-env'
import { AppServerClient } from './agent-runner'
import { createLogger } from './logger'
import { buildPrompt, isPromptBuildError } from './prompt-builder'
import { createWorkspace, runAfterRunHook, runBeforeRunHook } from './workspace'

const log = createLogger('issue-comment')

export interface IssueCommentPayload {
  action: string
  comment: {
    id: number
    body: string
    user: { login: string }
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
}

/**
 * Detect @mention of botUsername in comment body.
 * Returns the prompt text (body with @mention stripped) or null if no mention.
 */
export function extractMentionPrompt(body: string, botUsername: string): string | null {
  // Match @botUsername followed by end-of-string, whitespace, or punctuation — but not alphanumeric or hyphen
  const pattern = new RegExp(`@${escapeRegex(botUsername)}(?=[\\s,.:;!?)\\]}>]|$)`, 'gi')
  if (!pattern.test(body))
    return null
  // Reset lastIndex after test() with global flag
  pattern.lastIndex = 0
  return body.replace(pattern, '').trim()
}

const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g

function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL_CHARS, '\\$&')
}

/**
 * Check if the payload is a plain issue comment (not PR) with @mention of bot.
 */
export function shouldHandleComment(payload: IssueCommentPayload, botUsername: string): boolean {
  if (payload.action !== 'created')
    return false
  if (payload.issue.pull_request)
    return false
  if (payload.comment.user.login === botUsername)
    return false
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
  const { config, workflow, github, tokenProvider } = deps
  const botUsername = config.chat.bot_username || 'work-please'
  const { owner: { login: owner }, name: repo } = payload.repository
  const commentId = payload.comment.id
  const issueNumber = payload.issue.number

  const prompt = extractMentionPrompt(payload.comment.body, botUsername)
  if (!prompt) {
    log.warn(`no mention found in comment ${commentId} — skipping`)
    return
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

    // 3. Create/reuse workspace
    const wsResult = await createWorkspace(config, issue.identifier, issue)
    if (wsResult instanceof Error) {
      throw wsResult
    }

    // 4. Before-run hook
    const beforeRunErr = await runBeforeRunHook(config, wsResult.path, issue)
    if (beforeRunErr) {
      log.warn(`before_run hook failed: ${beforeRunErr}`)
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
      await runAfterRunHook(config, wsResult.path, issue)
    }

    // 7. Post agent response as new issue comment
    const responseBody = messages.length > 0
      ? messages.at(-1)!
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
