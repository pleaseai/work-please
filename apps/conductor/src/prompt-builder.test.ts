import type { Issue, WorkflowDefinition } from './types'
import { describe, expect, it } from 'bun:test'
import { buildContinuationPrompt, buildPrompt, isPromptBuildError } from './prompt-builder'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'abc123',
    identifier: 'MT-649',
    title: 'Fix the bug',
    description: 'A nasty bug',
    priority: 1,
    state: 'In Progress',
    branch_name: null,
    url: null,
    labels: ['bug'],
    blocked_by: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function makeWorkflow(prompt_template: string): WorkflowDefinition {
  return { config: {}, prompt_template }
}

describe('buildPrompt', () => {
  it('renders issue fields in template', async () => {
    const result = await buildPrompt(
      makeWorkflow('Issue: {{ issue.identifier }} - {{ issue.title }}'),
      makeIssue(),
    )
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toBe('Issue: MT-649 - Fix the bug')
  })

  it('renders attempt variable', async () => {
    const result = await buildPrompt(
      makeWorkflow('Attempt: {{ attempt }}'),
      makeIssue(),
      3,
    )
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toBe('Attempt: 3')
  })

  it('renders null attempt as empty', async () => {
    const result = await buildPrompt(
      makeWorkflow('Attempt: {{ attempt }}'),
      makeIssue(),
      null,
    )
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toBe('Attempt: ')
  })

  it('falls back to default prompt when template is empty', async () => {
    const result = await buildPrompt(makeWorkflow(''), makeIssue())
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toContain('issue from the configured issue tracker')
  })

  it('returns template_parse_error for invalid template syntax', async () => {
    const result = await buildPrompt(makeWorkflow('{{ issue.title | invalid_filter }}'), makeIssue())
    expect(isPromptBuildError(result)).toBe(true)
    if (!isPromptBuildError(result))
      return
    expect(result.code).toBe('template_parse_error')
  })

  it('returns template_render_error for unknown variable', async () => {
    const result = await buildPrompt(makeWorkflow('{{ unknown_var }}'), makeIssue())
    expect(isPromptBuildError(result)).toBe(true)
    if (!isPromptBuildError(result))
      return
    expect(result.code).toBe('template_render_error')
  })

  it('renders issue labels and blockers', async () => {
    const issue = makeIssue({
      labels: ['bug', 'urgent'],
      blocked_by: [{ id: '1', identifier: 'MT-648', state: 'Done' }],
    })
    const result = await buildPrompt(
      makeWorkflow('{% for label in issue.labels %}{{ label }} {% endfor %}'),
      issue,
    )
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toContain('bug')
    expect(result).toContain('urgent')
  })

  it('renders conditional blocks', async () => {
    const result = await buildPrompt(
      makeWorkflow('{% if issue.description %}Has desc{% else %}No desc{% endif %}'),
      makeIssue({ description: 'something' }),
    )
    expect(isPromptBuildError(result)).toBe(false)
    expect(result).toBe('Has desc')
  })
})

describe('buildContinuationPrompt', () => {
  it('includes turn number and max turns', () => {
    const prompt = buildContinuationPrompt(3, 20)
    expect(prompt).toContain('#3')
    expect(prompt).toContain('20')
    expect(prompt).toContain('Continuation guidance')
  })
})
