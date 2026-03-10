import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Orchestrator } from './orchestrator'
import { HttpServer } from './server'
import { WORKFLOW_FILE_NAME } from './workflow'

export async function runCli(argv: string[]): Promise<void> {
  const { workflowPath, portOverride } = parseArgs(argv.slice(2))
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
    console.error(`Error: failed to initialize work-please: ${err}`)
    process.exit(1)
  }

  let httpServer: HttpServer | null = null

  // Graceful shutdown
  const shutdown = () => {
    console.warn('[work-please] shutting down...')
    httpServer?.stop()
    orchestrator.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.warn(`[work-please] starting with workflow: ${resolvedPath}`)
  try {
    await orchestrator.start()
    console.warn('[work-please] running')
  }
  catch (err) {
    console.error(`[work-please] startup failed: ${err}`)
    process.exit(1)
  }

  // Start optional HTTP server (CLI --port overrides config server.port)
  const config = orchestrator.getConfig()
  const serverPort = portOverride ?? config.server.port
  if (serverPort !== null) {
    httpServer = new HttpServer(orchestrator, serverPort)
    const boundPort = httpServer.start()
    console.warn(`[work-please] http server listening on 127.0.0.1:${boundPort}`)
  }
}

export function parseArgs(args: string[]): { workflowPath: string, portOverride: number | null } {
  let portOverride: number | null = null
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      const n = Number.parseInt(args[i + 1], 10)
      if (!Number.isNaN(n) && n >= 0)
        portOverride = n
      i++
    }
    else if (args[i].startsWith('--port=')) {
      const n = Number.parseInt(args[i].slice(7), 10)
      if (!Number.isNaN(n) && n >= 0)
        portOverride = n
    }
    else {
      positional.push(args[i])
    }
  }

  return {
    workflowPath: positional[0] ?? WORKFLOW_FILE_NAME,
    portOverride,
  }
}
