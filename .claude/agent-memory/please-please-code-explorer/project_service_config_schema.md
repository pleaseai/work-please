---
name: service-config-schema-and-builder
description: Full ServiceConfig type, all top-level sections, buildConfig() YAML parsing flow, and pattern for adding new config sections
type: project
---

## ServiceConfig type (packages/core/src/types.ts:206-260)

Top-level fields:

| Field | Type | Notes |
|---|---|---|
| `platforms` | `Record<string, PlatformConfig>` | Keyed map; union of GitHub/Slack/Asana |
| `projects` | `ProjectConfig[]` | Array with per-project status mappings |
| `channels` | `ChannelConfig[]` | Array with per-channel platform + associations |
| `polling` | `{ mode: PollingMode, interval_ms: number }` | `mode: 'poll' | 'webhook'` |
| `workspace` | `{ root: string, branch_prefix: string \| null }` | Path with `~` expansion |
| `hooks` | `{ after_create, before_run, after_run, before_remove: string \| null, timeout_ms: number }` | Shell hook scripts |
| `agent` | `{ max_concurrent_agents, max_turns, max_retry_backoff_ms, max_concurrent_agents_by_state }` | Concurrency/retry |
| `claude` | `{ model, effort, command, permission_mode, allowed_tools, setting_sources, turn_timeout_ms, read_timeout_ms, stall_timeout_ms, sandbox, system_prompt, settings }` | Full claude CLI config |
| `auth` | `AuthConfig` | `{ secret, github: { client_id, client_secret }, admin: { email, password }, base_url, trusted_origins }` |
| `commit_signing` | `CommitSigningConfig` | `{ mode: 'none'|'ssh'|'api', ssh_signing_key }` |
| `env` | `Record<string, string>` | Arbitrary env vars passed to agent; `${RUNTIME_VAR}` preserved |
| `db` | `DbConfig` | `{ path, turso_url, turso_auth_token }` |
| `state` | `StateConfig` | `{ adapter: 'memory'|'redis'|'ioredis'|'postgres', url, key_prefix, on_lock_conflict }` |
| `server` | `{ port: number \| null, webhook: { secret, events } }` | HTTP server + webhook config |

## buildConfig() YAML parsing flow (packages/core/src/config.ts:40-90)

Pattern: `sectionMap(raw, 'section_name')` extracts each top-level YAML key as a `Record<string, unknown>`. Then each field is coerced via typed helpers:

- `sectionMap(raw, key)` → returns `{}` if key is absent or not an object
- `stringValue(v)` → trims string, returns null if empty
- `intValue(v, fallback)` / `posIntValue(v, fallback)` → parses int
- `csvValue(v)` → accepts YAML array or comma-separated string
- `resolveEnvValue(val, envFallback)` → if val matches `$VAR`, reads from `process.env.VAR`; falls back to envFallback
- `resolvePathValue(val, fallback)` → same but also expands `~`

## Pattern for adding a new config section

1. Add the new interface to `packages/core/src/types.ts` and add the field to `ServiceConfig`.
2. In `buildConfig()` in `packages/core/src/config.ts`:
   - Add `const mySection = sectionMap(raw, 'my_section')` at the top (line ~42-51 range).
   - Add a `buildMyConfig(mySection)` call in the returned object literal.
3. Write `buildMyConfig(sec: Record<string, unknown>): MyConfig` using the same coercion helpers.
4. Export the type from `packages/core/src/index.ts`.

## $ENV_VAR resolution

Credential fields (api_key, private_key, app_id, etc.) support `$ENV_VAR` syntax: if the YAML value matches `/^\$([A-Z_]\w*)$/i`, the env var is read at startup. `${RUNTIME_VAR}` syntax is preserved as-is (for deferred resolution in `env:` section).

## Nitro plugin sequence (apps/agent-please/server/plugins/)

Plugins run in numeric prefix order:

| File | Responsibility |
|---|---|
| `01.orchestrator.ts` | Reads `WORKFLOW_PATH` from runtimeConfig, instantiates `Orchestrator`, calls `orchestrator.start()`, stores on `nitroApp.orchestrator`. Hooks `close` for `orchestrator.stop()`. |
| `02.chat-bot.ts` | Reads `nitroApp.orchestrator`, calls `orchestrator.getConfig()`, builds platform adapters (GitHub/Slack/Asana) from `config.channels` + `config.platforms`, wires `Chat` SDK bot, shares state adapter via `orchestrator.setDispatchLockAdapter()`. |
| `03.auth.ts` | Reads config from orchestrator, calls `initAuth(config.auth, db, baseURL)`, runs better-auth migrations, seeds admin user from `config.auth.admin`. |

Each plugin guards itself with `if (!orchestrator) return` before proceeding.

**Why:** -
**How to apply:** When adding a new Nitro plugin (e.g., `04.my-feature.ts`), read `nitroApp.orchestrator`, call `orchestrator.getConfig()` for settings, and register a `nitroApp.hooks.hook('close', ...)` cleanup handler.

## Monorepo structure

- Root `package.json` uses Bun workspaces: `["apps/*", "packages/*"]`
- `turbo.json` defines tasks: `build` (deps: `^build`, outputs: `dist/**`), `check` (deps: `^build`), `test` (deps: `build`)
- Only one package workspace currently: `packages/core` (name: `@pleaseai/agent-core`)
- `packages/core/package.json` exports: `"." → "./src/index.ts"` (source-first, no build needed for internal consumers)
- Build command: `bun build ./src/index.ts --outdir ./dist --target bun`

## Pattern for adding a new packages/* workspace

1. Create `packages/my-package/` with `package.json` (name `@pleaseai/my-package`, same structure as core).
2. Set `exports: { ".": "./src/index.ts" }` for source-first resolution.
3. Declare `scripts: { build, check, lint, test }` matching the core pattern.
4. Add as dependency in the consuming workspace (`apps/agent-please` or `packages/core`).
5. Turbo picks it up automatically via `packages/*` glob.
