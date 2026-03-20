export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname

  // Skip auth for: auth endpoints, webhooks, and health checks
  if (
    path.startsWith('/api/auth/')
    || path.startsWith('/api/webhooks/')
    || path === '/api/_health'
  ) {
    return
  }

  // Only protect /api/v1/* routes
  if (!path.startsWith('/api/v1/'))
    return

  // Auth not configured — routes are unprotected by design
  if (!isAuthEnabled())
    return

  const auth = useAuth()
  const session = await auth.api.getSession({
    headers: event.headers,
  })

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }
})
