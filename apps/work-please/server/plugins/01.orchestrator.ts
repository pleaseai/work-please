import process from 'node:process'
import { createLogger, Orchestrator } from '@pleaseai/core'

const log = createLogger('orchestrator')

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  // Check runtimeConfig (NUXT_WORKFLOW_PATH) then process.env (WORKFLOW_PATH from CLI)
  const workflowPath = config.workflowPath || process.env.WORKFLOW_PATH || ''

  if (!workflowPath) {
    log.warn('no WORKFLOW_PATH configured — orchestrator not started')
    return
  }

  const orchestrator = new Orchestrator(workflowPath)

  // Store on nitroApp for access by server routes
  ;(nitroApp as any).orchestrator = orchestrator

  orchestrator.start().catch((err) => {
    log.error('startup failed:', err)
    process.exit(1)
  })

  nitroApp.hooks.hook('close', () => {
    try {
      orchestrator.stop()
    }
    catch (err) {
      log.error('error during shutdown:', err)
    }
  })
})
