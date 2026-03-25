import type { RouterClient } from '@orpc/server'
import type { router } from '../../server/orpc'
import { createRouterClient } from '@orpc/server'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

export default defineNuxtPlugin(() => {
  const client: RouterClient<typeof router> = createRouterClient(router, {
    context: {
      // During SSR, orchestrator context is resolved per-request
      // The server-side client bypasses HTTP — calls router directly
      get orchestrator() {
        const nitroApp = useNitroApp()
        return (nitroApp as any).orchestrator
      },
      get headers() {
        const event = useRequestEvent()
        return event?.headers ?? new Headers()
      },
    },
  })

  const orpc = createTanstackQueryUtils(client)

  return { provide: { orpc, orpcClient: client } }
})
