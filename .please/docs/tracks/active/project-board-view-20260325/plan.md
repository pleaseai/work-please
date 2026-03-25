# Plan: Add Tracker Project Board View to Dashboard

> Track: project-board-view-20260325
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: [spec.md](./spec.md)
- **Issue**: #206
- **Created**: 2026-03-25
- **Approach**: Pragmatic

## Purpose

After this change, dashboard users will be able to browse configured GitHub Projects v2 boards and see all issues grouped by status in a kanban layout. They can verify it works by navigating to `/projects`, clicking a project, and seeing issue cards organized in status columns that update in real-time via SSE.

## Context

The dashboard currently only shows orchestrator metrics (running/retrying counts, tokens, time) at `/`. There is no way to see the tracker's project board — the full picture of issues by status column. Issue #206 requests adding a project board view so users can see issue statuses at a glance.

The existing codebase provides all the building blocks: `TrackerAdapter.fetchIssuesByStates()` can retrieve issues grouped by status, `ServiceConfig.projects` contains project configuration from WORKFLOW.md, and `createTrackerAdapter()` creates adapters per project/platform pair. The dashboard follows a consistent pattern with `UDashboardPanel`, `UCard`, and composables using `useFetch` + `useIntervalFn` polling.

This track covers GitHub Projects v2 only. Asana board support is deferred to a follow-up track. SSE real-time updates are a new pattern for this codebase — existing composables use polling via `useIntervalFn`. Filter/search and drag-and-drop are out of scope.

### Non-goals

- Asana tracker board view
- Drag-and-drop issue reordering
- Issue creation or editing from the board
- Filter/search on the board
- Board customization (column ordering, visibility)

## Architecture Decision

The implementation follows the existing Nitro route + composable + page pattern established in the codebase. Two new API endpoints serve project list and board data by reading from the orchestrator's config and creating tracker adapters on-demand. An SSE endpoint provides real-time board updates by polling the tracker at a configurable interval and pushing diffs to connected clients. The UI uses the established `UDashboardPanel` layout with kanban columns rendered as a horizontal flex container of `UCard` components. This approach minimizes new patterns while adding SSE as the only new capability.

Alternative considered: WebSocket for real-time updates. Rejected because SSE is simpler (unidirectional server-to-client), works natively with H3/Nitro's `createEventStream()`, requires no additional dependencies, and matches the read-only nature of the board view.

## Tasks

### Phase 1: API Layer (oRPC)

- [ ] T001 Add Zod schemas for projects and board (file: apps/agent-please/server/orpc/schemas.ts)
- [ ] T002 Add projects list and board procedures to oRPC router (file: apps/agent-please/server/orpc/router.ts, depends on T001)
- [ ] T003 Add board live SSE procedure using eventIterator (file: apps/agent-please/server/orpc/router.ts, depends on T002)

### Phase 2: Composables

- [ ] T004 [P] Create useProjects composable with TanStack Query (file: apps/agent-please/app/composables/useProjects.ts, depends on T002)
- [ ] T005 [P] Create useProjectBoard composable with live SSE (file: apps/agent-please/app/composables/useProjectBoard.ts, depends on T003)

### Phase 3: UI Components

- [ ] T006 Create IssueCard component for board view (file: apps/agent-please/app/components/IssueCard.vue, depends on T001)
- [ ] T007 Create BoardColumn component for status columns (file: apps/agent-please/app/components/BoardColumn.vue, depends on T006)

### Phase 4: Pages & Navigation

- [ ] T008 Create projects list page (file: apps/agent-please/app/pages/projects/index.vue, depends on T004)
- [ ] T009 Create project board page with kanban layout (file: apps/agent-please/app/pages/projects/[id].vue, depends on T005, T007)
- [ ] T010 Add projects navigation item to dashboard sidebar (file: apps/agent-please/app/layouts/dashboard.vue, depends on T008)
- [ ] T011 Add projects quick-links section to dashboard home (file: apps/agent-please/app/pages/index.vue, depends on T004)

## Key Files

### Create

