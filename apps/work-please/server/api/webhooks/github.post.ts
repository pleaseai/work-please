import { createVerify, handleWebhook } from '@pleaseai/core'

export default defineEventHandler(async (event) => {
  const orchestrator = useOrchestrator(event)
  const config = orchestrator.getConfig()
  const { secret, events } = config.server.webhook

  const verify = secret ? createVerify(secret) : null
  const request = toWebRequest(event)

  const response = await handleWebhook(
    request,
    verify,
    events,
    () => orchestrator.triggerRefresh(),
  )

  // Convert Response to H3 response
  const body = await response.json()
  setResponseStatus(event, response.status)
  for (const [key, value] of response.headers.entries()) {
    setResponseHeader(event, key, value)
  }
  return body
})
