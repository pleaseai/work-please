import { eventIterator } from '@orpc/server'
import { z } from 'zod'

// --- Running Entry ---

export const tokensSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  total_tokens: z.number(),
})

export const runningEntrySchema = z.object({
  issue_id: z.string(),
  issue_identifier: z.string(),
  state: z.string(),
  session_id: z.string().nullable(),
  turn_count: z.number(),
  last_event: z.string().nullable(),
  last_message: z.string().nullable(),
  started_at: z.string(),
  last_event_at: z.string().nullable(),
  tokens: tokensSchema,
})

// --- Retry Entry ---

export const retryEntrySchema = z.object({
  issue_id: z.string(),
  issue_identifier: z.string(),
  attempt: z.number(),
  due_at: z.string(),
  error: z.string().nullable(),
})

// --- State Response ---

export const stateResponseSchema = z.object({
  generated_at: z.string(),
  counts: z.object({
    running: z.number(),
    retrying: z.number(),
  }),
  running: z.array(runningEntrySchema),
  retrying: z.array(retryEntrySchema),
  codex_totals: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    total_tokens: z.number(),
    seconds_running: z.number(),
  }),
  rate_limits: z.unknown(),
})

// --- Issue Detail ---

export const issueDetailInputSchema = z.object({
  identifier: z.string().min(1),
})

export const issueDetailResponseSchema = z.object({
  issue_identifier: z.string(),
  issue_id: z.string(),
  status: z.enum(['running', 'retrying']),
  workspace: z.object({ path: z.string() }),
  attempts: z.object({
    restart_count: z.number(),
    current_retry_attempt: z.number(),
  }),
  running: z.object({
    session_id: z.string().nullable(),
    turn_count: z.number(),
    state: z.string(),
    started_at: z.string(),
    last_event: z.string().nullable(),
    last_message: z.string().nullable(),
    last_event_at: z.string().nullable(),
    tokens: tokensSchema,
  }).nullable(),
  retry: z.object({
    attempt: z.number(),
    due_at: z.string(),
    error: z.string().nullable(),
  }).nullable(),
  recent_events: z.array(z.object({
    at: z.string(),
    event: z.string(),
    message: z.string().nullable(),
  })),
  last_error: z.string().nullable(),
})

// --- Session Messages ---

export const sessionMessagesInputSchema = z.object({
  sessionId: z.string().min(1),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
})

export const sessionMessageBlockSchema = z.object({
  kind: z.enum(['text', 'tool_use']),
  text: z.string().optional(),
  tool_name: z.string().optional(),
  input: z.string().optional(),
})

export const sessionMessageSchema = z.object({
  type: z.string(),
  uuid: z.string(),
  content: z.array(sessionMessageBlockSchema),
})

// --- Refresh ---

export const refreshResponseSchema = z.object({
  queued: z.literal(true),
  requested_at: z.string(),
  operations: z.array(z.string()),
})

// --- Projects ---

export const projectPayloadSchema = z.object({
  index: z.number(),
  platform: z.string(),
  project_number: z.number().nullable().optional(),
  project_id: z.string().nullable().optional(),
  active_statuses: z.array(z.string()),
  terminal_statuses: z.array(z.string()),
  watched_statuses: z.array(z.string()),
})

export const projectsResponseSchema = z.object({
  projects: z.array(projectPayloadSchema),
})

export const projectBoardInputSchema = z.object({
  id: z.number().nonnegative(),
})

export const boardIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  state: z.string(),
  priority: z.number().nullable(),
  url: z.string().nullable(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
})

export const boardColumnSchema = z.object({
  status: z.string(),
  issues: z.array(boardIssueSchema),
  count: z.number(),
})

export const boardResponseSchema = z.object({
  project: projectPayloadSchema,
  columns: z.array(boardColumnSchema),
  generated_at: z.string(),
})

export const boardLiveEventSchema = eventIterator(boardResponseSchema)

// --- SSE Event Iterators ---

export const liveStateEventSchema = eventIterator(stateResponseSchema)

export const sessionEventSchema = eventIterator(z.object({
  type: z.string(),
  timestamp: z.string(),
  data: z.unknown(),
}))
