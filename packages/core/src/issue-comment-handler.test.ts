import type { GitHubApi, IssueCommentHandlerDeps, IssueCommentPayload } from './issue-comment-handler'
import type { ServiceConfig } from './types'
import { describe, expect, mock, test } from 'bun:test'
import { extractMentionPrompt, handleIssueCommentMention, shouldHandleComment } from './issue-comment-handler'

function makePayload(overrides: Partial<IssueCommentPayload> = {}): IssueCommentPayload {
  return {
    action: 'created',
    comment: {
      id: 123,
      body: '@my-bot please help with this',
      user: { login: 'testuser' },
      node_id: 'IC_test',
    },
    issue: {
      number: 42,
      title: 'Test issue',
      body: 'This is a test issue',
      labels: [{ name: 'bug' }],
      state: 'open',
      assignees: [{ login: 'testuser' }],
    },
    repository: {
      owner: { login: 'myorg' },
      name: 'myrepo',
      full_name: 'myorg/myrepo',
      clone_url: 'https://github.com/myorg/myrepo.git',
    },
    ...overrides,
  }
}

describe('extractMentionPrompt', () => {
  test('extracts prompt from body with @mention', () => {
    const result = extractMentionPrompt('@my-bot please help', 'my-bot')
    expect(result).toBe('please help')
  })

  test('returns null when no @mention found', () => {
    const result = extractMentionPrompt('no mention here', 'my-bot')
    expect(result).toBeNull()
  })

  test('handles @mention at end of body', () => {
    const result = extractMentionPrompt('help me @my-bot', 'my-bot')
    expect(result).toBe('help me')
  })

  test('handles multiple @mentions', () => {
    const result = extractMentionPrompt('@my-bot first @my-bot second', 'my-bot')
    expect(result).toBe('first  second')
  })

  test('is case-insensitive', () => {
    const result = extractMentionPrompt('@My-Bot please help', 'my-bot')
    expect(result).toBe('please help')
  })

  test('does not match partial usernames', () => {
    const result = extractMentionPrompt('@my-bot-extra please help', 'my-bot')
    expect(result).toBeNull()
  })

  test('handles special regex characters in username', () => {
    const result = extractMentionPrompt('@bot.name help', 'bot.name')
    expect(result).toBe('help')
  })
})

describe('shouldHandleComment', () => {
  test('returns true for created issue comment with @mention', () => {
    expect(shouldHandleComment(makePayload(), 'my-bot')).toBe(true)
  })

  test('returns false for non-created action', () => {
    expect(shouldHandleComment(makePayload({ action: 'edited' }), 'my-bot')).toBe(false)
  })

  test('returns false for PR comment', () => {
    const payload = makePayload({
      issue: {
        ...makePayload().issue,
        pull_request: { url: 'https://api.github.com/repos/myorg/myrepo/pulls/42' },
      },
    })
    expect(shouldHandleComment(payload, 'my-bot')).toBe(false)
  })

  test('returns false when comment is from the bot itself', () => {
    const payload = makePayload({
      comment: { ...makePayload().comment, user: { login: 'my-bot' } },
    })
    expect(shouldHandleComment(payload, 'my-bot')).toBe(false)
  })

  test('returns false when no @mention in body', () => {
    const payload = makePayload({
      comment: { ...makePayload().comment, body: 'no mention here' },
    })
    expect(shouldHandleComment(payload, 'my-bot')).toBe(false)
  })
})

