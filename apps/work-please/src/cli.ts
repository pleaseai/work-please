import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { runInit } from './init'
import { Orchestrator } from './orchestrator'
import { HttpServer } from './server'
import { WORKFLOW_FILE_NAME } from './workflow'

export interface ParsedArgs {
  command: 'run' | 'init'
  workflowPath: string
  portOverride: number | null
  initOptions: { owner: string | null, title: string | null, token: string | null } | null
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv.slice(2))

  if (parsed.command === 'init') {
    await runInit(parsed.initOptions!)
    return
  }

  const resolvedPath = resolve(parsed.workflowPath)

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
  const serverPort = parsed.portOverride ?? config.server.port
  if (serverPort !== null) {
    httpServer = new HttpServer(orchestrator, serverPort)
    const boundPort = httpServer.start()
    console.warn(`[work-please] http server listening on 127.0.0.1:${boundPort}`)
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  // Check if first positional arg is 'init'
  if (args[0] === 'init') {
    return parseInitArgs(args.slice(1))
  }

  return parseRunArgs(args)
}

function parseInitArgs(args: string[]): ParsedArgs {
  let owner: string | null = null
  let title: string | null = null
  let token: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--owner' && i + 1 < args.length) {
      owner = args[i + 1]
      i++
    }
    else if (args[i].startsWith('--owner=')) {
      owner = args[i].slice(8)
    }
    else if (args[i] === '--title' && i + 1 < args.length) {
      title = args[i + 1]
      i++
    }
    else if (args[i].startsWith('--title=')) {
      title = args[i].slice(8)
    }
    else if (args[i] === '--token' && i + 1 < args.length) {
      token = args[i + 1]
      i++
    }
    else if (args[i].startsWith('--token=')) {
      token = args[i].slice(8)
    }
  }

  return {
    command: 'init',
    workflowPath: WORKFLOW_FILE_NAME,
    portOverride: null,
    initOptions: { owner, title, token },
  }
}

function parseRunArgs(args: string[]): ParsedArgs {
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
    command: 'run',
    workflowPath: positional[0] ?? WORKFLOW_FILE_NAME,
    portOverride,
    initOptions: null,
  }
}
