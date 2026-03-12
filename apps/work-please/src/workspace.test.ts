import type { Issue, ServiceConfig } from './types'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildConfig } from './config'
import {
  buildHookEnv,
  createWorkspace,
  extractRepoUrl,
  removeWorkspace,
  runAfterRunHook,
  runBeforeRunHook,
  sanitizeIdentifier,
  validateWorkspacePath,
  workspacePath,
} from './workspace'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'PVTI_abc123',
    identifier: '#42',
    title: 'Fix login bug',
    description: null,
    priority: null,
    state: 'Todo',
    branch_name: null,
    url: 'https://github.com/org/repo/issues/42',
    labels: [],
    blocked_by: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

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
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-test-'))
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

  it('replaces existing non-directory file at workspace path', async () => {
    const wsPath = join(tmpRoot, 'MT-888')
    writeFileSync(wsPath, 'not a directory')

    const config = makeConfig(tmpRoot)
    const result = await createWorkspace(config, 'MT-888')
    expect(result instanceof Error).toBe(false)
    if (result instanceof Error)
      return

    expect(existsSync(result.path)).toBe(true)
    expect(result.created_now).toBe(true)
  })

  it('removes artifact directories (tmp, .elixir_ls) during workspace prep', async () => {
    const wsPath = join(tmpRoot, 'MT-999')
    mkdirSync(wsPath)
    mkdirSync(join(wsPath, 'tmp'))
    mkdirSync(join(wsPath, '.elixir_ls'))
    writeFileSync(join(wsPath, 'keep.txt'), 'data')

    const config = makeConfig(tmpRoot)
    await createWorkspace(config, 'MT-999')

    expect(existsSync(join(wsPath, 'tmp'))).toBe(false)
    expect(existsSync(join(wsPath, '.elixir_ls'))).toBe(false)
    expect(existsSync(join(wsPath, 'keep.txt'))).toBe(true)
  })

  it('rejects symlink escape under the configured root (Section 17.2)', async () => {
    // Create a symlink at the workspace path that points outside the root
    const symlinkPath = join(tmpRoot, 'SYMLINK-1')
    symlinkSync('/tmp', symlinkPath)

    const config = makeConfig(tmpRoot)
    const result = await createWorkspace(config, 'SYMLINK-1')
    expect(result instanceof Error).toBe(true)
    if (result instanceof Error) {
      expect(result.message).toContain('workspace_symlink_escape')
    }

    rmSync(symlinkPath)
  })

  it('runs after_create hook only when workspace is newly created', async () => {
    const flagFile = join(tmpRoot, 'hook-ran')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `touch ${flagFile}` },
    })

    await createWorkspace(config, 'NEW-1')
    expect(existsSync(flagFile)).toBe(true)
  })

  it('supports multiline hook scripts (Section 17.2)', async () => {
    const file1 = join(tmpRoot, 'multiline-step1')
    const file2 = join(tmpRoot, 'multiline-step2')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `touch ${file1}\ntouch ${file2}` },
    })

    await createWorkspace(config, 'MULTI-1')
    expect(existsSync(file1)).toBe(true)
    expect(existsSync(file2)).toBe(true)
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

describe('runBeforeRunHook', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('returns null when no before_run hook configured', async () => {
    const config = makeConfig(tmpRoot)
    const err = await runBeforeRunHook(config, tmpRoot)
    expect(err).toBeNull()
  })

  it('runs before_run hook and returns null on success', async () => {
    const flagFile = join(tmpRoot, 'before-run-ran')
    const config = makeConfig(tmpRoot, {
      hooks: { before_run: `touch ${flagFile}` },
    })
    const err = await runBeforeRunHook(config, tmpRoot)
    expect(err).toBeNull()
    expect(existsSync(flagFile)).toBe(true)
  })

  it('returns Error when before_run hook exits nonzero', async () => {
    const config = makeConfig(tmpRoot, {
      hooks: { before_run: 'exit 1' },
    })
    const err = await runBeforeRunHook(config, tmpRoot)
    expect(err).not.toBeNull()
    expect(err?.message).toContain('status 1')
  })

  it('returns Error when before_run hook times out (hooks.timeout_ms)', async () => {
    const config = makeConfig(tmpRoot, {
      hooks: { before_run: 'sleep 10', timeout_ms: 200 },
    })
    const err = await runBeforeRunHook(config, tmpRoot)
    expect(err).not.toBeNull()
    expect(err?.message).toContain('hook timeout')
  })
})

