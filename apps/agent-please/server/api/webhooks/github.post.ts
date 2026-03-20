import type { GitHubApi, IssueCommentPayload, VerifySignature } from '@pleaseai/agent-core'
import type { Chat } from 'chat'
import process from 'node:process'
import { createLogger, createVerify, handleIssueCommentMention, handleWebhook, shouldHandleComment } from '@pleaseai/agent-core'

const log = createLogger('webhook')

// Cache the verifier per secret to avoid recreating it on every request
const verifierCache = new Map<string, VerifySignature>()

function getVerifier(secret: string): VerifySignature {
  let verifier = verifierCache.get(secret)
  if (!verifier) {
    verifier = createVerify(secret)
    verifierCache.set(secret, verifier)
  }
  return verifier
}

function createGitHubRestApi(token: string): GitHubApi {
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  return {
    async addReaction(owner, repo, commentId, reaction) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}/reactions`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: reaction }),
        },
      )
      if (!res.ok)
        throw new Error(`GitHub addReaction failed: ${res.status} ${await res.text()}`)
      const data = await res.json() as { id: number }
      return { id: data.id }
    },

    async removeReaction(owner, repo, commentId, reactionId) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}/reactions/${reactionId}`,
        { method: 'DELETE', headers },
      )
      if (!res.ok && res.status !== 404)
        throw new Error(`GitHub removeReaction failed: ${res.status} ${await res.text()}`)
    },

    async postComment(owner, repo, issueNumber, body) {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      )
      if (!res.ok)
        throw new Error(`GitHub postComment failed: ${res.status} ${await res.text()}`)
    },
  }
}

export default defineEventHandler(async (event) => {
  const orchestrator = useOrchestrator(event)
  const config = orchestrator.getConfig()
  const { secret, events } = config.server.webhook

  const request = toWebRequest(event)

  // Verify GitHub signature first, before any branching
  if (secret) {
    const verify = getVerifier(secret)
    const signature = getRequestHeader(event, 'x-hub-signature-256') ?? ''
    const body = await request.clone().text()
    const valid = await verify(body, signature).catch((err: unknown) => {
      log.error('signature verification error:', err)
      return false
    })
    if (!valid) {
      setResponseStatus(event, 401)
      return { error: { code: 'invalid_signature', message: 'Signature verification failed' } }
    }
  }

  const githubEvent = getRequestHeader(event, 'x-github-event')

  // Try Chat SDK first for issue_comment events with @mentions
  const nitroApp = useNitroApp()
  const chatBot = (nitroApp as any).chatBot as Chat | undefined

  if (chatBot) {
    if (githubEvent === 'issue_comment' || githubEvent === 'pull_request_review_comment') {
      const handler = chatBot.webhooks.github
      if (handler) {
        let chatResponse: Response
        try {
          // handler is fully awaited so work completes before 2xx response;
          // waitUntil is not needed here but satisfies the SDK interface
          chatResponse = await handler(request.clone(), {
            waitUntil: (promise: Promise<unknown>) => { promise.catch(err => log.error('waitUntil rejected:', err)) },
          })
        }
        catch (err) {
          log.error('chat SDK threw — falling through to orchestrator:', err)
          chatResponse = new Response(null, { status: 500 })
        }

        // If Chat SDK handled it (200), also trigger orchestrator refresh
        if (chatResponse.ok) {
          orchestrator.triggerRefresh()
          let body: unknown
          try {
            body = await chatResponse.json()
          }
          catch (parseErr) {
            log.warn('failed to parse chat SDK response body:', parseErr)
            body = { accepted: true }
          }
          setResponseStatus(event, chatResponse.status)
          return body
        }
      }
    }
  }

  // Plain issue comment @mention → agent dispatch (async, returns 202 immediately)
  // Requires webhook secret to be configured — reject unauthenticated agent dispatch
  if (githubEvent === 'issue_comment' && secret) {
    try {
      const payload = await request.clone().json() as IssueCommentPayload
      const botUsername = config.chat.bot_username || process.env.GITHUB_BOT_USERNAME || 'work-please'

      if (shouldHandleComment(payload, botUsername)) {
        const token = config.tracker.api_key
        if (!token) {
          log.warn('no API token available for issue comment handler')
          setResponseStatus(event, 503)
          return { error: { code: 'no_token', message: 'No API token configured for issue comment dispatch' } }
        }

        const github = createGitHubRestApi(token)
        const workflow = orchestrator.getWorkflow()

        // Fire and forget — dispatch asynchronously
        handleIssueCommentMention(payload, {
          config,
          workflow,
          github,
        }).catch(err => log.error('issue comment handler error:', err))

        setResponseStatus(event, 202)
        return { accepted: true, handler: 'issue_comment_agent' }
      }
    }
    catch (err) {
      log.error('failed to parse issue_comment payload for agent dispatch:', err)
      setResponseStatus(event, 400)
      return { error: { code: 'invalid_payload', message: 'Failed to parse issue_comment payload' } }
    }
  }

  // Fallback: orchestrator webhook handler (signature already verified above)
  const verify = secret ? getVerifier(secret) : null
  const response = await handleWebhook(
    request,
    verify,
    events,
    () => orchestrator.triggerRefresh(),
  )

  const body = await response.json()
  setResponseStatus(event, response.status)
  for (const [key, value] of response.headers.entries()) {
    setResponseHeader(event, key, value)
  }
  return body
})
