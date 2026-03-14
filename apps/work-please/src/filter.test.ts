import type { Issue } from './types'
import { describe, expect, it } from 'bun:test'
import { matchesFilter } from './filter'

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
