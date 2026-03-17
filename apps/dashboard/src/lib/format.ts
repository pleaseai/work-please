export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(iso))
}

export function formatTokens(n: number): string {
  return new Intl.NumberFormat().format(n)
}
