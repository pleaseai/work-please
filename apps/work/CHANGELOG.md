# Changelog

## [0.1.10](https://github.com/pleaseai/work-please/compare/work-v0.1.9...work-v0.1.10) (2026-03-16)


### Features

* **cli:** add --verbose flag for debug logging ([#108](https://github.com/pleaseai/work-please/issues/108)) ([3fda421](https://github.com/pleaseai/work-please/commit/3fda4219f450b10206955ef797a2845fa785af3f))

## [0.1.9](https://github.com/pleaseai/work-please/compare/work-v0.1.8...work-v0.1.9) (2026-03-15)


### Bug Fixes

* **orchestrator:** prevent duplicate dispatch for watched issues ([#102](https://github.com/pleaseai/work-please/issues/102)) ([804936c](https://github.com/pleaseai/work-please/commit/804936ccab98dd267dfa72d2abfe57e8269524ea))

## [0.1.8](https://github.com/pleaseai/work-please/compare/work-v0.1.7...work-v0.1.8) (2026-03-14)


### Features

* **agent:** add env injection via WORKFLOW.md and SDK options.env ([#94](https://github.com/pleaseai/work-please/issues/94)) ([5336a8c](https://github.com/pleaseai/work-please/commit/5336a8c59a0b1f8266847c90dc489481c8fe497c))
* **tracker:** add PR review lifecycle with Symphony-aligned status map ([#80](https://github.com/pleaseai/work-please/issues/80)) ([b8ab6b6](https://github.com/pleaseai/work-please/commit/b8ab6b63312396fd7baaf033f09afaff3ce5e93e))

## [0.1.7](https://github.com/pleaseai/work-please/compare/work-v0.1.6...work-v0.1.7) (2026-03-13)


### Features

* **config:** add effort field to claude configuration ([#73](https://github.com/pleaseai/work-please/issues/73)) ([05e4230](https://github.com/pleaseai/work-please/commit/05e4230504de13da4b6e76e0119ea847ab4794f3))

## [0.1.6](https://github.com/pleaseai/work-please/compare/work-v0.1.5...work-v0.1.6) (2026-03-13)


### Features

* **agent:** add setting_sources config for Claude SDK filesystem settings ([#68](https://github.com/pleaseai/work-please/issues/68)) ([3369b01](https://github.com/pleaseai/work-please/commit/3369b01c29e949511b0fc514e3b46e3e4e80b2ef))
* **config:** add system_prompt to claude configuration ([#70](https://github.com/pleaseai/work-please/issues/70)) ([8aea43c](https://github.com/pleaseai/work-please/commit/8aea43c2b0f31491e75b669e2c7f908e0ca23a81))
* **workspace:** create .claude/settings.local.json with attribution after workspace setup ([#72](https://github.com/pleaseai/work-please/issues/72)) ([a952ee0](https://github.com/pleaseai/work-please/commit/a952ee03a23f1a0aa36c9f1195f12aec9ddcd57a))

## [0.1.5](https://github.com/pleaseai/work-please/compare/work-v0.1.4...work-v0.1.5) (2026-03-13)


### Features

* **config:** add model field to claude configuration ([#65](https://github.com/pleaseai/work-please/issues/65)) ([3855f0d](https://github.com/pleaseai/work-please/commit/3855f0dba8dbd5ff9736831009b7309d8217e8c0))
* **tracker:** add linked PR data to issue model ([#66](https://github.com/pleaseai/work-please/issues/66)) ([ae74998](https://github.com/pleaseai/work-please/commit/ae74998b7ce2e1d70f7da2dd369fdb6136de38e4))

## [0.1.4](https://github.com/pleaseai/work-please/compare/work-v0.1.3...work-v0.1.4) (2026-03-13)


### Features

* **cli:** add --version / -V flag ([#63](https://github.com/pleaseai/work-please/issues/63)) ([7fc26c6](https://github.com/pleaseai/work-please/commit/7fc26c623195f6988d561b52955030388b3017dc))

## [0.1.3](https://github.com/pleaseai/work-please/compare/work-v0.1.2...work-v0.1.3) (2026-03-13)


### Features

* **tracker:** add formatTrackerError with full error details ([#61](https://github.com/pleaseai/work-please/issues/61)) ([52dd0f7](https://github.com/pleaseai/work-please/commit/52dd0f72d19ebc51eb3da6724387e3feffdb9289))

## [0.1.2](https://github.com/pleaseai/work-please/compare/work-v0.1.1...work-v0.1.2) (2026-03-13)


### Bug Fixes

* **build:** prepend shebang to dist/index.js for global install ([#58](https://github.com/pleaseai/work-please/issues/58)) ([39c260c](https://github.com/pleaseai/work-please/commit/39c260c70b839c32db8a3532cb3295ca7d7720a3))

## [0.1.1](https://github.com/chatbot-pf/work-please/compare/work-v0.1.0...work-v0.1.1) (2026-03-13)


### Features

* **agent-runner:** migrate to Claude Agent SDK ([85c70f1](https://github.com/chatbot-pf/work-please/commit/85c70f1ab32696de5fa22ae86294145c56615547))
* **cli:** replace manual arg parsing with commander.js ([#28](https://github.com/chatbot-pf/work-please/issues/28)) ([7f0d66b](https://github.com/chatbot-pf/work-please/commit/7f0d66b6a2082a8474f865d84b8ebdb103a2a091))
* **init:** add work-please init subcommand for GitHub Projects v2 creation ([#17](https://github.com/chatbot-pf/work-please/issues/17)) ([d6ac966](https://github.com/chatbot-pf/work-please/commit/d6ac966372273bf19fa1e576cf4249aabe0684e3))
* **init:** configure Status field with In Review and Cancelled options ([#26](https://github.com/chatbot-pf/work-please/issues/26)) ([7a528eb](https://github.com/chatbot-pf/work-please/commit/7a528ebcd7e87abacb7ef12ff2f7996514a1445a))
* **label:** add state-aware labels to worked issues ([#30](https://github.com/chatbot-pf/work-please/issues/30)) ([2934027](https://github.com/chatbot-pf/work-please/commit/2934027e5efd2235d246983d2647f8ec5a6b5a20))
* **tracker/github:** add GitHub App installation token support ([#31](https://github.com/chatbot-pf/work-please/issues/31)) ([19d7941](https://github.com/chatbot-pf/work-please/commit/19d79413e686089a0d41a36271392c8d9f7e362b))
* **tracker:** add assignee and label filters to candidate issues ([#34](https://github.com/chatbot-pf/work-please/issues/34)) ([ee67bc8](https://github.com/chatbot-pf/work-please/commit/ee67bc87ed1fdab4727d79e2f09fa6127ce9608e))
* **workspace:** add built-in git worktree support via repository_root ([#29](https://github.com/chatbot-pf/work-please/issues/29)) ([d9cf98e](https://github.com/chatbot-pf/work-please/commit/d9cf98eaadf632b2af707bc1ce44c824c7391ccb))
* **workspace:** inject issue context into hooks via WORK_* env vars ([#1](https://github.com/chatbot-pf/work-please/issues/1)) ([1834ec2](https://github.com/chatbot-pf/work-please/commit/1834ec210a1a17b2dc0a8f9b726c2baeff265880))


### Bug Fixes

* **init:** use repositoryOwner to resolve both org and user logins ([#25](https://github.com/chatbot-pf/work-please/issues/25)) ([2d723ba](https://github.com/chatbot-pf/work-please/commit/2d723ba6de7d895ba956652d026b7d6901e147f5))
* **tracker/github:** use repositoryOwner + project_id to fix org GraphQL errors ([#27](https://github.com/chatbot-pf/work-please/issues/27)) ([7dab212](https://github.com/chatbot-pf/work-please/commit/7dab2126c7127d1f64d5a258b52ce805dd495827))
