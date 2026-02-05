/**
 * 統計情報ジェネレーター
 *
 * ドキュメント更新用の統計情報を生成
 */

import { existsSync, readFileSync } from "fs";
import { logger } from "../core/logger.js";
import { LearningStats, SystemStatus } from "./types.js";

export class StatsGenerator {
  private learningStatsPath = "./workspace/learning-stats.json";
  private systemStatusPath = "./workspace/SYSTEM_STATUS.json";
  private troublesPath = "./workspace/troubles.json";

  /**
   * 学習統計を取得
   */
  getLearningStats(): LearningStats {
    try {
      if (existsSync(this.learningStatsPath)) {
        const content = readFileSync(this.learningStatsPath, "utf-8");
        const data = JSON.parse(content);
        return {
          totalPatterns: data.totalPatterns || 0,
          totalCycles: data.totalCycles || 0,
          aiCallsSaved: data.aiCallsSaved || 0,
          successRate: data.successRate || 0,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
        };
      }
    } catch (err) {
      logger.warn("Failed to read learning stats", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      totalPatterns: 0,
      totalCycles: 0,
      aiCallsSaved: 0,
      successRate: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * システムステータスを取得
   */
  getSystemStatus(): SystemStatus {
    try {
      if (existsSync(this.systemStatusPath)) {
        const content = readFileSync(this.systemStatusPath, "utf-8");
        const data = JSON.parse(content);
        return {
          isRunning: data.isRunning || false,
          consecutiveFailures: data.consecutiveFailures || 0,
          lastCycleTime: data.lastCycleTime || null,
          totalTroubles: this.getTroubleCount(),
          healthyProviders: data.healthyProviders || [],
        };
      }
    } catch (err) {
      logger.warn("Failed to read system status", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      isRunning: false,
      consecutiveFailures: 0,
      lastCycleTime: null,
      totalTroubles: 0,
      healthyProviders: [],
    };
  }

  /**
   * トラブル数を取得
   */
  private getTroubleCount(): number {
    try {
      if (existsSync(this.troublesPath)) {
        const content = readFileSync(this.troublesPath, "utf-8");
        const data = JSON.parse(content);
        return Array.isArray(data) ? data.length : 0;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  /**
   * 学習統計のMarkdownを生成
   */
  generateLearningStatsMarkdown(): string {
    const stats = this.getLearningStats();
    return `
| Metric | Value |
|--------|-------|
| Total Patterns | ${stats.totalPatterns} |
| Total Cycles | ${stats.totalCycles} |
| AI Calls Saved | ${stats.aiCallsSaved} |
| Success Rate | ${(stats.successRate * 100).toFixed(1)}% |
| Last Updated | ${stats.lastUpdated} |
`.trim();
  }

  /**
   * システムステータスのMarkdownを生成
   */
  generateSystemStatusMarkdown(): string {
    const status = this.getSystemStatus();
    const statusBadge = status.isRunning ? "🟢 Running" : "🔴 Stopped";

    return `
**Status:** ${statusBadge}

| Metric | Value |
|--------|-------|
| Consecutive Failures | ${status.consecutiveFailures} |
| Last Cycle | ${status.lastCycleTime || "Never"} |
| Total Troubles | ${status.totalTroubles} |
| Healthy Providers | ${status.healthyProviders.join(", ") || "None"} |
`.trim();
  }
}

export const statsGenerator = new StatsGenerator();
