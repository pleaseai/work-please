import type { WorkflowDefinition } from './types'
import { describe, expect, it } from 'bun:test'
import process from 'node:process'
import { buildConfig, getActiveStates, getTerminalStates, maxConcurrentForState, normalizeState, validateConfig } from './config'

function makeWorkflow(config: Record<string, unknown>): WorkflowDefinition {
  return { config, prompt_template: '' }
}

describe('buildConfig', () => {
  it('applies defaults when config is empty', () => {
    const config = buildConfig(makeWorkflow({}))
    expect(config.polling.interval_ms).toBe(30_000)
    expect(config.agent.max_concurrent_agents).toBe(10)
    expect(config.agent.max_turns).toBe(20)
    expect(config.agent.max_retry_backoff_ms).toBe(300_000)
    expect(config.claude.command).toBe('claude')
    expect(config.claude.turn_timeout_ms).toBe(3_600_000)
    expect(config.claude.read_timeout_ms).toBe(5_000)
    expect(config.claude.stall_timeout_ms).toBe(300_000)
    expect(config.hooks.timeout_ms).toBe(60_000)
    expect(config.hooks.after_create).toBeNull()
    expect(config.hooks.before_run).toBeNull()
  })

  it('parses asana tracker config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'asana',
        api_key: 'token123',
        project_gid: 'gid456',
        active_sections: ['Todo', 'In Progress'],
      },
    }))
    expect(config.tracker.kind).toBe('asana')
    expect(config.tracker.api_key).toBe('token123')
    expect(config.tracker.project_gid).toBe('gid456')
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress'])
  })

  it('parses github_projects tracker config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: {
        kind: 'github_projects',
        api_key: 'ghtoken',
        owner: 'myorg',
        project_number: 42,
      },
    }))
    expect(config.tracker.kind).toBe('github_projects')
    expect(config.tracker.api_key).toBe('ghtoken')
    expect(config.tracker.owner).toBe('myorg')
    expect(config.tracker.project_number).toBe(42)
  })

  it('resolves $VAR env references for api_key', () => {
    process.env.TEST_API_KEY = 'resolved-token'
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: '$TEST_API_KEY', project_gid: 'gid' },
    }))
    expect(config.tracker.api_key).toBe('resolved-token')
    delete process.env.TEST_API_KEY
  })

  it('parses comma-separated active_sections string', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_sections: 'Todo, In Progress, Review' },
    }))
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress', 'Review'])
  })

  it('accepts active_states as alias for active_sections (asana)', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_states: ['Todo', 'In Progress'] },
    }))
    expect(config.tracker.active_sections).toEqual(['Todo', 'In Progress'])
  })

  it('parses string integer for polling interval', () => {
    const config = buildConfig(makeWorkflow({ polling: { interval_ms: '60000' } }))
    expect(config.polling.interval_ms).toBe(60_000)
  })

  it('normalizes state keys in max_concurrent_agents_by_state', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents_by_state: {
          'In Progress': 3,
          'Todo': '2',
        },
      },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBe(3)
    expect(config.agent.max_concurrent_agents_by_state.todo).toBe(2)
  })

  it('ignores invalid (non-positive) values in max_concurrent_agents_by_state', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents_by_state: {
          'In Progress': -1,
          'Todo': 'invalid',
        },
      },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.todo).toBeUndefined()
  })

  it('preserves hook scripts with trimEnd', () => {
    const config = buildConfig(makeWorkflow({
      hooks: { before_run: 'git pull\n' },
    }))
    expect(config.hooks.before_run).toBe('git pull')
  })

  it('returns null for empty hook scripts', () => {
    const config = buildConfig(makeWorkflow({
      hooks: { before_run: '  ' },
    }))
    expect(config.hooks.before_run).toBeNull()
  })

  it('preserves claude.command as shell command string including spaces (Section 17.1)', () => {
    const config = buildConfig(makeWorkflow({
      claude: { command: 'claude --permission-mode full --no-ansi' },
    }))
    expect(config.claude.command).toBe('claude --permission-mode full --no-ansi')
  })

  it('resolves $VAR for workspace root path (Section 17.1)', () => {
    process.env.TEST_WORKSPACE_ROOT = '/tmp/test-workspaces'
    const config = buildConfig(makeWorkflow({
      workspace: { root: '$TEST_WORKSPACE_ROOT' },
    }))
    expect(config.workspace.root).toBe('/tmp/test-workspaces')
    delete process.env.TEST_WORKSPACE_ROOT
  })
})

