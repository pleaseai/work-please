import type { Orchestrator } from '@pleaseai/agent-core'
import { resolve } from 'node:path'
import process from 'node:process'
import { createLogger } from '@pleaseai/agent-core'
import { getMigrations } from 'better-auth/db/migration'

const log = createLogger('auth')
const MIN_ADMIN_PASSWORD_LENGTH = 8
const USER_ALREADY_EXISTS_ERROR_CODE = 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'

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
  const host = process.env.HOST || process.env.NITRO_HOST || 'localhost'
  const port = config.server.port ?? Number(process.env.PORT || process.env.NITRO_PORT || 3000)
  const baseURL = `http://${host}:${port}`
  const auth = initAuth(config.auth, dbPath, baseURL)

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
    catch (err: any) {
      if (err?.body?.code === USER_ALREADY_EXISTS_ERROR_CODE) {
        log.debug('admin user already exists — skipping seed')
      }
      else {
        log.warn('admin seeding failed:', err)
      }
    }
  }
})
