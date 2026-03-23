import { describe, expect, it } from 'vitest'
import { formatSecondsRunning, formatTokens } from '../../app/utils/format'

describe('formatTokens', () => {
  it('formats numbers with locale separators', () => {
    expect(formatTokens(1000)).toMatch(/1\D000/)
  })

  it('returns "0" for zero', () => {
    expect(formatTokens(0)).toBe('0')
  })
})

describe('formatSecondsRunning', () => {
  it('formats seconds under a minute', () => {
    expect(formatSecondsRunning(45)).toBe('45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatSecondsRunning(125)).toBe('2m 5s')
  })

  it('rounds fractional seconds', () => {
    expect(formatSecondsRunning(59.7)).toBe('1m 0s')
  })

  it('handles zero', () => {
    expect(formatSecondsRunning(0)).toBe('0s')
  })
})
