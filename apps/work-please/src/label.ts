import type { Issue, ServiceConfig } from './types'

export type LabelState = 'dispatched' | 'done' | 'failed'

export interface LabelService {
  setLabel: (issue: Issue, state: LabelState) => Promise<void>
}

const LABEL_COLORS: Record<LabelState, string> = {
  dispatched: '1d76db',
  done: '0e8a16',
  failed: 'd93f0b',
}

const LABEL_TIMEOUT_MS = 10_000
const GITHUB_ISSUE_URL_RE = /https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/

export function parseGitHubIssueUrl(url: string): { owner: string, repo: string, number: number } | null {
  const match = url.match(GITHUB_ISSUE_URL_RE)
  if (!match)
    return null
  const number = Number.parseInt(match[3], 10)
  if (Number.isNaN(number))
    return null
  return { owner: match[1], repo: match[2], number }
}

export function formatLabelName(prefix: string, state: LabelState): string {
  return `${prefix}: ${state}`
}

export function createLabelService(config: ServiceConfig): LabelService | null {
  const { kind, label_prefix } = config.tracker
  if (!label_prefix)
    return null
  if (kind !== 'github_projects')
    return null

  const apiKey = config.tracker.api_key
  const endpoint = config.tracker.endpoint
  const prefix = label_prefix
  const headers: Record<string, string> = {
    'Authorization': `bearer ${apiKey ?? ''}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
  }

  return {
    async setLabel(issue: Issue, state: LabelState): Promise<void> {
      if (!issue.url)
        return
      const parsed = parseGitHubIssueUrl(issue.url)
      if (!parsed)
        return

      try {
        const labelName = formatLabelName(prefix, state)
        await ensureLabelExists(endpoint, parsed.owner, parsed.repo, labelName, state, headers)
        await removeExistingPrefixLabels(endpoint, parsed.owner, parsed.repo, parsed.number, prefix, headers)
        await addLabel(endpoint, parsed.owner, parsed.repo, parsed.number, labelName, headers)
      }
      catch (err) {
        console.warn(`[label] error setting label issue_url=${issue.url}: ${err}`)
      }
    },
  }
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LABEL_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  }
  finally {
    clearTimeout(timer)
  }
}

async function ensureLabelExists(
  endpoint: string,
  owner: string,
  repo: string,
  name: string,
  state: LabelState,
  headers: Record<string, string>,
): Promise<void> {
  const url = `${endpoint}/repos/${owner}/${repo}/labels`
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, color: LABEL_COLORS[state] }),
  })
  if (!response.ok && response.status !== 422) {
    console.warn(`[label] failed to ensure label exists: ${response.status}`)
  }
}

async function removeExistingPrefixLabels(
  endpoint: string,
  owner: string,
  repo: string,
  number: number,
  prefix: string,
  headers: Record<string, string>,
): Promise<void> {
  const url = `${endpoint}/repos/${owner}/${repo}/issues/${number}/labels`
  const response = await fetchWithTimeout(url, { method: 'GET', headers })
  if (!response.ok)
    return
  const labels = await response.json() as Array<{ name: string }>
  const toRemove = labels.filter(l => l.name.startsWith(`${prefix}: `))
  for (const label of toRemove) {
    const deleteUrl = `${url}/${encodeURIComponent(label.name)}`
    await fetchWithTimeout(deleteUrl, { method: 'DELETE', headers }).catch(() => {})
  }
}

async function addLabel(
  endpoint: string,
  owner: string,
  repo: string,
  number: number,
  name: string,
  headers: Record<string, string>,
): Promise<void> {
  const url = `${endpoint}/repos/${owner}/${repo}/issues/${number}/labels`
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: [name] }),
  })
  if (!response.ok) {
    console.warn(`[label] failed to add label: ${response.status}`)
  }
}
