# AutoClaudeKMP システムワークフロー

このドキュメントでは、AutoClaudeKMPの各処理フローをMermaidフローチャートで図解します。

---

## 1. 全体アーキテクチャ図

```mermaid
graph TB
    subgraph "AutoClaudeKMP"
        Orchestrator[Orchestrator]
        Scheduler[Scheduler]
        Heartbeat[HeartbeatManager]

        subgraph "Core Services"
            TaskQueue[Task Queue]
            ClaudeCLI[Claude Code CLI]
            Memory[Memory Manager]
        end

        subgraph "Self-Improvement"
            LearningCycle[Learning Cycle Manager]
            RCA[Root Cause Analyzer]
            AutoImprover[Auto Improver]
            Diagnostician[System Diagnostician]
            PatternExtractor[Pattern Extractor]
        end

        subgraph "Monetization"
            StrategyManager[Strategy Manager]
            StrategyActivator[Strategy Activator]
            StrategyExecutor[Strategy Executor]
        end

        subgraph "User Interaction"
            SuggestionGate[Suggestion Gate]
            ApprovalGate[Approval Gate]
            Discord[Discord Notifier]
        end

        subgraph "Safety"
            LossLimiter[Loss Limiter]
            BoundaryGuard[Boundary Guard]
            ResourceManager[Resource Manager]
        end
    end

    Orchestrator --> Scheduler
    Orchestrator --> Heartbeat
    Scheduler --> TaskQueue
    TaskQueue --> ClaudeCLI

    Orchestrator --> LearningCycle
    Orchestrator --> StrategyManager
    Orchestrator --> SuggestionGate

    LearningCycle --> RCA
    LearningCycle --> AutoImprover

    StrategyManager --> StrategyExecutor
    StrategyActivator --> StrategyManager

    SuggestionGate --> Discord
    ApprovalGate --> Discord

    Heartbeat --> ResourceManager
    Orchestrator --> LossLimiter
```

---

## 2. 起動フロー

システム起動から待機状態までの流れ。

```mermaid
flowchart TD
    A[index.ts] --> B[getOrchestrator]
    B --> C[orchestrator.start]
    C --> D[ensureDirectories]
    D --> E[ensureGitignore]
    E --> F[registerScheduledTasks]
    F --> G[setupShutdownHandlers]
    G --> H[scheduler.start]
    H --> I[監査ログ記録]
    I --> J[Discord通知: システム起動]
    J --> K{3秒後}
    K --> L[runInitialTasks]

    subgraph "初期タスク"
        L --> M[processPendingSuggestions]
        M --> N[executeActiveStrategies]
        N --> O[seekImprovementOpportunities]
    end

    O --> P[IDLE状態]

    style P fill:#90EE90
```

---

## 3. ハートビートフロー

30分ごとの健全性チェック。

```mermaid
flowchart TD
    A[定期タスク: heartbeat<br/>30分ごと] --> B[heartbeat.beat]

    subgraph "システムチェック"
        B --> C[systemRisk.checkSystem]
        B --> D[toolRisk.checkToolHealth]
        B --> E[resourceManager.checkResources]
    end

    C --> F{状態判定}
    D --> F
    E --> F

    F -->|HEALTHY| G[ステータス保存]
    F -->|DEGRADED| H[Discord警告通知]
    F -->|SAFE_MODE| I[Discord重大通知]

    H --> G
    I --> G

    G --> J[Discord通知:<br/>稼働時間と状態]
    J --> K[IDLE状態へ]

    subgraph "連続失敗時"
        L{連続3回以上失敗?}
        L -->|Yes| M[Discord重大通知:<br/>ハートビート障害]
    end
```

---

## 4. 学習サイクルフロー

問題登録から改善実装・検証までの流れ。

