/**
 * Git関連の型定義
 */

export interface GitignorePattern {
  glob: string;      // 検出用のglobパターン
  pattern: string;   // .gitignoreに追加するパターン
  description?: string;
}

export interface GitignoreUpdateResult {
  updated: boolean;
  addedPatterns: string[];
  existingPatterns: string[];
}
