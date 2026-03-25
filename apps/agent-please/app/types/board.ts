export interface BoardIssue {
  id: string
  identifier: string
  title: string
  state: string
  priority: number | null
  url: string | null
  assignees: string[]
  labels: string[]
}
