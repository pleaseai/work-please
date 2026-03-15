import type { CandidateAndWatchedResult } from './tracker/types'
import type { Issue, IssueFilter } from './types'
import { normalizeState } from './config'

export function matchesFilter(issue: Issue, filter: IssueFilter): boolean {
  if (filter.assignee.length > 0) {
    const filterAssignees = new Set(filter.assignee.map(a => a.toLowerCase()))
    if (!issue.assignees.some(a => filterAssignees.has(a.toLowerCase()))) {
      return false
    }
  }
  if (filter.label.length > 0) {
    const filterLabels = new Set(filter.label.map(l => l.toLowerCase()))
    if (!issue.labels.some(l => filterLabels.has(l.toLowerCase()))) {
      return false
    }
  }
  return true
}

export function hasFilter(filter: IssueFilter): boolean {
  return filter.assignee.length > 0 || filter.label.length > 0
}

export function deduplicateByNormalized(states: string[]): string[] {
  const seen = new Set<string>()
  return states.filter((s) => {
    const norm = normalizeState(s)
    if (seen.has(norm))
      return false
    seen.add(norm)
    return true
  })
}

export function splitCandidatesAndWatched(
  allIssues: Issue[],
  activeStates: string[],
  watchedStates: string[],
  filter: IssueFilter,
): CandidateAndWatchedResult {
  const activeSet = new Set(activeStates.map(normalizeState))
  const watchedSet = new Set(watchedStates.map(normalizeState))

  const candidates: Issue[] = []
  const watched: Issue[] = []

  for (const issue of allIssues) {
    const norm = normalizeState(issue.state)
    if (activeSet.has(norm) && matchesFilter(issue, filter))
      candidates.push(issue)
    if (watchedSet.has(norm))
      watched.push(issue)
  }

  return { candidates, watched }
}
