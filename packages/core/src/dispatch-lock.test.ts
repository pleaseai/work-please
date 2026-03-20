import { describe, expect, it } from 'bun:test'
import { createNoopDispatchLock, toDispatchLockKey } from './dispatch-lock'
import type { Issue } from './types'

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'PVTI_kwDOtest',
    identifier: '#42',
    title: 'Test issue',
    description: null,
    priority: null,
    state: 'Todo',
    branch_name: null,
    url: 'https://github.com/octocat/Hello-World/issues/42',
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

describe('toDispatchLockKey', () => {
  it('derives key from GitHub issue URL', () => {
    const issue = makeIssue({ url: 'https://github.com/octocat/Hello-World/issues/42' })
    expect(toDispatchLockKey(issue)).toBe('github:octocat/Hello-World:issue:42')
  })

  it('derives key from GitHub PR URL', () => {
    const issue = makeIssue({ url: 'https://github.com/octocat/Hello-World/pull/99' })
    expect(toDispatchLockKey(issue)).toBe('github:octocat/Hello-World:99')
  })

  it('derives key from project owner + identifier when URL is missing', () => {
    const issue = makeIssue({
      url: null,
      identifier: '#7',
      project: { owner: 'myorg', number: 1, project_id: null, item_id: 'PVTI_x', field_id: null, status_options: [] },
    })
    expect(toDispatchLockKey(issue)).toBe('github:myorg:issue:7')
  })

  it('falls back to raw issue id when no URL or project', () => {
    const issue = makeIssue({ url: null, identifier: 'PVTI_abc', project: null })
    expect(toDispatchLockKey(issue)).toBe('dispatch:PVTI_abc')
  })

  it('handles GitHub Enterprise URLs', () => {
    const issue = makeIssue({ url: 'https://github.example.com/org/repo/issues/5' })
    expect(toDispatchLockKey(issue)).toBe('github:org/repo:issue:5')
  })
})

describe('toDispatchLockKey from webhook payload', () => {
  it('derives key from owner/repo and issue number', () => {
    const key = toDispatchLockKey({
      id: 'octocat/Hello-World#42',
      identifier: 'octocat/Hello-World#42',
      title: 'test',
      description: null,
      priority: null,
      state: 'open',
      branch_name: null,
      url: 'https://github.com/octocat/Hello-World/issues/42',
      assignees: [],
      labels: [],
      blocked_by: [],
      pull_requests: [],
      review_decision: null,
      created_at: null,
      updated_at: null,
      project: null,
    })
    expect(key).toBe('github:octocat/Hello-World:issue:42')
  })
})

describe('createNoopDispatchLock', () => {
  it('acquireLock always returns a synthetic lock', async () => {
    const noop = createNoopDispatchLock()
    const lock = await noop.acquireLock('test-key', 5000)
    expect(lock).not.toBeNull()
    expect(lock!.threadId).toBe('test-key')
    expect(lock!.token).toBe('noop')
  })

  it('acquireLock succeeds even for same key twice', async () => {
    const noop = createNoopDispatchLock()
    const lock1 = await noop.acquireLock('same-key', 5000)
    const lock2 = await noop.acquireLock('same-key', 5000)
    expect(lock1).not.toBeNull()
    expect(lock2).not.toBeNull()
  })

  it('extendLock always returns true', async () => {
    const noop = createNoopDispatchLock()
    const lock = await noop.acquireLock('key', 5000)
    const extended = await noop.extendLock(lock!, 10000)
    expect(extended).toBe(true)
  })

  it('releaseLock does not throw', async () => {
    const noop = createNoopDispatchLock()
    const lock = await noop.acquireLock('key', 5000)
    await expect(noop.releaseLock(lock!)).resolves.toBeUndefined()
  })
})
