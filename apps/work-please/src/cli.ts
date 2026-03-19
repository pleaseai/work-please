import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { setVerbose } from '@pleaseai/core'
import { Command, CommanderError } from 'commander'
import pkg from '../package.json' with { type: 'json' }
import { runInit } from './init'

export interface ParsedArgs {
  command: 'run' | 'init' | 'version' | 'help'
  workflowPath: string
  portOverride: number | null
  verbose: boolean
  initOptions: { owner: string | null, title: string | null, token: string | null } | null
}

const WORKFLOW_FILE_NAME = 'WORKFLOW.md'

export async function runCli(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv.slice(2))

  if (parsed.command === 'version' || parsed.command === 'help')
    return

  if (parsed.command === 'init') {
    await runInit(parsed.initOptions!)
    return
  }

  const resolvedPath = resolve(parsed.workflowPath)

  if (!existsSync(resolvedPath)) {
    console.error(`[work-please] workflow file not found: ${resolvedPath}`)
    process.exit(1)
  }

  // Set environment variables for the Nuxt/Nitro server
  // NUXT_ prefix required for Nuxt runtimeConfig auto-mapping
  process.env.NUXT_WORKFLOW_PATH = resolvedPath
  if (parsed.portOverride !== null) {
    process.env.PORT = String(parsed.portOverride)
  }
  if (parsed.verbose) {
    process.env.VERBOSE = 'true'
    setVerbose(true)
  }

  // Start the Nuxt server
  console.log(`[work-please] starting with workflow: ${resolvedPath}`)
  try {
    // Compute path at runtime to prevent bun build from bundling Nuxt output
    const serverEntry = resolve(import.meta.dir, '..', '.output', 'server', 'index.mjs')
    await import(serverEntry)
  }
  catch (err) {
    console.error('[work-please] failed to start server:', err)
    process.exit(1)
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
    program.parse(['node', 'work-please', ...args])
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
      console.error(err.message)
      process.exit(err.exitCode)
    }
    throw err
  }

  const globalOpts = program.opts<{ verbose?: boolean }>()
  result.verbose = globalOpts.verbose === true

  return result
}
