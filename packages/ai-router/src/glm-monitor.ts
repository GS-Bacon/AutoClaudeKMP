import { getLogger } from '@auto-claude/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const logger = getLogger('ai-router:glm-monitor');

/**
 * GLM実行ログ
 */
export interface GLMExecutionLog {
  timestamp: string;
  skillName: string;
  input: Record<string, unknown>;
  success: boolean;
  parseSuccess: boolean;
  fallbackUsed: boolean;
  duration: number;
  rawOutput?: string;
  error?: string;
  retryCount: number;
}

/**
 * 日次ログファイルの構造
 */
export interface DailyLogFile {
  date: string;
  logs: GLMExecutionLog[];
}

/**
 * スキル別統計
 */
export interface SkillStat {
  success: number;
  failed: number;
  avgDuration: number;
  fallbackCount: number;
}

/**
 * GLM統計サマリー
 */
export interface GLMStatsSummary {
  lastUpdated: string;
  summary: {
    totalExecutions: number;
    successRate: number;
    avgDuration: number;
    tokensSaved: number;
  };
  skillStats: Record<string, SkillStat>;
  recentImprovements: {
    date: string;
    skill: string;
    type: string;
  }[];
}

/**
 * 失敗パターン分析結果
 */
export interface FailurePattern {
  pattern: string;
  count: number;
  skillNames: string[];
  examples: string[];
}

/**
 * 改善提案
 */
export interface ImprovementSuggestion {
  skillName: string;
  type: 'prompt_update' | 'retry_config' | 'timeout' | 'fallback_change';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  change: string;
  reason: string;
}

/**
 * GLM監視システム
 */
export class GLMMonitor {
  private logsDir: string;
  private statsFile: string;
  private currentDateLogs: GLMExecutionLog[] = [];
  private currentDate: string;

  constructor(workspaceDir: string = '/home/bacon/AutoClaudeKMP/workspace') {
    this.logsDir = join(workspaceDir, 'glm-logs');
    this.statsFile = join(workspaceDir, 'glm-stats.json');
    this.currentDate = this.getDateString();

    this.ensureLogsDir();
    this.loadCurrentDateLogs();

    logger.info('GLMMonitor initialized', { logsDir: this.logsDir });
  }

  private getDateString(date: Date = new Date()): string {
    return date.toISOString().split('T')[0];
  }