describe('handleIssueCommentMention', () => {
  function makeConfig(): ServiceConfig {
    return {
      tracker: { kind: 'github_projects', endpoint: '', api_key: 'ghtoken', owner: 'myorg', project_number: 1, label_prefix: null, filter: { assignee: [], label: [] } },
      polling: { mode: 'poll' as const, interval_ms: 30000 },
      workspace: { root: '/tmp/test-ws' },
      hooks: { after_create: null, before_run: null, after_run: null, before_remove: null, timeout_ms: 60000 },
      agent: { max_concurrent_agents: 5, max_turns: 20, max_retry_backoff_ms: 300000, max_concurrent_agents_by_state: {} },
      claude: { model: null, effort: 'high' as const, command: 'claude', permission_mode: 'bypassPermissions', allowed_tools: [], setting_sources: [], turn_timeout_ms: 3600000, read_timeout_ms: 5000, stall_timeout_ms: 300000, sandbox: null, system_prompt: { type: 'preset', preset: 'claude_code' }, settings: { attribution: { commit: null, pr: null } } },
      env: {},
      db: { path: '.work-please/agent_runs.db', turso_url: null, turso_auth_token: null },
      server: { port: null, webhook: { secret: null, events: null } },
      chat: { bot_username: 'my-bot', github: null, slack: null },
    }
  }

  function makeGithubApi(): GitHubApi & { calls: Record<string, unknown[][]> } {
    const calls: Record<string, unknown[][]> = {
      addReaction: [],
      removeReaction: [],
      postComment: [],
    }
    return {
      calls,
      addReaction: mock(async (...args: unknown[]) => {
        calls.addReaction.push(args)
        return { id: 999 }
      }) as GitHubApi['addReaction'],
      removeReaction: mock(async (...args: unknown[]) => {
        calls.removeReaction.push(args)
      }) as GitHubApi['removeReaction'],
      postComment: mock(async (...args: unknown[]) => {
        calls.postComment.push(args)
      }) as GitHubApi['postComment'],
    }
  }

  test('adds eyes reaction on mention detection', async () => {
    const github = makeGithubApi()
    const deps: IssueCommentHandlerDeps = {
      config: makeConfig(),
      workflow: { config: {}, prompt_template: 'Work on {{ issue.title }}' },
      github,
    }

    // This will fail on createWorkspace (no real filesystem), but eyes reaction should already be added
    await handleIssueCommentMention(makePayload(), deps).catch(() => {})

    // Should have tried to add eyes reaction
    expect(github.calls.addReaction.length).toBeGreaterThanOrEqual(1)
    const [owner, repo, commentId, reaction] = github.calls.addReaction[0]
    expect(owner).toBe('myorg')
    expect(repo).toBe('myrepo')
    expect(commentId).toBe(123)
    expect(reaction).toBe('eyes')
  })

  test('posts error comment on failure', async () => {
    const github = makeGithubApi()
    const deps: IssueCommentHandlerDeps = {
      config: makeConfig(),
      workflow: { config: {}, prompt_template: 'Work on {{ issue.title }}' },
      github,
    }

    // Will fail because createWorkspace tries to access filesystem
    await handleIssueCommentMention(makePayload(), deps)

    // Should have posted an error comment
    const errorComments = github.calls.postComment.filter(
      args => typeof args[3] === 'string' && (args[3] as string).includes('error'),
    )
    expect(errorComments.length).toBeGreaterThanOrEqual(1)
  })

  test('adds confused reaction on failure', async () => {
    const github = makeGithubApi()
    const deps: IssueCommentHandlerDeps = {
      config: makeConfig(),
      workflow: { config: {}, prompt_template: 'Work on {{ issue.title }}' },
      github,
    }

    await handleIssueCommentMention(makePayload(), deps)

    // Should have added confused reaction (failure indicator)
    const confusedReactions = github.calls.addReaction.filter(
      args => args[3] === 'confused',
    )
    expect(confusedReactions.length).toBeGreaterThanOrEqual(1)
  })

  test('removes eyes reaction on failure', async () => {
    const github = makeGithubApi()
    const deps: IssueCommentHandlerDeps = {
      config: makeConfig(),
      workflow: { config: {}, prompt_template: 'Work on {{ issue.title }}' },
      github,
    }

    await handleIssueCommentMention(makePayload(), deps)

    // Should have removed the eyes reaction (id=999)
    expect(github.calls.removeReaction.length).toBeGreaterThanOrEqual(1)
    const [, , , reactionId] = github.calls.removeReaction[0]
    expect(reactionId).toBe(999)
  })
})
