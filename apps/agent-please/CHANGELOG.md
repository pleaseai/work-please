# Changelog

## [0.1.26](https://github.com/pleaseai/agent-please/compare/agent-v0.1.25...agent-v0.1.26) (2026-03-25)


### Bug Fixes

* **orpc:** change type-only import to value import in server plugin ([#214](https://github.com/pleaseai/agent-please/issues/214)) ([25cc2c5](https://github.com/pleaseai/agent-please/commit/25cc2c5895f1c15b43b936e65a669655a157187a))

## [0.1.25](https://github.com/pleaseai/agent-please/compare/agent-v0.1.24...agent-v0.1.25) (2026-03-25)


### Features

* **dashboard:** add tracker project board view ([#210](https://github.com/pleaseai/agent-please/issues/210)) ([e614643](https://github.com/pleaseai/agent-please/commit/e61464361ac0985cdc18e605876e358c58e52462))

## [0.1.24](https://github.com/pleaseai/agent-please/compare/agent-v0.1.23...agent-v0.1.24) (2026-03-25)


### Features

* **core:** replace @libsql/client with Kysely as unified DB layer ([#193](https://github.com/pleaseai/agent-please/issues/193)) ([4502d38](https://github.com/pleaseai/agent-please/commit/4502d38dcac79035788aeec2dda008d856726009))

## [0.1.23](https://github.com/pleaseai/agent-please/compare/agent-v0.1.22...agent-v0.1.23) (2026-03-24)


### Features

* **auth:** add base_url and trusted_origins config for reverse proxy support ([#190](https://github.com/pleaseai/agent-please/issues/190)) ([880e268](https://github.com/pleaseai/agent-please/commit/880e2689f93bab0012ccf1ddd1cea63d2e502533))

## [0.1.22](https://github.com/pleaseai/agent-please/compare/agent-v0.1.21...agent-v0.1.22) (2026-03-24)


### Bug Fixes

* **cli:** apply server.port from WORKFLOW.md to Nitro listen port ([#182](https://github.com/pleaseai/agent-please/issues/182)) ([af66b42](https://github.com/pleaseai/agent-please/commit/af66b42e3a2e327fb546e10c9bc1dad5cccf79dd))

## [0.1.21](https://github.com/pleaseai/agent-please/compare/agent-v0.1.20...agent-v0.1.21) (2026-03-23)


### Bug Fixes

* **chat:** eagerly connect state adapter before dispatch lock use ([#174](https://github.com/pleaseai/agent-please/issues/174)) ([04f4ff5](https://github.com/pleaseai/agent-please/commit/04f4ff521b6d1bede26bacf0b20aabe41fd7a8da))

## [0.1.20](https://github.com/pleaseai/agent-please/compare/agent-v0.1.19...agent-v0.1.20) (2026-03-23)


### Bug Fixes

* **auth:** add baseURL to betterAuth config and simplify admin seeding ([#171](https://github.com/pleaseai/agent-please/issues/171)) ([70ba6f2](https://github.com/pleaseai/agent-please/commit/70ba6f2f961e3fdb3de9ba1613efd3341f3932e7))

## [0.1.19](https://github.com/pleaseai/agent-please/compare/agent-v0.1.18...agent-v0.1.19) (2026-03-21)


### Features

* **core:** add full Asana support (webhooks, write, chat adapter) ([#160](https://github.com/pleaseai/agent-please/issues/160)) ([f17554a](https://github.com/pleaseai/agent-please/commit/f17554af2fd8f0bb2d55281f9af560e0a7d4b97f))

## [0.1.18](https://github.com/pleaseai/agent-please/compare/agent-v0.1.17...agent-v0.1.18) (2026-03-21)


### Bug Fixes

* **auth:** use getMigrations API for auth database migrations ([#165](https://github.com/pleaseai/agent-please/issues/165)) ([b1148ba](https://github.com/pleaseai/agent-please/commit/b1148ba7d7fefa8c8fd68d1117ba2be9242ab755))

## [0.1.17](https://github.com/pleaseai/agent-please/compare/agent-v0.1.16...agent-v0.1.17) (2026-03-21)


### Features

* **auth:** add dashboard authentication with Better Auth ([#158](https://github.com/pleaseai/agent-please/issues/158)) ([7ae47c4](https://github.com/pleaseai/agent-please/commit/7ae47c421bf13c3d1e3f063508691c2cb117bc21))
* **core:** add chat config and issue comment agent dispatch ([#148](https://github.com/pleaseai/agent-please/issues/148)) ([17e68bd](https://github.com/pleaseai/agent-please/commit/17e68bdeac7dd7e173505f229c75bfd1499e9a35))
* **core:** add configurable state adapter for Chat SDK ([#159](https://github.com/pleaseai/agent-please/issues/159)) ([2d1e95c](https://github.com/pleaseai/agent-please/commit/2d1e95cab82e5c5354c56f4508e3b48287a7efb3))
* **core:** deduplicate agent dispatch with Chat SDK state lock ([#156](https://github.com/pleaseai/agent-please/issues/156)) ([860c0e3](https://github.com/pleaseai/agent-please/commit/860c0e3b6d93521565710758c16892fe63e51e69))


### Bug Fixes

* **agent:** include .output directory in published package ([#162](https://github.com/pleaseai/agent-please/issues/162)) ([f167b60](https://github.com/pleaseai/agent-please/commit/f167b6004e06998e0c5b9c2f3c743e47d3c370c3))
* **deps:** add state adapter packages for redis, ioredis, and postgres ([#161](https://github.com/pleaseai/agent-please/issues/161)) ([8ae0f5b](https://github.com/pleaseai/agent-please/commit/8ae0f5b16d1e718826b612ec817ff78f9855e59e))

## [0.1.16](https://github.com/pleaseai/work-please/compare/work-v0.1.15...work-v0.1.16) (2026-03-19)


### Features

* **dashboard:** add configurable vite allowed hosts ([#140](https://github.com/pleaseai/work-please/issues/140)) ([ae24389](https://github.com/pleaseai/work-please/commit/ae24389f78159ad7098417d826da61e46c352c44))
* **db:** add libsql/Turso agent run history storage ([#116](https://github.com/pleaseai/work-please/issues/116)) ([6c99208](https://github.com/pleaseai/work-please/commit/6c992085a5c65e64f152b1e236daa96a112c430c))


### Bug Fixes

* **dashboard:** add missing session messages API route ([#145](https://github.com/pleaseai/work-please/issues/145)) ([55386db](https://github.com/pleaseai/work-please/commit/55386dbf6e8cad07376190df757071752eb13a1d))
* **dashboard:** prevent flicker on polling refresh ([#146](https://github.com/pleaseai/work-please/issues/146)) ([628da6b](https://github.com/pleaseai/work-please/commit/628da6b89de616ce995fe8c3fadf62f63cbac1fe))

## [0.1.15](https://github.com/pleaseai/work-please/compare/work-v0.1.14...work-v0.1.15) (2026-03-19)


### Features

* **chat:** add Slack webhook adapter and documentation ([#139](https://github.com/pleaseai/work-please/issues/139)) ([c842e44](https://github.com/pleaseai/work-please/commit/c842e447a18a4a5179677bd779a69dfd86b7f8e8))

## [0.1.14](https://github.com/pleaseai/work-please/compare/work-v0.1.13...work-v0.1.14) (2026-03-19)


### Features

* **dashboard:** add session conversation view with Nuxt migration ([#117](https://github.com/pleaseai/work-please/issues/117)) ([e5d12ed](https://github.com/pleaseai/work-please/commit/e5d12ed7b88fc9a456a2eb32897c2c7d18343347))

## [0.1.13](https://github.com/pleaseai/work-please/compare/work-v0.1.12...work-v0.1.13) (2026-03-19)


### Features

* **agent-runner:** add sandbox config support for Claude execution ([#114](https://github.com/pleaseai/work-please/issues/114)) ([29888c4](https://github.com/pleaseai/work-please/commit/29888c434f5d32832a47150cef9bab61e76d4e31))

## [0.1.12](https://github.com/pleaseai/work-please/compare/work-v0.1.11...work-v0.1.12) (2026-03-18)


### Features

* **dashboard:** add Vue.js SPA with shadcn-vue ([#113](https://github.com/pleaseai/work-please/issues/113)) ([6a55106](https://github.com/pleaseai/work-please/commit/6a55106a1a58495f468af76e7f063cdf118440ca))


### Bug Fixes

* **tracker:** promote linked PR review_decision for Issue-type items ([#126](https://github.com/pleaseai/work-please/issues/126)) ([667300c](https://github.com/pleaseai/work-please/commit/667300ca51d9c44161146bfaa9493b1cbbb30e9c))

## [0.1.11](https://github.com/pleaseai/work-please/compare/work-v0.1.10...work-v0.1.11) (2026-03-17)


### Features

* **webhook:** add webhook mode with @octokit/webhooks ([#101](https://github.com/pleaseai/work-please/issues/101)) ([ea891fc](https://github.com/pleaseai/work-please/commit/ea891fcf6b68f86be46853f9857d5399a12cd9b4))


### Bug Fixes

* **cli:** prevent --help from starting the server ([#111](https://github.com/pleaseai/work-please/issues/111)) ([73ac406](https://github.com/pleaseai/work-please/commit/73ac4065e1cf1c087110ecfbd8d138c6f673a23f))

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
