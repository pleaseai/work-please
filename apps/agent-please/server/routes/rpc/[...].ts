import { onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { router } from '../../orpc'

const rpcHandler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error('[orpc]', error)
    }),
  ],
})

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)

  const orchestrator = useOrchestrator(event)

  const { response } = await rpcHandler.handle(request, {
    prefix: '/rpc',
    context: {
      orchestrator,
      headers: event.headers,
    },
  })

  if (response) {
    return response
  }

  setResponseStatus(event, 404, 'Not Found')
  return 'Not Found'
})
