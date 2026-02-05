/**
 * Adaptive Learning System - Type Definitions
 *
 * パターンベースの学習システムの型定義。
 * Self-Evolving Agents と OpenClaw のアーキテクチャを参考に設計。
 */

export type ConditionType = "regex" | "file-glob" | "ast-pattern" | "error-code";
export type ConditionTarget = "content" | "filename" | "error-message";
export type SolutionType = "script" | "template" | "ai-prompt";
export type PatternPhase = "initial" | "maturing" | "stable";

/**
 * パターンのマッチ条件
 */
export interface PatternCondition {
  type: ConditionType;
  value: string;
  target: ConditionTarget;
}

/**
 * パターンの解決策
 */
export interface PatternSolution {
  type: SolutionType;
  content: string;
}

/**
 * パターンの統計情報
 */
export interface PatternStats {
  usageCount: number;
  successCount: number;
  confidence: number;
  lastUsed: string;
  phase: PatternPhase;
}

/**
 * パターンの履歴エントリ
 */
export interface PatternHistoryEntry {
  version: number;
  timestamp: string;
  changeReason: string;
}

/**
 * 学習済みパターン
 */
export interface LearnedPattern {
  id: string;
  name: string;
  version: number;
  conditions: PatternCondition[];
  solution: PatternSolution;
  stats: PatternStats;
  history: PatternHistoryEntry[];
  createdAt: string;
  learnedFrom?: string;
}

/**
 * パターンマッチの結果
 */
export interface PatternMatch {
  patternId: string;
  patternName: string;
  confidence: number;
  file: string;
  line?: number;
  matchedContent: string;
  suggestedFix?: string;
}

/**
 * マッチングのコンテキスト
 */
export interface MatchContext {
  file: string;
  content: string;
  errorMessage?: string;
  issueType?: string;
}

/**
 * スクリプト実行のコンテキスト
 */
export interface ExecuteContext {
  file: string;
  workDir: string;
  variables: Record<string, string>;
}

/**
 * 分析のコンテキスト
 */
export interface AnalyzeContext {
  files: string[];
  existingIssues: string[];
  codebaseRoot: string;
}

/**
 * AI分析による改善提案
 */
export interface AIImprovement {
  id: string;
  type: "refactor" | "optimization" | "security" | "bug-fix" | "style";
  description: string;
  file: string;
  line?: number;
  priority: "low" | "medium" | "high";
  suggestedFix?: string;
  aiGenerated: true;
}

/**
 * セマンティック検索の結果
 */
export interface SemanticSearchResult {
  file: string;
  content: string;
  relevance: number;
  matchType: "exact" | "semantic" | "pattern";
  context?: string;
}

/**
 * パターン抽出のコンテキスト
 */
export interface ExtractionContext {
  problem: {
    type: string;
    description: string;
    file: string;
    content?: string;
  };
  solution: {
    description: string;
    changes: Array<{
      file: string;
      before: string;
      after: string;
    }>;
  };
  success: boolean;
}

/**
 * 学習統計
 */
export interface LearningStats {
  totalCycles: number;
  patternHits: number;
  aiCalls: number;
  patternHitRate: number;
  avgConfidence: number;
  topPatterns: Array<{
    id: string;
    name: string;
    usage: number;
  }>;
  lastUpdated: string;
}

/**
 * 信頼度閾値の設定
 */
export const CONFIDENCE_THRESHOLDS = {
  initial: {
    minUsage: 0,
    maxUsage: 4,
    verifyThreshold: 0, // 常に適用
    deprecateThreshold: 0,
  },
  maturing: {
    minUsage: 5,
    maxUsage: 19,
    verifyThreshold: 0.6, // 60%未満でAI検証
    deprecateThreshold: 0,
  },
  stable: {
    minUsage: 20,
    maxUsage: Infinity,
    verifyThreshold: 0.6,
    deprecateThreshold: 0.5, // 50%未満で廃棄候補
  },
} as const;

/**
 * パターンの状態を判定
 */
export function determinePhase(usageCount: number): PatternPhase {
  if (usageCount < CONFIDENCE_THRESHOLDS.maturing.minUsage) {
    return "initial";
  }
  if (usageCount < CONFIDENCE_THRESHOLDS.stable.minUsage) {
    return "maturing";
  }
  return "stable";
}

/**
 * 信頼度を計算
 */
export function calculateConfidence(successCount: number, usageCount: number): number {
  if (usageCount === 0) return 0.9; // 初期値
  return successCount / usageCount;
}

/**
 * パターンが廃棄候補かどうかを判定
 */
export function isDeprecationCandidate(pattern: LearnedPattern): boolean {
  const phase = pattern.stats.phase;
  const threshold = CONFIDENCE_THRESHOLDS[phase];
  return (
    threshold.deprecateThreshold > 0 &&
    pattern.stats.confidence < threshold.deprecateThreshold
  );
}

/**
 * パターンがAI検証を必要とするかどうかを判定
 */
export function needsAIVerification(pattern: LearnedPattern): boolean {
  const phase = pattern.stats.phase;
  const threshold = CONFIDENCE_THRESHOLDS[phase];
  return (
    threshold.verifyThreshold > 0 &&
    pattern.stats.confidence < threshold.verifyThreshold
  );
}
