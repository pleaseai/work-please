import type { Chat } from 'chat'
import { createLogger } from '@pleaseai/agent-core'

const log = createLogger('webhook:asana')

export default defineEventHandler(async (event) => {
  const nitroApp = useNitroApp()
  const chatBot = (nitroApp as any).chatBot as Chat | undefined

  if (!chatBot) {
    setResponseStatus(event, 503)
    return { error: { code: 'not_initialized', message: 'Chat bot not initialized' } }
  }

  const handler = chatBot.webhooks.asana
  if (!handler) {
    setResponseStatus(event, 404)
    return { error: { code: 'asana_not_configured', message: 'Asana adapter not configured' } }
  }

  const request = toWebRequest(event)

  try {
    const response = await handler(request, {
      waitUntil: (promise: Promise<unknown>) => {
        promise.catch(err => log.error('waitUntil rejected:', err))
      },
    })

    setResponseStatus(event, response.status)
    for (const [key, value] of response.headers.entries()) {
      setResponseHeader(event, key, value)
    }

    const text = await response.text()
    if (!text) {
      return { accepted: true }
    }
    try {
      return JSON.parse(text)
    }
    catch {
      log.warn('asana webhook response is not JSON:', { status: response.status, body: text.slice(0, 200) })
      return text
    }
  }
  catch (err) {
    log.error('asana webhook handler error:', err)
    setResponseStatus(event, 500)
    return { error: { code: 'internal_error', message: 'Asana webhook processing failed' } }
  }
})
