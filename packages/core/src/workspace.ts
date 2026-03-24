import type { Issue, ServiceConfig, Workspace } from './types'
import { Buffer } from 'node:buffer'
import { spawnSync as nodeSpawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { createLogger } from './logger'

const log = createLogger('workspace')

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json'
const AGENT_PLEASE_URL = 'https://github.com/pleaseai/agent-please'
const ATTRIBUTION_TEXT = `🙏 Generated with [Agent Please](${AGENT_PLEASE_URL})`

export function generateClaudeSettings(attribution?: { commit?: string | null, pr?: string | null }): string {
  return `${JSON.stringify({
    attribution: {
      commit: attribution?.commit ?? ATTRIBUTION_TEXT,
      pr: attribution?.pr ?? ATTRIBUTION_TEXT,
    },
  }, null, 2)}\n`
}

export function ensureClaudeSettings(wsPath: string, attribution?: { commit?: string | null, pr?: string | null }): void {
  const settingsPath = join(wsPath, CLAUDE_SETTINGS_PATH)
  if (existsSync(settingsPath))
    return
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, generateClaudeSettings(attribution), 'utf-8')
}

export interface SpawnSyncResult {
  success: boolean
  exitCode: number | null
  stdout: Buffer
  stderr: Buffer
  signalCode: string | null
}

function spawnSyncCompat(args: string[]): SpawnSyncResult {
  const [cmd, ...rest] = args
  const result = nodeSpawnSync(cmd, rest, { stdio: ['pipe', 'pipe', 'pipe'] })
  return {
    success: result.status === 0,
    exitCode: result.status,
    stdout: Buffer.from(result.stdout ?? ''),
    stderr: Buffer.from(result.stderr ?? ''),
    signalCode: result.signal as string | null,
  }
}

// Thin wrapper around spawnSync — replaced by spyOn(_git, 'spawnSync') in unit tests
export const _git = {
  spawnSync: (args: string[]): SpawnSyncResult => spawnSyncCompat(args),
}

const EXCLUDED_ARTIFACTS = ['.elixir_ls', 'tmp']
const IDENTIFIER_UNSAFE_RE = /[^\w.-]/g
const LEADING_PATH_SEP_RE = /^[/\\]/
const RELATIVE_PARTS_RE = /[/\\]/
const REPO_URL_STRIP_RE = /\/(?:issues|pull)\/\d+/
const REPO_GIT_SUFFIX_RE = /\.git$/
const GITHUB_HTTPS_URL_RE = /^https:\/\/(?:[^@]+@)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/

export function extractRepoUrl(url: string): string | null {
  const match = REPO_URL_STRIP_RE.exec(url)
  return match ? url.slice(0, match.index) : null
}

const GITHUB_HTTPS_PLAIN_RE = /^https:\/\/github\.com\//
const TRAILING_SLASH_RE = /\/$/

export function buildAuthenticatedUrl(repoUrl: string, token?: string | null): string {
  if (!token || !GITHUB_HTTPS_PLAIN_RE.test(repoUrl))
    return repoUrl
  const url = new URL(repoUrl)
  url.username = 'x-access-token'
  url.password = token
  return url.toString().replace(TRAILING_SLASH_RE, '')
}

export function resolveRepoDir(workspaceRoot: string, repoUrl: string): string {
  const url = new URL(repoUrl)
  const parts = url.pathname.replace(REPO_GIT_SUFFIX_RE, '').split('/').filter(Boolean)
  const [owner, repo] = parts.slice(0, 2)
  return join(workspaceRoot, `github-${owner}-${repo}`)
}

export function resolveWorktreePath(workspaceRoot: string, repoUrl: string, branchName: string): string {
  const repoDir = resolveRepoDir(workspaceRoot, repoUrl)
  return join(repoDir, 'worktrees', branchName)
}

function redactToken(text: string, token?: string | null): string {
  if (!token)
    return text
  return text.replaceAll(token, '***')
}