- `apps/agent-please/app/composables/useProjects.ts` — Projects list composable (TanStack Query)
- `apps/agent-please/app/composables/useProjectBoard.ts` — Board data + live SSE composable
- `apps/agent-please/app/components/IssueCard.vue` — Issue card component
- `apps/agent-please/app/components/BoardColumn.vue` — Status column component
- `apps/agent-please/app/pages/projects/index.vue` — Projects list page
- `apps/agent-please/app/pages/projects/[id].vue` — Project board page

### Modify

- `apps/agent-please/server/orpc/schemas.ts` — Add project/board Zod schemas
- `apps/agent-please/server/orpc/router.ts` — Add projects procedures to router
- `apps/agent-please/app/layouts/dashboard.vue` — Add "Projects" navigation item
- `apps/agent-please/app/pages/index.vue` — Add projects quick-links section

### Reuse

- `apps/agent-please/server/orpc/middleware.ts` — `authed` middleware for auth
- `apps/agent-please/server/utils/orchestrator.ts` — `useOrchestrator()` for accessing config
- `packages/core/src/tracker/index.ts` — `createTrackerAdapter()` factory
- `packages/core/src/tracker/types.ts` — `TrackerAdapter`, `isTrackerError()`, `formatTrackerError()`
- `packages/core/src/types.ts` — `Issue`, `ProjectConfig`, `PlatformConfig`, `ServiceConfig`

## Verification

### Automated Tests

- [ ] T002 endpoint returns project list from config
- [ ] T003 endpoint returns issues grouped by status columns
- [ ] T003 endpoint returns 404 for invalid project index
- [ ] T005 composable fetches and exposes project list reactively
- [ ] T006 composable fetches board data and handles SSE events
- [ ] T007 IssueCard renders title, assignee, labels, priority
- [ ] T008 BoardColumn renders column header with count and issue cards

### Observable Outcomes

- After navigating to `/projects`, the page shows a list of configured GitHub Projects v2 projects with name and tracker type
- After clicking a project, the kanban board displays issues in status columns with issue count badges
- After an issue changes status in GitHub, the board column updates within seconds without page refresh

### Manual Testing

- [ ] Navigate to `/projects` — verify project list loads
- [ ] Click a project — verify kanban board renders with correct status columns
- [ ] Verify issue cards show title, assignee avatar, labels, and priority badge
- [ ] Click an issue card — verify navigation to issue detail page
- [ ] Verify SSE reconnects after network interruption
- [ ] Verify dashboard home page shows project quick links

### Acceptance Criteria Check

- [ ] AC-1: `/projects` shows all configured GitHub Projects v2 projects
- [ ] AC-2: Kanban board with issues grouped by status columns
- [ ] AC-3: Each column shows issue count
- [ ] AC-4: Issue cards show title, assignee, labels, priority
- [ ] AC-5: Click-through to issue detail
- [ ] AC-6: Real-time updates via SSE
- [ ] AC-7: Dashboard home shows project links

## Decision Log

- Decision: Use SSE over WebSocket for real-time board updates
  Rationale: SSE is simpler (unidirectional), natively supported by H3/Nitro `createEventStream()`, requires no additional dependencies, and matches the read-only nature of the board view
  Date/Author: 2026-03-25 / Claude

- Decision: GitHub Projects v2 only in this track, Asana deferred
  Rationale: User chose to scope this track to GitHub first, reducing complexity and allowing faster delivery
  Date/Author: 2026-03-25 / Claude

- Decision: Use project array index as project ID in routes
  Rationale: `ServiceConfig.projects` is an array without explicit IDs. Using the array index (0-based) as the route param `[id]` is the simplest approach. The project list endpoint returns the index alongside each project so the client can construct board URLs
  Date/Author: 2026-03-25 / Claude

- Decision: Use oRPC procedures instead of Nitro REST routes
  Rationale: The codebase has already migrated to oRPC + TanStack Query (orpc-tanstack-migration track). New endpoints should follow the established oRPC pattern with Zod schemas, authed middleware, and eventIterator for SSE
  Date/Author: 2026-03-25 / Claude
