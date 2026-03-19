import type { Orchestrator } from '@pleaseai/core'
import process from 'node:process'
import { createGitHubAdapter } from '@chat-adapter/github'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createLogger } from '@pleaseai/core'
import { Chat } from 'chat'

const log = createLogger('chat-bot')

export default defineNitroPlugin((nitroApp) => {
  const orchestrator = (nitroApp as any).orchestrator as Orchestrator | undefined
  if (!orchestrator) {
    log.warn('orchestrator not available — chat bot not started')
    return
  }

  const config = orchestrator.getConfig()
  const tracker = config.tracker

  // Only initialize if GitHub tracker is configured
  if (tracker.kind !== 'github_projects') {
    log.warn('tracker is not github_projects — chat bot not started')
    return
  }

  // Build GitHub adapter options from orchestrator config
  const adapterOpts: Record<string, any> = {}
  if (tracker.api_key) {
    adapterOpts.token = tracker.api_key
  }
  else if (tracker.app_id && tracker.private_key) {
    adapterOpts.appId = String(tracker.app_id)
    adapterOpts.privateKey = tracker.private_key
    if (tracker.installation_id) {
      adapterOpts.installationId = tracker.installation_id
    }
  }

  const webhookSecret = config.server.webhook.secret
  if (!webhookSecret) {
    log.warn('no webhook secret configured — chat bot requires webhook mode')
    return
  }
  adapterOpts.webhookSecret = webhookSecret

  const botUsername = process.env.GITHUB_BOT_USERNAME || 'work-please'

  const bot = new Chat({
    userName: botUsername,
    adapters: {
      github: createGitHubAdapter(adapterOpts),
    },
    state: createMemoryState(),
  })

  // Handle @mentions: respond with issue status from orchestrator
  bot.onNewMention(async (thread) => {
    try {
      const state = orchestrator.getState()

      const statusLines: string[] = []
      const runningCount = state.running.size
      const retryCount = state.retry_attempts.size

      statusLines.push(`**Work Please Status**`)
      statusLines.push(`- Running: ${runningCount}`)
      statusLines.push(`- Retrying: ${retryCount}`)
      statusLines.push(`- Total tokens: ${state.agent_totals.total_tokens.toLocaleString()}`)

      if (runningCount > 0) {
        statusLines.push('')
        statusLines.push('**Running Issues:**')
        for (const entry of state.running.values()) {
          statusLines.push(`- \`${entry.identifier}\` — ${entry.issue.state} (turn ${entry.turn_count})`)
        }
      }

      if (retryCount > 0) {
        statusLines.push('')
        statusLines.push('**Retry Queue:**')
        for (const entry of state.retry_attempts.values()) {
          statusLines.push(`- \`${entry.identifier}\` — attempt ${entry.attempt}${entry.error ? ` (${entry.error})` : ''}`)
        }
      }

      await thread.post(statusLines.join('\n'))
    }
    catch (err) {
      log.error('failed to handle mention:', err)
      try {
        await thread.post('Sorry, I encountered an error retrieving status. Please try again.')
      }
      catch (replyErr) {
        log.error('failed to post error reply:', replyErr)
      }
    }
  })

  // Store bot on nitroApp for webhook handler access
  ;(nitroApp as any).chatBot = bot

  nitroApp.hooks.hook('close', async () => {
    try {
      await bot.shutdown()
    }
    catch (err) {
      log.error('error during shutdown:', err)
    }
  })

  log.info('GitHub adapter initialized')
})
