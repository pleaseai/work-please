import type { RouterClient } from '@orpc/server'
import type { router } from '../../server/orpc'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

export default defineNuxtPlugin(() => {
  const link = new RPCLink({
    url: `${window.location.origin}/rpc`,
    headers: () => ({}),
  })

  const client: RouterClient<typeof router> = createORPCClient(link)
  const orpc = createTanstackQueryUtils(client)

  return { provide: { orpc, orpcClient: client } }
})
