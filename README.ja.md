# Work Please

[English](README.md) | [한국어](README.ko.md) | 日本語 | [简体中文](README.zh-CN.md)

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=bugs)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=pleaseai_work-please&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=pleaseai_work-please)
[![codecov](https://codecov.io/gh/pleaseai/work-please/graph/badge.svg?token=do858Z1lsI)](https://codecov.io/gh/pleaseai/work-please)

Work Pleaseはイシュートラッカーのタスクを隔離された自律的な実装実行に変換します — コーディングエージェントを監視する代わりに作業を管理します。

> **警告**: Work Pleaseは信頼できる環境での使用を前提としたエンジニアリングプレビューです。

## 目次

- [概要](#概要)
- [Symphonyとの主な違い](#symphonyとの主な違い)
- [機能](#機能)
- [アーキテクチャ](#アーキテクチャ)
- [クイックスタート](#クイックスタート)
  - [前提条件](#前提条件)
  - [インストール](#インストール)
  - [設定](#設定)
  - [実行](#実行)
- [WORKFLOW.md設定](#workflowmd設定)
  - [完全なFront Matterスキーマ](#完全なfront-matterスキーマ)
  - [テンプレート変数](#テンプレート変数)
- [CLI使用方法](#cli使用方法)
- [GitHub App認証](#github-app認証)
  - [GitHub App資格情報の設定](#github-app資格情報の設定)
  - [検証](#検証)
- [信頼と安全性](#信頼と安全性)
  - [権限モード](#権限モード)
  - [ワークスペースの隔離](#ワークスペースの隔離)
  - [推奨事項](#推奨事項)
- [ライセンス](#ライセンス)

## 概要

Work Pleaseは以下を実行する長期稼働TypeScriptサービスです：

1. イシュートラッカー（GitHub Projects v2またはAsana）から設定されたアクティブ状態のタスクをポーリングします。
2. 対象となる各イシューに対して隔離されたワークスペースディレクトリを作成します。
3. そのワークスペースでレンダリングされたプロンプトとともにClaude Codeエージェントセッションを起動します。
4. セッションを監視し、リトライを処理し、各ポーリングサイクルでイシュー状態を調整します。

[Symphony仕様](vendor/symphony/SPEC.md)のTypeScript実装であり、
GitHub Projects v2 / AsanaおよびClaude Codeに適応されています（LinearとCodexの代わり）。

完全な技術的詳細については[SPEC.md](SPEC.md)を参照してください。

## Symphonyとの主な違い

| | Symphony（リファレンス） | Work Please |
|---|---|---|
| イシュートラッカー | Linear | GitHub Projects v2 & Asana（開発中） |
| コーディングエージェント | Codex（app-serverモード） | Claude Code CLI |
| 言語 | Elixir/OTP | TypeScript + Bun |
| トラッカー認証 | `LINEAR_API_KEY` | `GITHUB_TOKEN`、GitHub App資格情報、または`ASANA_ACCESS_TOKEN` |
| プロジェクト設定 | `project_slug` | `owner` + `project_number`（GitHub Projects v2）または`project_gid`（Asana） |
| イシュー状態 | Linearワークフロー状態 | GitHub Projects v2 Statusフィールド / Asanaセクション |
| エージェントプロトコル | JSON-RPC over stdio | `@anthropic-ai/claude-agent-sdk` |
| 権限モデル | Codex承認/サンドボックスポリシー | Claude Code `--permission-mode` |

## 機能

- **マルチトラッカーサポート** — GitHub Projects v2アイテムまたはAsanaタスク（開発中）から固定周期で作業をディスパッチします。
- **GitHub App認証** — PATの代わりにGitHub Appインストールトークン（`app_id` + `private_key` + `installation_id`）で
  GitHubトラッカーを認証し、きめ細かい権限と高いAPIレート制限を活用します。
- **担当者＆ラベルフィルター** — 担当者および/またはラベルで対象イシューをフィルタリングします。各フィルター内の
  複数値はOR論理を使用し、担当者とラベルフィルターが両方指定された場合はANDで結合されます。ディスパッチ時にのみ
  適用され、実行中のイシューには影響しません。`WORKFLOW.md`でトラッカーごとに設定します。
- **隔離されたワークスペース** — 各イシュー専用のディレクトリを使用し、ワークスペースは実行間で保持されます。
- **`WORKFLOW.md`設定** — エージェントプロンプトとランタイム設定をコードと一緒にバージョン管理します。
- **制限付き同時実行** — グローバルおよび状態ごとの同時エージェント制限をサポートします。
- **バックオフリトライ** — 失敗時に指数バックオフを適用し、正常終了時には短い継続リトライを実行します。
- **動的設定リロード** — `WORKFLOW.md`を編集すると、サービス再起動なしで変更が適用されます。
- **ワークスペースフック** — `after_create`、`before_run`、`after_run`、`before_remove`ライフサイクル
  イベントでシェルスクリプトを実行します。
- **構造化ロギング** — 安定した`key=value`形式のオペレーター可視ログを提供します。
- **オプションHTTPダッシュボード** — `--port`で有効化して、ランタイム状態とJSON APIを確認できます。

## アーキテクチャ

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
               Status Surface（オプションHTTPダッシュボード / 構造化ログ）
```

コンポーネント：

- **Workflow Loader** — `WORKFLOW.md` YAML front matterとプロンプトテンプレート本文を解析します。
- **Config Layer** — 環境変数間接参照とデフォルト値を持つ型安全なgetterを提供します。
- **Issue Tracker Client** — 候補イシューを取得し、実行中のイシュー状態を調整します。GitHub
  Projects v2（GraphQL API）とAsana（REST API）アダプターをサポートします。
- **Orchestrator** — インメモリ状態を所有し、ポーリング/ディスパッチ/リトライループを駆動します。
- **Workspace Manager** — イシューごとのワークスペースを作成、再利用、クリーンアップし、フックを実行します。
- **Agent Runner** — Claude Codeを起動し、イベントをOrchestratorにストリーミングします。
- **Status Surface** — オペレーター可視性のためのオプションのターミナルビューとHTTP APIを提供します。

完全な仕様については[SPEC.md](SPEC.md)を参照してください。

## クイックスタート

### 前提条件

- **Bun**（インストール：[bun.sh](https://bun.sh)）
- **Claude Code CLI**（[公式インストールガイド](https://docs.anthropic.com/en/docs/claude-code)参照）
- **GitHubトークン**（`GITHUB_TOKEN`）— 対象プロジェクトへのアクセス権が必要、**または** **GitHub App資格情報**
  （`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_APP_INSTALLATION_ID`）— [GitHub App認証](#github-app認証)参照、
  **または** **Asanaアクセストークン**（`ASANA_ACCESS_TOKEN`）（開発中）

### インストール

```bash
git clone https://github.com/pleaseai/work-please.git
cd work-please
bun install
bun run build
```

### 設定

ターゲットリポジトリに`WORKFLOW.md`を作成します。以下に2つの例を示します。
実際の使用例については[サンプルWORKFLOW.md](https://github.com/pleaseai/workflow/blob/main/WORKFLOW.md)を参照してください。

#### GitHub Projects v2（PAT）

実際の使用例については[サンプルGitHub Project](https://github.com/orgs/pleaseai/projects/2)を参照してください。

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
  # setting_sources: []               # デフォルト: [project, local, user]; SDK隔離モードでは[]に設定
  turn_timeout_ms: 3600000
---

`your-org/your-repo`リポジトリのGitHubイシューに取り組んでいます。

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
ブロッカー：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
これは#{{ attempt }}回目の試行です。続行する前にワークスペースの既存の作業を確認してください。
{% endif %}

タスク：
1. イシューの要件を理解します。
2. 要求された変更を実装します。
3. 必要に応じてテストを作成または更新します。
4. Pull Requestを作成し、このイシューを`Human Review`に移動します。
```

#### GitHub Projects v2（GitHub App）

きめ細かい権限と高いAPIレート制限のために、PATの代わりにGitHub App資格情報を使用します：

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
  # setting_sources: []               # デフォルト: [project, local, user]; SDK隔離モードでは[]に設定
  turn_timeout_ms: 3600000
---

`your-org/your-repo`リポジトリのGitHubイシューに取り組んでいます。

Issue {{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
ブロッカー：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
これは#{{ attempt }}回目の試行です。続行する前にワークスペースの既存の作業を確認してください。
{% endif %}

タスク：
1. イシューの要件を理解します。
2. 要求された変更を実装します。
3. 必要に応じてテストを作成または更新します。
4. Pull Requestを作成し、このイシューを`Human Review`に移動します。
```

#### Asana（開発中）

> **注意**: Asanaサポートは開発中です。以下の設定はプレビューであり、変更される可能性があります。

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
  # setting_sources: []               # デフォルト: [project, local, user]; SDK隔離モードでは[]に設定
  turn_timeout_ms: 3600000
---

プロジェクトのAsanaタスクに取り組んでいます。

タスク: {{ issue.title }}

{{ issue.description }}

{% if issue.blocked_by.size > 0 %}
ブロッカー：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if attempt %}
これは#{{ attempt }}回目の試行です。続行する前にワークスペースの既存の作業を確認してください。
{% endif %}

タスク：
1. タスクの要件を理解します。
2. 要求された変更を実装します。
3. 必要に応じてテストを作成または更新します。
4. Pull Requestを作成し、このタスクをレビューセクション（例：`Human Review`）に移動します。
```

### 実行

```bash
# トラッカートークンの設定（GitHub PAT）
export GITHUB_TOKEN=ghp_your_token_here
# または（GitHub App）
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
# または（Asana — 開発中）
export ASANA_ACCESS_TOKEN=your_token_here

# カレントディレクトリのWORKFLOW.mdを使用してWork Pleaseを実行
bunx work-please

# またはWORKFLOW.mdパスを指定
bunx work-please /path/to/WORKFLOW.md

# ポート3000でオプションHTTPダッシュボードを有効化
bunx work-please --port 3000
```

## WORKFLOW.md設定

`WORKFLOW.md`はWork Pleaseのランタイム動作の唯一の信頼できるソースです。YAML front matter
設定ブロックとMarkdownプロンプトテンプレート本文を組み合わせます。

### 完全なFront Matterスキーマ

```yaml
---
tracker:
  kind: github_projects               # 必須: "github_projects"または"asana"

  # --- GitHub Projects v2フィールド（kind == "github_projects"の場合） ---
  api_key: $GITHUB_TOKEN              # 必須: トークンまたは$ENV_VAR
  endpoint: https://api.github.com   # 任意: GitHub API基本URLのオーバーライド
  owner: your-org                     # 必須: GitHub組織またはユーザーログイン
  project_number: 42                  # 必須: GitHub Projects v2プロジェクト番号
  project_id: PVT_kwDOxxxxx          # 任意: プロジェクトノードID（owner+project_number検索をスキップ）
  active_statuses:                    # 任意: デフォルト ["Todo", "In Progress", "Merging", "Rework"]
    - Todo
    - In Progress
    - Merging
    - Rework
  terminal_statuses:                  # 任意: デフォルト ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"]
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done
  watched_statuses:                   # 任意: レビュー活動時にエージェントをディスパッチする状態。デフォルト ["Human Review"]
    - Human Review
  # GitHub App認証（api_keyの代替 — 3フィールドすべて同時に必要）：
  # app_id: $GITHUB_APP_ID            # 任意: GitHub App ID（整数または$ENV_VAR）
  # private_key: $GITHUB_APP_PRIVATE_KEY  # 任意: GitHub App秘密鍵PEMまたは$ENV_VAR
  # installation_id: $GITHUB_APP_INSTALLATION_ID  # 任意: インストールID（整数または$ENV_VAR）

  # --- Asanaフィールド（kind == "asana"の場合） --- 開発中
  # api_key: $ASANA_ACCESS_TOKEN      # 必須: トークンまたは$ENV_VAR
  # endpoint: https://app.asana.com/api/1.0  # 任意: Asana API基本URLのオーバーライド
  # project_gid: "1234567890123456"   # 必須: AsanaプロジェクトGID
  # active_sections:                  # 任意: デフォルト ["To Do", "In Progress"]
  #   - In Progress
  # terminal_sections:                # 任意: デフォルト ["Done", "Cancelled"]
  #   - Done
  #   - Cancelled

  # --- 共通フィルターフィールド（両トラッカー共通） ---
  # filter:
  #   assignee: user1, user2          # 任意: CSVまたはYAML配列; 大文字小文字を区別しないORマッチ
  #                                   # （このフィルター設定時、未割り当てイシューは除外）
  #   label: bug, feature             # 任意: CSVまたはYAML配列; 大文字小文字を区別しないORマッチ
  # 両フィルター指定時はANDで結合。ディスパッチ時にのみ適用。

polling:
  interval_ms: 30000                  # 任意: ポーリング間隔（ms）、デフォルト 30000

workspace:
  root: ~/work-please_workspaces        # 任意: デフォルト <tmpdir>/work-please_workspaces

hooks:
  after_create: |                     # 任意: ワークスペース初回作成時に一度実行
    git clone https://github.com/your-org/your-repo.git .
  before_run: |                       # 任意: 各エージェント試行前に実行
    git pull --rebase
  after_run: |                        # 任意: 各エージェント試行後に実行
    echo "Run completed"
  before_remove: |                    # 任意: ワークスペース削除前に実行
    echo "Cleaning up"
  timeout_ms: 60000                   # 任意: フックタイムアウト（ms）、デフォルト 60000

agent:
  max_concurrent_agents: 10           # 任意: グローバル同時実行制限、デフォルト 10
  max_retry_backoff_ms: 300000        # 任意: 最大リトライ遅延（ms）、デフォルト 300000
  max_concurrent_agents_by_state:     # 任意: 状態ごとの同時実行制限
    in progress: 5

claude:
  command: claude                     # 任意: Claude Code CLIコマンド、デフォルト "claude"
  effort: high                        # 任意: 推論深度 — 'low'、'medium'、'high'、または'max'。デフォルト 'high'。
  permission_mode: acceptEdits        # 任意: 'default'、'acceptEdits'、'bypassPermissions'のいずれか。デフォルト 'bypassPermissions'。
  allowed_tools:                      # 任意: 使用可能なツールの制限
    - Read
    - Write
    - Bash
  setting_sources:                    # 任意: ロードするファイルシステム設定。デフォルト: [project, local, user]
    - project                         # ワークスペースディレクトリから.claude/settings.json + CLAUDE.mdをロード
    - local                           # ワークスペースディレクトリから.claude/settings.local.jsonをロード
    - user                            # ~/.claude/settings.json + グローバルCLAUDE.mdをロード
                                      # "project"、"local"、"user"のみ有効 — その他の値は無視
  turn_timeout_ms: 3600000            # 任意: ターンごとのタイムアウト（ms）、デフォルト 3600000
  read_timeout_ms: 5000               # 任意: 初期サブプロセス読み取りタイムアウト（ms）、デフォルト 5000
  stall_timeout_ms: 300000            # 任意: ストール検出タイムアウト、デフォルト 300000
  settings:
    attribution:
      commit: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"  # 任意: gitコミットメッセージに追加。デフォルトはWork Pleaseリンク。
      pr: "🙏 Generated with [Work Please](https://github.com/pleaseai/work-please)"      # 任意: PR説明に追加。デフォルトはWork Pleaseリンク。

server:
  port: 3000                          # 任意: このポートでHTTPダッシュボードを有効化
---

プロンプトテンプレートをここに記述します。使用可能な変数：

- {{ issue.id }}           — トラッカー内部イシューID
- {{ issue.identifier }}   — 人間が読める識別子（例：「#42」またはタスクGID）
- {{ issue.title }}        — イシュータイトル
- {{ issue.description }}  — イシュー本文/説明
- {{ issue.state }}        — 現在のトラッカー状態名
- {{ issue.url }}          — イシューURL
- {{ issue.assignees }}     — 担当者ログイン（GitHub）またはメール（Asana）の配列
- {{ issue.labels }}       — ラベル文字列の配列（小文字に正規化）
- {{ issue.blocked_by }}   — ブロッカー参照の配列（各要素にid、identifier、stateを含む）
- {{ issue.branch_name }}  — PRヘッドブランチ名（PullRequestアイテム）またはnull
- {{ issue.pull_requests }} — リンクされたPRの配列（各要素にnumber、title、url、state、branch_nameを含む）
- {{ issue.review_decision }} — PRレビュー決定："approved"、"changes_requested"、"commented"、"review_required"、またはnull
- {{ issue.has_unresolved_threads }} — PRに未解決レビュースレッドがあるかどうか
- {{ issue.has_unresolved_human_threads }} — PRに未解決の非ボットレビュースレッドがあるかどうか
- {{ issue.priority }}     — 数値優先度またはnull
- {{ issue.created_at }}   — ISO-8601作成タイムスタンプ
- {{ issue.updated_at }}   — ISO-8601最終更新タイムスタンプ
- {{ attempt }}            — リトライ回数（初回実行時はnull）
```

### テンプレート変数

プロンプトテンプレートはLiquid互換構文を使用します。すべての`issue`フィールドが利用可能です：

```markdown
{{ issue.identifier }}: {{ issue.title }}

{{ issue.description }}

状態: {{ issue.state }}

{% if issue.blocked_by.size > 0 %}
ブロッカー：
{% for blocker in issue.blocked_by %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

{% if issue.pull_requests.size > 0 %}
リンクされたPull Request：
{% for pr in issue.pull_requests %}
- PR #{{ pr.number }}: {{ pr.title }} ({{ pr.state }}){% if pr.branch_name %} — ブランチ: {{ pr.branch_name }}{% endif %}{% if pr.url %} — {{ pr.url }}{% endif %}

{% endfor %}
{% endif %}

{% if attempt %}
リトライ回数: {{ attempt }}
{% endif %}
```

## CLI使用方法

```bash
# 基本的な使い方（カレントディレクトリからWORKFLOW.mdを読み込む）
work-please

# WORKFLOW.mdパスを指定（位置引数）
work-please ./WORKFLOW.md

# HTTPダッシュボードを有効化
work-please --port 3000

# 新しいGitHub Projects v2プロジェクトを初期化し、WORKFLOW.mdをスキャフォールド
# （GITHUB_TOKEN環境変数の設定が必要）
work-please init --owner <org-or-user> --title "My Project"

# またはフラグでトークンを指定：
work-please init --owner <org-or-user> --title "My Project" --token <your-github-token>

# ヘルプを表示
work-please --help
```

## GitHub App認証

`github_projects`トラッカーは2つの認証方法をサポートしています：

| 方法 | 設定フィールド | 使用場面 |
|--------|--------------|-------------|
| **PAT** | `api_key` | 個人アクセストークン — 簡単セットアップ |
| **GitHub App** | `app_id`、`private_key`、`installation_id` | 組織 — きめ細かい権限、高いレート制限 |

両方が存在する場合、`api_key`（PAT）が優先されます。

### GitHub App資格情報の設定

1. 以下の権限でGitHub Appを作成します：
   - **リポジトリ権限**：
     - `Contents`：読み取り専用
     - `Issues`：読み取り＆書き込み
     - `Pull requests`：読み取り＆書き込み
   - **組織権限**：
     - `Projects`：読み取り＆書き込み
2. 組織にアプリをインストールし、**インストールID**を確認します（アプリのインストール設定URLで確認可能）。
3. アプリの設定ページから**秘密鍵**（`.pem`ファイル）を生成します。
4. 環境変数を設定します：

```bash
export GITHUB_APP_ID=12345
export GITHUB_APP_PRIVATE_KEY="$(cat /path/to/private-key.pem)"
export GITHUB_APP_INSTALLATION_ID=67890
```

5. `WORKFLOW.md`で参照します：

```yaml
tracker:
  kind: github_projects
  app_id: $GITHUB_APP_ID
  private_key: $GITHUB_APP_PRIVATE_KEY
  installation_id: $GITHUB_APP_INSTALLATION_ID
  owner: your-org
  project_number: 42
```

値を直接インラインすることもできます（シークレットには推奨しません）：

```yaml
app_id: 12345
private_key: "-----BEGIN RSA PRIVATE KEY-----\n..."
installation_id: 67890
```

### 検証

Work Pleaseは起動時にGitHub App設定を検証します：

| シナリオ | 結果 |
|----------|--------|
| `api_key`が設定済み | PAT認証 — appフィールドは無視 |
| 3フィールドすべて設定済み（`app_id`、`private_key`、`installation_id`） | App認証 |
| 一部のappフィールドのみ設定 | `incomplete_github_app_config`エラー |
| 認証未設定 | `missing_tracker_api_key`エラー |

## 信頼と安全性

Work PleaseはClaude Codeを自律的に実行します。デプロイ前に信頼に関する影響を理解してください。

### 権限モード

| モード | 動作 | 推奨対象 |
|---|---|---|
| `default` | 機密操作に対して対話的な承認 | 開発環境、不明なリポジトリ |
| `acceptEdits` | ファイル編集を自動承認；シェルコマンドはプロンプト | 信頼できるコードベース |
| `bypassPermissions` | すべての操作を自動承認 | サンドボックスCI環境 |

完全に隔離された環境で実行する場合を除き、`default`または`acceptEdits`で開始してください。

### ワークスペースの隔離

- 各イシューは`workspace.root`配下の専用ディレクトリで実行されます。
- Claude Codeの作業ディレクトリは起動前にワークスペースパスに対して検証されます。
- ワークスペースパスはパストラバーサル攻撃を防ぐためにサニタイズされます。

### 推奨事項

- ほとんどのデプロイで`acceptEdits`権限モードをベースラインとして使用してください。
- `bypassPermissions`はネットワーク隔離されたCIランナーまたはDockerコンテナでのみ使用してください。
- 初回テスト時は`agent.max_concurrent_agents`を控えめに設定してください。
- HTTPダッシュボード（`--port`）または構造化ログでエージェント実行を監視してください。
- APIトークンの権限を必要最小限に設定してください。

## ライセンス

Functional Source License 1.1, MIT Future License (FSL-1.1-MIT)。詳細は[LICENSE](LICENSE)を参照してください。

### サードパーティライセンス

- Work PleaseはOpenAIの[Symphony仕様](vendor/symphony/SPEC.md)（Apache 2.0）に基づくTypeScript実装です。
- 本プロジェクトは[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)を使用しており、Anthropicの[商用利用規約](https://www.anthropic.com/legal/commercial-terms)が適用されます。
