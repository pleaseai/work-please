import type { AutoTransitions, Issue } from './types'

export function evaluateAutoTransition(issue: Issue, autoTransitions: Required<AutoTransitions>): string | null {
  // Rule 1: CHANGES_REQUESTED or unresolved threads → Rework
  if (autoTransitions.human_review_to_rework) {
    if (issue.review_decision === 'changes_requested')
      return 'Rework'

    const hasUnresolved = autoTransitions.include_bot_reviews
      ? issue.has_unresolved_threads
      : issue.has_unresolved_human_threads
    if (hasUnresolved)
      return 'Rework'
  }

  // Rule 2: APPROVED + no unresolved threads → Merging
  if (autoTransitions.human_review_to_merging) {
    if (issue.review_decision === 'approved') {
      const hasUnresolved = autoTransitions.include_bot_reviews
        ? issue.has_unresolved_threads
        : issue.has_unresolved_human_threads
      if (!hasUnresolved)
        return 'Merging'
    }
  }

  return null
}
