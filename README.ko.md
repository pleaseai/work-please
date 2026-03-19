# Work Please

[English](README.md) | 한국어 | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=bugs)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please)
[![codecov](https://codecov.io/gh/pleaseai/work-please/graph/badge.svg?token=do858Z1lsI)](https://codecov.io/gh/pleaseai/work-please)

Work Please는 이슈 트래커의 작업을 격리된 자율 구현 실행으로 전환합니다 — 코딩 에이전트를 감독하는 대신 작업을 관리합니다.

> **경고**: Work Please는 신뢰할 수 있는 환경에서 사용하기 위한 엔지니어링 프리뷰입니다.

## 목차

- [개요](#개요)
- [Symphony와의 주요 차이점](#symphony와의-주요-차이점)
- [기능](#기능)
- [아키텍처](#아키텍처)
- [빠른 시작](#빠른-시작)
  - [사전 요구사항](#사전-요구사항)
  - [설치](#설치)
  - [설정](#설정)
  - [실행](#실행)
- [WORKFLOW.md 설정](#workflowmd-설정)
  - [전체 Front Matter 스키마](#전체-front-matter-스키마)
  - [템플릿 변수](#템플릿-변수)
- [CLI 사용법](#cli-사용법)
- [GitHub App 인증](#github-app-인증)
  - [GitHub App 자격 증명 설정](#github-app-자격-증명-설정)
  - [검증](#검증)
- [Slack 알림](#slack-알림)
  - [Slack 앱 설정](#slack-앱-설정)
- [신뢰 및 안전](#신뢰-및-안전)
  - [권한 모드](#권한-모드)
  - [워크스페이스 격리](#워크스페이스-격리)
  - [권장사항](#권장사항)
- [라이선스](#라이선스)

## 개요

Work Please는 다음을 수행하는 장기 실행 TypeScript 서비스입니다:

1. 이슈 트래커(GitHub Projects v2 또는 Asana)에서 설정된 활성 상태의 작업을 폴링합니다.
2. 적격한 각 이슈에 대해 격리된 워크스페이스 디렉토리를 생성합니다.
3. 해당 워크스페이스에서 렌더링된 프롬프트와 함께 Claude Code 에이전트 세션을 실행합니다.
4. 세션을 모니터링하고, 재시도를 처리하며, 각 폴링 주기마다 이슈 상태를 조정합니다.

[Symphony 명세](vendor/symphony/SPEC.md)의 TypeScript 구현체로,
GitHub Projects v2 / Asana 및 Claude Code에 맞게 적용되었습니다 (Linear와 Codex 대신).

전체 기술 세부사항은 [SPEC.md](SPEC.md)를 참조하세요.

## Symphony와의 주요 차이점

| | Symphony (레퍼런스) | Work Please |
|---|---|---|
| 이슈 트래커 | Linear | GitHub Projects v2 & Asana (개발 중) |
| 코딩 에이전트 | Codex (app-server 모드) | Claude Code CLI |
| 언어 | Elixir/OTP | TypeScript + Bun |
| 트래커 인증 | `LINEAR_API_KEY` | `GITHUB_TOKEN`, GitHub App 자격 증명, 또는 `ASANA_ACCESS_TOKEN` |
| 프로젝트 설정 | `project_slug` | `owner` + `project_number` (GitHub Projects v2) 또는 `project_gid` (Asana) |
| 이슈 상태 | Linear 워크플로우 상태 | GitHub Projects v2 Status 필드 / Asana 섹션 |
| 에이전트 프로토콜 | JSON-RPC over stdio | `@anthropic-ai/claude-agent-sdk` |
| 권한 모델 | Codex 승인/샌드박스 정책 | Claude Code `--permission-mode` |

## 기능

- **멀티 트래커 지원** — GitHub Projects v2 항목 또는 Asana 작업(개발 중)에서 고정 주기로 작업을 디스패치합니다.
- **GitHub App 인증** — PAT 대신 GitHub App 설치 토큰(`app_id` + `private_key` + `installation_id`)으로
  GitHub 트래커를 인증하여, 세밀한 권한과 높은 API 속도 제한을 활용합니다.
- **담당자 & 라벨 필터** — 담당자 및/또는 라벨로 적격한 이슈를 필터링합니다. 각 필터 내 여러 값은
  OR 로직을 사용하고, 담당자와 라벨 필터가 모두 지정되면 AND로 결합됩니다. 디스패치 시에만
  적용되며 이미 실행 중인 이슈에는 영향을 주지 않습니다. `WORKFLOW.md`에서 트래커별로 설정합니다.
- **격리된 워크스페이스** — 각 이슈별 전용 디렉토리를 사용하며, 워크스페이스는 실행 간 유지됩니다.
- **`WORKFLOW.md` 설정** — 에이전트 프롬프트와 런타임 설정을 코드와 함께 버전 관리합니다.
- **제한된 동시 실행** — 전역 및 상태별 동시 에이전트 제한을 지원합니다.
- **백오프 재시도** — 실패 시 지수 백오프를 적용하고, 정상 종료 시 짧은 연속 재시도를 수행합니다.
- **동적 설정 리로드** — `WORKFLOW.md`를 편집하면 서비스 재시작 없이 변경사항이 적용됩니다.
- **워크스페이스 훅** — `after_create`, `before_run`, `after_run`, `before_remove` 라이프사이클
  이벤트에서 셸 스크립트를 실행합니다.
- **구조화된 로깅** — 안정적인 `key=value` 형식의 운영자 가시 로그를 제공합니다.
- **Slack 알림** — Slack에서 봇을 @멘션하여 오케스트레이터 상태를 확인할 수 있습니다.
  [Chat SDK](https://chat-sdk.dev/) Slack 어댑터를 사용합니다.
- **선택적 HTTP 대시보드** — `--port`로 활성화하여 런타임 상태와 JSON API를 확인할 수 있습니다.

## 아키텍처

```
WORKFLOW.md
    |
    v
Config Layer ──> Orchestrator ──> Workspace Manager ──> Agent Runner (Claude Code)
                     |                                         |
                     v                                         v
           Issue Tracker Client                       Isolated workspace/
          (GitHub GraphQL API or                      per-issue directory
          Asana REST API,
          polling + reconciliation)
                     |
                     v
               Status Surface (선택적 HTTP 대시보드 / 구조화된 로그)
```

컴포넌트:

- **Workflow Loader** — `WORKFLOW.md` YAML front matter와 프롬프트 템플릿 본문을 파싱합니다.
- **Config Layer** — 환경 변수 간접 참조와 기본값을 가진 타입 안전 getter를 제공합니다.
- **Issue Tracker Client** — 후보 이슈를 가져오고, 실행 중인 이슈 상태를 조정합니다. GitHub
  Projects v2 (GraphQL API)와 Asana (REST API) 어댑터를 지원합니다.
- **Orchestrator** — 인메모리 상태를 소유하고, 폴링/디스패치/재시도 루프를 구동합니다.
- **Workspace Manager** — 이슈별 워크스페이스를 생성, 재사용, 정리하고 훅을 실행합니다.
- **Agent Runner** — Claude Code를 실행하고, 이벤트를 Orchestrator로 스트리밍합니다.
- **Status Surface** — 운영자 가시성을 위한 선택적 터미널 뷰와 HTTP API를 제공합니다.

전체 명세는 [SPEC.md](SPEC.md)를 참조하세요.

## 빠른 시작

### 사전 요구사항

- **Bun** (설치: [bun.sh](https://bun.sh))
- **Claude Code CLI** ([공식 설치 가이드](https://docs.anthropic.com/en/docs/claude-code) 참조)
- **GitHub 토큰** (`GITHUB_TOKEN`) — 대상 프로젝트에 접근 가능해야 함, **또는** **GitHub App 자격 증명**
  (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`) — [GitHub App 인증](#github-app-인증) 참조,
  **또는** **Asana 액세스 토큰** (`ASANA_ACCESS_TOKEN`) (개발 중)

### 설치

```bash
git clone https://github.com/pleaseai/work-please.git
cd work-please
bun install
bun run build
```

### 설정

대상 저장소에 `WORKFLOW.md`를 생성합니다. 아래에 두 가지 예시가 있습니다.
실제 사용 예시는 [예제 WORKFLOW.md](https://github.com/pleaseai/workflow/blob/main/WORKFLOW.md)를 참조하세요.

#### GitHub Projects v2 (PAT)

실제 사용 예시는 [예제 GitHub Project](https://github.com/orgs/pleaseai/projects/2)를 참조하세요.

```markdown
---
tracker:
  kind: github_projects
  api_key: $GITHUB_TOKEN
  owner: your-org
  project_number: 42
  active_statuses:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:
    - Human Review

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 기본값: [project, local, user]; SDK 격리 모드에서는 []로 설정
  turn_timeout_ms: 3600000
---

GitHub 이슈에 대해 `your-org/your-repo` 저장소에서 작업하고 있습니다.

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
차단 사항:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
이번은 #{{ attempt }}번째 시도입니다. 계속하기 전에 워크스페이스의 기존 작업을 검토하세요.
{% endif %}

할 일:
1. 이슈 요구사항을 파악합니다.
2. 요청된 변경사항을 구현합니다.
3. 필요에 따라 테스트를 작성하거나 업데이트합니다.
4. Pull Request를 열고 이 이슈를 `Human Review`로 이동합니다.
```

#### GitHub Projects v2 (GitHub App)

세밀한 권한과 높은 API 속도 제한을 위해 PAT 대신 GitHub App 자격 증명을 사용합니다:

```markdown
---
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
  active_statuses:
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:
    - Human Review

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 기본값: [project, local, user]; SDK 격리 모드에서는 []로 설정
  turn_timeout_ms: 3600000
---

GitHub 이슈에 대해 `your-org/your-repo` 저장소에서 작업하고 있습니다.

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
차단 사항:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
이번은 #{{ attempt }}번째 시도입니다. 계속하기 전에 워크스페이스의 기존 작업을 검토하세요.
{% endif %}

할 일:
1. 이슈 요구사항을 파악합니다.
2. 요청된 변경사항을 구현합니다.
3. 필요에 따라 테스트를 작성하거나 업데이트합니다.
4. Pull Request를 열고 이 이슈를 `Human Review`로 이동합니다.
```

#### Asana (개발 중)

> **참고**: Asana 지원은 개발 중입니다. 아래 설정은 프리뷰이며 변경될 수 있습니다.

```markdown
---
tracker:
  kind: asana
  api_key: $ASANA_ACCESS_TOKEN
  project_gid: "1234567890123456"
  active_sections:
    - In Progress
  terminal_sections:
    - Done
    - Cancelled

polling:
  interval_ms: 30000

workspace:
  root: ~/work-please_workspaces

hooks:
  after_create: |
    git clone https://github.com/your-org/your-repo.git .
    bun install

agent:
  max_concurrent_agents: 3
  max_turns: 20

claude:
  permission_mode: acceptEdits
  # setting_sources: []               # 기본값: [project, local, user]; SDK 격리 모드에서는 []로 설정
  turn_timeout_ms: 3600000
---

프로젝트의 Asana 작업을 처리하고 있습니다.

작업: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
차단 사항:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
이번은 #{{ attempt }}번째 시도입니다. 계속하기 전에 워크스페이스의 기존 작업을 검토하세요.
{% endif %}

할 일:
1. 작업 요구사항을 파악합니다.
2. 요청된 변경사항을 구현합니다.
3. 필요에 따라 테스트를 작성하거나 업데이트합니다.
4. Pull Request를 열고 이 작업을 리뷰 섹션(예: `Human Review`)으로 이동합니다.
```

### 실행

```bash
# 트래커 토큰 설정 (GitHub PAT)
export GITHUB_TOKEN=ghp_your_token_here
# 또는 (GitHub App)
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
# 또는 (Asana — 개발 중)
export ASANA_ACCESS_TOKEN=your_token_here

# 현재 디렉토리의 WORKFLOW.md를 사용하여 Work Please 실행
bunx work-please

# 또는 WORKFLOW.md 경로 지정
bunx work-please /path/to/WORKFLOW.md

# 포트 3000에서 선택적 HTTP 대시보드 활성화
bunx work-please --port 3000
```

## WORKFLOW.md 설정

`WORKFLOW.md`는 Work Please의 런타임 동작에 대한 단일 진실 공급원입니다. YAML front matter
설정 블록과 Markdown 프롬프트 템플릿 본문을 결합합니다.

### 전체 Front Matter 스키마

```yaml
---
tracker:
  kind: github_projects               # 필수: "github_projects" 또는 "asana"

  # --- GitHub Projects v2 필드 (kind == "github_projects"일 때) ---
  api_key: $GITHUB_TOKEN              # 필수: 토큰 또는 $ENV_VAR
  endpoint: https://api.github.com   # 선택: GitHub API 기본 URL 재정의
  owner: your-org                     # 필수: GitHub 조직 또는 사용자 로그인
  project_number: 42                  # 필수: GitHub Projects v2 프로젝트 번호
  project_id: PVT_kwDOxxxxx          # 선택: 프로젝트 노드 ID (owner+project_number 조회 생략)
  active_statuses:                    # 선택: 기본값 ["Todo", "In Progress", "Merging", "Rework"]
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:                  # 선택: 기본값 ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:                   # 선택: 리뷰 활동 시 에이전트를 디스패치할 상태. 기본값 ["Human Review"]
    - Human Review
  # GitHub App 인증 (api_key 대안 — 세 필드 모두 함께 필요):
  # app_id: $GITHUB_APP_ID            # 선택: GitHub App ID (정수 또는 $ENV_VAR)
  # private_key: $GITHUB_APP_PRIVATE_KEY  # 선택: GitHub App 개인키 PEM 또는 $ENV_VAR
  # installation_id: $GITHUB_APP_INSTALLATION_ID  # 선택: 설치 ID (정수 또는 $ENV_VAR)

  # --- Asana 필드 (kind == "asana"일 때) --- 개발 중
  # api_key: $ASANA_ACCESS_TOKEN      # 필수: 토큰 또는 $ENV_VAR
  # endpoint: https://app.asana.com/api/1.0  # 선택: Asana API 기본 URL 재정의
  # project_gid: "1234567890123456"   # 필수: Asana 프로젝트 GID
  # active_sections:                  # 선택: 기본값 ["To Do", "In Progress"]
  #   - In Progress
  # terminal_sections:                # 선택: 기본값 ["Done", "Cancelled"]
  #   - Done
  #   - Cancelled

  # --- 공통 필터 필드 (양쪽 트래커) ---
  # filter:
  #   assignee: user1, user2          # 선택: CSV 또는 YAML 배열; 대소문자 무관 OR 매칭
  #                                   # (이 필터 설정 시 미할당 이슈는 제외)
  #   label: bug, feature             # 선택: CSV 또는 YAML 배열; 대소문자 무관 OR 매칭
  # 양쪽 필터 모두 지정 시 AND로 결합. 디스패치 시에만 적용.

polling:
  interval_ms: 30000                  # 선택: 폴링 주기 (ms), 기본값 30000

workspace:
  root: ~/work-please_workspaces        # 선택: 기본값 <tmpdir>/work-please_workspaces

hooks:
  after_create: |                     # 선택: 워크스페이스 최초 생성 시 한 번 실행
    git clone https://github.com/your-org/your-repo.git .
  before_run: |                       # 선택: 각 에이전트 시도 전 실행
    git pull --rebase
  after_run: |                        # 선택: 각 에이전트 시도 후 실행
    echo "Run completed"
  before_remove: |                    # 선택: 워크스페이스 삭제 전 실행
    echo "Cleaning up"
  timeout_ms: 60000                   # 선택: 훅 타임아웃 (ms), 기본값 60000

agent:
  max_concurrent_agents: 10           # 선택: 전역 동시 실행 제한, 기본값 10
  max_retry_backoff_ms: 300000        # 선택: 최대 재시도 지연 (ms), 기본값 300000
  max_concurrent_agents_by_state:     # 선택: 상태별 동시 실행 제한
    in progress: 5

claude:
  command: claude                     # 선택: Claude Code CLI 명령, 기본값 "claude"
  effort: high                        # 선택: 추론 깊이 — 'low', 'medium', 'high', 또는 'max'. 기본값 'high'.
  permission_mode: acceptEdits        # 선택: 'default', 'acceptEdits', 'bypassPermissions' 중 하나. 기본값 'bypassPermissions'.
  allowed_tools:                      # 선택: 사용 가능한 도구 제한
    - Read
    - Write
    - Bash
  setting_sources:                    # 선택: 로드할 파일시스템 설정. 기본값: [project, local, user]
    - project                         # 워크스페이스 디렉토리에서 .claude/settings.json + CLAUDE.md 로드
    - local                           # 워크스페이스 디렉토리에서 .claude/settings.local.json 로드
    - user                            # ~/.claude/settings.json + 전역 CLAUDE.md 로드
                                      # "project", "local", "user"만 유효 — 다른 값은 무시됨
  turn_timeout_ms: 3600000            # 선택: 턴별 타임아웃 (ms), 기본값 3600000
  read_timeout_ms: 5000               # 선택: 초기 서브프로세스 읽기 타임아웃 (ms), 기본값 5000
  stall_timeout_ms: 300000            # 선택: 정체 감지 타임아웃, 기본값 300000
  settings:
    attribution:
      commit: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"  # 선택: git 커밋 메시지에 추가. 기본값은 Work Please 링크.
      pr: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"      # 선택: PR 설명에 추가. 기본값은 Work Please 링크.

server:
  port: 3000                          # 선택: 이 포트에서 HTTP 대시보드 활성화
  # 웹훅 엔드포인트:
  #   GitHub: POST /api/webhooks/github (server.webhook.secret 필요)
  #   Slack:  POST /api/webhooks/slack  (SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET 환경변수 필요)
---

프롬프트 템플릿을 여기에 작성합니다. 사용 가능한 변수:

- {{ issue.id }}           — 트래커 내부 이슈 ID
- {{ issue.identifier }}   — 사람이 읽을 수 있는 식별자 (예: "#42" 또는 작업 GID)
- {{ issue.title }}        — 이슈 제목
- {{ issue.description }}  — 이슈 본문/설명
- {{ issue.state }}        — 현재 트래커 상태명
- {{ issue.url }}          — 이슈 URL
- {{ issue.assignees }}     — 담당자 로그인(GitHub) 또는 이메일(Asana) 배열
- {{ issue.labels }}       — 라벨 문자열 배열 (소문자로 정규화됨)
- {{ issue.blocked_by }}   — 차단 참조 배열 (각각 id, identifier, state 포함)
- {{ issue.branch_name }}  — PR 헤드 브랜치명 (PullRequest 항목) 또는 null
- {{ issue.pull_requests }} — 연결된 PR 배열 (각각 number, title, url, state, branch_name 포함)
- {{ issue.review_decision }} — PR 리뷰 결정: "approved", "changes_requested", "commented", "review_required", 또는 null
- {{ issue.priority }}     — 숫자 우선순위 또는 null
- {{ issue.created_at }}   — ISO-8601 생성 타임스탬프
- {{ issue.updated_at }}   — ISO-8601 최종 업데이트 타임스탬프
- {{ attempt }}            — 재시도 횟수 (첫 실행 시 null)
```

### 템플릿 변수

프롬프트 템플릿은 Liquid 호환 구문을 사용합니다. 모든 `issue` 필드를 사용할 수 있습니다:

```markdown
{{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

상태: {{ issue.state }}

{% if issue.blocked_by.size > 0 %}
차단 사항:
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if issue.pull_requests.size > 0 %}
연결된 Pull Request:
{% for pr in issue.pull_requests %}
- PR #{{ pr.number }}: {{ pr.title }} ({{ pr.state }}){% if pr.branch_name %} — 브랜치: {{ pr.branch_name }}{% endif %}{% if pr.url %} — {{ pr.url }}{% endif %}

{% endfor %}
{% endif %}

{% if attempt %}
재시도 횟수: {{ attempt }}
{% endif %}
```

## CLI 사용법

```bash
# 기본 사용법 (현재 디렉토리에서 WORKFLOW.md 읽기)
work-please

# WORKFLOW.md 경로 지정 (위치 인수)
work-please ./WORKFLOW.md

# HTTP 대시보드 활성화
work-please --port 3000

# 새 GitHub Projects v2 프로젝트 초기화 및 WORKFLOW.md 스캐폴딩
# (GITHUB_TOKEN 환경 변수 설정 필요)
work-please init --owner <org-or-user> --title "My Project"

# 또는 플래그로 토큰 제공:
work-please init --owner <org-or-user> --title "My Project" --token <your-github-token>

# 도움말 표시
work-please --help
```

## GitHub App 인증

`github_projects` 트래커는 두 가지 인증 방법을 지원합니다:

| 방법 | 설정 필드 | 사용 시점 |
|--------|--------------|-------------|
| **PAT** | `api_key` | 개인 액세스 토큰 — 빠른 설정 |
| **GitHub App** | `app_id`, `private_key`, `installation_id` | 조직 — 세밀한 권한, 높은 속도 제한 |

둘 다 있으면 `api_key` (PAT)가 우선합니다.

### GitHub App 자격 증명 설정

1. 다음 권한으로 GitHub App을 생성합니다:
   - **저장소 권한**:
     - `Contents`: 읽기 전용
     - `Issues`: 읽기 & 쓰기
     - `Pull requests`: 읽기 & 쓰기
   - **조직 권한**:
     - `Projects`: 읽기 & 쓰기
2. 조직에 앱을 설치하고 **설치 ID**를 확인합니다 (앱의 설치 설정 URL에서 확인 가능).
3. 앱의 설정 페이지에서 **개인키** (`.pem` 파일)를 생성합니다.
4. 환경 변수를 설정합니다:

```bash
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
```

5. `WORKFLOW.md`에서 참조합니다:

```yaml
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
```

값을 직접 인라인할 수도 있습니다 (시크릿에는 권장하지 않음):

```yaml
app_id: 12345
private_key: "-----BEGIN RSA PRIVATE KEY-----\n..."
installation_id: 67890
```

### 검증

Work Please는 시작 시 GitHub App 설정을 검증합니다:

| 시나리오 | 결과 |
|----------|--------|
| `api_key` 설정됨 | PAT 인증 — app 필드 무시 |
| 세 필드 모두 설정됨 (`app_id`, `private_key`, `installation_id`) | App 인증 |
| 일부 app 필드만 설정됨 | `incomplete_github_app_config` 오류 |
| 인증 미설정 | `missing_tracker_api_key` 오류 |

## Slack 알림

Work Please는 [Chat SDK](https://chat-sdk.dev/) Slack 어댑터를 통해 Slack을 알림 채널로 지원합니다.
설정하면 Slack 채널에서 봇을 @멘션하여 실시간 오케스트레이터 상태(실행 중인 이슈, 재시도 큐,
토큰 사용량)를 확인할 수 있습니다.

### 환경 변수

```bash
SLACK_BOT_TOKEN=xoxb-...           # Bot User OAuth Token
SLACK_SIGNING_SECRET=...           # 웹훅 검증을 위한 서명 시크릿
```

두 환경 변수가 모두 설정되면, 설정된 트래커(GitHub Projects v2 또는 Asana)와 함께 Slack 어댑터가
자동으로 활성화됩니다.

### 웹훅 URL

Slack 앱의 Event Subscriptions 및 Interactivity 요청 URL을 다음으로 설정하세요:

```
https://your-domain.com/api/webhooks/slack
```

### Slack 앱 설정

1. [api.slack.com/apps](https://api.slack.com/apps)에서 **Create New App** > **From an app manifest**를 클릭합니다.
2. 워크스페이스를 선택하고 다음 매니페스트를 붙여넣습니다:

```yaml
display_information:
  name: Work Please
  description: 오케스트레이터 상태 봇
features:
  bot_user:
    display_name: Work Please
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - groups:history
      - groups:read
      - im:history
      - im:read
      - reactions:read
      - reactions:write
      - users:read
settings:
  event_subscriptions:
    request_url: https://your-domain.com/api/webhooks/slack
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
  interactivity:
    is_enabled: true
    request_url: https://your-domain.com/api/webhooks/slack
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

3. `https://your-domain.com/api/webhooks/slack`를 배포된 웹훅 URL로 교체합니다.
4. **Create**를 클릭한 후 **Basic Information** > **App Credentials**에서 **Signing Secret**을 `SLACK_SIGNING_SECRET`으로 복사합니다.
5. **OAuth & Permissions**에서 **Install to Workspace**를 클릭하고 **Bot User OAuth Token** (`xoxb-...`)을 `SLACK_BOT_TOKEN`으로 복사합니다.
6. 채널에 봇을 초대하고 @멘션하여 오케스트레이터 상태를 확인합니다.

## 신뢰 및 안전

Work Please는 Claude Code를 자율적으로 실행합니다. 배포 전에 신뢰 관련 영향을 이해하세요.

### 권한 모드

| 모드 | 동작 | 권장 대상 |
|---|---|---|
| `default` | 민감한 작업에 대해 대화형 승인 | 개발 환경, 알 수 없는 저장소 |
| `acceptEdits` | 파일 편집 자동 승인; 셸 명령은 프롬프트 | 신뢰할 수 있는 코드베이스 |
| `bypassPermissions` | 모든 작업 자동 승인 | 샌드박스 CI 환경 |

완전히 격리된 환경에서 실행하는 경우가 아니라면 `default` 또는 `acceptEdits`로 시작하세요.

### 워크스페이스 격리

- 각 이슈는 `workspace.root` 하위의 전용 디렉토리에서 실행됩니다.
- Claude Code의 작업 디렉토리는 실행 전에 워크스페이스 경로에 대해 검증됩니다.
- 워크스페이스 경로는 경로 탐색 공격을 방지하기 위해 정규화됩니다.

### 권장사항

- 대부분의 배포에서 `acceptEdits` 권한 모드를 기본으로 사용하세요.
- `bypassPermissions`는 네트워크가 격리된 CI 러너 또는 Docker 컨테이너에서만 사용하세요.
- 처음 테스트할 때는 `agent.max_concurrent_agents`를 보수적으로 설정하세요.
- HTTP 대시보드(`--port`) 또는 구조화된 로그를 통해 에이전트 실행을 모니터링하세요.
- API 토큰의 권한을 최소한으로 설정하세요.

## 라이선스

Functional Source License 1.1, MIT Future License (FSL-1.1-MIT). 자세한 내용은 [LICENSE](LICENSE)를 참조하세요.

### 서드파티 라이선스

- Work Please는 OpenAI의 [Symphony 명세](vendor/symphony/SPEC.md) (Apache 2.0)를 기반으로 한 TypeScript 구현체입니다.
- 이 프로젝트는 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)를 사용하며, Anthropic의 [상업적 서비스 약관](https://www.anthropic.com/legal/commercial-terms)이 적용됩니다.
