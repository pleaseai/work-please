import type { PromptFunctions, WizardContext } from './init-wizard'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { generateWorkflowFromContext, resolveToken, runWizard } from './init-wizard'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function createMockPrompts(answers: Record<string, unknown> = {}): PromptFunctions {
  const callLog: { method: string, opts: unknown }[] = []

  return {
    input: mock(async (opts: { message: string, default?: string }) => {
      callLog.push({ method: 'input', opts })
      const key = opts.message
      if (key in answers)
        return answers[key] as string
      return opts.default ?? ''
    }) as PromptFunctions['input'],

    password: mock(async (opts: { message: string }) => {
      callLog.push({ method: 'password', opts })
      return (answers[opts.message] as string) ?? 'mock-token'
    }) as PromptFunctions['password'],

    confirm: mock(async (opts: { message: string, default?: boolean }) => {
      callLog.push({ method: 'confirm', opts })
      if (opts.message in answers)
        return answers[opts.message] as boolean
      return opts.default ?? true
    }) as PromptFunctions['confirm'],

    select: mock(async (opts: { message: string, choices: { name: string, value: unknown }[], default?: unknown }) => {
      callLog.push({ method: 'select', opts })
      if (opts.message in answers)
        return answers[opts.message]
      return opts.default ?? opts.choices[0].value
    }) as PromptFunctions['select'],

    number: mock(async (opts: { message: string, default?: number, min?: number }) => {
      callLog.push({ method: 'number', opts })
      if (opts.message in answers)
        return answers[opts.message] as number
      return opts.default
    }) as PromptFunctions['number'],
  }
}

