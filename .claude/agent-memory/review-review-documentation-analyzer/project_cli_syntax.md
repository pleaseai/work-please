---
name: CLI syntax — no 'run' subcommand
description: The CLI has no 'run' subcommand. workflowPath is a positional argument on the root command.
type: project
---

The docs say `agent-please run` but the actual CLI (`apps/agent-please/src/cli.ts`) registers:
- A root command with `[workflowPath]` as an optional positional argument
- An `init` subcommand

There is no `run` subcommand. Correct invocation: `agent-please [workflowPath] [--port <number>] [--verbose]`

**Why:** Docs were written with a `run` subcommand in mind but it was never implemented.

**How to apply:** Flag all docs showing `agent-please run` as incorrect.
