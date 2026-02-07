/**
 * AIレビュー型定義
 */

/** 三審制の審理レベル */
export type TrialLevel = "first" | "appeal" | "final";

/** 各審理の記録 */
export interface TrialRecord {
  level: TrialLevel;
  approved: boolean;
  reason: string;
  timestamp: string;
}

/** レビュー全体の結果 */
export interface TrialSystemResult {
  approved: boolean;
  trialsCompleted: number;
  trialHistory: TrialRecord[];
  finalReason: string;
}
