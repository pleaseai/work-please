import type { ServiceConfig } from './types'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildConfig } from './config'
import {
  createWorkspace,
  removeWorkspace,
  sanitizeIdentifier,
  validateWorkspacePath,
  workspacePath,
} from './workspace'

function makeConfig(root: string, extra: Record<string, unknown> = {}): ServiceConfig {
  return buildConfig({
    config: {
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
      workspace: { root },
      ...extra,
    },
    prompt_template: '',
  })
}

describe('sanitizeIdentifier', () => {
  it('replaces non-alphanumeric characters with underscore', () => {
    expect(sanitizeIdentifier('MT-649')).toBe('MT-649')
    expect(sanitizeIdentifier('#123')).toBe('_123')
    expect(sanitizeIdentifier('foo bar')).toBe('foo_bar')
    expect(sanitizeIdentifier('issue/1')).toBe('issue_1')
  })

  it('preserves allowed chars: letters, digits, dot, hyphen, underscore', () => {
    expect(sanitizeIdentifier('my-issue_2.0')).toBe('my-issue_2.0')
  })

  it('falls back to "issue" for empty string', () => {
    expect(sanitizeIdentifier('')).toBe('issue')
  })
})

describe('workspacePath', () => {
  it('builds path from root and sanitized identifier', () => {
    const config = makeConfig('/tmp/workspaces')
    expect(workspacePath(config, 'MT-649')).toBe('/tmp/workspaces/MT-649')
    expect(workspacePath(config, '#123')).toBe('/tmp/workspaces/_123')
  })
})

describe('validateWorkspacePath', () => {
  it('rejects workspace equal to root', () => {
    const config = makeConfig('/tmp/workspaces')
    const err = validateWorkspacePath(config, '/tmp/workspaces')
    expect(err).not.toBeNull()
    expect(err?.message).toContain('workspace_equals_root')
  })

  it('rejects workspace outside root', () => {
    const config = makeConfig('/tmp/workspaces')
    const err = validateWorkspacePath(config, '/tmp/other')
    expect(err).not.toBeNull()
    expect(err?.message).toContain('workspace_outside_root')
  })

  it('accepts workspace inside root', () => {
    const config = makeConfig('/tmp/workspaces')
    const err = validateWorkspacePath(config, '/tmp/workspaces/MT-649')
    expect(err).toBeNull()
  })
})

describe('createWorkspace', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'conductor-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates a new workspace directory', async () => {
    const config = makeConfig(tmpRoot)
    const result = await createWorkspace(config, 'MT-649')
    expect(result instanceof Error).toBe(false)
    if (result instanceof Error)
      return

    expect(existsSync(result.path)).toBe(true)
    expect(result.created_now).toBe(true)
    expect(result.workspace_key).toBe('MT-649')
  })

  it('reuses an existing workspace directory', async () => {
    const config = makeConfig(tmpRoot)
    mkdirSync(join(tmpRoot, 'MT-649'))
    writeFileSync(join(tmpRoot, 'MT-649', 'existing.txt'), 'data')

    const result = await createWorkspace(config, 'MT-649')
    expect(result instanceof Error).toBe(false)
    if (result instanceof Error)
      return

    expect(result.created_now).toBe(false)
    expect(existsSync(join(result.path, 'existing.txt'))).toBe(true)
  })

  it('runs after_create hook only when workspace is newly created', async () => {
    const flagFile = join(tmpRoot, 'hook-ran')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `touch ${flagFile}` },
    })

    await createWorkspace(config, 'NEW-1')
    expect(existsSync(flagFile)).toBe(true)
  })

  it('does not run after_create hook on workspace reuse', async () => {
    const flagFile = join(tmpRoot, 'hook-ran')
    mkdirSync(join(tmpRoot, 'EXISTING-1'))
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `touch ${flagFile}` },
    })

    await createWorkspace(config, 'EXISTING-1')
    expect(existsSync(flagFile)).toBe(false)
  })
})

describe('removeWorkspace', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'conductor-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('removes workspace directory', async () => {
    const config = makeConfig(tmpRoot)
    mkdirSync(join(tmpRoot, 'MT-1'))
    writeFileSync(join(tmpRoot, 'MT-1', 'file.txt'), 'data')

    await removeWorkspace(config, 'MT-1')
    expect(existsSync(join(tmpRoot, 'MT-1'))).toBe(false)
  })

  it('is a no-op when workspace does not exist', async () => {
    const config = makeConfig(tmpRoot)
    expect(await removeWorkspace(config, 'NONEXISTENT')).toBeUndefined()
  })
})
