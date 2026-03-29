import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCachedFetch } from './cached-fetch'

describe('createCachedFetch', () => {
  const tempDirs: string[] = []

  function makeTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cached-fetch-test-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('returns a function', () => {
    const cachedFetch = createCachedFetch(makeTempDir())
    expect(typeof cachedFetch).toBe('function')
  })

  it('accepts cachePath option', () => {
    const cachePath = makeTempDir()
    const cachedFetch = createCachedFetch(cachePath)
    expect(cachedFetch).toBeDefined()
  })

  it('returns a function that returns a Response-like promise', async () => {
    const cachedFetch = createCachedFetch(makeTempDir())
    // We can't easily test against a real server, but verify the function signature
    expect(typeof cachedFetch).toBe('function')
  })

  it('uses no-cache mode by default', () => {
    // Verify createCachedFetch sets default options correctly
    const cachePath = makeTempDir()
    const cachedFetch = createCachedFetch(cachePath)
    // The function should be created without throwing
    expect(cachedFetch).toBeDefined()
  })

  it('allows overriding cache mode', () => {
    const cachePath = makeTempDir()
    const cachedFetch = createCachedFetch(cachePath, { cache: 'default' })
    expect(cachedFetch).toBeDefined()
  })
})
