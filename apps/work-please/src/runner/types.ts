import type { AgentMessage, Issue } from '../types'

export interface AgentSession {
  sessionId: string
  workspace: string | null
}

export interface SessionResult {
  turn_id: string
  session_id: string
}

export interface AgentRunner {
  setAgentEnv: (env: Record<string, string>) => void
  startSession: (sessionId?: string) => Promise<AgentSession | Error>
  runTurn: (
    session: AgentSession,
    prompt: string,
    issue: Issue,
    onMessage: (msg: AgentMessage) => void,
  ) => Promise<SessionResult | Error>
  stopSession: () => void
}
