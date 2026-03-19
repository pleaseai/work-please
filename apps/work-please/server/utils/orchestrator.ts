import type { Orchestrator } from '@pleaseai/core'
import type { H3Event } from 'h3'

export function useOrchestrator(event: H3Event): Orchestrator {
  const nitroApp = useNitroApp()
  const orchestrator = (nitroApp as any).orchestrator as Orchestrator | undefined
  if (!orchestrator) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Orchestrator not initialized',
    })
  }
  return orchestrator
}
