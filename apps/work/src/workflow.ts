import type { WorkflowDefinition, WorkflowError } from './types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { load as parseYaml } from 'js-yaml'

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
