# Changelog

## [0.1.6](https://github.com/pleaseai/agent-please/compare/agent-core-v0.1.5...agent-core-v0.1.6) (2026-03-24)


### Features

* **agent-env:** add default GH_TOKEN, GITHUB_TOKEN, and git identity overrides ([#179](https://github.com/pleaseai/agent-please/issues/179)) ([5b20556](https://github.com/pleaseai/agent-please/commit/5b20556908118a40f818b527c92cc95c9c9ffd90))
* **tracker:** include repository name in GitHub issue identifier ([#181](https://github.com/pleaseai/agent-please/issues/181)) ([765be7b](https://github.com/pleaseai/agent-please/commit/765be7bb1efadedde8443dffdd50db8e73f562f9))


### Bug Fixes

* **workspace:** move worktree path outside repo dir and add branch prefix option ([#178](https://github.com/pleaseai/agent-please/issues/178)) ([9620eca](https://github.com/pleaseai/agent-please/commit/9620eca7722f5f14c58902b87328aec79605c6e5))

## [0.1.5](https://github.com/pleaseai/agent-please/compare/agent-core-v0.1.4...agent-core-v0.1.5) (2026-03-23)


### Bug Fixes

* **chat:** eagerly connect state adapter before dispatch lock use ([#174](https://github.com/pleaseai/agent-please/issues/174)) ([04f4ff5](https://github.com/pleaseai/agent-please/commit/04f4ff521b6d1bede26bacf0b20aabe41fd7a8da))

## [0.1.4](https://github.com/pleaseai/agent-please/compare/agent-core-v0.1.3...agent-core-v0.1.4) (2026-03-21)


### Features

* **core:** add full Asana support (webhooks, write, chat adapter) ([#160](https://github.com/pleaseai/agent-please/issues/160)) ([f17554a](https://github.com/pleaseai/agent-please/commit/f17554af2fd8f0bb2d55281f9af560e0a7d4b97f))

## [0.1.3](https://github.com/pleaseai/agent-please/compare/agent-core-v0.1.2...agent-core-v0.1.3) (2026-03-21)


### Features

* **auth:** add dashboard authentication with Better Auth ([#158](https://github.com/pleaseai/agent-please/issues/158)) ([7ae47c4](https://github.com/pleaseai/agent-please/commit/7ae47c421bf13c3d1e3f063508691c2cb117bc21))
* **core:** add chat config and issue comment agent dispatch ([#148](https://github.com/pleaseai/agent-please/issues/148)) ([17e68bd](https://github.com/pleaseai/agent-please/commit/17e68bdeac7dd7e173505f229c75bfd1499e9a35))
* **core:** add configurable state adapter for Chat SDK ([#159](https://github.com/pleaseai/agent-please/issues/159)) ([2d1e95c](https://github.com/pleaseai/agent-please/commit/2d1e95cab82e5c5354c56f4508e3b48287a7efb3))
* **core:** deduplicate agent dispatch with Chat SDK state lock ([#156](https://github.com/pleaseai/agent-please/issues/156)) ([860c0e3](https://github.com/pleaseai/agent-please/commit/860c0e3b6d93521565710758c16892fe63e51e69))
* **dashboard:** add session conversation view with Nuxt migration ([#117](https://github.com/pleaseai/agent-please/issues/117)) ([e5d12ed](https://github.com/pleaseai/agent-please/commit/e5d12ed7b88fc9a456a2eb32897c2c7d18343347))
* **db:** add libsql/Turso agent run history storage ([#116](https://github.com/pleaseai/agent-please/issues/116)) ([6c99208](https://github.com/pleaseai/agent-please/commit/6c992085a5c65e64f152b1e236daa96a112c430c))


### Bug Fixes

* **core:** replace Bun globals with Node.js compatible APIs ([#144](https://github.com/pleaseai/agent-please/issues/144)) ([e8d23c6](https://github.com/pleaseai/agent-please/commit/e8d23c6ff487e3448d343f308c65be3ac25221a2))
* **dashboard:** add missing session messages API route ([#145](https://github.com/pleaseai/agent-please/issues/145)) ([55386db](https://github.com/pleaseai/agent-please/commit/55386dbf6e8cad07376190df757071752eb13a1d))

## [0.1.2](https://github.com/pleaseai/work-please/compare/work-core-v0.1.1...work-core-v0.1.2) (2026-03-19)


### Features

* **db:** add libsql/Turso agent run history storage ([#116](https://github.com/pleaseai/work-please/issues/116)) ([6c99208](https://github.com/pleaseai/work-please/commit/6c992085a5c65e64f152b1e236daa96a112c430c))


### Bug Fixes

* **core:** replace Bun globals with Node.js compatible APIs ([#144](https://github.com/pleaseai/work-please/issues/144)) ([e8d23c6](https://github.com/pleaseai/work-please/commit/e8d23c6ff487e3448d343f308c65be3ac25221a2))
* **dashboard:** add missing session messages API route ([#145](https://github.com/pleaseai/work-please/issues/145)) ([55386db](https://github.com/pleaseai/work-please/commit/55386dbf6e8cad07376190df757071752eb13a1d))

## [0.1.1](https://github.com/pleaseai/work-please/compare/work-core-v0.1.0...work-core-v0.1.1) (2026-03-19)


### Features

* **dashboard:** add session conversation view with Nuxt migration ([#117](https://github.com/pleaseai/work-please/issues/117)) ([e5d12ed](https://github.com/pleaseai/work-please/commit/e5d12ed7b88fc9a456a2eb32897c2c7d18343347))
