import type { MakeFetchHappenOptions } from 'make-fetch-happen'
import makeFetchHappen from 'make-fetch-happen'

export type CachedFetch = (url: string, init?: RequestInit & MakeFetchHappenOptions) => Promise<Response>

export interface CachedFetchOptions {
  /** Override the default cache mode (default: 'no-cache' — always revalidate) */
  cache?: RequestCache
}

/**
 * Creates a fetch function with built-in HTTP caching via make-fetch-happen.
 *
 * Uses `cache: 'no-cache'` by default, which always sends conditional requests
 * (If-None-Match / If-Modified-Since) and returns cached body on 304.
 * This is ideal for polling where freshness matters but we want to avoid
 * redundant data transfers.
 */
export function createCachedFetch(cachePath: string, options?: CachedFetchOptions): CachedFetch {
  const cacheMode = options?.cache ?? 'no-cache'

  return makeFetchHappen.defaults({
    cachePath,
    cache: cacheMode,
  }) as unknown as CachedFetch
}
