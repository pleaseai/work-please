export default defineEventHandler((event) => {
  const orchestrator = useOrchestrator(event)
  orchestrator.triggerRefresh()

  setResponseStatus(event, 202)
  return {
    queued: true,
    requested_at: new Date().toISOString(),
    operations: ['poll', 'reconcile'],
  }
})
