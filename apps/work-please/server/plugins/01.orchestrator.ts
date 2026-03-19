import process from 'node:process'
import { createLogger, Orchestrator } from '@pleaseai/core'

const log = createLogger('orchestrator')

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const workflowPath = config.workflowPath as string

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
