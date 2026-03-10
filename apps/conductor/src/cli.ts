import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Orchestrator } from './orchestrator'
import { WORKFLOW_FILE_NAME } from './workflow'

export async function runCli(argv: string[]): Promise<void> {
  // Parse args: conductor [workflow-path]
  const args = argv.slice(2)
  const workflowPath = args[0] ?? WORKFLOW_FILE_NAME

  const resolvedPath = resolve(workflowPath)

  if (!existsSync(resolvedPath)) {
    console.error(`Error: workflow file not found: ${resolvedPath}`)
    process.exit(1)
  }

  let orchestrator: Orchestrator
  try {
    orchestrator = new Orchestrator(resolvedPath)
  }
  catch (err) {
    console.error(`Error: failed to initialize conductor: ${err}`)
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = () => {
    console.warn('[conductor] shutting down...')
    orchestrator.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.warn(`[conductor] starting with workflow: ${resolvedPath}`)
  try {
    await orchestrator.start()
    console.warn('[conductor] running')
  }
  catch (err) {
    console.error(`[conductor] startup failed: ${err}`)
    process.exit(1)
  }
}
