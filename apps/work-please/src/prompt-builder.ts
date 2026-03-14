import type { Issue, WorkflowDefinition } from './types'
import { Liquid } from 'liquidjs'

const DEFAULT_PROMPT = 'You are working on an issue from the configured issue tracker.'

const liquid = new Liquid({
  strictVariables: true,
  strictFilters: true,
})

export interface PromptBuildError {
  code: 'template_parse_error' | 'template_render_error'
  cause: unknown
}

export async function buildPrompt(
  workflow: WorkflowDefinition,
  issue: Issue,
  attempt?: number | null,
): Promise<string | PromptBuildError> {
  const templateSource = workflow.prompt_template.trim() || DEFAULT_PROMPT

  let template: Awaited<ReturnType<typeof liquid.parse>>
  try {
    template = await liquid.parse(templateSource)
  }
  catch (cause) {
    return { code: 'template_parse_error', cause }
  }

  try {
    const rendered = await liquid.render(template, {
      issue: issueToTemplateVars(issue),
      attempt: attempt ?? null,
    })
    return rendered
  }
  catch (cause) {
    return { code: 'template_render_error', cause }
  }
}

export function buildContinuationPrompt(turnNumber: number, maxTurns: number): string {
  return `Continuation guidance:

- The previous agent turn completed normally, but the issue is still in an active state.
- This is continuation turn #${turnNumber} of ${maxTurns} for the current agent run.
- Resume from the current workspace state instead of restarting from scratch.
- The original task instructions and prior turn context are already present in this thread, so do not restate them before acting.
- Focus on the remaining ticket work and do not end the turn while the issue stays active unless you are truly blocked.`
}

export function isPromptBuildError(result: string | PromptBuildError): result is PromptBuildError {
  return typeof result === 'object' && 'code' in result
}

function issueToTemplateVars(issue: Issue): Record<string, unknown> {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branch_name,
    url: issue.url,
    labels: issue.labels,
    blocked_by: issue.blocked_by,
    pull_requests: issue.pull_requests,
    review_decision: issue.review_decision,
    created_at: issue.created_at?.toISOString() ?? null,
    updated_at: issue.updated_at?.toISOString() ?? null,
  }
}
