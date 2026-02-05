/**
 * Strategy Types for KairosAgent
 *
 * 将来の収益化機能に備えた型定義
 */

/**
 * 戦略の状態
 */
export type StrategyStatus =
  | "pending"      // 未開始
  | "active"       // 実行中
  | "paused"       // 一時停止
  | "completed"    // 完了
  | "failed";      // 失敗

/**
 * 戦略のカテゴリ
 */
export type StrategyCategory =
  | "content"      // コンテンツ作成
  | "automation"   // 自動化
  | "optimization" // 最適化
  | "research";    // リサーチ

/**
 * 戦略の基本インターフェース
 */
export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: StrategyCategory;
  status: StrategyStatus;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * 戦略の実行結果
 */
export interface StrategyResult {
  strategyId: string;
  success: boolean;
  message: string;
  output?: unknown;
  error?: string;
  executedAt: Date;
  duration: number; // milliseconds
}

/**
 * 戦略エグゼキュータのインターフェース
 */
export interface StrategyExecutor {
  readonly name: string;
  readonly supportedCategories: StrategyCategory[];

  canExecute(strategy: Strategy): boolean;
  execute(strategy: Strategy): Promise<StrategyResult>;
  validate(strategy: Strategy): Promise<{ valid: boolean; errors: string[] }>;
}
