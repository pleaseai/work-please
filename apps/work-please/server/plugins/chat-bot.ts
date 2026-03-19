import { Chat } from 'chat'
import { createGitHubAdapter } from '@chat-adapter/github'
import { createMemoryState } from '@chat-adapter/state-memory'
import type { Orchestrator } from '@pleaseai/core'

export default defineNitroPlugin((nitroApp) => {
  const orchestrator = (nitroApp as any).orchestrator as Orchestrator | undefined
  if (!orchestrator) {
    console.warn('[chat-bot] orchestrator not available — chat bot not started')
    return
  }

  const config = orchestrator.getConfig()
  const tracker = config.tracker

  // Only initialize if GitHub tracker is configured
  if (tracker.kind !== 'github_projects') {
    console.warn('[chat-bot] tracker is not github_projects — chat bot not started')
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
  if (webhookSecret) {
    adapterOpts.webhookSecret = webhookSecret
  }

  const botUsername = process.env.GITHUB_BOT_USERNAME || 'work-please'

  const bot = new Chat({
    userName: botUsername,
    adapters: {
      github: createGitHubAdapter(adapterOpts),
    },
    state: createMemoryState(),
  })

  // Handle @mentions: respond with issue status from orchestrator
  bot.onNewMention(async (thread, message) => {
    const state = orchestrator.getState()
    const text = message.text?.trim() ?? ''

    // Try to find a running/retrying issue matching the context
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
  })

  // Store bot on nitroApp for webhook handler access
  ;(nitroApp as any).chatBot = bot

  console.log('[chat-bot] GitHub adapter initialized')
})
