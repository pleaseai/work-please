# Product Guide — Work Please

## Vision

Work Please turns issue tracker tasks into autonomous, isolated Claude Code agent sessions — enabling engineering teams to manage work at scale instead of supervising individual coding agents.

## Target Users

Engineering teams running autonomous coding agents at scale. Teams that need to dispatch multiple agent sessions against a backlog of issues, with production-grade reliability and minimal configuration overhead.

## Core Value Proposition

**Zero-config issue-to-agent mapping with WORKFLOW.md as single source of truth.** A single Markdown file in the target repository defines tracker connection, agent behavior, workspace hooks, and the prompt template. No external dashboards, databases, or config servers required.

## Key Capabilities

- **Poll-based orchestration** — Continuously polls issue trackers (GitHub Projects v2, Asana) and dispatches agent sessions for eligible issues.
- **WORKFLOW.md configuration** — Version agent prompt and runtime settings alongside your code. Live-reload on file changes.
- **Workspace isolation** — Each issue gets a dedicated directory with lifecycle hooks (after_create, before_run, after_run, before_remove).
- **Bounded concurrency** — Global and per-state concurrent agent limits prevent resource exhaustion.
- **Retry with backoff** — Exponential backoff on failures; short continuation retry on clean exits.
- **Multi-tracker support** — GitHub Projects v2 (PAT or GitHub App auth) and Asana (under development).
- **Minimal tracker writes** — The orchestrator applies only status labels. All state transitions, PR creation, and comments are performed by the agent itself.

## Near-Term Goals

- **Developer experience** — Easier setup, better documentation, improved `init` command, and streamlined onboarding.
- Continued improvement of observability (HTTP dashboard, structured logging).

## Non-Goals

- **Not a general-purpose AI agent framework** — Work Please is focused specifically on the issue tracker to agent workflow pipeline. It does not aim to be a generic agent orchestration platform.
- **Not a code review tool** — The agent performs implementation tasks. Review remains a human or separate-tool responsibility.
- **Not a CI/CD replacement** — Work Please complements existing CI/CD pipelines rather than replacing them.

## Architecture Summary

Work Please is a long-running TypeScript daemon (Bun + Turborepo monorepo) implementing the Symphony specification. It follows a scheduler/runner pattern: poll tracker → reconcile state → dispatch agents → retry on failure.
