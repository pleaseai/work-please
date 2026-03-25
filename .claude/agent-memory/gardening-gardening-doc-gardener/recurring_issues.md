---
name: recurring-doc-issues
description: Chronic drift points and recurring issue types found in scans
type: project
---

**Chronic drift: ARCHITECTURE.md**
- This file drifts fastest because the codebase evolves rapidly (oRPC migration, relay packages, auth)
- In the 2026-03-26 scan: 4 API route file paths were stale (v1/* Nitro routes replaced by oRPC)
- New modules added to packages/core without updating ARCHITECTURE.md module listing
- DB description said @libsql/client; actually Kysely since v0.1.8
- 03.auth.ts plugin existed but was not listed in Entry Points or Module Structure

**Structural gap: packages without READMEs**
- packages/relay-client and packages/relay-server were created without READMEs (added 2026-03-26)
- packages/core also lacked a README (added 2026-03-26)
- apps/docs and apps/agent-please still lack READMEs (root README.md serves for agent-please)

**Orphaned track plan:**
- `.please/docs/tracks/active/dedup-dispatch-20260321/plan.md` exists but was not in tracks/index.md
- This track has no formal spec file (conversation-derived)

**Expected orphans (not real issues):**
- .please/docs/tracks/active/*/plan.md and spec.md — accessed via tracks/index.md, link graph
  misses them because .please/INDEX.md uses bare relative paths (not ./prefix)
- .please/docs/research/md/* — accessed via research/index.md
- apps/docs/content/* — Docus auto-discovers content, no explicit linking needed
- CHANGELOG.md files — standalone, not meant to be linked