```mermaid
flowchart TD
    subgraph "問題登録"
        A[問題発生] --> B[registerProblem]
        B --> C[類似問題検索]
        C -->|類似あり| D[Discord警告:<br/>類似問題の再発]
    end

    subgraph "根本原因分析"
        C --> E{autoAnalyze?}
        E -->|Yes| F[analyzeWithFiveWhys]
        F --> G[1. Why: 直接原因]
        G --> H[2. Why: 一次原因]
        H --> I[3. Why: 二次原因]
        I --> J[4. Why: 三次原因]
        J --> K[5. Why: 根本原因]
    end

    subgraph "改善提案"
        K --> L[proposeImprovement]
        L --> M[改善案生成]
        M --> N[recordCycle:<br/>LEARNING_CYCLES.md更新]
    end

    subgraph "自動改善処理（1時間ごと）"
        O[auto_improve タスク] --> P[autoImprover.processImprovements]
        P --> Q{リスク評価}
        Q -->|低リスク| R[自動実装]
        Q -->|中・高リスク| S[保留]
    end

    subgraph "改善検証（毎日7時）"
        T[improvement_verify タスク] --> U[verifyImplementedImprovements]
        U --> V{効果測定}
        V -->|成功| W[verified]
        V -->|失敗| X[rollback検討]
    end

    N --> O
    R --> T
```

---

## 5. 提案システムフロー

ユーザー提案の処理フロー。

```mermaid
flowchart TD
    subgraph "提案受付"
        A[ユーザー提案<br/>Discord/Dashboard] --> B[SuggestionGate.create]
        B --> C[pending.json保存]
        C --> D[status: pending]
    end

    subgraph "提案チェック（5分ごと）"
        E[suggestion_check タスク] --> F[processPendingSuggestions]
        F --> G{pending提案あり?}
        G -->|Yes| H[analyzeSuggestionWithAI]
    end

    subgraph "AI分析"
        H --> I[Claude CLIで分析]
        I --> J{判定結果}
        J -->|質問| K[回答生成]
        J -->|バグ報告| L[優先的に採択]
        J -->|機能要望| M[実現可能性評価]
        J -->|その他| N[総合評価]
    end

    subgraph "ステータス更新"
        K --> O[status: implemented]
        L --> P[status: accepted]
        M --> Q{評価結果}
        N --> Q
        Q -->|採択| P
        Q -->|却下| R[status: rejected]
        Q -->|保留| S[status: deferred]
    end

    subgraph "保留再検討"
        S --> T{再検討回数 < 5?}
        T -->|Yes| U[次回再評価]
        T -->|No| V[自動却下]
    end

    subgraph "採択提案の自動実装（30分ごと）"
        P --> W[implement_accepted タスク]
        W --> X[Claude CLIで実装]
        X -->|成功| Y[status: implemented]
        X -->|失敗| Z[status: deferred<br/>再試行予定]
    end

    O --> AA[Discord通知]
    Y --> AA
    R --> AA
    V --> AA
```

---

## 6. 戦略実行フロー

収益化戦略の管理・実行フロー。

```mermaid
flowchart TD
    subgraph "戦略作成"
        A[createStrategy] --> B[倫理チェック]
        B -->|OK| C[status: DRAFT]
        B -->|NG| D[拒否]
    end

    subgraph "戦略アクティベーション（1時間ごと）"
        E[strategy_activation タスク] --> F[evaluateAndActivateDrafts]
        F --> G{DRAFT戦略あり?}
        G -->|Yes| H[リスク評価]
        H -->|低リスク| I[自動アクティベート]
        H -->|中・高リスク| J[承認リクエスト]
        J -->|承認| K[status: ACTIVE]
        J -->|却下| L[status: DRAFT維持]
        I --> K
    end

    subgraph "戦略実行（30分ごと）"
        M[strategy_execution タスク] --> N[executeActiveStrategies]
        N --> O[StrategyExecutor.executeAllActive]
        O --> P{各戦略を実行}
        P --> Q[recordExecution]
        Q --> R[パフォーマンス更新]
        R --> S[ROI計算]
    end

    subgraph "戦略評価（毎日6時）"
        T[daily_analysis タスク] --> U[evaluateStrategies]
        U --> V{失敗率 > 50%?}
        V -->|Yes| W[Discord警告]
        U --> X{ROI < -20%?}
        X -->|Yes| Y[Discord警告]
    end

    C --> E
    K --> M
    S --> T
```

---

## 7. ドキュメント同期フロー

ソースコード変更時のドキュメント同期。

