import { authClient } from '~/lib/auth-client'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for the login page itself
  if (to.path === '/login')
    return

  const { data: session } = await authClient.useSession(useFetch)

  if (!session.value) {
    return navigateTo('/login')
  }
})
