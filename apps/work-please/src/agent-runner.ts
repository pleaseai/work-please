import type { AgentMessage } from './types'

// Re-export SdkRunner as AppServerClient for backward compatibility
export { SdkRunner as AppServerClient } from './runner/sdk-runner'
export type { AgentRunner, AgentSession, SessionResult } from './runner/types'

// Utility exports (used by tests and orchestrator)
type JsonRpcMessage = Record<string, unknown>

export function extractRateLimits(payload: JsonRpcMessage): { rate_limits?: unknown } {
  const params = payload.params as Record<string, unknown> | undefined
  const candidates = [
    params?.rate_limits,
    (params?.msg as Record<string, unknown> | undefined)?.rate_limits,
    payload.rate_limits,
  ]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object')
      return { rate_limits: candidate }
  }
  return {}
}

export function extractUsage(payload: JsonRpcMessage): { usage?: AgentMessage['usage'] } {
  const params = payload.params as Record<string, unknown> | undefined
  const tokenUsage = params?.tokenUsage as Record<string, unknown> | undefined
  const usageRaw = (
    params?.usage
    ?? params?.total_token_usage
    ?? tokenUsage?.total
  ) as Record<string, unknown> | undefined
  if (!usageRaw)
    return {}
  return {
    usage: {
      input_tokens: Number(usageRaw.input_tokens ?? usageRaw.inputTokens ?? usageRaw.prompt_tokens ?? 0),
      output_tokens: Number(usageRaw.output_tokens ?? usageRaw.outputTokens ?? usageRaw.completion_tokens ?? 0),
      total_tokens: Number(usageRaw.total_tokens ?? usageRaw.totalTokens ?? 0),
    },
  }
}

export function isInputRequired(method: string, payload: JsonRpcMessage): boolean {
  const INPUT_METHODS = [
    'turn/input_required',
    'turn/needs_input',
    'turn/need_input',
    'turn/request_input',
    'turn/approval_required',
  ]
  if (INPUT_METHODS.includes(method))
    return true

  const params = payload.params as Record<string, unknown> | undefined
  const checks = [payload, params]
  return checks.some(obj =>
    obj?.requiresInput === true
    || obj?.needsInput === true
    || obj?.input_required === true
    || obj?.inputRequired === true,
  )
}