```mermaid
flowchart TD
    A[ソースコード変更] --> B[コミット/Push]
    B --> C[毎日8時: doc_sync_check]
    C --> D[DocSyncChecker.checkSyncStatus]
    D --> E{ドキュメントより<br/>ソースが新しい?}
    E -->|Yes| F[提案システムに登録]
    F --> G[AI分析で更新内容を判定]
    G --> H[Claude CLIでドキュメント自動更新]
    H --> I[DOC_SYNC_STATUS.json更新]
    E -->|No| J[同期済み - 処理終了]

    style J fill:#90EE90
    style I fill:#90EE90
```

---

## 8. 定期タスク一覧

システムで実行される定期タスクの一覧。

| ID | タスク名 | スケジュール | 説明 |
|---|---|---|---|
| `health_check` | ヘルスチェック | 5分ごと | システムの健全性を確認 |
| `suggestion_check` | 提案チェック | 5分ごと | 新規提案をAI分析 |
| `heartbeat` | ハートビート通知 | 30分ごと | 稼働状況をDiscord通知 |
| `strategy_execution` | 戦略実行 | 30分ごと | アクティブ戦略を実行 |
| `implement_accepted` | 採択提案の自動実装 | 30分ごと | 採択された提案を自動実装 |
| `resource_monitor` | リソース監視 | 5分ごと | CPU/メモリを監視 |
| `loss_check` | 損失チェック | 10分ごと | 損失制限を監視 |
| `approval_cleanup` | 承認リクエストクリーンアップ | 1時間ごと | 期限切れリクエストを削除 |
| `improvement_seek` | 改善機会探索 | 1時間ごと | 改善できる箇所を探索 |
| `strategy_activation` | 戦略自動アクティベーション | 1時間ごと | DRAFT戦略を評価・有効化 |
| `auto_improve` | 自動改善処理 | 1時間ごと | 低リスク改善を自動実装 |
| `daily_backup` | 日次バックアップ | 毎日3時 | データをバックアップ |
| `system_diagnosis` | システム診断 | 毎日5時 | 全コンポーネントを診断 |
| `daily_analysis` | 日次分析 | 毎日6時 | 学習レビュー・戦略評価 |
| `improvement_verify` | 改善検証 | 毎日7時 | 実装済み改善の効果を検証 |
| `doc_sync_check` | ドキュメント同期チェック | 毎日8時 | ソースとドキュメントの同期確認 |
| `weekly_report` | 週報生成 | 毎週月曜6時 | 週次レポートを生成 |
| `pattern_extraction` | 成功パターン抽出 | 毎週土曜9時 | 成功パターンを再利用可能な形式に変換 |
| `weekly_retrospective` | 週次振り返り | 毎週日曜21時 | 成功事例・改善点を分析 |

---

## 9. エラーハンドリングフロー

```mermaid
flowchart TD
    subgraph "未捕捉例外"
        A[uncaughtException] --> B[ログ記録: critical]
        B --> C[Discord重大通知]
        C --> D[learningCycle.registerProblem]
        D --> E[severity: 4]
    end

    subgraph "未処理Promise拒否"
        F[unhandledRejection] --> G[ログ記録: error]
        G --> H[learningCycle.registerProblem]
        H --> I[severity: 3]
    end

    subgraph "タスク実行失敗"
        J[Task handler error] --> K[ログ記録: error]
        K --> L[次回実行をスケジュール]
    end

    subgraph "連続失敗"
        M{consecutiveFailures >= 3?} -->|Yes| N[Discord重大通知]
        N --> O[安全モード検討]
    end
```

---

## 関連ファイル

| ファイル | 説明 |
|---|---|
| `apps/orchestrator/src/index.ts` | エントリーポイント |
| `apps/orchestrator/src/orchestrator.ts` | メインオーケストレーター |
| `apps/orchestrator/src/scheduler.ts` | 定期タスクスケジューラー |
| `apps/orchestrator/src/heartbeat.ts` | ハートビート管理 |
| `packages/self-improve/src/learning-cycle.ts` | 学習サイクル管理 |
| `packages/notification/src/suggestion-gate.ts` | 提案システム |
| `packages/strategies/src/strategy-manager.ts` | 戦略管理 |

---

*このドキュメントは自動同期システムにより、ソースコード変更時に更新提案が生成されます。*
