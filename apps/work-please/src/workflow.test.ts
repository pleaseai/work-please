import type { WorkflowDefinition } from './types'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { loadRepoWorkflow, loadWorkflow, mergeWorkflows, parseWorkflow } from './workflow'

describe('loadWorkflow', () => {
  it('returns missing_workflow_file for nonexistent path (Section 17.1)', () => {
    const result = loadWorkflow('/nonexistent/path/WORKFLOW.md')
    expect('code' in result).toBe(true)
    if (!('code' in result))
      return
    expect(result.code).toBe('missing_workflow_file')
  })
})

describe('parseWorkflow', () => {
  it('parses file with YAML front matter and prompt body', () => {
    const content = `---
tracker:
  kind: asana
  project_gid: "123"
---
You are working on {{ issue.title }}.`

    const result = parseWorkflow(content)
    expect('code' in result).toBe(false)
    if ('code' in result)
      return

    expect(result.config).toMatchObject({ tracker: { kind: 'asana', project_gid: '123' } })
    expect(result.prompt_template).toBe('You are working on {{ issue.title }}.')
  })

  it('parses file without front matter as prompt only', () => {
    const content = 'Just a plain prompt with no front matter.'
    const result = parseWorkflow(content)
    expect('code' in result).toBe(false)
    if ('code' in result)
      return

    expect(result.config).toEqual({})
    expect(result.prompt_template).toBe('Just a plain prompt with no front matter.')
  })

  it('returns empty prompt_template when only front matter is present', () => {
    const content = `---
tracker:
  kind: asana
---`
    const result = parseWorkflow(content)
    expect('code' in result).toBe(false)
    if ('code' in result)
      return

    expect(result.prompt_template).toBe('')
  })

  it('trims whitespace from prompt_template', () => {
    const content = `---
tracker:
  kind: asana
---

  Hello world.

`
    const result = parseWorkflow(content)
    expect('code' in result).toBe(false)
    if ('code' in result)
      return

    expect(result.prompt_template).toBe('Hello world.')
  })

  it('returns workflow_parse_error for invalid YAML', () => {
    const content = `---
tracker: [unclosed
---
prompt`
    const result = parseWorkflow(content)
    expect('code' in result).toBe(true)
    if (!('code' in result))
      return

    expect(result.code).toBe('workflow_parse_error')
  })

  it('returns workflow_front_matter_not_a_map for non-map YAML', () => {
    const content = `---
- item1
- item2
---
prompt`
    const result = parseWorkflow(content)
    expect('code' in result).toBe(true)
    if (!('code' in result))
      return

    expect(result.code).toBe('workflow_front_matter_not_a_map')
  })

  it('treats empty front matter as empty config', () => {
    const content = `---
---
Hello world.`
    const result = parseWorkflow(content)
    expect('code' in result).toBe(false)
    if ('code' in result)
      return

    expect(result.config).toEqual({})
    expect(result.prompt_template).toBe('Hello world.')
  })
})

