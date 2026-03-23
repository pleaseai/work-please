import type { Orchestrator } from '@pleaseai/agent-core'
import type { StateAdapter } from 'chat'
import process from 'node:process'
import { createGitHubAdapter } from '@chat-adapter/github'
import { createSlackAdapter } from '@chat-adapter/slack'
import { createLogger, createStateFromConfig } from '@pleaseai/agent-core'
import { Chat } from 'chat'
import { createAsanaAdapter } from 'chat-adapter-asana'

const log = createLogger('chat-bot')

export default defineNitroPlugin(async (nitroApp) => {
  const orchestrator = (nitroApp as any).orchestrator as Orchestrator | undefined
  if (!orchestrator) {
    log.warn('orchestrator not available — chat bot not started')
    return
  }

  const config = orchestrator.getConfig()

  const adapters: Record<string, any> = {}
  let resolvedBotUsername: string | null = null

  for (const channel of config.channels) {
    const platform = config.platforms[channel.platform]
    if (!platform) {
      log.warn(`unknown platform "${channel.platform}" for channel, skipping`)
      continue
    }

    if (platform.kind === 'github') {
      const githubPlatform = platform
      const adapterOpts: Record<string, any> = {}

      if (githubPlatform.api_key) {
        adapterOpts.token = githubPlatform.api_key
      }
      else if (githubPlatform.app_id && githubPlatform.private_key) {
        adapterOpts.appId = String(githubPlatform.app_id)
        adapterOpts.privateKey = githubPlatform.private_key
        if (githubPlatform.installation_id) {
          adapterOpts.installationId = githubPlatform.installation_id
        }
      }

      const webhookSecret = config.server.webhook.secret
      if (webhookSecret) {
        adapterOpts.webhookSecret = webhookSecret
        if (githubPlatform.bot_username) {
          adapterOpts.userName = githubPlatform.bot_username
          resolvedBotUsername ??= githubPlatform.bot_username
        }
        adapters.github = createGitHubAdapter(adapterOpts)
      }
      else {
        log.warn('no webhook secret configured — GitHub chat adapter skipped')
      }
    }
    else if (platform.kind === 'slack') {
      const slackPlatform = platform
      if (slackPlatform.bot_token && slackPlatform.signing_secret) {
        adapters.slack = createSlackAdapter({
          botToken: slackPlatform.bot_token,
          signingSecret: slackPlatform.signing_secret,
        })
        resolvedBotUsername ??= null
      }
    }
    else if (platform.kind === 'asana') {
      const asanaPlatform = platform
      if (asanaPlatform.api_key) {
        const adapterOpts: {
          accessToken: string
          userName?: string
          webhookSecret?: string
        } = {
          accessToken: asanaPlatform.api_key,
        }
        if (asanaPlatform.bot_username) {
          adapterOpts.userName = asanaPlatform.bot_username
          resolvedBotUsername ??= asanaPlatform.bot_username
        }
        if (asanaPlatform.webhook_secret) {
          adapterOpts.webhookSecret = asanaPlatform.webhook_secret
        }
        adapters.asana = createAsanaAdapter(adapterOpts)
      }
      else {
        log.warn('no api_key configured — Asana chat adapter skipped')
      }
    }
  }

  if (Object.keys(adapters).length === 0) {
    log.warn('no chat adapters configured — chat bot not started')
    return
  }

  const botUsername = resolvedBotUsername || process.env.CHAT_BOT_USERNAME || process.env.GITHUB_BOT_USERNAME || 'agent-please'

  const stateConfig = config.state
  const onLockConflict = stateConfig.on_lock_conflict === 'force' ? 'force' as const : undefined

  try {
    const stateAdapter = await createStateFromConfig(stateConfig) as StateAdapter
    // Connect eagerly so the orchestrator's dispatch lock works
    // before Chat SDK's lazy initialization triggers.
    await stateAdapter.connect()
    const bot = new Chat({
      userName: botUsername,
      adapters,
      state: stateAdapter,
      ...(onLockConflict ? { onLockConflict } : {}),
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

    // Share Chat SDK state adapter with orchestrator for dispatch lock dedup
    const chatState = bot.getState()
    orchestrator.setDispatchLockAdapter(chatState)

    // Store bot on nitroApp for webhook handler access
    ;(nitroApp as any).chatBot = bot
    ;(nitroApp as any).chatStateAdapter = chatState

    nitroApp.hooks.hook('close', async () => {
      try {
        await bot.shutdown()
      }
      catch (err) {
        log.error('error during shutdown:', err)
      }
    })

    const adapterNames = Object.keys(adapters).join(', ')
    log.info(`chat bot initialized (state: ${stateConfig.adapter}, adapters: ${adapterNames})`)
  }
  catch (err) {
    log.error('failed to create state adapter:', err)
  }
})
