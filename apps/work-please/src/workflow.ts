import type { WorkflowDefinition, WorkflowError } from './types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { load as parseYaml } from 'js-yaml'
import { createLogger } from './logger'

const log = createLogger('workflow')

const NEWLINE_RE = /\r?\n/

export const WORKFLOW_FILE_NAME = 'WORKFLOW.md'

export function defaultWorkflowPath(): string {
  return join(process.cwd(), WORKFLOW_FILE_NAME)
}

export function loadWorkflow(path?: string): WorkflowDefinition | WorkflowError {
  const filePath = path ?? defaultWorkflowPath()

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  }
  catch (cause) {
    return { code: 'missing_workflow_file', path: filePath, cause }
  }

  return parseWorkflow(content)
}

export function parseWorkflow(content: string): WorkflowDefinition | WorkflowError {
  const { frontMatterLines, promptLines } = splitFrontMatter(content)

  const frontResult = parseFrontMatter(frontMatterLines)
  if ('code' in frontResult)
    return frontResult

  const prompt_template = promptLines.join('\n').trim()

  return { config: frontResult.config, prompt_template }
}

function splitFrontMatter(content: string): { frontMatterLines: string[], promptLines: string[] } {
  const lines = content.split(NEWLINE_RE)

  if (lines[0] !== '---') {
    return { frontMatterLines: [], promptLines: lines }
  }

  const frontMatterLines: string[] = []
  let i = 1
  for (; i < lines.length; i++) {
    if (lines[i] === '---') {
      i++
      break
    }
    frontMatterLines.push(lines[i])
  }

  return { frontMatterLines, promptLines: lines.slice(i) }
}

function parseFrontMatter(lines: string[]): { config: Record<string, unknown> } | WorkflowError {
  const yaml = lines.join('\n')

  if (yaml.trim() === '') {
    return { config: {} }
  }

  let parsed: unknown
  try {
    parsed = parseYaml(yaml)
  }
  catch (cause) {
    return { code: 'workflow_parse_error', cause }
  }

  if (parsed === null || parsed === undefined) {
    return { config: {} }
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { code: 'workflow_front_matter_not_a_map' }
  }

  return { config: parsed as Record<string, unknown> }
}

export function isWorkflowError(result: WorkflowDefinition | WorkflowError): result is WorkflowError {
  return 'code' in result
}

const HOOK_OVERRIDABLE_KEYS = new Set(['before_run', 'after_run'])

export function loadRepoWorkflow(workspacePath: string): WorkflowDefinition | null {
  const filePath = join(workspacePath, WORKFLOW_FILE_NAME)

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  }
  catch {
    return null
  }

  const result = parseWorkflow(content)
  if (isWorkflowError(result)) {
    log.warn(`repo WORKFLOW.md parse error at ${filePath}: ${result.code} — using global workflow`)
    return null
  }

  return result
}

export function mergeWorkflows(
  base: WorkflowDefinition,
  repoOverride: WorkflowDefinition | null,
  allowedSections: string[],
): WorkflowDefinition {
  if (!repoOverride)
    return base

  const allowed = new Set(allowedSections)
  const merged: Record<string, unknown> = {}

  // Copy all base config sections
  for (const [key, value] of Object.entries(base.config)) {
    merged[key] = deepClone(value)
  }

  // Override allowed sections from repo workflow
  for (const [key, value] of Object.entries(repoOverride.config)) {
    if (key === 'repo_overrides')
      continue

    if (!allowed.has(key))
      continue

    // Special handling for hooks: only allow before_run and after_run
    if (key === 'hooks') {
      const baseHooks = (merged.hooks ?? {}) as Record<string, unknown>
      const overrideHooks = value as Record<string, unknown>
      for (const [hookKey, hookVal] of Object.entries(overrideHooks)) {
        if (HOOK_OVERRIDABLE_KEYS.has(hookKey)) {
          baseHooks[hookKey] = hookVal
        }
        // lifecycle hooks (after_create, before_remove) are silently ignored
      }
      merged.hooks = baseHooks
      continue
    }

    // Deep-merge for object sections (agent, claude, env)
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = deepMerge(merged[key] as Record<string, unknown>, value as Record<string, unknown>)
    }
    else {
      merged[key] = deepClone(value)
    }
  }

  // Strip repo_overrides from merged result
  delete merged.repo_overrides

  // Prompt template: only override if allowed and non-empty
  const prompt_template = (allowed.has('prompt_template') && repoOverride.prompt_template)
    ? repoOverride.prompt_template
    : base.prompt_template

  return { config: merged, prompt_template }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = output[key]
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      output[key] = deepMerge(targetValue, sourceValue)
    }
    else {
      output[key] = sourceValue
    }
  }
  return output
}

function deepClone<T>(val: T): T {
  if (val === null || typeof val !== 'object')
    return val
  return JSON.parse(JSON.stringify(val))
}
