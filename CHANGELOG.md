# Changelog

## 1.0.0 (2026-03-11)


### Features

* add rate limit tracking and conformance test coverage ([68f8dc0](https://github.com/chatbot-pf/work-please/commit/68f8dc07223bd35e4d6df25b9928b424f736bb77))
* **agent-runner:** add tool_call_failed event; tests for supported tool execution (Section 17.5) ([68c97fc](https://github.com/chatbot-pf/work-please/commit/68c97fc0f19458ff3419400214b237946ecdcae4))
* **agent-runner:** emit startup_failed event when turn/start fails ([dfa03af](https://github.com/chatbot-pf/work-please/commit/dfa03afd6bd209d2b19b734be57255ecd9d6c195))
* **agent-runner:** extend extractUsage to handle tokenUsage.total and prompt_tokens aliases ([58a59e7](https://github.com/chatbot-pf/work-please/commit/58a59e77b67832539e76fa2c1d9b07273dc876e2))
* **agent-runner:** migrate to Claude Agent SDK ([85c70f1](https://github.com/chatbot-pf/work-please/commit/85c70f1ab32696de5fa22ae86294145c56615547))
* **conductor:** implement conductor service per SPEC.md ([ff4a949](https://github.com/chatbot-pf/work-please/commit/ff4a949e450a8d0ef87b7ed3f3f627defa3cbaa9))
* **orchestrator:** re-check blockers during retry dispatch revalidation (Section 17.4) ([40af50d](https://github.com/chatbot-pf/work-please/commit/40af50d9d2cbb6e310adae83ee538900ee5fc6f9))
* **server:** add optional HTTP server extension (Section 13.7) ([100ffbd](https://github.com/chatbot-pf/work-please/commit/100ffbd9d491f51694e4dcedeedfd998ff4c0a32))
* **tools:** add asana_api and github_graphql client-side tool extensions (Section 18.2) ([d91a1df](https://github.com/chatbot-pf/work-please/commit/d91a1df09c6fddfd0c370a221582841abc481c40))
* **workspace:** inject issue context into hooks via WORK_* env vars ([#1](https://github.com/chatbot-pf/work-please/issues/1)) ([1834ec2](https://github.com/chatbot-pf/work-please/commit/1834ec210a1a17b2dc0a8f9b726c2baeff265880))


### Bug Fixes

* **agent-runner:** buffer turn/completed signal to prevent race condition ([eafff67](https://github.com/chatbot-pf/work-please/commit/eafff67ecacdecd3591cd47254c2a73a69102c39))
