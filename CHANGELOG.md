# Changelog

## 1.0.0 (2026-03-13)


### Features

* add rate limit tracking and conformance test coverage ([68f8dc0](https://github.com/chatbot-pf/work-please/commit/68f8dc07223bd35e4d6df25b9928b424f736bb77))
* **agent-runner:** add tool_call_failed event; tests for supported tool execution (Section 17.5) ([68c97fc](https://github.com/chatbot-pf/work-please/commit/68c97fc0f19458ff3419400214b237946ecdcae4))
* **agent-runner:** emit startup_failed event when turn/start fails ([dfa03af](https://github.com/chatbot-pf/work-please/commit/dfa03afd6bd209d2b19b734be57255ecd9d6c195))
* **agent-runner:** extend extractUsage to handle tokenUsage.total and prompt_tokens aliases ([58a59e7](https://github.com/chatbot-pf/work-please/commit/58a59e77b67832539e76fa2c1d9b07273dc876e2))
* **agent-runner:** migrate to Claude Agent SDK ([85c70f1](https://github.com/chatbot-pf/work-please/commit/85c70f1ab32696de5fa22ae86294145c56615547))
* **cli:** replace manual arg parsing with commander.js ([#28](https://github.com/chatbot-pf/work-please/issues/28)) ([7f0d66b](https://github.com/chatbot-pf/work-please/commit/7f0d66b6a2082a8474f865d84b8ebdb103a2a091))
* **conductor:** implement conductor service per SPEC.md ([ff4a949](https://github.com/chatbot-pf/work-please/commit/ff4a949e450a8d0ef87b7ed3f3f627defa3cbaa9))
* **init:** add work-please init subcommand for GitHub Projects v2 creation ([#17](https://github.com/chatbot-pf/work-please/issues/17)) ([d6ac966](https://github.com/chatbot-pf/work-please/commit/d6ac966372273bf19fa1e576cf4249aabe0684e3))
* **init:** configure Status field with In Review and Cancelled options ([#26](https://github.com/chatbot-pf/work-please/issues/26)) ([7a528eb](https://github.com/chatbot-pf/work-please/commit/7a528ebcd7e87abacb7ef12ff2f7996514a1445a))
* **label:** add state-aware labels to worked issues ([#30](https://github.com/chatbot-pf/work-please/issues/30)) ([2934027](https://github.com/chatbot-pf/work-please/commit/2934027e5efd2235d246983d2647f8ec5a6b5a20))
* **orchestrator:** re-check blockers during retry dispatch revalidation (Section 17.4) ([40af50d](https://github.com/chatbot-pf/work-please/commit/40af50d9d2cbb6e310adae83ee538900ee5fc6f9))
* **server:** add optional HTTP server extension (Section 13.7) ([100ffbd](https://github.com/chatbot-pf/work-please/commit/100ffbd9d491f51694e4dcedeedfd998ff4c0a32))
* **tools:** add asana_api and github_graphql client-side tool extensions (Section 18.2) ([d91a1df](https://github.com/chatbot-pf/work-please/commit/d91a1df09c6fddfd0c370a221582841abc481c40))
* **tracker/github:** add GitHub App installation token support ([#31](https://github.com/chatbot-pf/work-please/issues/31)) ([19d7941](https://github.com/chatbot-pf/work-please/commit/19d79413e686089a0d41a36271392c8d9f7e362b))
* **tracker:** add assignee and label filters to candidate issues ([#34](https://github.com/chatbot-pf/work-please/issues/34)) ([ee67bc8](https://github.com/chatbot-pf/work-please/commit/ee67bc87ed1fdab4727d79e2f09fa6127ce9608e))
* **workspace:** add built-in git worktree support via repository_root ([#29](https://github.com/chatbot-pf/work-please/issues/29)) ([d9cf98e](https://github.com/chatbot-pf/work-please/commit/d9cf98eaadf632b2af707bc1ce44c824c7391ccb))
* **workspace:** inject issue context into hooks via WORK_* env vars ([#1](https://github.com/chatbot-pf/work-please/issues/1)) ([1834ec2](https://github.com/chatbot-pf/work-please/commit/1834ec210a1a17b2dc0a8f9b726c2baeff265880))


### Bug Fixes

* **agent-runner:** buffer turn/completed signal to prevent race condition ([eafff67](https://github.com/chatbot-pf/work-please/commit/eafff67ecacdecd3591cd47254c2a73a69102c39))
* **init:** use repositoryOwner to resolve both org and user logins ([#25](https://github.com/chatbot-pf/work-please/issues/25)) ([2d723ba](https://github.com/chatbot-pf/work-please/commit/2d723ba6de7d895ba956652d026b7d6901e147f5))
* **release:** move initial-version to root config for all packages ([#42](https://github.com/chatbot-pf/work-please/issues/42)) ([8092154](https://github.com/chatbot-pf/work-please/commit/809215491db654456dda8ff96dc7a123c22707f9))
* **release:** remove root package from release-please to prevent 1.0.0 bump ([#40](https://github.com/chatbot-pf/work-please/issues/40)) ([48594b3](https://github.com/chatbot-pf/work-please/commit/48594b3c1b4a7d97ab54ccd90d34811a709791c6))
* **tracker/github:** use repositoryOwner + project_id to fix org GraphQL errors ([#27](https://github.com/chatbot-pf/work-please/issues/27)) ([7dab212](https://github.com/chatbot-pf/work-please/commit/7dab2126c7127d1f64d5a258b52ce805dd495827))
