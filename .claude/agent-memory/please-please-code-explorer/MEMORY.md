# Memory Index

## Project
- [service-config-schema-and-builder](project_service_config_schema.md) — Full ServiceConfig type, all sections, buildConfig() YAML parsing pattern, monorepo structure, Nitro plugin sequence
- [agent-env-workspace-architecture](project_agent_env_workspace_arch.md) — Key architecture facts: orchestrator → resolveAgentEnv → agent-runner flow, workspace lifecycle, SSH/signing integration points
- [nitro-server-architecture](project_nitro_server_architecture.md) — Nitro plugins (01/02/03), middleware auth guard, server utils, API routes, better-auth integration pattern; includes orchestrator public API and API route pattern
- [db-layer-integration](project_db_layer_integration.md) — DB layer: DbConfig, createDbClient, insertRun, queryRuns — config → orchestrator → HTTP API integration map
- [tracker-config-patterns](project_tracker_config_patterns.md) — TrackerAdapter interface, fetchIssuesByStates return type, WORKFLOW.md → ServiceConfig parsing flow, adapter factory pattern
