import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'
import { parseArgs } from './cli'

describe('parseArgs - init subcommand', () => {
  it('detects init as first positional arg and sets command to init', () => {
    const result = parseArgs(['init'])
    expect(result.command).toBe('init')
    expect(result.initOptions).not.toBeNull()
  })

  it('parses --owner flag with space separator', () => {
    const result = parseArgs(['init', '--owner', 'myorg'])
    expect(result.command).toBe('init')
    expect(result.initOptions?.owner).toBe('myorg')
  })

  it('parses --owner= flag with equals separator', () => {
    const result = parseArgs(['init', '--owner=myorg'])
    expect(result.command).toBe('init')
    expect(result.initOptions?.owner).toBe('myorg')
  })

  it('parses --title flag', () => {
    const result = parseArgs(['init', '--title', 'My Project'])
    expect(result.initOptions?.title).toBe('My Project')
  })

  it('parses --title= flag with equals separator', () => {
    const result = parseArgs(['init', '--title=My Project'])
    expect(result.initOptions?.title).toBe('My Project')
  })

  it('parses --token flag', () => {
    const result = parseArgs(['init', '--token', 'ghp_xxx'])
    expect(result.initOptions?.token).toBe('ghp_xxx')
  })

  it('parses --token= flag with equals separator', () => {
    const result = parseArgs(['init', '--token=ghp_xxx'])
    expect(result.initOptions?.token).toBe('ghp_xxx')
  })

  it('parses multiple init flags together', () => {
    const result = parseArgs(['init', '--owner', 'myorg', '--title', 'My Board', '--token', 'tok123'])
    expect(result.command).toBe('init')
    expect(result.initOptions?.owner).toBe('myorg')
    expect(result.initOptions?.title).toBe('My Board')
    expect(result.initOptions?.token).toBe('tok123')
  })

  it('defaults all init option fields to null when no flags provided', () => {
    const result = parseArgs(['init'])
    expect(result.initOptions?.owner).toBeNull()
    expect(result.initOptions?.title).toBeNull()
    expect(result.initOptions?.token).toBeNull()
  })

  it('defaults command to run when no init subcommand', () => {
    const result = parseArgs([])
    expect(result.command).toBe('run')
    expect(result.initOptions).toBeNull()
  })

  it('defaults command to run when workflow path is provided', () => {
    const result = parseArgs(['my.md'])
    expect(result.command).toBe('run')
    expect(result.workflowPath).toBe('my.md')
    expect(result.initOptions).toBeNull()
  })

  it('does not treat --owner flag without init as init command', () => {
    const result = parseArgs(['--owner', 'myorg'])
    expect(result.command).toBe('run')
  })
})

describe('parseArgs - workflow path', () => {
  it('uses WORKFLOW.md default when no positional arg is provided', () => {
    const result = parseArgs([])
    expect(result.workflowPath).toBe('WORKFLOW.md')
    expect(result.portOverride).toBeNull()
  })

  it('uses explicit positional path argument', () => {
    const result = parseArgs(['/path/to/MY_WORKFLOW.md'])
    expect(result.workflowPath).toBe('/path/to/MY_WORKFLOW.md')
  })

  it('uses first positional arg when multiple are given', () => {
    const result = parseArgs(['first.md', 'second.md'])
    expect(result.workflowPath).toBe('first.md')
  })
})

describe('parseArgs - --port flag', () => {
  it('parses --port <value> with space separator', () => {
    const result = parseArgs(['--port', '8080'])
    expect(result.portOverride).toBe(8080)
  })

  it('parses --port=<value> with equals separator', () => {
    const result = parseArgs(['--port=3000'])
    expect(result.portOverride).toBe(3000)
  })

  it('accepts port 0 for ephemeral binding', () => {
    const result = parseArgs(['--port', '0'])
    expect(result.portOverride).toBe(0)
  })

  it('ignores --port with non-numeric value', () => {
    const result = parseArgs(['--port', 'abc'])
    expect(result.portOverride).toBeNull()
  })

  it('parses --port with workflow path together', () => {
    const result = parseArgs(['my.md', '--port', '9000'])
    expect(result.workflowPath).toBe('my.md')
    expect(result.portOverride).toBe(9000)
  })

  it('returns null portOverride when --port not provided', () => {
    const result = parseArgs(['my.md'])
    expect(result.portOverride).toBeNull()
  })
})

describe('parseArgs - --version / -V flag', () => {
  it('does not throw when --version is passed', () => {
    expect(() => parseArgs(['--version'])).not.toThrow()
  })

  it('does not throw when -V is passed', () => {
    expect(() => parseArgs(['-V'])).not.toThrow()
  })
})

describe('CLI startup - nonexistent workflow path (Section 17.7)', () => {
  it('exits nonzero when explicit workflow path does not exist', () => {
    // Use import.meta.dir (Bun) to find the app root regardless of test cwd
    const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const result = Bun.spawnSync(['bun', 'run', 'src/index.ts', '/nonexistent/WORKFLOW.md'], {
      cwd: appDir,
      timeout: 5000,
    })
    expect(result.exitCode).not.toBe(0)
    const output = [result.stderr, result.stdout]
      .map(b => b?.toString() ?? '')
      .join('')
    expect(output).toContain('workflow file not found')
  })

  it('exits nonzero when default WORKFLOW.md is missing from cwd (Section 17.7)', () => {
    const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    // Run without explicit path from a directory that has no WORKFLOW.md (the src/ dir itself)
    const indexPath = resolve(appDir, 'src/index.ts')
    const result = Bun.spawnSync(['bun', 'run', indexPath], {
      cwd: resolve(appDir, 'src'),
      timeout: 5000,
    })
    expect(result.exitCode).not.toBe(0)
    const output = [result.stderr, result.stdout]
      .map(b => b?.toString() ?? '')
      .join('')
    expect(output).toContain('workflow file not found')
  })
})
