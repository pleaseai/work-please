import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { Command, CommanderError } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { runInit } from './init'
import { createLogger, setVerbose } from './logger'
import { Orchestrator } from './orchestrator'
import { HttpServer } from './server'
import { WORKFLOW_FILE_NAME } from './workflow'

const log = createLogger('cli')

export interface ParsedArgs {
  command: 'run' | 'init' | 'version' | 'help'
  workflowPath: string
  portOverride: number | null
  verbose: boolean
  initOptions: { owner: string | null, title: string | null, token: string | null } | null
}

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv.slice(2))

  if (parsed.verbose) {
    setVerbose(true)
  }

  if (parsed.command === 'version' || parsed.command === 'help')
    return

  if (parsed.command === 'init') {
    await runInit(parsed.initOptions!)
    return
  }

  const resolvedPath = resolve(parsed.workflowPath)

  if (!existsSync(resolvedPath)) {
    log.fatal(`workflow file not found: ${resolvedPath}`)
    process.exit(1)
  }

  let orchestrator: Orchestrator
  try {
    orchestrator = new Orchestrator(resolvedPath)
  }
  catch (err) {
    log.fatal(`failed to initialize please-work: ${err}`)
    process.exit(1)
  }

  let httpServer: HttpServer | null = null

  // Graceful shutdown
  const shutdown = () => {
    log.info('shutting down...')
    httpServer?.stop()
    orchestrator.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  log.info(`starting with workflow: ${resolvedPath}`)
  try {
    await orchestrator.start()
    log.success('running')
  }
  catch (err) {
    log.fatal(`startup failed: ${err}`)
    process.exit(1)
  }

  // Start optional HTTP server (CLI --port overrides config server.port)
  const config = orchestrator.getConfig()
  const serverPort = parsed.portOverride ?? config.server.port
  if (serverPort !== null) {
    httpServer = new HttpServer(orchestrator, serverPort)
    const boundPort = httpServer.start()
    log.info(`http server listening on 127.0.0.1:${boundPort}`)
  }
}

function registerInitCommand(program: Command, onResult: (r: ParsedArgs) => void): void {
  program
    .command('init')
    .allowUnknownOption()
    .allowExcessArguments(true)
    .option('--owner <value>', 'repository owner')
    .option('--title <value>', 'project title')
    .option('--token <value>', 'API token')
    .action((opts: { owner?: string, title?: string, token?: string }) => {
      onResult({
        command: 'init',
        workflowPath: WORKFLOW_FILE_NAME,
        portOverride: null,
        verbose: false,
        initOptions: {
          owner: opts.owner ?? null,
          title: opts.title ?? null,
          token: opts.token ?? null,
        },
      })
    })
}

export function parseArgs(args: string[]): ParsedArgs {
  let result: ParsedArgs = {
    command: 'run',
    workflowPath: WORKFLOW_FILE_NAME,
    portOverride: null,
    verbose: false,
    initOptions: null,
  }

  const program = new Command()
  program.version(pkg.version)
  program.exitOverride()
  program.allowUnknownOption()
  program.allowExcessArguments(true)
  program.option('--verbose', 'enable verbose/debug logging')

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
        verbose: false,
        initOptions: null,
      }
    })

  registerInitCommand(program, (r) => {
    result = r
  })

  try {
    program.parse(['node', 'please-work', ...args])
  }
  catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.version') {
        const globalOpts = program.opts<{ verbose?: boolean }>()
        return { ...result, command: 'version', verbose: globalOpts.verbose === true }
      }
      const informational = new Set(['commander.help', 'commander.helpDisplayed'])
      if (informational.has(err.code)) {
        const globalOpts = program.opts<{ verbose?: boolean }>()
        return { ...result, command: 'help', verbose: globalOpts.verbose === true }
      }
      log.error(err.message)
      process.exit(err.exitCode)
    }
    throw err
  }

  // Read global --verbose option from program level
  const globalOpts = program.opts<{ verbose?: boolean }>()
  result.verbose = globalOpts.verbose === true

  return result
}
