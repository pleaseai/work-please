import type { Issue, TrackerConfig } from './types'

type FilterConfig = NonNullable<TrackerConfig['filter']>

export function matchesFilter(issue: Issue, filter: FilterConfig): boolean {
  if (filter.assignee.length > 0) {
    if (!issue.assignee
      || !filter.assignee.some(a => a.toLowerCase() === issue.assignee!.toLowerCase())) {
      return false
    }
  }
  if (filter.label.length > 0) {
    if (!issue.labels.some(l => filter.label.some(f => f.toLowerCase() === l))) {
      return false
    }
  }
  return true
}