describe('runAfterRunHook', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('does nothing when no after_run hook configured', async () => {
    const config = makeConfig(tmpRoot)
    await expect(runAfterRunHook(config, tmpRoot)).resolves.toBeUndefined()
  })

  it('runs after_run hook and logs (does not throw) on failure', async () => {
    const config = makeConfig(tmpRoot, {
      hooks: { after_run: 'exit 2' },
    })
    await expect(runAfterRunHook(config, tmpRoot)).resolves.toBeUndefined()
  })
})

describe('removeWorkspace', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-test-'))
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

  it('runs before_remove hook before removing workspace', async () => {
    const wsPath = join(tmpRoot, 'MT-BR')
    mkdirSync(wsPath)
    const flagFile = join(tmpRoot, 'before-remove-ran')
    const config = makeConfig(tmpRoot, {
      hooks: { before_remove: `touch ${flagFile}` },
    })

    await removeWorkspace(config, 'MT-BR')
    expect(existsSync(wsPath)).toBe(false)
    expect(existsSync(flagFile)).toBe(true)
  })

  it('ignores before_remove hook failure and still removes workspace', async () => {
    const wsPath = join(tmpRoot, 'MT-BRF')
    mkdirSync(wsPath)
    const config = makeConfig(tmpRoot, {
      hooks: { before_remove: 'exit 1' },
    })

    await removeWorkspace(config, 'MT-BRF')
    expect(existsSync(wsPath)).toBe(false)
  })

  it('ignores before_remove hook failure with large output and still removes workspace (Section 17.2)', async () => {
    const wsPath = join(tmpRoot, 'MT-BRL')
    mkdirSync(wsPath)
    // Produce >2048 bytes of output before exiting with non-zero status
    const config = makeConfig(tmpRoot, {
      hooks: { before_remove: 'i=0; while [ $i -lt 3000 ]; do printf a; i=$((i+1)); done; exit 17' },
    })

    await removeWorkspace(config, 'MT-BRL')
    expect(existsSync(wsPath)).toBe(false)
  })
})

describe('extractRepoUrl', () => {
  it('extracts repo URL from GitHub issue URL', () => {
    expect(extractRepoUrl('https://github.com/org/repo/issues/42')).toBe('https://github.com/org/repo')
  })

  it('extracts repo URL from GitHub PR URL', () => {
    expect(extractRepoUrl('https://github.com/org/repo/pull/5')).toBe('https://github.com/org/repo')
  })

  it('returns null for URL without /issues/ or /pull/ segment', () => {
    expect(extractRepoUrl('https://linear.app/team/issue/MT-42')).toBeNull()
  })

  it('returns null for bare repo URL', () => {
    expect(extractRepoUrl('https://github.com/org/repo')).toBeNull()
  })

  it('strips query string after issue number', () => {
    expect(extractRepoUrl('https://github.com/org/repo/issues/42?tab=timeline')).toBe('https://github.com/org/repo')
  })

  it('strips fragment after issue number', () => {
    expect(extractRepoUrl('https://github.com/org/repo/issues/42#issuecomment-123')).toBe('https://github.com/org/repo')
  })
})

