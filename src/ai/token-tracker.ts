/**
 * トークン使用量計測・追跡システム
 *
 * AI呼び出しごとにトークン数を記録し、サイクル単位で集計
 * workspace/token-usage.json に永続化
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { logger } from "../core/logger.js";

export interface TokenUsage {
  cycleId: string;
  phase: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export interface CycleTokenStats {
  cycleId: string;
  totalInput: number;
  totalOutput: number;
  byPhase: Record<string, { input: number; output: number }>;
  byProvider: Record<string, { input: number; output: number }>;
  timestamp: string;
}

interface TokenUsageData {
  currentCycleUsages: TokenUsage[];
  cycleHistory: CycleTokenStats[];
}

const TOKEN_USAGE_PATH = "./workspace/token-usage.json";
const MAX_HISTORY_CYCLES = 30;

// 文字数ベースのトークン推定（Claude/GLMの平均的な比率）
const CHARS_PER_TOKEN = 4;

export class TokenTracker {
  private currentCycleId: string | null = null;
  private usages: TokenUsage[] = [];
  private cycleHistory: CycleTokenStats[] = [];

  constructor() {
    this.load();
  }

  /**
   * 永続化データを読み込み
   */
  private load(): void {
    try {
      if (existsSync(TOKEN_USAGE_PATH)) {
        const content = readFileSync(TOKEN_USAGE_PATH, "utf-8");
        const data: TokenUsageData = JSON.parse(content);
        this.usages = data.currentCycleUsages || [];
        this.cycleHistory = data.cycleHistory || [];
        logger.debug("Token usage data loaded", {
          currentUsages: this.usages.length,
          historySize: this.cycleHistory.length,
        });
      }
    } catch (err) {
      logger.warn("Failed to load token usage data", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * データを永続化
   */
  private save(): void {
    try {
      const data: TokenUsageData = {
        currentCycleUsages: this.usages,
        cycleHistory: this.cycleHistory,
      };
      writeFileSync(TOKEN_USAGE_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.warn("Failed to save token usage data", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 新しいサイクルを開始
   */
  startCycle(cycleId: string): void {
    // 前のサイクルがあれば集計して保存
    if (this.currentCycleId && this.usages.length > 0) {
      this.saveCycleStats();
    }

    this.currentCycleId = cycleId;
    this.usages = [];
    logger.debug("Token tracking started for cycle", { cycleId });
  }

  /**
   * トークン使用を記録
   */
  record(
    phase: string,
    provider: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    if (!this.currentCycleId) {
      logger.warn("Token record called without active cycle");
      return;
    }

    const usage: TokenUsage = {
      cycleId: this.currentCycleId,
      phase,
      provider,
      inputTokens,
      outputTokens,
      timestamp: new Date().toISOString(),
    };

    this.usages.push(usage);
    logger.debug("Token usage recorded", {
      phase,
      provider,
      input: inputTokens,
      output: outputTokens,
    });
  }

  /**
   * 文字数からトークン数を推定して記録
   */
  recordFromText(
    phase: string,
    provider: string,
    inputText: string,
    outputText: string
  ): void {
    const inputTokens = Math.ceil(inputText.length / CHARS_PER_TOKEN);
    const outputTokens = Math.ceil(outputText.length / CHARS_PER_TOKEN);
    this.record(phase, provider, inputTokens, outputTokens);
  }

  /**
   * サイクル終了時に統計を計算して保存
   */
  saveCycleStats(): CycleTokenStats | null {
    if (!this.currentCycleId || this.usages.length === 0) {
      return null;
    }

    const stats: CycleTokenStats = {
      cycleId: this.currentCycleId,
      totalInput: 0,
      totalOutput: 0,
      byPhase: {},
      byProvider: {},
      timestamp: new Date().toISOString(),
    };

    for (const usage of this.usages) {
      // Total
      stats.totalInput += usage.inputTokens;
      stats.totalOutput += usage.outputTokens;

      // By phase
      if (!stats.byPhase[usage.phase]) {
        stats.byPhase[usage.phase] = { input: 0, output: 0 };
      }
      stats.byPhase[usage.phase].input += usage.inputTokens;
      stats.byPhase[usage.phase].output += usage.outputTokens;

      // By provider
      if (!stats.byProvider[usage.provider]) {
        stats.byProvider[usage.provider] = { input: 0, output: 0 };
      }
      stats.byProvider[usage.provider].input += usage.inputTokens;
      stats.byProvider[usage.provider].output += usage.outputTokens;
    }

    // 履歴に追加
    this.cycleHistory.push(stats);

    // 古い履歴を削除（30サイクル保持）
    if (this.cycleHistory.length > MAX_HISTORY_CYCLES) {
      this.cycleHistory = this.cycleHistory.slice(-MAX_HISTORY_CYCLES);
    }

    // リセット
    this.usages = [];
    this.currentCycleId = null;

    // 永続化
    this.save();

    logger.info("Cycle token stats saved", {
      cycleId: stats.cycleId,
      totalInput: stats.totalInput,
      totalOutput: stats.totalOutput,
    });

    return stats;
  }

  /**
   * 現在のサイクルの使用量を取得
   */
  getCurrentCycleUsages(): TokenUsage[] {
    return [...this.usages];
  }

  /**
   * サイクル履歴を取得
   */
  getCycleHistory(): CycleTokenStats[] {
    return [...this.cycleHistory];
  }

  /**
   * 最新N件のサイクル統計を取得
   */
  getRecentStats(count: number = 10): CycleTokenStats[] {
    return this.cycleHistory.slice(-count);
  }

  /**
   * 全体の統計サマリーを取得
   */
  getSummary(): {
    totalCycles: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    averageInputPerCycle: number;
    averageOutputPerCycle: number;
  } {
    const totalCycles = this.cycleHistory.length;
    let totalInput = 0;
    let totalOutput = 0;

    for (const cycle of this.cycleHistory) {
      totalInput += cycle.totalInput;
      totalOutput += cycle.totalOutput;
    }

    return {
      totalCycles,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      averageInputPerCycle: totalCycles > 0 ? Math.round(totalInput / totalCycles) : 0,
      averageOutputPerCycle: totalCycles > 0 ? Math.round(totalOutput / totalCycles) : 0,
    };
  }
}

// シングルトンインスタンス
export const tokenTracker = new TokenTracker();
