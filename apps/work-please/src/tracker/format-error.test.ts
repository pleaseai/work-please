import { describe, expect, it } from 'bun:test'
import { formatTrackerError } from './types'

describe('formatTrackerError', () => {
  describe('github_projects_api_status', () => {
    it('includes HTTP status 401', () => {
      expect(formatTrackerError({ code: 'github_projects_api_status', status: 401, body: null }))
        .toBe('github_projects_api_status (HTTP 401)')
    })

    it('includes HTTP status 403', () => {
      expect(formatTrackerError({ code: 'github_projects_api_status', status: 403, body: null }))
        .toBe('github_projects_api_status (HTTP 403)')
    })
  })

  describe('asana_api_status', () => {
    it('includes HTTP status 403', () => {
      expect(formatTrackerError({ code: 'asana_api_status', status: 403, body: null }))
        .toBe('asana_api_status (HTTP 403)')
    })

    it('includes HTTP status 500', () => {
      expect(formatTrackerError({ code: 'asana_api_status', status: 500, body: null }))
        .toBe('asana_api_status (HTTP 500)')
    })
  })

  describe('github_projects_graphql_errors', () => {
    it('stringifies errors array', () => {
      const errors = [{ message: 'Could not resolve to a node' }]
      const result = formatTrackerError({ code: 'github_projects_graphql_errors', errors })
      expect(result).toBe(`github_projects_graphql_errors: ${JSON.stringify(errors)}`)
    })

    it('handles empty errors array', () => {
      expect(formatTrackerError({ code: 'github_projects_graphql_errors', errors: [] }))
        .toBe('github_projects_graphql_errors: []')
    })
  })

  describe('github_projects_api_request', () => {
    it('includes cause message for Error', () => {
      const cause = new Error('ECONNREFUSED')
      const result = formatTrackerError({ code: 'github_projects_api_request', cause })
      expect(result).toContain('github_projects_api_request:')
      expect(result).toContain('ECONNREFUSED')
    })

    it('serializes non-Error object cause', () => {
      const cause = { code: 'ECONNREFUSED', errno: -111 }
      const result = formatTrackerError({ code: 'github_projects_api_request', cause })
      expect(result).toContain('github_projects_api_request:')
      expect(result).toContain('ECONNREFUSED')
    })

    it('handles string cause', () => {
      expect(formatTrackerError({ code: 'github_projects_api_request', cause: 'timeout' }))
        .toBe('github_projects_api_request: timeout')
    })
  })

  describe('asana_api_request', () => {
    it('includes cause message for Error', () => {
      const cause = new Error('fetch failed')
      const result = formatTrackerError({ code: 'asana_api_request', cause })
      expect(result).toContain('asana_api_request:')
      expect(result).toContain('fetch failed')
    })

    it('serializes non-Error object cause', () => {
      const cause = { type: 'NetworkError' }
      const result = formatTrackerError({ code: 'asana_api_request', cause })
      expect(result).toContain('asana_api_request:')
      expect(result).toContain('NetworkError')
    })
  })

  describe('simple code variants', () => {
    it('missing_tracker_api_key returns just the code', () => {
      expect(formatTrackerError({ code: 'missing_tracker_api_key' }))
        .toBe('missing_tracker_api_key')
    })

    it('unsupported_tracker_kind returns just the code', () => {
      expect(formatTrackerError({ code: 'unsupported_tracker_kind', kind: 'jira' }))
        .toBe('unsupported_tracker_kind')
    })

    it('missing_tracker_project_config returns just the code', () => {
      expect(formatTrackerError({ code: 'missing_tracker_project_config', field: 'project_gid' }))
        .toBe('missing_tracker_project_config')
    })

    it('asana_unknown_payload returns just the code', () => {
      expect(formatTrackerError({ code: 'asana_unknown_payload', payload: {} }))
        .toBe('asana_unknown_payload')
    })

    it('github_projects_unknown_payload returns just the code', () => {
      expect(formatTrackerError({ code: 'github_projects_unknown_payload', payload: {} }))
        .toBe('github_projects_unknown_payload')
    })

    it('asana_missing_next_page returns just the code', () => {
      expect(formatTrackerError({ code: 'asana_missing_next_page' }))
        .toBe('asana_missing_next_page')
    })

    it('github_projects_missing_end_cursor returns just the code', () => {
      expect(formatTrackerError({ code: 'github_projects_missing_end_cursor' }))
        .toBe('github_projects_missing_end_cursor')
    })
  })
})