describe('mergeWorkflows', () => {
  const base: WorkflowDefinition = {
    config: {
      tracker: { kind: 'github_projects', api_key: 'secret' },
      polling: { interval_ms: 30000 },
      workspace: { root: '/tmp/ws' },
      server: { port: 8080 },
      agent: { max_turns: 20, max_concurrent_agents: 10 },
      claude: { model: 'claude-sonnet-4-20250514', effort: 'high' },
      hooks: { after_create: 'echo setup', before_run: 'echo before', after_run: 'echo after', before_remove: 'echo rm' },
      env: { EXISTING: 'val' },
    },
    prompt_template: 'Default prompt {{ issue.title }}',
  }

  it('returns base unchanged when override is null', () => {
    const result = mergeWorkflows(base, null, ['agent', 'claude', 'env', 'hooks'])
    expect(result).toEqual(base)
  })

  it('merges allowed config sections from override', () => {
    const override: WorkflowDefinition = {
      config: { agent: { max_turns: 40 } },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['agent', 'claude', 'env', 'hooks'])
    expect((result.config.agent as Record<string, unknown>).max_turns).toBe(40)
    // preserves base values not overridden
    expect((result.config.agent as Record<string, unknown>).max_concurrent_agents).toBe(10)
  })

  it('ignores disallowed config sections from override', () => {
    const override: WorkflowDefinition = {
      config: {
        tracker: { kind: 'asana', api_key: 'stolen' },
        polling: { interval_ms: 1 },
        workspace: { root: '/etc/evil' },
        server: { port: 9999 },
        agent: { max_turns: 40 },
      },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['agent', 'claude', 'env', 'hooks'])
    // tracker, polling, workspace, server must remain from base
    expect(result.config.tracker).toEqual(base.config.tracker)
    expect(result.config.polling).toEqual(base.config.polling)
    expect(result.config.workspace).toEqual(base.config.workspace)
    expect(result.config.server).toEqual(base.config.server)
    // agent is allowed
    expect((result.config.agent as Record<string, unknown>).max_turns).toBe(40)
  })

  it('replaces prompt_template when override provides a non-empty one and prompt_template is allowed', () => {
    const override: WorkflowDefinition = {
      config: {},
      prompt_template: 'Custom repo prompt',
    }
    const result = mergeWorkflows(base, override, ['agent', 'prompt_template'])
    expect(result.prompt_template).toBe('Custom repo prompt')
  })

  it('keeps base prompt_template when prompt_template is not in allowed sections', () => {
    const override: WorkflowDefinition = {
      config: {},
      prompt_template: 'Custom repo prompt',
    }
    const result = mergeWorkflows(base, override, ['agent'])
    expect(result.prompt_template).toBe('Default prompt {{ issue.title }}')
  })

  it('keeps base prompt_template when override prompt is empty', () => {
    const override: WorkflowDefinition = {
      config: { agent: { max_turns: 50 } },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['agent', 'prompt_template'])
    expect(result.prompt_template).toBe('Default prompt {{ issue.title }}')
  })

  it('deep-merges nested config sections', () => {
    const override: WorkflowDefinition = {
      config: { claude: { effort: 'max' } },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['claude'])
    // effort overridden
    expect((result.config.claude as Record<string, unknown>).effort).toBe('max')
    // model preserved from base
    expect((result.config.claude as Record<string, unknown>).model).toBe('claude-sonnet-4-20250514')
  })

  it('recursively deep-merges nested objects (e.g. claude.settings.attribution)', () => {
    const baseWithSettings: WorkflowDefinition = {
      config: {
        claude: { model: 'opus', settings: { attribution: { commit: 'base-commit', pr: 'base-pr' } } },
      },
      prompt_template: '',
    }
    const override: WorkflowDefinition = {
      config: { claude: { settings: { attribution: { commit: 'repo-commit' } } } },
      prompt_template: '',
    }
    const result = mergeWorkflows(baseWithSettings, override, ['claude'])
    const claude = result.config.claude as Record<string, unknown>
    const settings = claude.settings as Record<string, unknown>
    const attribution = settings.attribution as Record<string, unknown>
    // commit overridden by repo
    expect(attribution.commit).toBe('repo-commit')
    // pr preserved from base
    expect(attribution.pr).toBe('base-pr')
    // model preserved from base
    expect(claude.model).toBe('opus')
  })

  it('merges env additively', () => {
    const override: WorkflowDefinition = {
      config: { env: { NEW_VAR: 'new' } },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['env'])
    const env = result.config.env as Record<string, unknown>
    expect(env.EXISTING).toBe('val')
    expect(env.NEW_VAR).toBe('new')
  })

  it('only merges hooks.before_run and hooks.after_run, not after_create or before_remove', () => {
    const override: WorkflowDefinition = {
      config: {
        hooks: {
          after_create: 'echo hacked',
          before_run: 'echo repo-before',
          after_run: 'echo repo-after',
          before_remove: 'echo hacked-rm',
        },
      },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['hooks'])
    const hooks = result.config.hooks as Record<string, unknown>
    // before_run and after_run replaced
    expect(hooks.before_run).toBe('echo repo-before')
    expect(hooks.after_run).toBe('echo repo-after')
    // after_create and before_remove preserved from base
    expect(hooks.after_create).toBe('echo setup')
    expect(hooks.before_remove).toBe('echo rm')
  })

  it('does not mutate the base workflow', () => {
    const baseCopy = JSON.parse(JSON.stringify(base))
    const override: WorkflowDefinition = {
      config: { agent: { max_turns: 99 } },
      prompt_template: 'New prompt',
    }
    mergeWorkflows(base, override, ['agent', 'prompt_template'])
    expect(base).toEqual(baseCopy)
  })

  it('strips repo_overrides key from the merged config', () => {
    const override: WorkflowDefinition = {
      config: { repo_overrides: true, agent: { max_turns: 30 } },
      prompt_template: '',
    }
    const result = mergeWorkflows(base, override, ['agent'])
    expect(result.config.repo_overrides).toBeUndefined()
  })
})

describe('loadRepoWorkflow', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `workflow-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns null when WORKFLOW.md does not exist in workspace', () => {
    const result = loadRepoWorkflow(testDir)
    expect(result).toBeNull()
  })

  it('parses a valid WORKFLOW.md from workspace', () => {
    writeFileSync(join(testDir, 'WORKFLOW.md'), `---
agent:
  max_turns: 50
---
Custom prompt.`)
    const result = loadRepoWorkflow(testDir)
    expect(result).not.toBeNull()
    expect(result!.config).toMatchObject({ agent: { max_turns: 50 } })
    expect(result!.prompt_template).toBe('Custom prompt.')
  })

  it('returns null for invalid YAML and does not throw', () => {
    writeFileSync(join(testDir, 'WORKFLOW.md'), `---
agent: [unclosed
---
prompt`)
    const result = loadRepoWorkflow(testDir)
    expect(result).toBeNull()
  })
})
