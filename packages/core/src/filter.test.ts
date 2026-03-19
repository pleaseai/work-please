import type { Issue } from './types'
import { describe, expect, it } from 'bun:test'
import { deduplicateByNormalized, hasFilter, matchesFilter, splitCandidatesAndWatched } from './filter'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'i1',
    identifier: '#1',
    title: 'Test',
    description: null,
    priority: null,
    state: 'In Progress',
    branch_name: null,
    url: null,
    assignees: [],
    labels: [],
    blocked_by: [],
    pull_requests: [],
    review_decision: null,
    created_at: null,
    updated_at: null,
    project: null,
    ...overrides,
  }
}

describe('matchesFilter', () => {
  it('empty filter passes all issues', () => {
    const issue = makeIssue()
    expect(matchesFilter(issue, { assignee: [], label: [] })).toBe(true)
  })

  it('assignee filter: matches when issue assignee is in list (OR)', () => {
    const issue = makeIssue({ assignees: ['user1'] })
    expect(matchesFilter(issue, { assignee: ['user1', 'user2'], label: [] })).toBe(true)
  })

  it('assignee filter: matches second item in list (OR)', () => {
    const issue = makeIssue({ assignees: ['user2'] })
    expect(matchesFilter(issue, { assignee: ['user1', 'user2'], label: [] })).toBe(true)
  })

  it('assignee filter: no match when assignee not in list', () => {
    const issue = makeIssue({ assignees: ['other'] })
    expect(matchesFilter(issue, { assignee: ['user1', 'user2'], label: [] })).toBe(false)
  })

  it('assignee filter: no match when issue has no assignee', () => {
    const issue = makeIssue({ assignees: [] })
    expect(matchesFilter(issue, { assignee: ['user1'], label: [] })).toBe(false)
  })

  it('assignee filter: case-insensitive matching', () => {
    const issue = makeIssue({ assignees: ['User1'] })
    expect(matchesFilter(issue, { assignee: ['user1'], label: [] })).toBe(true)
  })

  it('assignee filter: case-insensitive (filter uppercase, assignee lowercase)', () => {
    const issue = makeIssue({ assignees: ['alice'] })
    expect(matchesFilter(issue, { assignee: ['Alice'], label: [] })).toBe(true)
  })

  it('assignee filter: matches when any of multiple issue assignees is in filter list', () => {
    const issue = makeIssue({ assignees: ['alice', 'bob'] })
    expect(matchesFilter(issue, { assignee: ['bob'], label: [] })).toBe(true)
  })

  it('label filter: matches when issue has at least one matching label (OR)', () => {
    const issue = makeIssue({ labels: ['bug', 'urgent'] })
    expect(matchesFilter(issue, { assignee: [], label: ['bug', 'feature'] })).toBe(true)
  })

  it('label filter: matches second item in list (OR)', () => {
    const issue = makeIssue({ labels: ['feature'] })
    expect(matchesFilter(issue, { assignee: [], label: ['bug', 'feature'] })).toBe(true)
  })

  it('label filter: no match when issue has none of the required labels', () => {
    const issue = makeIssue({ labels: ['docs'] })
    expect(matchesFilter(issue, { assignee: [], label: ['bug', 'feature'] })).toBe(false)
  })

  it('label filter: no match when issue has no labels', () => {
    const issue = makeIssue({ labels: [] })
    expect(matchesFilter(issue, { assignee: [], label: ['bug'] })).toBe(false)
  })

  it('label filter: case-insensitive (filter uppercase, labels already lowercase)', () => {
    const issue = makeIssue({ labels: ['bug'] })
    expect(matchesFilter(issue, { assignee: [], label: ['Bug'] })).toBe(true)
  })

  it('label filter: case-insensitive (issue label uppercase, filter lowercase)', () => {
    const issue = makeIssue({ labels: ['Bug'] })
    expect(matchesFilter(issue, { assignee: [], label: ['bug'] })).toBe(true)
  })

  it('combined assignee + label: both must match (AND)', () => {
    const issue = makeIssue({ assignees: ['user1'], labels: ['bug'] })
    expect(matchesFilter(issue, { assignee: ['user1'], label: ['bug'] })).toBe(true)
  })

  it('combined: fails when assignee matches but label does not', () => {
    const issue = makeIssue({ assignees: ['user1'], labels: ['docs'] })
    expect(matchesFilter(issue, { assignee: ['user1'], label: ['bug'] })).toBe(false)
  })

  it('combined: fails when label matches but assignee does not', () => {
    const issue = makeIssue({ assignees: ['other'], labels: ['bug'] })
    expect(matchesFilter(issue, { assignee: ['user1'], label: ['bug'] })).toBe(false)
  })
})

