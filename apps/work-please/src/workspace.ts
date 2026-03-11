import type { Issue, ServiceConfig, Workspace } from './types'
import { existsSync, lstatSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import process from 'node:process'

const EXCLUDED_ARTIFACTS = ['.elixir_ls', 'tmp']
const IDENTIFIER_UNSAFE_RE = /[^\w.-]/g
const LEADING_PATH_SEP_RE = /^[/\\]/
const RELATIVE_PARTS_RE = /[/\\]/
const REPO_URL_STRIP_RE = /\/(?:issues|pull)\/\d+/

export function extractRepoUrl(url: string): string | null {
  const match = REPO_URL_STRIP_RE.exec(url)
  return match ? url.slice(0, match.index) : null
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

export function sanitizeIdentifier(identifier: string): string {
  return (identifier || 'issue').replace(IDENTIFIER_UNSAFE_RE, '_')
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
): Promise<Workspace | Error> {
  const key = sanitizeIdentifier(identifier)
  const wsPath = join(config.workspace.root, key)

  const validationErr = validateWorkspacePath(config, wsPath)
  if (validationErr)
    return validationErr

  let createdNow = false
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

  return workspace
}

export async function removeWorkspace(config: ServiceConfig, identifier: string, issue?: Issue): Promise<void> {
  const key = sanitizeIdentifier(identifier)
  const wsPath = join(config.workspace.root, key)

  if (!existsSync(wsPath))
    return

  const validationErr = validateWorkspacePath(config, wsPath)
  if (validationErr) {
    console.error(`workspace remove validation failed: ${validationErr.message}`)
    return
  }

  if (config.hooks.before_remove && statSync(wsPath).isDirectory()) {
    const hookErr = runHook(config.hooks.before_remove, wsPath, config.hooks.timeout_ms, buildHookEnv(issue))
    if (hookErr) {
      console.error(`before_remove hook failed (ignored): ${hookErr.message}`)
    }
  }

  try {
    rmSync(wsPath, { recursive: true, force: true })
  }
  catch (err) {
    console.error(`workspace remove failed: ${err}`)
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
    console.error(`after_run hook failed (ignored): ${err.message}`)
  }
}

export function runHook(script: string, cwd: string, timeoutMs: number, env: Record<string, string> = {}): Error | null {
  let result: ReturnType<typeof Bun.spawnSync>
  try {
    result = Bun.spawnSync(['sh', '-lc', script], {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, ...env },
    })
  }
  catch (err) {
    return new Error(`hook spawn failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (result.exitCode === null) {
    const signal = result.signalCode ?? 'unknown'
    return new Error(`hook timeout after ${timeoutMs}ms (signal: ${signal})`)
  }

  if (!result.success) {
    const output = ((result.stdout?.toString() ?? '') + (result.stderr?.toString() ?? '')).slice(0, 2048)
    return new Error(`hook exited with status ${result.exitCode}: ${output}`)
  }

  return null
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
