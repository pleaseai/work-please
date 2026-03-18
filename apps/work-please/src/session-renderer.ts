import type { OrchestratorState, RunningEntry } from './types'
import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'

// --- types ---

interface TextBlock { kind: 'text', text: string }
interface ToolBlock { kind: 'tool_use', tool_name: string, input: string }
export type ContentBlock = TextBlock | ToolBlock

// --- session ID validation ---

const SESSION_ID_VALID_RE = /^[\w-]{1,128}$/

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_VALID_RE.test(id)
}

// --- content extraction ---

export function extractContent(msg: { type: string, message: unknown }): ContentBlock[] {
  const message = msg.message as Record<string, unknown> | undefined
  if (!message)
    return []

  const content = message.content
  if (typeof content === 'string')
    return [{ kind: 'text', text: content }]

  if (!Array.isArray(content))
    return []

  const blocks: ContentBlock[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      blocks.push({ kind: 'text', text: block })
    }
    else if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        blocks.push({ kind: 'text', text: b.text })
      }
      else if (b.type === 'tool_use') {
        blocks.push({
          kind: 'tool_use',
          tool_name: String(b.name ?? 'unknown'),
          input: typeof b.input === 'string' ? b.input : JSON.stringify(b.input, null, 2),
        })
      }
      else if (b.type === 'tool_result') {
        const content = b.content
        blocks.push({
          kind: 'text',
          text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        })
      }
      else {
        blocks.push({ kind: 'text', text: `[${String(b.type)}]` })
      }
    }
  }
  return blocks
}

// --- HTML rendering ---

export function renderMessageRow(m: { type: string, uuid: string, content: ContentBlock[] }, esc: (s: string) => string): string {
  const isAssistant = m.type === 'assistant'
  const roleBadge = isAssistant
    ? '<span style="color:#cba6f7;font-weight:bold">assistant</span>'
    : '<span style="color:#a6e3a1;font-weight:bold">user</span>'
  const bgColor = isAssistant ? '#1e1e2e' : '#181825'

  const blocks = m.content.map((block) => {
    if (block.kind === 'text') {
      return `<pre style="white-space:pre-wrap;margin:0.4rem 0">${esc(block.text)}</pre>`
    }
    return `<details style="margin:0.4rem 0"><summary style="cursor:pointer;color:#f9e2af">${esc(block.tool_name)}</summary><pre style="white-space:pre-wrap;font-size:0.85rem;color:#585b70">${esc(block.input)}</pre></details>`
  }).join('')

  return `<div style="background:${bgColor};padding:0.8rem 1rem;margin:0.4rem 0;border-radius:4px;border-left:3px solid ${isAssistant ? '#cba6f7' : '#a6e3a1'}">${roleBadge}${blocks}</div>`
}

// --- session API ---

export async function fetchSessionMessages(
  sessionId: string,
  dir: string,
  opts?: { limit?: number, offset?: number },
): Promise<Array<{ type: string, uuid: string, content: ContentBlock[] }>> {
  const messages = await getSessionMessages(sessionId, {
    dir,
    limit: opts?.limit,
    offset: opts?.offset,
  })
  return messages.map(m => ({
    type: m.type,
    uuid: m.uuid,
    content: extractContent(m),
  }))
}

// --- session page HTML ---

const ESC_AMP_RE = /&/g
const ESC_LT_RE = /</g
const ESC_GT_RE = />/g
const ESC_QUOT_RE = /"/g

function esc(s: string): string {
  return s
    .replace(ESC_AMP_RE, '&amp;')
    .replace(ESC_LT_RE, '&lt;')
    .replace(ESC_GT_RE, '&gt;')
    .replace(ESC_QUOT_RE, '&quot;')
}

export function buildSessionPageHtml(
  sessionId: string,
  running: RunningEntry | undefined,
  messages: Array<{ type: string, uuid: string, content: ContentBlock[] }>,
): string {
  const messageRows = messages.map(m => renderMessageRow(m, esc)).join('')
  const title = running ? esc(running.identifier) : esc(sessionId.slice(0, 8))
  const meta = running
    ? `<p>Issue: <strong>${esc(running.identifier)}</strong> — ${esc(running.issue.title)}<br>Turn: ${running.turn_count} | Tokens: ${running.agent_total_tokens}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session — ${title}</title>
<style>
  body { font-family: monospace; margin: 2rem; background: #0f0f0f; color: #d4d4d4; }
  h1 { color: #cba6f7; } h2 { color: #89b4fa; }
  a { color: #89b4fa; }
  pre { overflow-x: auto; }
</style>
</head>
<body>
<p><a href="/">&larr; Dashboard</a></p>
<h1>Session ${esc(sessionId.slice(0, 8))}…</h1>
${meta}
<h2>Conversation</h2>
${messages.length === 0 ? '<p>No messages found.</p>' : messageRows}
<p style="color:#585b70;font-size:0.85rem">Generated ${new Date().toISOString()}</p>
</body>
</html>`
}

// --- helpers ---

export function findRunningBySessionId(state: OrchestratorState, sessionId: string): RunningEntry | undefined {
  for (const entry of state.running.values()) {
    if (entry.session_id === sessionId)
      return entry
  }
  return undefined
}

export function parsePositiveInt(raw: string | null, max = 1000): number | undefined {
  if (raw === null)
    return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0)
    return undefined
  return Math.min(n, max)
}