describe('buildHookEnv', () => {
  it('returns empty object when no issue provided', () => {
    expect(buildHookEnv()).toEqual({})
    expect(buildHookEnv(undefined)).toEqual({})
  })

  it('sets WORK_ISSUE_* vars from issue fields', () => {
    const env = buildHookEnv(makeIssue())
    expect(env.WORK_ISSUE_ID).toBe('PVTI_abc123')
    expect(env.WORK_ISSUE_IDENTIFIER).toBe('#42')
    expect(env.WORK_ISSUE_TITLE).toBe('Fix login bug')
    expect(env.WORK_ISSUE_URL).toBe('https://github.com/org/repo/issues/42')
    expect(env.WORK_REPO_URL).toBe('https://github.com/org/repo')
  })

  it('omits WORK_ISSUE_URL and WORK_REPO_URL when url is null', () => {
    const env = buildHookEnv(makeIssue({ url: null }))
    expect(env.WORK_ISSUE_ID).toBe('PVTI_abc123')
    expect('WORK_ISSUE_URL' in env).toBe(false)
    expect('WORK_REPO_URL' in env).toBe(false)
  })

  it('omits WORK_REPO_URL when URL does not match GitHub issue/PR pattern', () => {
    const env = buildHookEnv(makeIssue({ url: 'https://linear.app/team/issue/MT-42' }))
    expect(env.WORK_ISSUE_URL).toBe('https://linear.app/team/issue/MT-42')
    expect('WORK_REPO_URL' in env).toBe(false)
  })

  it('extracts WORK_REPO_URL from GitHub PR URL', () => {
    const env = buildHookEnv(makeIssue({ url: 'https://github.com/org/repo/pull/99' }))
    expect(env.WORK_REPO_URL).toBe('https://github.com/org/repo')
  })
})

describe('hook env var injection', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'work-please-env-test-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('after_create hook receives WORK_ISSUE_* env vars', async () => {
    const envFile = join(tmpRoot, 'env-out.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `printenv WORK_ISSUE_ID > ${envFile}` },
    })
    const issue = makeIssue()

    await createWorkspace(config, 'ENV-1', issue)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(envFile, 'utf-8').trim()).toBe('PVTI_abc123')
  })

  it('after_create hook receives WORK_REPO_URL env var', async () => {
    const envFile = join(tmpRoot, 'repo-url-out.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `printenv WORK_REPO_URL > ${envFile}` },
    })
    const issue = makeIssue()

    await createWorkspace(config, 'ENV-2', issue)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(envFile, 'utf-8').trim()).toBe('https://github.com/org/repo')
  })

  it('before_run hook receives WORK_ISSUE_* env vars', async () => {
    const wsPath = join(tmpRoot, 'ws-before-run')
    mkdirSync(wsPath)
    const envFile = join(tmpRoot, 'before-run-env.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { before_run: `printenv WORK_ISSUE_TITLE > ${envFile}` },
    })
    const issue = makeIssue()

    await runBeforeRunHook(config, wsPath, issue)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(envFile, 'utf-8').trim()).toBe('Fix login bug')
  })

  it('after_run hook receives WORK_ISSUE_* env vars', async () => {
    const wsPath = join(tmpRoot, 'ws-after-run')
    mkdirSync(wsPath)
    const envFile = join(tmpRoot, 'after-run-env.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { after_run: `printenv WORK_ISSUE_IDENTIFIER > ${envFile}` },
    })
    const issue = makeIssue()

    await runAfterRunHook(config, wsPath, issue)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(envFile, 'utf-8').trim()).toBe('#42')
  })

  it('before_remove hook receives WORK_ISSUE_* env vars', async () => {
    const wsPath = join(tmpRoot, 'ws-before-remove')
    mkdirSync(wsPath)
    const envFile = join(tmpRoot, 'before-remove-env.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { before_remove: `printenv WORK_ISSUE_ID > ${envFile}` },
    })
    const issue = makeIssue()

    await removeWorkspace(config, 'ws-before-remove', issue)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(envFile, 'utf-8').trim()).toBe('PVTI_abc123')
  })

  it('hook still works when no issue provided (no WORK_* vars set)', async () => {
    const envFile = join(tmpRoot, 'no-issue-env.txt')
    const config = makeConfig(tmpRoot, {
      hooks: { after_create: `touch ${envFile}` },
    })

    await createWorkspace(config, 'ENV-3')
    expect(existsSync(envFile)).toBe(true)
  })
})