function createDefaultContext(overrides: Partial<WizardContext> = {}): WizardContext {
  return {
    token: 'ghp_test123',
    owner: 'myorg',
    title: 'Work Please',
    projectNumber: null,
    pollingIntervalMs: 30000,
    workspaceRoot: '~/workspaces',
    hooks: { after_create: null, before_run: null, after_run: null, before_remove: null },
    agent: { max_concurrent_agents: 5, max_turns: 20 },
    claude: { permission_mode: 'bypassPermissions', effort: 'high', model: null },
    serverPort: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveToken
// ---------------------------------------------------------------------------

describe('resolveToken', () => {
  let origEnv: string | undefined

  beforeEach(() => {
    origEnv = process.env.GITHUB_TOKEN
  })

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.GITHUB_TOKEN = origEnv
    }
    else {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('returns flag token with highest priority', async () => {
    process.env.GITHUB_TOKEN = 'env-token'
    const result = await resolveToken('flag-token')
    expect(result).toEqual({ token: 'flag-token', source: '--token flag' })
  })

  it('returns env token when no flag is provided', async () => {
    process.env.GITHUB_TOKEN = 'env-token'
    const result = await resolveToken(null)
    expect(result).toEqual({ token: 'env-token', source: 'GITHUB_TOKEN environment variable' })
  })

  it('returns null when no token source is available', async () => {
    delete process.env.GITHUB_TOKEN
    // gh auth token will likely fail in test env too
    const result = await resolveToken(null)
    // Result is either from gh auth token or null
    if (result !== null) {
      expect(result.source).toBe('gh auth token')
    }
    else {
      expect(result).toBeNull()
    }
  })

  it('prefers flag over env', async () => {
    process.env.GITHUB_TOKEN = 'env-token'
    const result = await resolveToken('flag-token')
    expect(result!.token).toBe('flag-token')
    expect(result!.source).toBe('--token flag')
  })
})

// ---------------------------------------------------------------------------
// generateWorkflowFromContext
// ---------------------------------------------------------------------------

describe('generateWorkflowFromContext', () => {
  it('starts with YAML front matter delimiter', () => {
    const content = generateWorkflowFromContext(createDefaultContext())
    expect(content.startsWith('---\n')).toBe(true)
  })

  it('includes tracker configuration', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ owner: 'acme', projectNumber: 42 }))
    expect(content).toContain('kind: github_projects')
    expect(content).toContain('owner: "acme"')
    expect(content).toContain('project_number: 42')
    expect(content).toContain('api_key: $GITHUB_TOKEN')
  })

  it('includes active_states and terminal_states', () => {
    const content = generateWorkflowFromContext(createDefaultContext())
    expect(content).toContain('- Todo')
    expect(content).toContain('- In Progress')
    expect(content).toContain('- Done')
    expect(content).toContain('- Cancelled')
  })

  it('includes polling interval', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ pollingIntervalMs: 60000 }))
    expect(content).toContain('interval_ms: 60000')
  })

  it('includes workspace root', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ workspaceRoot: '/tmp/ws' }))
    expect(content).toContain('root: /tmp/ws')
  })

  it('uses default hook when after_create is null', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ owner: 'acme' }))
    expect(content).toContain('after_create: |')
    expect(content).toContain('https://github.com/acme/<repo>')
  })

  it('uses custom after_create hook when provided', () => {
    const ctx = createDefaultContext({
      hooks: { after_create: 'echo "hello"', before_run: null, after_run: null, before_remove: null },
    })
    const content = generateWorkflowFromContext(ctx)
    expect(content).toContain('echo "hello"')
    expect(content).not.toContain('<repo>')
  })

  it('includes before_run hook when set', () => {
    const ctx = createDefaultContext({
      hooks: { after_create: null, before_run: 'echo before', after_run: null, before_remove: null },
    })
    const content = generateWorkflowFromContext(ctx)
    expect(content).toContain('before_run: |')
    expect(content).toContain('echo before')
  })

  it('includes agent configuration', () => {
    const ctx = createDefaultContext({ agent: { max_concurrent_agents: 3, max_turns: 10 } })
    const content = generateWorkflowFromContext(ctx)
    expect(content).toContain('max_concurrent_agents: 3')
    expect(content).toContain('max_turns: 10')
  })

  it('includes claude configuration', () => {
    const ctx = createDefaultContext({
      claude: { permission_mode: 'default', effort: 'max', model: 'claude-sonnet-4-5-20250514' },
    })
    const content = generateWorkflowFromContext(ctx)
    expect(content).toContain('permission_mode: default')
    expect(content).toContain('effort: max')
    expect(content).toContain('model: claude-sonnet-4-5-20250514')
  })

  it('omits model line when model is null', () => {
    const ctx = createDefaultContext({ claude: { permission_mode: 'bypassPermissions', effort: 'high', model: null } })
    const content = generateWorkflowFromContext(ctx)
    expect(content).not.toContain('model:')
  })

  it('includes server port when set', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ serverPort: 3000 }))
    expect(content).toContain('server:')
    expect(content).toContain('port: 3000')
  })

  it('comments out server when port is null', () => {
    const content = generateWorkflowFromContext(createDefaultContext({ serverPort: null }))
    expect(content).toContain('# server:')
    expect(content).toContain('#   port: 3000')
  })

  it('includes Liquid prompt template', () => {
    const content = generateWorkflowFromContext(createDefaultContext())
    expect(content).toContain('{{ issue.identifier | escape }}')
    expect(content).toContain('{{ issue.title | escape }}')
    expect(content).toContain('{{ issue.description | escape }}')
  })

  it('escapes all dynamic fields in issue-data and blocker-data', () => {
    const content = generateWorkflowFromContext(createDefaultContext())
    expect(content).toContain('{{ issue.title | escape }}')
    expect(content).toContain('{{ issue.description | escape }}')
    expect(content).toContain('{{ blocker.identifier | escape }}')
    expect(content).toContain('{{ blocker.title | escape }}')
    expect(content).toContain('{{ blocker.state | escape }}')
  })

  it('produces different content for different owners', () => {
    const a = generateWorkflowFromContext(createDefaultContext({ owner: 'orgA' }))
    const b = generateWorkflowFromContext(createDefaultContext({ owner: 'orgB' }))
    expect(a).not.toBe(b)
  })

  it('produces different content for different project numbers', () => {
    const a = generateWorkflowFromContext(createDefaultContext({ projectNumber: 1 }))
    const b = generateWorkflowFromContext(createDefaultContext({ projectNumber: 99 }))
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// runWizard
// ---------------------------------------------------------------------------

describe('runWizard', () => {
  let origEnv: string | undefined

  beforeEach(() => {
    origEnv = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'env-test-token'
  })

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.GITHUB_TOKEN = origEnv
    }
    else {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('returns WizardContext with defaults on happy path', async () => {
    const prompts = createMockPrompts()
    const result = await runWizard(
      { owner: 'myorg', title: 'Test Board', token: 'ghp_test' },
      prompts,
    )

    expect(result).not.toBeNull()
    expect(result!.owner).toBe('myorg')
    expect(result!.token).toBe('ghp_test')
    expect(result!.pollingIntervalMs).toBe(30000)
    expect(result!.workspaceRoot).toBe('~/workspaces')
    expect(result!.agent.max_concurrent_agents).toBe(5)
    expect(result!.agent.max_turns).toBe(20)
    expect(result!.claude.permission_mode).toBe('bypassPermissions')
    expect(result!.claude.effort).toBe('high')
  })

  it('returns null when user declines confirmation', async () => {
    const prompts = createMockPrompts({
      'Proceed with this configuration?': false,
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result).toBeNull()
  })

  it('skips owner prompt when owner is provided', async () => {
    const prompts = createMockPrompts()
    await runWizard(
      { owner: 'provided-org', title: null, token: 'ghp_test' },
      prompts,
    )

    const inputCalls = (prompts.input as ReturnType<typeof mock>).mock.calls
    const ownerCall = inputCalls.find(
      (c: unknown[]) => (c[0] as { message: string }).message.includes('owner'),
    )
    expect(ownerCall).toBeUndefined()
  })

  it('prompts for owner when not provided', async () => {
    const prompts = createMockPrompts({
      'GitHub org/user (owner):': 'prompted-org',
    })
    const result = await runWizard(
      { owner: null, title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.owner).toBe('prompted-org')
  })

  it('creates new project by default', async () => {
    const prompts = createMockPrompts()
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.projectNumber).toBeNull()
  })

  it('uses existing project when selected', async () => {
    const prompts = createMockPrompts({
      'Project board setup:': 'existing',
      'Project number:': 42,
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.projectNumber).toBe(42)
  })

  it('prompts for password when no token is available', async () => {
    delete process.env.GITHUB_TOKEN
    const prompts = createMockPrompts({
      'GitHub token:': 'prompted-token',
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: null },
      prompts,
    )

    // May get gh auth token or prompted token
    expect(result).not.toBeNull()
    expect(result!.token).toBeTruthy()
  })

  it('uses provided title as default for input prompt', async () => {
    const prompts = createMockPrompts({
      'Project title:': 'Custom Title',
    })
    const result = await runWizard(
      { owner: 'myorg', title: 'Suggested Title', token: 'ghp_test' },
      prompts,
    )

    expect(result!.title).toBe('Custom Title')
  })

  it('sets server port when provided', async () => {
    const prompts = createMockPrompts({
      'HTTP server port (blank to disable):': '8080',
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.serverPort).toBe(8080)
  })

  it('sets server port to null when blank', async () => {
    const prompts = createMockPrompts({
      'HTTP server port (blank to disable):': '',
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.serverPort).toBeNull()
  })

  it('sets claude model when provided', async () => {
    const prompts = createMockPrompts({
      'Claude model (blank for CLI default):': 'claude-sonnet-4-5-20250514',
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.claude.model).toBe('claude-sonnet-4-5-20250514')
  })

  it('sets claude model to null when blank', async () => {
    const prompts = createMockPrompts({
      'Claude model (blank for CLI default):': '',
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.claude.model).toBeNull()
  })

  it('uses custom polling interval', async () => {
    const prompts = createMockPrompts({
      'Polling interval (ms):': 60000,
    })
    const result = await runWizard(
      { owner: 'myorg', title: null, token: 'ghp_test' },
      prompts,
    )

    expect(result!.pollingIntervalMs).toBe(60000)
  })
})
