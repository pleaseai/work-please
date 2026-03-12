import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Command } from 'commander'
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
  let result: ParsedArgs = {
    command: 'run',
    workflowPath: WORKFLOW_FILE_NAME,
    portOverride: null,
    initOptions: null,
  }

  const program = new Command()
  program.exitOverride()
  program.allowUnknownOption()
  program.allowExcessArguments(true)

  program
    .argument('[workflowPath]', 'path to workflow file')
    .option('--port <number>', 'port to listen on')
    .action((workflowPath: string | undefined, opts: { port?: string }) => {
      let portOverride: number | null = null
      if (opts.port !== undefined) {
        const n = Number.parseInt(opts.port, 10)
        portOverride = (!Number.isNaN(n) && n >= 0) ? n : null
      }
      result = {
        command: 'run',
        workflowPath: workflowPath ?? WORKFLOW_FILE_NAME,
        portOverride,
        initOptions: null,
      }
    })

  program
    .command('init')
    .option('--owner <value>', 'repository owner')
    .option('--title <value>', 'project title')
    .option('--token <value>', 'API token')
    .action(function (this: Command) {
      const opts = this.opts<{ owner?: string, title?: string, token?: string }>()
      result = {
        command: 'init',
        workflowPath: WORKFLOW_FILE_NAME,
        portOverride: null,
        initOptions: {
          owner: opts.owner ?? null,
          title: opts.title ?? null,
          token: opts.token ?? null,
        },
      }
    })

  try {
    program.parse(['node', 'work-please', ...args])
  }
  catch {
    // exitOverride throws CommanderError for --help/--version; ignore
  }

  return result
}