  private ensureLogsDir(): void {
    if (!existsSync(this.logsDir)) {
      mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private getLogFilePath(date: string): string {
    return join(this.logsDir, `${date}.json`);
  }

  private loadCurrentDateLogs(): void {
    const filepath = this.getLogFilePath(this.currentDate);
    if (existsSync(filepath)) {
      try {
        const data = JSON.parse(readFileSync(filepath, 'utf-8')) as DailyLogFile;
        this.currentDateLogs = data.logs;
      } catch (e) {
        logger.warn('Failed to load current date logs', { error: e });
        this.currentDateLogs = [];
      }
    }
  }

  private saveDailyLogs(): void {
    const filepath = this.getLogFilePath(this.currentDate);
    const data: DailyLogFile = {
      date: this.currentDate,
      logs: this.currentDateLogs,
    };
    writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 実行ログを記録
   */
  logExecution(log: GLMExecutionLog): void {
    // 日付が変わった場合
    const today = this.getDateString();
    if (today !== this.currentDate) {
      this.saveDailyLogs();
      this.currentDate = today;
      this.currentDateLogs = [];
    }

    this.currentDateLogs.push(log);

    // 即座に保存（パフォーマンスが問題ならバッチ処理に変更）
    this.saveDailyLogs();

    logger.debug('Execution logged', {
      skillName: log.skillName,
      success: log.success,
      duration: log.duration,
    });
  }

  /**
   * 指定日のログを取得
   */
  getLogsForDate(date: string): GLMExecutionLog[] {
    if (date === this.currentDate) {
      return [...this.currentDateLogs];
    }

    const filepath = this.getLogFilePath(date);
    if (!existsSync(filepath)) {
      return [];
    }

    try {
      const data = JSON.parse(readFileSync(filepath, 'utf-8')) as DailyLogFile;
      return data.logs;
    } catch (e) {
      logger.warn('Failed to load logs for date', { date, error: e });
      return [];
    }
  }

  /**
   * 過去N日間のログを取得
   */
  getLogsForPastDays(days: number): GLMExecutionLog[] {
    const logs: GLMExecutionLog[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = this.getDateString(date);
      logs.push(...this.getLogsForDate(dateStr));
    }

    return logs;
  }

  /**
   * 統計サマリーを計算
   */
  calculateStats(logs: GLMExecutionLog[]): GLMStatsSummary {
    const skillStats: Record<string, SkillStat> = {};

    let totalDuration = 0;
    let successCount = 0;

    for (const log of logs) {
      // スキル別統計
      if (!skillStats[log.skillName]) {
        skillStats[log.skillName] = {
          success: 0,
          failed: 0,
          avgDuration: 0,
          fallbackCount: 0,
        };
      }

      const stat = skillStats[log.skillName];
      if (log.success) {
        stat.success++;
        successCount++;
      } else {
        stat.failed++;
      }
      if (log.fallbackUsed) {
        stat.fallbackCount++;
      }

      totalDuration += log.duration;
    }

    // 平均durationを計算
    for (const skillName of Object.keys(skillStats)) {
      const stat = skillStats[skillName];
      const total = stat.success + stat.failed;
      if (total > 0) {
        const skillLogs = logs.filter((l) => l.skillName === skillName);
        stat.avgDuration = skillLogs.reduce((sum, l) => sum + l.duration, 0) / total;
      }
    }

    // トークン節約計算（概算）
    const glmSuccesses = logs.filter((l) => l.success && !l.fallbackUsed).length;
    const tokensSaved = glmSuccesses * 1000; // 1実行あたり1000トークン概算

    // 既存の改善履歴を読み込む
    let recentImprovements: { date: string; skill: string; type: string }[] = [];
    if (existsSync(this.statsFile)) {
      try {
        const existing = JSON.parse(readFileSync(this.statsFile, 'utf-8')) as GLMStatsSummary;
        recentImprovements = existing.recentImprovements || [];
      } catch {
        // ignore
      }
    }

    return {
      lastUpdated: new Date().toISOString(),
      summary: {
        totalExecutions: logs.length,
        successRate: logs.length > 0 ? (successCount / logs.length) * 100 : 0,
        avgDuration: logs.length > 0 ? totalDuration / logs.length : 0,
        tokensSaved,
      },
      skillStats,
      recentImprovements,
    };
  }

  /**
   * 失敗パターンを分析
   */
  analyzeFailurePatterns(logs: GLMExecutionLog[]): FailurePattern[] {
    const failedLogs = logs.filter((l) => !l.success);
    const patterns: Map<string, FailurePattern> = new Map();

    for (const log of failedLogs) {
      // エラーメッセージからパターンを抽出
      let pattern = 'unknown';
      if (log.error) {
        if (log.error.includes('parse') || log.error.includes('JSON')) {
          pattern = 'parse_failure';
        } else if (log.error.includes('timeout') || log.error.includes('Timeout')) {
          pattern = 'timeout';
        } else if (log.error.includes('rate') || log.error.includes('limit')) {
          pattern = 'rate_limit';
        } else if (log.error.includes('validation')) {
          pattern = 'validation_failure';
        } else {
          pattern = 'execution_error';
        }
      } else if (!log.parseSuccess) {
        pattern = 'parse_failure';
      }

      if (!patterns.has(pattern)) {
        patterns.set(pattern, {
          pattern,
          count: 0,
          skillNames: [],
          examples: [],
        });
      }

      const p = patterns.get(pattern)!;
      p.count++;
      if (!p.skillNames.includes(log.skillName)) {
        p.skillNames.push(log.skillName);
      }
      if (p.examples.length < 3 && log.error) {
        p.examples.push(log.error.slice(0, 200));
      }
    }

    return Array.from(patterns.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * 改善提案を生成
   */
  generateImprovementSuggestions(
    stats: GLMStatsSummary,
    patterns: FailurePattern[]
  ): ImprovementSuggestion[] {
    const suggestions: ImprovementSuggestion[] = [];

    // スキル別の分析
    for (const [skillName, stat] of Object.entries(stats.skillStats)) {
      const total = stat.success + stat.failed;
      if (total < 5) continue; // サンプル不足

      const successRate = (stat.success / total) * 100;

      // 成功率が低いスキル
      if (successRate < 70) {
        suggestions.push({
          skillName,
          type: 'prompt_update',
          riskLevel: 'LOW',
          change: 'プロンプトをより明確にし、出力形式の例を追加する',
          reason: `成功率が${successRate.toFixed(1)}%と低い`,
        });
      }

      // タイムアウトが多い
      if (stat.avgDuration > 120000) {
        suggestions.push({
          skillName,
          type: 'timeout',
          riskLevel: 'LOW',
          change: 'タイムアウトを延長する（現在の1.5倍）',
          reason: `平均実行時間が${(stat.avgDuration / 1000).toFixed(1)}秒と長い`,
        });
      }

      // フォールバック率が高い
      const fallbackRate = total > 0 ? (stat.fallbackCount / total) * 100 : 0;
      if (fallbackRate > 30) {
        suggestions.push({
          skillName,
          type: 'retry_config',
          riskLevel: 'LOW',
          change: 'リトライ回数を増やす（+1回）',
          reason: `フォールバック率が${fallbackRate.toFixed(1)}%と高い`,
        });
      }
    }

    // パターン別の分析
    for (const pattern of patterns) {
      if (pattern.pattern === 'parse_failure' && pattern.count >= 3) {
        for (const skillName of pattern.skillNames) {
          suggestions.push({
            skillName,
            type: 'prompt_update',
            riskLevel: 'LOW',
            change: 'JSON出力形式の指示を強化し、「JSONのみを出力」を強調する',
            reason: `パース失敗が${pattern.count}回発生`,
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * 統計ファイルを更新
   */
  updateStatsFile(): GLMStatsSummary {
    const logs = this.getLogsForPastDays(7);
    const stats = this.calculateStats(logs);
    writeFileSync(this.statsFile, JSON.stringify(stats, null, 2), 'utf-8');
    logger.info('Stats file updated', { totalExecutions: stats.summary.totalExecutions });
    return stats;
  }

  /**
   * 日次レビューレポートを生成
   */
  generateDailyReviewReport(): {
    stats: GLMStatsSummary;
    patterns: FailurePattern[];
    suggestions: ImprovementSuggestion[];
  } {
    const logs = this.getLogsForPastDays(1); // 過去24時間
    const stats = this.calculateStats(logs);
    const patterns = this.analyzeFailurePatterns(logs);
    const suggestions = this.generateImprovementSuggestions(stats, patterns);

    return { stats, patterns, suggestions };
  }

  /**
   * 改善を適用した記録を追加
   */
  recordImprovement(skillName: string, type: string): void {
    if (existsSync(this.statsFile)) {
      try {
        const stats = JSON.parse(readFileSync(this.statsFile, 'utf-8')) as GLMStatsSummary;
        stats.recentImprovements = stats.recentImprovements || [];
        stats.recentImprovements.unshift({
          date: this.getDateString(),
          skill: skillName,
          type,
        });
        // 最新30件のみ保持
        stats.recentImprovements = stats.recentImprovements.slice(0, 30);
        writeFileSync(this.statsFile, JSON.stringify(stats, null, 2), 'utf-8');
      } catch (e) {
        logger.warn('Failed to record improvement', { error: e });
      }
    }
  }

  /**
   * 利用可能なログファイル一覧を取得
   */
  getAvailableLogDates(): string[] {
    if (!existsSync(this.logsDir)) {
      return [];
    }

    return readdirSync(this.logsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''))
      .sort()
      .reverse();
  }
}

let instance: GLMMonitor | null = null;

export function getGLMMonitor(workspaceDir?: string): GLMMonitor {
  if (!instance) {
    instance = new GLMMonitor(workspaceDir);
  }
  return instance;
}
