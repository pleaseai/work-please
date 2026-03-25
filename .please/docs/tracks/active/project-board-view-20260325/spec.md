# Add Tracker Project Board View to Dashboard

> Track: project-board-view-20260325
> Issue: https://github.com/pleaseai/agent-please/issues/206

## Overview

Add a project board view to the Nuxt dashboard that displays tracker project issues grouped by status columns in a kanban layout. After login, users can browse configured tracker projects and view their issues at a glance, with real-time updates via SSE. This initial implementation targets GitHub Projects v2 only; Asana support will follow in a separate track.

## Requirements

### Functional Requirements

- [ ] FR-1: `GET /api/v1/projects` endpoint returning the list of configured tracker projects from the global WORKFLOW.md service config (with optional per-repo WORKFLOW.md overrides when `repo_overrides.allow` is enabled); workspace configuration remains in `.please/config.yml`
- [ ] FR-2: `GET /api/v1/projects/[id]/board` endpoint returning issues grouped by status column, using the existing `TrackerAdapter.fetchIssuesByStates`
- [ ] FR-3: SSE endpoint `GET /api/v1/projects/[id]/board/stream` for real-time board updates when orchestrator state changes
- [ ] FR-4: `/projects` page displaying a list of configured projects with name, tracker type, and link to board view
- [ ] FR-5: `/projects/[id]` page displaying a kanban board with status columns, issue cards, and issue count per column
- [ ] FR-6: Issue cards display title, assignee, labels, and priority
- [ ] FR-7: Clicking an issue card navigates to the existing issue detail page (`/issues/[id]`) or opens the external tracker URL
- [ ] FR-8: Dashboard home page (`/`) updated to include a projects section with quick links
- [ ] FR-9: `useProjects` composable for fetching project list
- [ ] FR-10: `useProjectBoard` composable for fetching and subscribing to board state via SSE

### Non-functional Requirements

- [ ] NFR-1: Board view loads within 2 seconds for up to 100 issues
- [ ] NFR-2: SSE connection auto-reconnects on disconnect
- [ ] NFR-3: UI follows existing dashboard patterns (Nuxt UI v4 components: `UDashboardPanel`, `UCard`, `UBadge`)
- [ ] NFR-4: Reference `vendor/better-hub` for UI/UX patterns (issues-list, issue-detail-layout)

## Acceptance Criteria

- [ ] AC-1: User can navigate to `/projects` and see all configured GitHub Projects v2 projects
- [ ] AC-2: User can click a project to see its kanban board with issues grouped by status columns
- [ ] AC-3: Each column shows its issue count
- [ ] AC-4: Issue cards show title, assignee avatar, labels, and priority badge
- [ ] AC-5: Clicking an issue card navigates to issue detail
- [ ] AC-6: Board updates in real-time when issue status changes (via SSE)
- [ ] AC-7: Dashboard home page shows links to projects

## Out of Scope

- Asana tracker board view (separate follow-up track)
- Drag-and-drop issue reordering between columns
- Issue creation or editing from the board view
- Filter/search functionality on the board
- Board view customization (column ordering, visibility)

## Assumptions

- The existing `TrackerAdapter` interface provides `fetchIssuesByStates` which can be used to retrieve issues grouped by status
- WORKFLOW.md config already contains project identifiers that can be used for the projects list
- Authentication is already handled by the existing auth middleware
