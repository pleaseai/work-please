import { consola } from 'consola'

export function createLogger(tag: string) {
  return consola.withTag(tag)
}
