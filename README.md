# KairosAgent

自己改善型AIシステム - 長期間動いて自律的に自分自身のコードを修正・改善し続けます。

## 概要

KairosAgentは以下の特徴を持つシステムです：

- **自己修正**: AIが自分自身のソースコードを改善
- **フェイルセーフ**: 変更前にスナップショット、失敗時は自動ロールバック
- **疎結合**: コアはREST API提供のみ、UI/通知は別コンポーネント
- **長期安定稼働**: エラーからの自動復旧

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                    KairosAgent Core                     │
│  (自己改善エンジン - API提供)                            │
│                                                         │
│  ┌─────────┐  ┌───────────┐  ┌─────────┐              │
│  │ 診断    │  │ 修正      │  │ 安全    │              │
│  │ Engine  │→ │ Engine    │→ │ Guard   │              │
│  └─────────┘  └───────────┘  └─────────┘              │
│                      │                                  │
│              ┌───────┴───────┐                         │
│              │   REST API    │ ← 全ての外部通信はここ経由│
│              │   (Port 3100) │                         │
│              └───────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

## 改善サイクル（8フェーズ）

```
Phase 1: health-check  → システム正常性確認
Phase 2: error-detect  → ログ/ビルドエラー検出
Phase 3: improve-find  → TODO/FIXME、品質問題検出
Phase 4: search        → 関連コード調査
Phase 5: plan          → 修正計画作成        [AI]
Phase 6: implement     → スナップショット→コード生成  [AI]
Phase 7: test-gen      → テスト自動生成      [AI]
Phase 8: verify        → テスト実行→成功:コミット/失敗:ロールバック
```

## 各フェーズのAI動作詳細

### Phase 1: health-check（AIなし）
システムリソースと環境の正常性を確認します。
- ソースディレクトリ存在確認
- ワークスペースディレクトリ確認
- ディスク容量チェック
- メモリ使用率チェック（90%超でfail、70%超でwarn）

### Phase 2: error-detect（AIなし）
ログファイルとビルドエラーを検出します。
- `workspace/logs/*.log` から ERROR/WARN レベルのログを抽出
- `tsc --noEmit` でTypeScriptコンパイルエラーを検出
- 直近7日分のログファイルをスキャン

### Phase 3: improve-find（AIなし）
コード品質の問題点を検出します。
- `TODO`, `FIXME`, `HACK`, `NOTE`, `OPTIMIZE` コメントを検出
- 50行以上の長い関数を検出（100行超で高リスク）
- 120文字以上の長い行を検出

### Phase 4: search（AIなし）
問題に関連するコードを検索します。
- キーワードベースの全文検索
- 関連度スコアリング（単語境界マッチで加点）
- import文の依存関係解析
- 上位20件のマッチを返却

### Phase 5: plan（AI使用）
修正計画を作成します。

**使用するAI機能**: `AIProvider.chat()`

**プロンプト例**:
```
Create a repair plan for this error:
Problem: [エラーメッセージ]
File: [対象ファイル]
Related code: [Phase 4で見つかったコード]

Output a JSON array of steps:
[{"order": 1, "action": "modify|create|delete", "file": "path", "details": "what to do"}]
```

**出力**: 修正ステップのJSON配列（アクション、対象ファイル、詳細）

**リスク評価**: 影響ファイル数や削除操作の有無でlow/medium/highを判定

### Phase 6: implement（AI使用 + セキュリティレビュー）
実際にコードを生成・修正します。

**使用するAI機能**:
- `AIProvider.generateCode()` - コード生成
- `Guard.validateCodeWithAI()` - セキュリティレビュー（危険なパターン検出時）

**処理フロー**:
1. Guard による変更許可チェック（保護パターン、ファイル数制限）
2. スナップショット作成
3. AIによるコード生成
4. 危険なパターン検出時はAIセキュリティレビューを実施
5. 承認された場合のみファイルに書き込み

**コード生成プロンプト例**:
```
You are a code generator. Generate ONLY the code, no explanations.
File: [ファイルパス]
Existing code: [既存コード]
Issue to fix: [問題の説明]
Task: [修正内容]
Output ONLY the complete code for the file, nothing else.
```

### Phase 7: test-gen（AI使用）
変更されたコードのテストを自動生成します。

**使用するAI機能**: `AIProvider.generateTest()`

**プロンプト例**:
```
Generate unit tests for the following code.
Target file: [ファイル名]
Test framework: vitest
Code to test: [テスト対象コード]
Existing tests: [既存テストがあれば]
Output ONLY the test code, no explanations.
```

**出力**: vitest形式のテストファイル（`tests/*.test.ts`）

**フォールバック**: AI失敗時は基本的なスケルトンテストを生成

### Phase 8: verify（AIなし）
変更の検証とコミット/ロールバックを行います。

**処理フロー**:
1. `npm run build` でビルドチェック
2. `npm test` でテスト実行
3. 成功時: `git commit` で自動コミット
4. 失敗時: スナップショットから自動ロールバック

**コミットメッセージ形式**: `[KairosAgent] Auto-repair: [タイムスタンプ]`

## AIプロバイダー設定

```json
// config.json
{
  "ai": {
    "provider": "claude"  // "claude", "opencode", or "hybrid"
  }
}
```

### ハイブリッドモード
重要度に応じてAIを使い分けます：

| フェーズ | 使用AI | 理由 |
|---------|--------|------|
| plan | Claude | 重要な判断が必要 |
| implement | Claude | 高品質なコード生成 |
| その他 | OpenCode | コスト効率 |

## セットアップ

### インストール

```bash
npm install
npm run build
```

### 設定

```bash
# config.json を編集
{
  "port": 3100,
  "checkInterval": 1800000,  // 30分
  "ai": {
    "provider": "claude"  // or "glm"
  }
}
```

### 起動

```bash
npm start
```

## REST API

| Endpoint | Method | 説明 |
|----------|--------|------|
| `/api/status` | GET | システム状態 |
| `/api/health` | GET | ヘルスチェック |
| `/api/logs` | GET | ログ取得 |
| `/api/history` | GET | 変更履歴 |
| `/api/events` | GET | SSE (リアルタイム) |
| `/api/trigger/check` | POST | 手動チェック実行 |
| `/api/trigger/repair` | POST | 手動修正実行 |
| `/api/config` | GET/PUT | 設定 |

## CLI

```bash
cd cli
npm install
npm run build
npm link

kairos status          # システム状態
kairos health          # ヘルスチェック
kairos logs            # ログ表示
kairos history         # 変更履歴
kairos check           # チェック実行
kairos watch           # リアルタイム監視
```

## ディレクトリ構造

```
KairosAgent/
├── src/
│   ├── index.ts              # エントリーポイント
│   ├── core/                 # コア機能
│   │   ├── orchestrator.ts   # フェーズ制御
│   │   ├── scheduler.ts      # 定期実行
│   │   ├── logger.ts         # ロギング
│   │   └── event-bus.ts      # イベント管理
│   ├── phases/               # 8つのフェーズ
│   ├── ai/                   # AIプロバイダー
│   ├── safety/               # 安全機構
│   └── api/                  # REST API
├── cli/                      # CLIクライアント
├── workspace/                # 作業ディレクトリ
└── tests/                    # テスト
```

## 安全機構

1. **スナップショット**: 修正前にコード全体を保存
2. **変更制限**: 1回の修正で変更できるファイル数を制限
3. **禁止パターン**: 安全機構自体は修正禁止
4. **テスト必須**: 修正後は必ずテスト実行
5. **自動ロールバック**: テスト失敗時は自動で戻す

## ライセンス

MIT
