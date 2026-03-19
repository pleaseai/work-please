import type { Chat } from 'chat'
import { createVerify, handleWebhook } from '@pleaseai/core'

export default defineEventHandler(async (event) => {
  const orchestrator = useOrchestrator(event)
  const config = orchestrator.getConfig()
  const { secret, events } = config.server.webhook

  const request = toWebRequest(event)

  // Try Chat SDK first for issue_comment events with @mentions
  const nitroApp = useNitroApp()
  const chatBot = (nitroApp as any).chatBot as Chat | undefined

  if (chatBot) {
    const githubEvent = getRequestHeader(event, 'x-github-event')
    if (githubEvent === 'issue_comment' || githubEvent === 'pull_request_review_comment') {
      try {
        const handler = chatBot.webhooks.github
        if (handler) {
          const chatResponse = await handler(request.clone(), {
            waitUntil: (task: Promise<unknown>) => event.waitUntil(task),
          })

          // If Chat SDK handled it (200), also trigger orchestrator refresh
          if (chatResponse.ok) {
            orchestrator.triggerRefresh()
            const body = await chatResponse.json().catch(() => ({ accepted: true }))
            setResponseStatus(event, chatResponse.status)
            return body
          }
        }
      }
      catch {
        // Chat SDK didn't handle it — fall through to orchestrator webhook
      }
    }
  }

  // Fallback: orchestrator webhook handler
  const verify = secret ? createVerify(secret) : null
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
