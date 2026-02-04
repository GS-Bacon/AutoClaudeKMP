/**
 * スキル定義の型定義
 * GLM-4.7を確実に動作させるためのスキルインターフェース
 */

/**
 * フォールバック動作の種類
 */
export type FallbackBehavior = 'retry' | 'claude' | 'error';

/**
 * スキル実行結果
 */
export interface SkillResult<T = unknown> {
  success: boolean;
  data?: T;
  rawOutput?: string;
  error?: string;
  retryCount: number;
  fallbackUsed: boolean;
  duration: number;
}

/**
 * スキル入力の基本インターフェース
 */
export interface SkillInput {
  [key: string]: unknown;
}

/**
 * スキル定義インターフェース
 * 各スキルはこのインターフェースを実装する
 */
export interface SkillDefinition<TInput extends SkillInput = SkillInput, TOutput = unknown> {
  /** スキル名（一意識別子） */
  name: string;

  /** スキルの説明 */
  description: string;

  /** フォールバック動作（リトライ→失敗時の挙動） */
  fallbackBehavior: FallbackBehavior;

  /** 最大リトライ回数（デフォルト: 2） */
  maxRetries?: number;

  /** タイムアウト（ミリ秒、デフォルト: 180000 = 3分） */
  timeout?: number;

  /**
   * 入力からプロンプトを構築する
   * GLM-4.7に渡すプロンプト文字列を生成
   */
  buildPrompt(input: TInput): string;

  /**
   * GLM-4.7の出力をパースする
   * パース失敗時はundefinedを返す（リトライ対象）
   */
  parseOutput(rawOutput: string): TOutput | undefined;

  /**
   * 入力のバリデーション
   * 無効な場合はエラーメッセージを返す
   */
  validateInput?(input: TInput): string | null;

  /**
   * 出力のバリデーション
   * パース後の追加検証、無効な場合はエラーメッセージを返す
   */
  validateOutput?(output: TOutput): string | null;
}

/**
 * スキル実行オプション
 */
export interface SkillExecutionOptions {
  /** タイムアウト上書き */
  timeout?: number;
  /** 作業ディレクトリ */
  workingDir?: string;
  /** フォールバック動作上書き */
  fallbackBehavior?: FallbackBehavior;
  /** 強制的にClaudeを使用 */
  forceClaude?: boolean;
}

/**
 * 登録済みスキル情報
 */
export interface RegisteredSkill {
  definition: SkillDefinition;
  executionCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  avgDuration: number;
}

/**
 * プロンプトテンプレートヘルパー
 * GLM-4.7に確実にJSON出力させるための共通パターン
 */
export function buildStructuredPrompt(params: {
  taskName: string;
  inputs: Record<string, unknown>;
  requirements: string[];
  outputSchema: Record<string, unknown>;
}): string {
  const inputsText = Object.entries(params.inputs)
    .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
    .join('\n');

  const requirementsText = params.requirements
    .map((req, i) => `${i + 1}. ${req}`)
    .join('\n');

  const schemaText = JSON.stringify(params.outputSchema, null, 2);

  return `# タスク: ${params.taskName}

## 入力
${inputsText}

## 要件
${requirementsText}

## 出力形式（必ずこのJSON形式のみを出力）
\`\`\`json
${schemaText}
\`\`\`

JSONのみを出力してください。説明は不要です。`;
}

/**
 * JSON出力パーサーヘルパー
 * GLM-4.7の出力からJSONを抽出する
 */
export function parseJsonFromOutput<T>(output: string): T | undefined {
  // まずJSONブロックを探す
  const jsonBlockMatch = output.match(/```json\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1]) as T;
    } catch {
      // JSONブロック内のパースに失敗
    }
  }

  // JSONブロックがない場合、出力全体をパースしてみる
  const trimmed = output.trim();

  // JSON配列またはオブジェクトで始まる場合
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // 全体のパースに失敗
    }
  }

  // JSONが見つからない
  return undefined;
}

/**
 * 出力検証ヘルパー
 * 必須フィールドの存在確認
 */
export function validateRequiredFields(
  obj: Record<string, unknown>,
  requiredFields: string[]
): string | null {
  const missingFields = requiredFields.filter((field) => {
    const value = obj[field];
    return value === undefined || value === null || value === '';
  });

  if (missingFields.length > 0) {
    return `必須フィールドが不足: ${missingFields.join(', ')}`;
  }

  return null;
}
