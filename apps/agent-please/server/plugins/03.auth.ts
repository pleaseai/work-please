import type { Orchestrator } from '@pleaseai/agent-core'
import { resolve } from 'node:path'
import { createLogger } from '@pleaseai/agent-core'
import { getMigrations } from 'better-auth/db/migration'

const log = createLogger('auth')
const MIN_ADMIN_PASSWORD_LENGTH = 8

export default defineNitroPlugin(async (nitroApp) => {
  const orchestrator = (nitroApp as any).orchestrator as Orchestrator | undefined
  if (!orchestrator) {
    log.warn('orchestrator not available — auth not initialized')
    return
  }

  const config = orchestrator.getConfig()
  if (!config?.auth?.secret) {
    log.info('auth not configured — dashboard authentication disabled')
    return
  }

  const dbPath = resolve(config.workspace.root, config.db.path)
  const auth = initAuth(config.auth, dbPath)

  try {
    const { runMigrations } = await getMigrations(auth.options)
    await runMigrations()
    log.info('auth migrations complete')
  }
  catch (err) {
    log.error('auth migration failed:', err)
    resetAuth()
    return
  }

  if (config.auth.admin.email && config.auth.admin.password) {
    if (config.auth.admin.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
      log.warn(`admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters — admin not seeded`)
      return
    }

    try {
      const existing = await auth.api.listUsers({
        query: { limit: 1, offset: 0, filterField: 'role', filterValue: 'admin' },
      }).catch((err) => {
        log.warn('failed to list users during admin seeding:', err)
        return null
      })

      const adminExists = (existing?.total ?? 0) > 0

      if (!adminExists) {
        const name = config.auth.admin.email.split('@')[0] || config.auth.admin.email
        await auth.api.createUser({
          body: {
            email: config.auth.admin.email,
            name,
            password: config.auth.admin.password,
            role: 'admin',
          },
        })
        log.info(`admin user "${config.auth.admin.email}" seeded`)
      }
    }
    catch (err) {
      log.warn('admin seeding failed:', err)
    }
  }
})
