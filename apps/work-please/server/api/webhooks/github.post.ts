import type { VerifySignature } from '@pleaseai/core'
import type { Chat } from 'chat'
import { createLogger, createVerify, handleWebhook } from '@pleaseai/core'

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

  // Try Chat SDK first for issue_comment events with @mentions
  const nitroApp = useNitroApp()
  const chatBot = (nitroApp as any).chatBot as Chat | undefined

  if (chatBot) {
    const githubEvent = getRequestHeader(event, 'x-github-event')
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
