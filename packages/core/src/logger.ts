import { consola } from 'consola'

let verboseEnabled = false
const DEFAULT_LOG_LEVEL = consola.level

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled
  consola.level = enabled ? 5 : DEFAULT_LOG_LEVEL
}

export function isVerbose(): boolean {
  return verboseEnabled
}

export function createLogger(tag: string) {
  return consola.withTag(tag)
}
