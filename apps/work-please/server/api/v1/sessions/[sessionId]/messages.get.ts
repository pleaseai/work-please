import { fetchSessionMessages, isValidSessionId, parsePositiveInt } from '@pleaseai/work-core'

export default defineEventHandler(async (event) => {
  const orchestrator = useOrchestrator(event)
  const sessionId = getRouterParam(event, 'sessionId') ?? ''

  if (!sessionId || !isValidSessionId(sessionId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid session ID' })
  }

  const config = orchestrator.getConfig()
  const query = getQuery(event)
  const limit = parsePositiveInt(typeof query.limit === 'string' ? query.limit : null)
  const offset = parsePositiveInt(typeof query.offset === 'string' ? query.offset : null)

  try {
    return await fetchSessionMessages(sessionId, config.workspace.root, { limit, offset })
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.toLowerCase().includes('not found'))
      return []
    console.error('[server] sessionMessagesResponse error:', err)
    throw createError({ statusCode: 500, statusMessage: 'Failed to load session messages' })
  }
})
