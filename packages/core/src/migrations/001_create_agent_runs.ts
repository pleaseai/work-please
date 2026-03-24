import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('agent_runs')
    .ifNotExists()
    .addColumn('id', 'integer', col => col.primaryKey().autoIncrement())
    .addColumn('issue_id', 'text', col => col.notNull())
    .addColumn('identifier', 'text', col => col.notNull())
    .addColumn('issue_state', 'text', col => col.notNull())
    .addColumn('session_id', 'text')
    .addColumn('started_at', 'text', col => col.notNull())
    .addColumn('finished_at', 'text', col => col.notNull())
    .addColumn('duration_ms', 'integer', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('error', 'text')
    .addColumn('turn_count', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('retry_attempt', 'integer')
    .addColumn('input_tokens', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', col => col.notNull().defaultTo(0))
    .addColumn('total_tokens', 'integer', col => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .createIndex('idx_agent_runs_identifier')
    .ifNotExists()
    .on('agent_runs')
    .column('identifier')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('agent_runs').ifExists().execute()
}
