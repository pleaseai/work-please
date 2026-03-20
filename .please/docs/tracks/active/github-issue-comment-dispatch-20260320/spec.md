# GitHub Issue Comment Agent Dispatch

> Track: github-issue-comment-dispatch-20260320

## Overview

Add a `chat` config section to WORKFLOW.md and handle plain issue comments (not PR) as agent dispatch triggers. When someone @mentions the bot in an issue comment, the bot acknowledges with an emoji, runs Claude Code with the comment as a prompt, posts the response, and marks completion.

## Requirements

### Functional Requirements

- [x] FR-1: New `chat` section in WORKFLOW.md with `bot_username` at the top level (shared across adapters)
- [x] FR-2: Per-adapter sub-sections (`chat.github`, `chat.slack`) for adapter-specific config
- [x] FR-3: `chat.bot_username` supports `$ENV_VAR` syntax for env var indirection
- [ ] FR-4: Plain issue comments (not PR) with @mention of bot trigger agent dispatch
- [ ] FR-5: On @mention detection, bot adds eyes reaction to the original comment (acknowledge)
- [ ] FR-6: Comment text (minus @mention) is passed as prompt to Claude Code agent
- [ ] FR-7: Agent response is posted as a new reply comment on the issue
- [ ] FR-8: After reply, bot adds check_mark reaction to original comment and removes eyes
- [x] FR-9: Existing PR comment handling (status response via Chat SDK) continues working unchanged

### Non-functional Requirements

- [ ] NFR-1: Webhook response returns 202 immediately — agent dispatch runs asynchronously
- [ ] NFR-2: All existing tests continue to pass
- [x] NFR-3: Config fallback chain: `config.chat.bot_username` -> `GITHUB_BOT_USERNAME` env -> `'work-please'`

## WORKFLOW.md Config Shape

```yaml
chat:
  bot_username: my-bot-name       # shared across all adapters
  github:
    # auth inherited from tracker section by default
    # webhook_secret inherited from server.webhook.secret
  slack:
    bot_token: $SLACK_BOT_TOKEN
    signing_secret: $SLACK_SIGNING_SECRET
```

## Issue Comment Flow

```
GitHub issue_comment webhook (action: created, no pull_request)
  -> signature verified (existing)
  -> Chat SDK skips (no pull_request) -> falls through
  -> detect @mention of bot_username in comment body
  -> return 202 Accepted immediately
  -> async:
    1. Add eyes reaction to original comment
    2. Extract prompt (comment body minus @mention)
    3. Build agent context (issue title, body, labels, repo)
    4. Create/reuse workspace for the issue
    5. Run Claude Code agent with prompt + context
    6. Post agent response as new issue comment
    7. Replace eyes with white_check_mark on original comment
```

## Acceptance Criteria

- [ ] AC-1: `chat.bot_username` in WORKFLOW.md is used as the bot identity
- [ ] AC-2: @mention in a plain issue comment triggers agent dispatch
- [ ] AC-3: Eyes emoji appears on the comment within seconds
- [ ] AC-4: Agent response is posted as a reply comment
- [ ] AC-5: Check mark emoji replaces eyes on completion
- [ ] AC-6: PR comment handling (existing) is unaffected
- [ ] AC-7: Missing `chat` section falls back to env vars (backward compatible)

## Out of Scope

- Streaming responses (GitHub adapter doesn't support streaming)
- Slack adapter implementation (config structure only)
- Production state adapters for Chat SDK
- Rate limiting or queue management for concurrent comment-triggered agents
- Error retry for failed agent runs triggered by comments

## Assumptions

- Existing `WorkspaceManager` and `AgentRunner` can be reused for comment-triggered agent runs
- Octokit instance from tracker adapter can be shared for reaction/comment API calls
- The orchestrator is running and has a valid config when webhooks arrive
