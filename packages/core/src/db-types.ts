import type { ColumnType, Generated } from 'kysely'

/**
 * Kysely table interface for the `agent_runs` table.
 *
 * Column type conventions:
 * - `Generated<T>` — autoincrement / server-generated (omit on insert)
 * - `ColumnType<SelectType, InsertType, UpdateType>` — used when insert differs from select
 *   (e.g. columns with DEFAULT values accept `number | undefined` on insert)
 */
export interface AgentRunsTable {
  id: Generated<number>
  issue_id: string
  identifier: string
  issue_state: string
  session_id: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  status: string
  error: string | null
  /** DEFAULT 0 — optional on insert */
  turn_count: ColumnType<number, number | undefined, number>
  retry_attempt: number | null
  /** DEFAULT 0 — optional on insert */
  input_tokens: ColumnType<number, number | undefined, number>
  /** DEFAULT 0 — optional on insert */
  output_tokens: ColumnType<number, number | undefined, number>
  /** DEFAULT 0 — optional on insert */
  total_tokens: ColumnType<number, number | undefined, number>
}

export interface AppDatabase {
  agent_runs: AgentRunsTable
}
