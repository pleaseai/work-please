import type { Issue } from './types'

export interface DispatchLock {
  threadId: string
  token: string
  expiresAt: number
}

export interface DispatchLockAdapter {
  acquireLock(threadId: string, ttlMs: number): Promise<DispatchLock | null>
  extendLock(lock: DispatchLock, ttlMs: number): Promise<boolean>
  releaseLock(lock: DispatchLock): Promise<void>
}

const GITHUB_ISSUE_URL_RE = /\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/
const IDENTIFIER_NUMBER_RE = /^#(\d+)$/

/**
 * Derive a dispatch lock key from an Issue, following Chat SDK threadId conventions.
 *
 * - GitHub issue: `github:{owner}/{repo}:issue:{number}`
 * - GitHub PR:    `github:{owner}/{repo}:{prNumber}`
 * - Fallback:     `dispatch:{identifier}`
 */
export function toDispatchLockKey(issue: Issue): string {
  // Try parsing from URL first (most reliable)
  if (issue.url) {
    const match = issue.url.match(GITHUB_ISSUE_URL_RE)
    if (match) {
      const [, owner, repo, type, number] = match
      if (type === 'pull') {
        return `github:${owner}/${repo}:${number}`
      }
      return `github:${owner}/${repo}:issue:${number}`
    }
  }

  // Try project owner + identifier (orchestrator path without URL)
  if (issue.project?.owner) {
    const numMatch = issue.identifier.match(IDENTIFIER_NUMBER_RE)
    if (numMatch) {
      return `github:${issue.project.owner}:issue:${numMatch[1]}`
    }
  }

  // Fallback: use raw identifier
  return `dispatch:${issue.identifier}`
}

/**
 * Create a no-op DispatchLockAdapter that never blocks.
 * Used when Chat SDK is not configured.
 */
export function createNoopDispatchLock(): DispatchLockAdapter {
  return {
    async acquireLock(threadId: string, ttlMs: number): Promise<DispatchLock> {
      return { threadId, token: 'noop', expiresAt: Date.now() + ttlMs }
    },
    async extendLock(_lock: DispatchLock, _ttlMs: number): Promise<boolean> {
      return true
    },
    async releaseLock(_lock: DispatchLock): Promise<void> {},
  }
}
