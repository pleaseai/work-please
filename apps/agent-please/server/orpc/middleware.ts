import type { Orchestrator } from '@pleaseai/agent-core'
import { ORPCError, os } from '@orpc/server'

export interface ORPCContext {
  orchestrator: Orchestrator
  headers: Headers
}

export const pub = os.$context<ORPCContext>()

export const authed = pub.use(async ({ context, next }) => {
  if (!isAuthEnabled()) {
    return next({ context })
  }

  const auth = useAuth()
  const session = await auth.api.getSession({
    headers: context.headers,
  })

  if (!session) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Authentication required' })
  }

  return next({
    context: { ...context, session },
  })
})
