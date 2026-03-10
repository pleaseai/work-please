import { describe, expect, it } from 'bun:test'
import { parseWorkflow } from './workflow'

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
