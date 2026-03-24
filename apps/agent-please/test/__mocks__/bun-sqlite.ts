// Shim for bun:sqlite → node:sqlite for vitest (Node runtime)
// better-auth accepts both bun:sqlite Database and node:sqlite DatabaseSync
import { DatabaseSync } from 'node:sqlite'

export { DatabaseSync as Database }
