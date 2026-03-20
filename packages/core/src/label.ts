import type { Issue, ServiceConfig } from './types'
import { createLogger } from './logger'

const log = createLogger('label')

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

interface RepoContext {
  endpoint: string
  owner: string
  repo: string
  headers: Record<string, string>
}

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
  // Use the first github-like project with a label_prefix
  const project = config.projects.find(p => p.label_prefix && config.platforms[p.platform]?.kind === 'github')
  if (!project?.label_prefix)
    return null

  const platform = config.platforms[project.platform]
  if (!platform || platform.kind !== 'github')
    return null

  const apiKey = platform.api_key
  const endpoint = project.endpoint
  const prefix = project.label_prefix
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

      const ctx: RepoContext = { endpoint, owner: parsed.owner, repo: parsed.repo, headers }

      try {
        const labelName = formatLabelName(prefix, state)
        await ensureLabelExists(ctx, labelName, state)
        await removeExistingPrefixLabels(ctx, parsed.number, prefix)
        await addLabel(ctx, parsed.number, labelName)
      }
      catch (err) {
        log.warn(`error setting label issue_url=${issue.url}: ${err}`)
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
  ctx: RepoContext,
  name: string,
  state: LabelState,
): Promise<void> {
  const { endpoint, owner, repo, headers } = ctx
  const url = `${endpoint}/repos/${owner}/${repo}/labels`
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, color: LABEL_COLORS[state] }),
  })
  if (!response.ok && response.status !== 422) {
    log.warn(`failed to ensure label exists label_name=${name} owner=${owner} repo=${repo}: HTTP ${response.status}`)
  }
}

async function removeExistingPrefixLabels(
  ctx: RepoContext,
  number: number,
  prefix: string,
): Promise<void> {
  const { endpoint, owner, repo, headers } = ctx
  const url = `${endpoint}/repos/${owner}/${repo}/issues/${number}/labels`
  const response = await fetchWithTimeout(url, { method: 'GET', headers })
  if (!response.ok) {
    log.warn(`failed to fetch existing labels owner=${owner} repo=${repo} issue_number=${number}: HTTP ${response.status}`)
    return
  }
  let labels: Array<{ name: string }>
  try {
    labels = await response.json() as Array<{ name: string }>
  }
  catch {
    log.warn(`failed to parse label list response for issue_number=${number}`)
    return
  }
  const toRemove = labels.filter(l => l.name.startsWith(`${prefix}: `))
  for (const label of toRemove) {
    const deleteUrl = `${url}/${encodeURIComponent(label.name)}`
    const deleteResponse = await fetchWithTimeout(deleteUrl, { method: 'DELETE', headers }).catch((err) => {
      log.warn(`failed to remove label "${label.name}" issue_number=${number}: ${err}`)
      return null
    })
    if (deleteResponse && !deleteResponse.ok) {
      log.warn(`failed to remove label "${label.name}" owner=${owner} repo=${repo} issue_number=${number}: HTTP ${deleteResponse.status}`)
    }
  }
}

async function addLabel(
  ctx: RepoContext,
  number: number,
  name: string,
): Promise<void> {
  const { endpoint, owner, repo, headers } = ctx
  const url = `${endpoint}/repos/${owner}/${repo}/issues/${number}/labels`
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ labels: [name] }),
  })
  if (!response.ok) {
    log.warn(`failed to add label label_name=${name} owner=${owner} repo=${repo} issue_number=${number}: HTTP ${response.status}`)
  }
}
