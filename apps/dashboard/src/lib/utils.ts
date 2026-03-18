import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toMessage(e: unknown): string {
  if (e instanceof Error)
    return e.message
  if (typeof e === 'string')
    return e
  return 'An unexpected error occurred'
}
