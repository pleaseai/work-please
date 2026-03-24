---
name: WORKFLOW.md config schema (actual)
description: The real WORKFLOW.md YAML structure uses platforms/projects/channels, not tracker:. Docs site uses the old tracker: schema.
type: project
---

The docs site (apps/docs) was written against an older config schema using `tracker:` as a top-level key.

The actual config parser (`packages/core/src/config.ts`) reads:
- `platforms:` — named platform configs (github, asana, slack)
- `projects:` — array of project configs referencing a platform by name
- `channels:` — array of chat channel configs referencing a platform by name

**Why:** The schema was refactored to support multi-platform/multi-project, but docs were not updated.

**How to apply:** All WORKFLOW.md examples in docs need to use the new schema. Flag any doc showing `tracker:` as incorrect.
