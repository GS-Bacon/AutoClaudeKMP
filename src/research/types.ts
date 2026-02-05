/**
 * Research機能の型定義
 */

import { Goal } from "../goals/types.js";

/**
 * 調査トピック
 */
export interface ResearchTopic {
  id: string;
  topic: string;                              // 調査テーマ
  source: "goal" | "improvement" | "scheduled";
  priority: number;                           // 0-100
  relatedGoalId?: string;                     // 関連する目標ID
  context?: string;                           // 追加のコンテキスト
}

/**
 * 調査で発見した情報
 */
export interface ResearchFinding {
  source: string;                             // 情報源（URLまたは内部ソース）
  summary: string;                            // 要約
  relevance: number;                          // 関連度 0-1
  timestamp: string;
}

/**
 * 解決アプローチ
 */
export interface Approach {
  id: string;
  description: string;                        // アプローチの説明
  pros: string[];                             // メリット
  cons: string[];                             // デメリット
  estimatedEffort: "low" | "medium" | "high"; // 推定工数
  confidence: number;                         // 信頼度 0-1
  relatedFindings?: string[];                 // 関連する発見のソース
}

/**
 * 調査結果
 */
export interface ResearchResult {
  topic: ResearchTopic;
  findings: ResearchFinding[];
  approaches: Approach[];
  recommendations: string[];                  // 具体的な改善提案
  timestamp: string;
}

/**
 * Research設定
 */
export interface ResearchConfig {
  enabled: boolean;                           // Research機能を有効化
  frequency: number;                          // N回に1回実行（デフォルト: 5）
  maxTopicsPerCycle: number;                  // 1回のResearchで調査する最大トピック数
  minConfidenceToQueue: number;               // キュー登録の最小信頼度（デフォルト: 0.6）
}

/**
 * デフォルトのResearch設定
 */
export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  enabled: true,
  frequency: 5,
  maxTopicsPerCycle: 2,
  minConfidenceToQueue: 0.6,
};

/**
 * Research実行コンテキスト
 */
export interface ResearchContext {
  cycleId: string;
  activeGoals: Goal[];
  recentImprovements?: string[];              // 最近の改善項目
  codebaseFiles?: string[];                   // コードベースのファイルリスト
}

/**
 * Web検索を含むAI応答の期待フォーマット
 */
export interface ResearchAIResponse {
  findings: Array<{
    source: string;
    summary: string;
  }>;
  approaches: Array<{
    description: string;
    pros: string[];
    cons: string[];
    effort: "low" | "medium" | "high";
    confidence: number;
  }>;
  recommendations: string[];
}
