/**
 * ドキュメント更新関連の型定義
 */

export interface DocumentSection {
  name: string;
  startMarker: string;
  endMarker: string;
  generator: () => Promise<string> | string;
}

export interface DocumentTarget {
  path: string;
  sections: string[];
}

export interface DocumentUpdateResult {
  path: string;
  updated: boolean;
  updatedSections: string[];
  errors: string[];
}

export interface LearningStats {
  totalPatterns: number;
  totalCycles: number;
  aiCallsSaved: number;
  successRate: number;
  lastUpdated: string;
}

export interface SystemStatus {
  isRunning: boolean;
  consecutiveFailures: number;
  lastCycleTime: string | null;
  totalTroubles: number;
  healthyProviders: string[];
}