describe('validateConfig', () => {
  it('returns null for valid asana config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'token', project_gid: 'gid' },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns null for valid github_projects config', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', api_key: 'token', owner: 'org', project_number: 1 },
    }))
    expect(validateConfig(config)).toBeNull()
  })

  it('returns missing_tracker_kind when kind is absent', () => {
    const config = buildConfig(makeWorkflow({}))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_kind')
  })

  it('returns unsupported_tracker_kind for unknown tracker', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'linear' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('unsupported_tracker_kind')
  })

  it('returns missing_tracker_api_key when api_key is absent', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana', project_gid: 'gid' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_api_key')
  })

  it('returns missing_tracker_project_config when asana project_gid missing', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana', api_key: 'tok' } }))
    const err = validateConfig(config)
    expect(err?.code).toBe('missing_tracker_project_config')
  })

  it('returns missing_claude_command when claude.command is blank (Section 17.1)', () => {
    // buildConfig always applies default when command is empty, so we test validateConfig
    // directly with a ServiceConfig that has a blank command
    const baseConfig = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', api_key: 'tok', project_gid: 'gid' },
    }))
    const configWithBlankCommand = {
      ...baseConfig,
      claude: { ...baseConfig.claude, command: '   ' },
    }
    const err = validateConfig(configWithBlankCommand)
    expect(err?.code).toBe('missing_claude_command')
  })
})

describe('getActiveStates / getTerminalStates', () => {
  it('returns asana active_sections', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'asana', active_sections: ['Todo'] },
    }))
    expect(getActiveStates(config)).toEqual(['Todo'])
  })

  it('returns github_projects active_statuses', () => {
    const config = buildConfig(makeWorkflow({
      tracker: { kind: 'github_projects', active_statuses: ['In Progress'] },
    }))
    expect(getActiveStates(config)).toEqual(['In Progress'])
  })

  it('returns defaults when not configured', () => {
    const config = buildConfig(makeWorkflow({ tracker: { kind: 'asana' } }))
    expect(getTerminalStates(config)).toEqual(['Done', 'Cancelled'])
  })
})

describe('normalizeState', () => {
  it('lowercases and trims state names', () => {
    expect(normalizeState('  In Progress  ')).toBe('in progress')
    expect(normalizeState('DONE')).toBe('done')
  })
})

describe('path expansion', () => {
  it('expands ~ to HOME directory', () => {
    const home = process.env.HOME ?? '/home/user'
    const config = buildConfig(makeWorkflow({ workspace: { root: '~/workspaces' } }))
    expect(config.workspace.root).toBe(`${home}/workspaces`)
  })

  it('preserves absolute paths unchanged', () => {
    const config = buildConfig(makeWorkflow({ workspace: { root: '/tmp/myworkspaces' } }))
    expect(config.workspace.root).toBe('/tmp/myworkspaces')
  })
})

describe('per-state concurrency limits', () => {
  it('normalizes state keys to lowercase', () => {
    const config = buildConfig(makeWorkflow({
      agent: { max_concurrent_agents_by_state: { 'In Progress': 2, 'TODO': 1 } },
    }))
    expect(config.agent.max_concurrent_agents_by_state['in progress']).toBe(2)
    expect(config.agent.max_concurrent_agents_by_state.todo).toBe(1)
  })

  it('ignores non-positive values', () => {
    const config = buildConfig(makeWorkflow({
      agent: { max_concurrent_agents_by_state: { done: 0, active: -1, running: 3 } },
    }))
    expect(config.agent.max_concurrent_agents_by_state.done).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.active).toBeUndefined()
    expect(config.agent.max_concurrent_agents_by_state.running).toBe(3)
  })

  it('maxConcurrentForState falls back to global limit for unknown states', () => {
    const config = buildConfig(makeWorkflow({ agent: { max_concurrent_agents: 5 } }))
    expect(maxConcurrentForState(config, 'unknown state')).toBe(5)
  })

  it('maxConcurrentForState returns per-state limit when configured', () => {
    const config = buildConfig(makeWorkflow({
      agent: {
        max_concurrent_agents: 10,
        max_concurrent_agents_by_state: { 'in progress': 2 },
      },
    }))
    expect(maxConcurrentForState(config, 'In Progress')).toBe(2)
  })
})
