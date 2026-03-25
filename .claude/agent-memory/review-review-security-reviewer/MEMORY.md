# Security Reviewer Memory — brisbane / agent-please

## Project Context
- Bun + TypeScript monorepo; main service at `apps/agent-please/src/`
- Dashboard SPA at `apps/dashboard/src/` (Vue 3 + Vite)
- HTTP server: `apps/agent-please/src/server.ts` (Bun.serve)
- Workspace path logic: `apps/agent-please/src/workspace.ts`

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

### PR amondnet/issue-comment-dispatch
1. CRITICAL — No signature guard on new agent dispatch path: when `webhook.secret` is null (documented default), unauthenticated callers can POST crafted `issue_comment` payloads to trigger Claude Code agent runs. `github.post.ts:75-87`. Mitigation: require secret to be set before allowing agent dispatch.
2. IMPORTANT — Full `String(err)` posted to public GitHub comment in catch block: may leak stack traces, filesystem paths, or config values. `issue-comment-handler.ts:218-225`. Fix: log full error server-side, post only a generic message.
3. IMPORTANT — `owner`, `repo`, `commentId`, `reactionId` from untrusted payload interpolated into GitHub API URLs without validation. No runtime type guard on numeric fields. `github.post.ts:29-63`. Fix: validate/sanitize + encodeURIComponent on string segments.
4. POSITIVE — `escapeRegex` correctly prevents ReDoS in `extractMentionPrompt`.
5. POSITIVE — `sanitizeIdentifier` + `validateWorkspacePath` with `resolve`/`sep` guard prevents path traversal on `identifier`.
6. POSITIVE — Bearer token only sent to hardcoded `https://api.github.com` endpoints; no SSRF risk.

### PR amondnet/istanbul — auth feature
1. CRITICAL — Auth entirely optional at runtime: if `auth.secret` absent, ALL /api/v1/* routes are unprotected with no warning to callers (server/middleware/auth.ts:17-25).
2. IMPORTANT — No `trustedOrigins` in `betterAuth()`: Better Auth defaults accept requests from any origin; no CORS restriction on state-changing auth endpoints (server/utils/auth.ts:29-37).
3. IMPORTANT — OAuth `callbackURL: '/'` is relative; open redirect risk if Better Auth does not enforce same-origin before following it (app/pages/login.vue:19).
4. IMPORTANT — DB path: `resolve(config.workspace.root, config.db.path)` where `config.db.path` comes from untrusted WORKFLOW.md and is never checked to stay within workspace root (server/plugins/03.auth.ts:20). Path traversal possible.
5. IMPORTANT — Admin password stored as plain string in config and passed to createUser() with no minimum-length validation (server/plugins/03.auth.ts:43-49; types.ts:149-153).
6. POSITIVE — Auth disabled unless `config.auth.secret` is set (plugin guard at line 15).
7. POSITIVE — Webhook routes explicitly excluded from session checks.
8. POSITIVE — `$ENV_VAR` indirection keeps secrets out of WORKFLOW.md.

### PR amondnet/session-chat-view
1. IMPORTANT — Unbounded offset cap: `parsePositiveInt(url.searchParams.get('offset'), Number.MAX_SAFE_INTEGER)` in server.ts:268 — offset should be capped at a reasonable value (e.g. 10,000) not MAX_SAFE_INTEGER
2. IMPORTANT — No Content-Security-Policy on session page HTML response (server.ts ~line 300); SECURITY_HEADERS lacks CSP; easy fix: `"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"`
3. POSITIVE — Session ID validated with allowlist regex `/^[\w-]{1,128}$/` before SDK call
4. POSITIVE — All server-side HTML uses esc() throughout session-renderer.ts
5. POSITIVE — Vue layer uses mustache-only interpolation; no v-html; encodeURIComponent on link construction
6. POSITIVE — decodeURIComponent applied before isValidSessionId (correct order)
7. NOTE — esc() helper duplicated in server.ts and session-renderer.ts (code quality, not security issue)
8. NOTE — SECURITY_HEADERS now includes X-Content-Type-Options, X-Frame-Options, Referrer-Policy (previously flagged as missing — partially resolved)

### PR #198 — GitHub App token injection into git URLs (workspace.ts)
1. CRITICAL — Token leaked in server-side logs: `ensureSharedClone` embeds `authUrl` (containing live token) in git clone/fetch error strings at `workspace.ts:101-102`, `workspace.ts:111-112`. Git echoes the URL on failure; error propagates to `log.error` in orchestrator.ts:360 and issue-comment-handler.ts:251. Fix: scrub token from stderr/stdout before constructing the Error message.
2. IMPORTANT — Token persisted in `.git/config`: `configureRemoteAuth` calls `git remote set-url origin https://x-access-token:<token>@...` writing the live token into the worktree's `.git/config` file at `workspace.ts:465`. Token remains on-disk after the agent run completes. Fix: use a git credential helper or ephemeral .netrc; unset the credential URL in the cleanup/after-run path.
3. POSITIVE — `buildAuthenticatedUrl` uses `new URL()` `.username`/`.password` setters — no injection risk from token characters (`@`, `/`).
4. POSITIVE — Error posted to GitHub comment (`issue-comment-handler.ts:275`) is a static generic string; token never reaches public GitHub.

Notes:
- Agent threads always have their cwd reset between bash calls; only use absolute file paths.
- In final responses, share absolute file paths; include code snippets only when load-bearing.
- Avoid emojis in all responses.
- Do not use a colon before tool calls.
