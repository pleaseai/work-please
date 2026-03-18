# Security Reviewer Memory — brisbane / work-please

## Project Context
- Bun + TypeScript monorepo; main service at `apps/work-please/src/`
- Dashboard SPA at `apps/dashboard/src/` (Vue 3 + Vite)
- HTTP server: `apps/work-please/src/server.ts` (Bun.serve)
- Workspace path logic: `apps/work-please/src/workspace.ts`

## Confirmed Security Patterns

### Path traversal guard (server.ts) — FIXED in shadcn PR
- PR introduced `DASHBOARD_DIST_PREFIX = DASHBOARD_DIST + sep` (line 18)
- `serveStatic` checks `resolved !== DASHBOARD_DIST && !resolved.startsWith(DASHBOARD_DIST_PREFIX)` (line 96)
- The trailing-separator prefix issue from PR #113 is now correctly fixed.
- REMAINING: `Bun.env.DASHBOARD_DIST` still not validated as absolute/normalised path.

### Information disclosure (server.ts `issueResponse`)
- `workspace.path` (absolute server filesystem path) returned in
  `/api/v1/:id` JSON at line 167, rendered in IssuePage.vue line 183.
- Mitigated by loopback-only bind (127.0.0.1).

### Missing security headers (server.ts)
- No `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`,
  or `Referrer-Policy` on any response (API or static file).

### No authentication / no CSRF protection
- `/api/v1/refresh` (POST, state-changing) has no auth or CSRF token.
- Dashboard accessible to any process reaching the bound port (127.0.0.1).

### XSS
- Vue templates use `{{ }}` interpolation exclusively — auto-escaped by Vue.
  No `v-html` found. No raw HTML injection risk in Vue layer.
- Inline HTML fallback in `dashboardResponse()` properly uses `esc()` helper.
- `index.html` inline script reads only from `localStorage` (hardcoded key) — no XSS risk.

### External font loading (index.html)
- Loads Google Fonts over HTTPS; no subresource integrity (SRI) hashes.
  Low severity for a local-only tool.

### Vite proxy
- Proxy target uses `process.env.API_PORT ?? '6100'` — dev-only, not in prod.
- Port value not validated as numeric/range.

## PR Reviews Summary

### PR #113 — path traversal guard (previous)
1. IMPORTANT — Path traversal: missing trailing separator (FIXED in shadcn PR)
2. IMPORTANT — Workspace path disclosure in API + UI (persists)
3. SUGGESTION — No security response headers (persists)
4. SUGGESTION — No CSRF token on POST /api/v1/refresh (persists)
5. SUGGESTION — DASHBOARD_DIST env var not validated (persists)

### PR amondnet/web-dashboard-shadcn
1. IMPORTANT — Workspace path disclosure: server.ts:167, IssuePage.vue:183
2. IMPORTANT — No security headers on any HTTP response
3. SUGGESTION — No CSRF protection on POST /api/v1/refresh
4. SUGGESTION — No SRI on external Google Fonts in index.html
5. SUGGESTION — API_PORT env var not range-validated in vite.config.ts (dev only)
6. POSITIVE — Path traversal guard correctly implemented with sep suffix

Notes:
- Agent threads always have their cwd reset between bash calls; only use absolute file paths.
- In final responses, share absolute file paths; include code snippets only when load-bearing.
- Avoid emojis in all responses.
- Do not use a colon before tool calls.