describe('hasFilter', () => {
  it('returns false for empty filter', () => {
    expect(hasFilter({ assignee: [], label: [] })).toBe(false)
  })

  it('returns true when assignee is set', () => {
    expect(hasFilter({ assignee: ['user1'], label: [] })).toBe(true)
  })

  it('returns true when label is set', () => {
    expect(hasFilter({ assignee: [], label: ['bug'] })).toBe(true)
  })

  it('returns true when both are set', () => {
    expect(hasFilter({ assignee: ['user1'], label: ['bug'] })).toBe(true)
  })
})

describe('deduplicateByNormalized', () => {
  it('removes duplicates by normalized value', () => {
    expect(deduplicateByNormalized(['Todo', 'todo', 'In Progress'])).toEqual(['Todo', 'In Progress'])
  })

  it('preserves first occurrence when normalized collides', () => {
    expect(deduplicateByNormalized(['TODO', 'todo', 'Todo'])).toEqual(['TODO'])
  })

  it('returns empty array for empty input', () => {
    expect(deduplicateByNormalized([])).toEqual([])
  })

  it('preserves order of non-duplicate items', () => {
    expect(deduplicateByNormalized(['C', 'B', 'A'])).toEqual(['C', 'B', 'A'])
  })

  it('handles whitespace normalization', () => {
    expect(deduplicateByNormalized([' Todo ', 'todo'])).toEqual([' Todo '])
  })
})

describe('splitCandidatesAndWatched', () => {
  const noFilter = { assignee: [] as string[], label: [] as string[] }

  it('splits issues by active and watched states', () => {
    const issues = [
      makeIssue({ id: '1', state: 'In Progress' }),
      makeIssue({ id: '2', state: 'Human Review' }),
      makeIssue({ id: '3', state: 'Todo' }),
    ]
    const result = splitCandidatesAndWatched(issues, ['In Progress', 'Todo'], ['Human Review'], noFilter)
    expect(result.candidates.map(i => i.id)).toEqual(['1', '3'])
    expect(result.watched.map(i => i.id)).toEqual(['2'])
  })

  it('issue in both active and watched states appears in both result arrays', () => {
    const issues = [
      makeIssue({ id: '1', state: 'Rework' }),
    ]
    const result = splitCandidatesAndWatched(issues, ['Rework'], ['Rework'], noFilter)
    expect(result.candidates.map(i => i.id)).toEqual(['1'])
    expect(result.watched.map(i => i.id)).toEqual(['1'])
  })

  it('filter is applied only to candidates, not watched', () => {
    const issues = [
      makeIssue({ id: '1', state: 'In Progress', labels: ['bot'] }),
      makeIssue({ id: '2', state: 'In Progress', labels: ['other'] }),
      makeIssue({ id: '3', state: 'Human Review', labels: ['other'] }),
    ]
    const filter = { assignee: [], label: ['bot'] }
    const result = splitCandidatesAndWatched(issues, ['In Progress'], ['Human Review'], filter)
    expect(result.candidates.map(i => i.id)).toEqual(['1'])
    expect(result.watched.map(i => i.id)).toEqual(['3'])
  })

  it('returns empty arrays when no issues match', () => {
    const issues = [
      makeIssue({ id: '1', state: 'Done' }),
    ]
    const result = splitCandidatesAndWatched(issues, ['In Progress'], ['Human Review'], noFilter)
    expect(result.candidates).toEqual([])
    expect(result.watched).toEqual([])
  })

  it('handles empty input', () => {
    const result = splitCandidatesAndWatched([], ['In Progress'], ['Human Review'], noFilter)
    expect(result.candidates).toEqual([])
    expect(result.watched).toEqual([])
  })

  it('normalizes state comparison (case-insensitive)', () => {
    const issues = [
      makeIssue({ id: '1', state: 'in progress' }),
    ]
    const result = splitCandidatesAndWatched(issues, ['In Progress'], [], noFilter)
    expect(result.candidates.map(i => i.id)).toEqual(['1'])
  })
})
