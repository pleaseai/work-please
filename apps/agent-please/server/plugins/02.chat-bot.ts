import type { Orchestrator } from '@pleaseai/agent-core'
import process from 'node:process'
import { createGitHubAdapter } from '@chat-adapter/github'
import { createSlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { createLogger } from '@pleaseai/agent-core'
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

  const adapters: Record<string, any> = {}

  // GitHub adapter: requires github_projects tracker + webhook secret
  if (tracker.kind === 'github_projects') {
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
    if (webhookSecret) {
      adapterOpts.webhookSecret = webhookSecret
      if (config.chat.bot_username) {
        adapterOpts.userName = config.chat.bot_username
      }
      adapters.github = createGitHubAdapter(adapterOpts)
    }
    else {
      log.warn('no webhook secret configured — GitHub chat adapter skipped')
    }
  }

  // Slack adapter: requires bot_token + signing_secret from chat config or env
  const slackConfig = config.chat.slack
  if (slackConfig?.bot_token && slackConfig?.signing_secret) {
    adapters.slack = createSlackAdapter({
      botToken: slackConfig.bot_token,
      signingSecret: slackConfig.signing_secret,
    })
  }
  else if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter()
  }

  if (Object.keys(adapters).length === 0) {
    log.warn('no chat adapters configured — chat bot not started')
    return
  }

  const botUsername = config.chat.bot_username || process.env.GITHUB_BOT_USERNAME || 'agent-please'

  const bot = new Chat({
    userName: botUsername,
    adapters,
    state: createMemoryState(),
  })

  // Handle @mentions: respond with issue status from orchestrator
  bot.onNewMention(async (thread) => {
    try {
      const state = orchestrator.getState()

      const statusLines: string[] = []
      const runningCount = state.running.size
      const retryCount = state.retry_attempts.size

      statusLines.push(`**Agent Please Status**`)
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

  const adapterNames = Object.keys(adapters).join(', ')
  log.info(`chat adapters initialized: ${adapterNames}`)
})
