import { Orchestrator } from '@pleaseai/core'

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const workflowPath = config.workflowPath

  if (!workflowPath) {
    console.warn('[orchestrator] no WORKFLOW_PATH configured — orchestrator not started')
    return
  }

  const orchestrator = new Orchestrator(workflowPath)

  // Store on nitroApp for access by server routes
  ;(nitroApp as any).orchestrator = orchestrator

  orchestrator.start().catch((err) => {
    console.error('[orchestrator] startup failed:', err)
    process.exit(1)
  })

  nitroApp.hooks.hook('close', () => {
    orchestrator.stop()
  })
})