export function ensureSharedClone(repoDir: string, repoUrl: string, token?: string | null): Error | null {
  const authUrl = buildAuthenticatedUrl(repoUrl, token)
  try {
    if (!existsSync(repoDir)) {
      mkdirSync(resolve(repoDir, '..'), { recursive: true })
      const result = _git.spawnSync(['git', 'clone', authUrl, repoDir])
      if (!result.success) {
        const output = redactToken(((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048), token)
        return new Error(`git clone failed: ${output}`)
      }
    }
    else {
      // When token is provided, temporarily set the remote URL to authenticate,
      // then fetch from 'origin'. This avoids writing the token to FETCH_HEAD
      // (git records the raw URL when fetching by URL instead of remote name).
      if (token) {
        _git.spawnSync(['git', '-C', repoDir, 'remote', 'set-url', 'origin', authUrl])
      }
      const result = _git.spawnSync(['git', '-C', repoDir, 'fetch', 'origin'])
      if (token) {
        // Restore the plain URL to avoid persisting the token in .git/config.
        // Always attempt restore regardless of fetch result to prevent token leakage.
        const restoreResult = _git.spawnSync(['git', '-C', repoDir, 'remote', 'set-url', 'origin', repoUrl])
        if (!result.success) {
          const output = redactToken(((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048), token)
          return new Error(`git fetch failed: ${output}`)
        }
        if (!restoreResult.success) {
          const output = redactToken(((restoreResult.stdout?.toString() ?? '') + (restoreResult.stderr?.toString() ?? '')).trim().slice(0, 2048), token)
          return new Error(`git remote restore-url failed: ${output}`)
        }
      }
      else if (!result.success) {
        const output = redactToken(((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048), token)
        return new Error(`git fetch failed: ${output}`)
      }
    }
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  return null
}

export function createWorktree(repoDir: string, wsPath: string, branchName: string): Error | null {
  try {
    rmSync(wsPath, { recursive: true, force: true })
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  try {
    const result = _git.spawnSync(['git', '-C', repoDir, 'worktree', 'add', wsPath, '-b', branchName, 'origin/main'])
    if (!result.success) {
      const output = ((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048)
      return new Error(`git worktree add failed (new branch ${branchName}): ${output}`)
    }
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  return null
}

export function checkoutExistingBranch(repoDir: string, wsPath: string, remoteBranch: string): Error | null {
  try {
    rmSync(wsPath, { recursive: true, force: true })
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  try {
    const result = _git.spawnSync(['git', '-C', repoDir, 'worktree', 'add', wsPath, '-B', remoteBranch, `origin/${remoteBranch}`])
    if (!result.success) {
      const output = ((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048)
      return new Error(`git worktree checkout failed (existing branch origin/${remoteBranch}): ${output}`)
    }
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  return null
}

export function buildHookEnv(issue?: Issue): Record<string, string> {
  if (!issue)
    return {}

  const env: Record<string, string> = {
    WORK_ISSUE_ID: issue.id,
    WORK_ISSUE_IDENTIFIER: issue.identifier,
    WORK_ISSUE_TITLE: issue.title,
  }

  if (issue.url) {
    env.WORK_ISSUE_URL = issue.url
    const repoUrl = extractRepoUrl(issue.url)
    if (repoUrl)
      env.WORK_REPO_URL = repoUrl
  }

  return env
}

const LEADING_HASH_RE = /^#+/

export function sanitizeIdentifier(identifier: string): string {
  const stripped = (identifier || 'issue').replace(LEADING_HASH_RE, '')
  return (stripped || 'issue').replace(IDENTIFIER_UNSAFE_RE, '_')
}

export function applyBranchPrefix(prefix: string | null, name: string): string {
  if (!prefix)
    return name
  return `${prefix}${name}`
}

export function workspacePath(config: ServiceConfig, identifier: string): string {
  const key = sanitizeIdentifier(identifier)
  return join(config.workspace.root, key)
}

export function validateWorkspacePath(config: ServiceConfig, workspacePath: string): Error | null {
  const expandedWorkspace = resolve(workspacePath)
  const root = resolve(config.workspace.root)
  const rootWithSep = root + sep

  if (expandedWorkspace === root) {
    return new Error(`workspace_equals_root: ${expandedWorkspace}`)
  }

  if (!expandedWorkspace.startsWith(rootWithSep) && !(expandedWorkspace + sep).startsWith(rootWithSep)) {
    return new Error(`workspace_outside_root: ${expandedWorkspace} not under ${root}`)
  }

  return checkSymlinks(expandedWorkspace, root)
}

function checkSymlinks(workspace: string, root: string): Error | null {
  const relative = workspace.slice(root.length).replace(LEADING_PATH_SEP_RE, '')
  const parts = relative.split(RELATIVE_PARTS_RE).filter(Boolean)
  let current = root

  for (const part of parts) {
    current = join(current, part)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink()) {
        return new Error(`workspace_symlink_escape: ${current}`)
      }
    }
    catch {
      // path doesn't exist yet — ok
      break
    }
  }
  return null
}

export interface WorkspaceCreateResult {
  workspace: Workspace
  error?: Error
}

export async function createWorkspace(
  config: ServiceConfig,
  identifier: string,
  issue?: Issue,
  token?: string | null,
): Promise<Workspace | Error> {
  const key = sanitizeIdentifier(identifier)
  let createdNow = false

  if (issue?.url) {
    const repoUrl = extractRepoUrl(issue.url)
    if (repoUrl) {
      const repoDir = resolveRepoDir(config.workspace.root, repoUrl)
      const cloneErr = ensureSharedClone(repoDir, repoUrl, token)
      if (cloneErr)
        return cloneErr
      const sanitized = sanitizeIdentifier(issue.identifier)
      const branchName = applyBranchPrefix(config.workspace.branch_prefix, sanitized)
      const wtPath = resolveWorktreePath(config.workspace.root, repoUrl, sanitized)
      if (!existsSync(wtPath)) {
        const wtErr = issue.branch_name
          ? checkoutExistingBranch(repoDir, wtPath, issue.branch_name)
          : createWorktree(repoDir, wtPath, branchName)
        if (wtErr)
          return wtErr
        createdNow = true
      }
      if (createdNow && config.hooks.after_create) {
        const hookErr = runHook(config.hooks.after_create, wtPath, config.hooks.timeout_ms, buildHookEnv(issue))
        if (hookErr)
          return hookErr
      }
      try {
        ensureClaudeSettings(wtPath, config.claude.settings.attribution)
      }
      catch (err) {
        return err instanceof Error ? err : new Error(String(err))
      }
      return { path: wtPath, workspace_key: key, created_now: createdNow }
    }
  }

  const wsPath = join(config.workspace.root, key)

  const validationErr = validateWorkspacePath(config, wsPath)
  if (validationErr)
    return validationErr

  try {
    if (existsSync(wsPath)) {
      const stat = statSync(wsPath)
      if (stat.isDirectory()) {
        cleanArtifacts(wsPath)
      }
      else {
        rmSync(wsPath, { force: true })
        mkdirSync(wsPath, { recursive: true })
        createdNow = true
      }
    }
    else {
      mkdirSync(wsPath, { recursive: true })
      createdNow = true
    }
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }

  const workspace: Workspace = { path: wsPath, workspace_key: key, created_now: createdNow }

  if (createdNow && config.hooks.after_create) {
    const hookErr = runHook(config.hooks.after_create, wsPath, config.hooks.timeout_ms, buildHookEnv(issue))
    if (hookErr)
      return hookErr
  }

  try {
    ensureClaudeSettings(wsPath, config.claude.settings.attribution)
  }
  catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
  return workspace
}

export async function removeWorkspace(config: ServiceConfig, identifier: string, issue?: Issue): Promise<void> {
  if (issue?.url) {
    const repoUrl = extractRepoUrl(issue.url)
    if (repoUrl) {
      const repoDir = resolveRepoDir(config.workspace.root, repoUrl)
      const branchName = sanitizeIdentifier(issue.identifier)
      const wtPath = resolveWorktreePath(config.workspace.root, repoUrl, branchName)

      if (!existsSync(wtPath))
        return

      if (config.hooks.before_remove && statSync(wtPath).isDirectory()) {
        const hookErr = runHook(config.hooks.before_remove, wtPath, config.hooks.timeout_ms, buildHookEnv(issue))
        if (hookErr) {
          log.warn(`before_remove hook failed (ignored): ${hookErr.message}`)
        }
      }

      try {
        const result = _git.spawnSync(['git', '-C', repoDir, 'worktree', 'remove', wtPath, '--force'])
        if (!result.success) {
          const output = ((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048)
          log.warn(`git worktree remove failed (ignored): ${output}`)
        }
      }
      catch (err) {
        log.warn(`git worktree remove spawn failed (ignored): ${err instanceof Error ? err.message : String(err)}`)
      }

      try {
        rmSync(wtPath, { recursive: true, force: true })
      }
      catch (err) {
        log.error(`workspace remove failed: ${err}`)
      }
      return
    }
  }

  const key = sanitizeIdentifier(identifier)
  const wsPath = join(config.workspace.root, key)

  if (!existsSync(wsPath))
    return

  const validationErr = validateWorkspacePath(config, wsPath)
  if (validationErr) {
    log.error(`workspace remove validation failed: ${validationErr.message}`)
    return
  }

  if (config.hooks.before_remove && statSync(wsPath).isDirectory()) {
    const hookErr = runHook(config.hooks.before_remove, wsPath, config.hooks.timeout_ms, buildHookEnv(issue))
    if (hookErr) {
      log.warn(`before_remove hook failed (ignored): ${hookErr.message}`)
    }
  }

  try {
    rmSync(wsPath, { recursive: true, force: true })
  }
  catch (err) {
    log.error(`workspace remove failed: ${err}`)
  }
}

export async function runBeforeRunHook(config: ServiceConfig, wsPath: string, issue?: Issue): Promise<Error | null> {
  if (!config.hooks.before_run)
    return null
  return runHook(config.hooks.before_run, wsPath, config.hooks.timeout_ms, buildHookEnv(issue))
}

export async function runAfterRunHook(config: ServiceConfig, wsPath: string, issue?: Issue): Promise<void> {
  if (!config.hooks.after_run)
    return
  const err = runHook(config.hooks.after_run, wsPath, config.hooks.timeout_ms, buildHookEnv(issue))
  if (err) {
    log.warn(`after_run hook failed (ignored): ${err.message}`)
  }
}

export function runHook(script: string, cwd: string, timeoutMs: number, env: Record<string, string> = {}): Error | null {
  let result: SpawnSyncResult
  try {
    const r = nodeSpawnSync('sh', ['-lc', script], {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (r.error) {
      return new Error(`hook spawn failed: ${r.error.message}`)
    }
    result = {
      success: r.status === 0,
      exitCode: r.status,
      stdout: Buffer.from(r.stdout ?? ''),
      stderr: Buffer.from(r.stderr ?? ''),
      signalCode: r.signal as string | null,
    }
  }
  catch (err) {
    return new Error(`hook spawn failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (result.exitCode === null) {
    const signal = result.signalCode ?? 'unknown'
    return new Error(`hook timeout after ${timeoutMs}ms (signal: ${signal})`)
  }

  if (!result.success) {
    const raw = ((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).trim().slice(0, 2048)
    const output = raw.length > 0 ? raw : '(no output captured)'
    return new Error(`hook exited with status ${result.exitCode}: ${output}`)
  }

  return null
}

export function configureRemoteAuth(wsPath: string, token: string): void {
  // Read current remote URL
  const result = _git.spawnSync(['git', '-C', wsPath, 'remote', 'get-url', 'origin'])
  if (!result.success) {
    log.warn(`configureRemoteAuth: failed to read remote URL for ${wsPath}`)
    return
  }
  const currentUrl = result.stdout.toString().trim()
  if (!currentUrl)
    return

  // Extract owner/repo from HTTPS URL (e.g., https://github.com/owner/repo.git)
  const match = currentUrl.match(GITHUB_HTTPS_URL_RE)
  if (!match) {
    log.warn('configureRemoteAuth: unsupported remote URL format for origin')
    return
  }
  const repoPath = match[1]
  const authUrl = `https://x-access-token:${token}@github.com/${repoPath}.git`

  const setResult = _git.spawnSync(['git', '-C', wsPath, 'remote', 'set-url', 'origin', authUrl])
  if (!setResult.success) {
    log.warn(`configureRemoteAuth: failed to set remote URL for ${wsPath}`)
  }
}

function cleanArtifacts(wsPath: string): void {
  for (const entry of EXCLUDED_ARTIFACTS) {
    const target = join(wsPath, entry)
    if (existsSync(target)) {
      try {
        rmSync(target, { recursive: true, force: true })
      }
      catch {}
    }
  }
}
