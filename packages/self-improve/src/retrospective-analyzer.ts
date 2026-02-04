/**
 * レトロスペクティブアナライザー
 *
 * 週次振り返りの自動化、判断精度の追跡、長期トレンド分析を担当
 */

import {
  getLogger,
  RetrospectiveReport,
  RetrospectiveItem,
  RetrospectiveMetrics,
  ActionItem,
} from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('RetrospectiveAnalyzer');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface PredictionRecord {
  id: string;
  timestamp: Date;
  type: 'revenue' | 'cost' | 'success' | 'duration';
  predicted: number;
  actual?: number;
  accuracy?: number;
  context: string;
}

export interface PerformanceSnapshot {
  date: Date;
  tasksCompleted: number;
  tasksPlanned: number;
  revenue: number;
  cost: number;
  errors: number;
  successRate: number;
}

export interface LongTermTrend {
  metric: string;
  period: 'weekly' | 'monthly' | 'quarterly';
  direction: 'improving' | 'stable' | 'declining';
  changePercent: number;
  dataPoints: { date: Date; value: number }[];
  analysis: string;
}

export interface RetrospectiveConfig {
  weeklyReviewDay: number; // 0=日曜, 6=土曜
  includeFinancials: boolean;
  trackPredictions: boolean;
  generateActionItems: boolean;
}

const DEFAULT_CONFIG: RetrospectiveConfig = {
  weeklyReviewDay: 0, // 日曜日
  includeFinancials: true,
  trackPredictions: true,
  generateActionItems: true,
};

export class RetrospectiveAnalyzer {
  private readonly discord = getDiscordNotifier();
  private readonly config: RetrospectiveConfig;
  private readonly predictions: PredictionRecord[] = [];
  private readonly performanceHistory: PerformanceSnapshot[] = [];
  private readonly retrospectives: RetrospectiveReport[] = [];

  constructor(config: Partial<RetrospectiveConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 週次振り返りを実行
   */
  async conductWeeklyRetrospective(): Promise<RetrospectiveReport> {
    logger.info('Starting weekly retrospective');

    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - 7);

    // メトリクスを収集
    const metrics = await this.collectMetrics(startDate, now);

    // うまくいったことを分析
    const whatWentWell = await this.analyzeSuccesses(startDate, now);

    // うまくいかなかったことを分析
    const whatWentWrong = await this.analyzeFailures(startDate, now);

    // 改善点を特定
    const improvements = await this.identifyImprovements(whatWentWell, whatWentWrong);

    // アクションアイテムを生成
    const actionItems = this.config.generateActionItems
      ? this.generateActionItems(improvements)
      : [];

    const report: RetrospectiveReport = {
      id: `retro-${now.toISOString().slice(0, 10)}`,
      period: 'weekly',
      startDate,
      endDate: now,
      generatedAt: now,
      summary: this.generateSummary(metrics, whatWentWell, whatWentWrong),
      whatWentWell,
      whatWentWrong,
      improvements,
      metrics,
      actionItems,
    };

    this.retrospectives.push(report);

    // 結果を保存
    await this.saveRetrospective(report);

    // レポートを通知
    await this.notifyRetrospective(report);

    logger.info('Weekly retrospective completed', {
      wellCount: whatWentWell.length,
      wrongCount: whatWentWrong.length,
      improvementCount: improvements.length,
    });

    return report;
  }

  /**
   * 予測を記録
   */
  recordPrediction(
    type: PredictionRecord['type'],
    predicted: number,
    context: string
  ): string {
    const prediction: PredictionRecord = {
      id: `pred-${Date.now()}`,
      timestamp: new Date(),
      type,
      predicted,
      context,
    };

    this.predictions.push(prediction);
    logger.debug('Prediction recorded', { id: prediction.id, type, predicted });

    return prediction.id;
  }

  /**
   * 予測の実績を記録
   */
  recordActual(predictionId: string, actual: number): void {
    const prediction = this.predictions.find(p => p.id === predictionId);
    if (!prediction) {
      logger.warn('Prediction not found', { predictionId });
      return;
    }

    prediction.actual = actual;
    prediction.accuracy = this.calculateAccuracy(prediction.predicted, actual);

    logger.debug('Actual recorded', {
      id: predictionId,
      predicted: prediction.predicted,
      actual,
      accuracy: prediction.accuracy,
    });
  }

  /**
   * 判断精度を追跡
   */
  async trackPredictionAccuracy(): Promise<{
    overallAccuracy: number;
    byType: Record<string, number>;
    trend: 'improving' | 'stable' | 'declining';
  }> {
    const completedPredictions = this.predictions.filter(
      p => p.actual !== undefined && p.accuracy !== undefined
    );

    if (completedPredictions.length === 0) {
      return {
        overallAccuracy: 0,
        byType: {},
        trend: 'stable',
      };
    }

    // 全体の精度
    const overallAccuracy = completedPredictions.reduce(
      (sum, p) => sum + (p.accuracy ?? 0),
      0
    ) / completedPredictions.length;

    // タイプ別精度
    const byType: Record<string, number> = {};
    const types = ['revenue', 'cost', 'success', 'duration'];

    for (const type of types) {
      const typePredictions = completedPredictions.filter(p => p.type === type);
      if (typePredictions.length > 0) {
        byType[type] = typePredictions.reduce(
          (sum, p) => sum + (p.accuracy ?? 0),
          0
        ) / typePredictions.length;
      }
    }

    // トレンド分析（直近10件 vs 過去10件）
    const recent = completedPredictions.slice(-10);
    const older = completedPredictions.slice(-20, -10);

    let trend: 'improving' | 'stable' | 'declining' = 'stable';

    if (recent.length >= 5 && older.length >= 5) {
      const recentAvg = recent.reduce((s, p) => s + (p.accuracy ?? 0), 0) / recent.length;
      const olderAvg = older.reduce((s, p) => s + (p.accuracy ?? 0), 0) / older.length;

      if (recentAvg > olderAvg + 5) {
        trend = 'improving';
      } else if (recentAvg < olderAvg - 5) {
        trend = 'declining';
      }
    }

    return { overallAccuracy, byType, trend };
  }

  /**
   * 長期トレンド分析
   */
  async analyzeLongTermTrends(): Promise<LongTermTrend[]> {
    const trends: LongTermTrend[] = [];

    if (this.performanceHistory.length < 4) {
      logger.debug('Not enough data for long-term trend analysis');
      return trends;
    }

    // 週次トレンド分析
    trends.push(await this.analyzeMetricTrend('successRate', 'weekly'));
    trends.push(await this.analyzeMetricTrend('revenue', 'weekly'));
    trends.push(await this.analyzeMetricTrend('errors', 'weekly'));

    // 月次トレンド（十分なデータがある場合）
    if (this.performanceHistory.length >= 30) {
      trends.push(await this.analyzeMetricTrend('successRate', 'monthly'));
      trends.push(await this.analyzeMetricTrend('revenue', 'monthly'));
    }

    return trends;
  }

  /**
   * パフォーマンススナップショットを記録
   */
  recordPerformanceSnapshot(snapshot: Omit<PerformanceSnapshot, 'date'>): void {
    this.performanceHistory.push({
      ...snapshot,
      date: new Date(),
    });

    // 履歴の上限を維持（1年分）
    while (this.performanceHistory.length > 365) {
      this.performanceHistory.shift();
    }
  }

  // Private methods

  private async collectMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<RetrospectiveMetrics> {
    // 期間内のパフォーマンスデータを集計
    const periodData = this.performanceHistory.filter(
      p => p.date >= startDate && p.date <= endDate
    );

    if (periodData.length === 0) {
      // デフォルト値を返す（実際のデータがない場合）
      return {
        tasksCompleted: 0,
        tasksPlanned: 0,
        completionRate: 0,
        revenueActual: 0,
        errorsEncountered: 0,
        errorsResolved: 0,
      };
    }

    const tasksCompleted = periodData.reduce((s, p) => s + p.tasksCompleted, 0);
    const tasksPlanned = periodData.reduce((s, p) => s + p.tasksPlanned, 0);
    const revenueActual = periodData.reduce((s, p) => s + p.revenue, 0);
    const errorsEncountered = periodData.reduce((s, p) => s + p.errors, 0);

    // 予測精度を計算
    const accuracyData = await this.trackPredictionAccuracy();

    return {
      tasksCompleted,
      tasksPlanned,
      completionRate: tasksPlanned > 0 ? (tasksCompleted / tasksPlanned) * 100 : 0,
      predictionAccuracy: accuracyData.overallAccuracy,
      revenueActual,
      errorsEncountered,
      errorsResolved: Math.floor(errorsEncountered * 0.8), // 推定値
    };
  }

  private async analyzeSuccesses(
    startDate: Date,
    endDate: Date
  ): Promise<RetrospectiveItem[]> {
    const items: RetrospectiveItem[] = [];

    // ログやレポートからの成功事例を抽出（簡略版）
    const reportsDir = path.join(WORKSPACE_PATH, 'reports');

    try {
      const files = await fs.promises.readdir(reportsDir);
      const periodFiles = files.filter(f => {
        const dateMatch = f.match(/(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) return false;
        const fileDate = new Date(dateMatch[1]);
        return fileDate >= startDate && fileDate <= endDate;
      });

      // レポートから成功事例を抽出（簡略化）
      if (periodFiles.length > 0) {
        items.push({
          description: `${periodFiles.length}件のレポートを生成`,
          impact: 'medium',
          category: 'reporting',
        });
      }
    } catch {
      // ディレクトリがない場合は無視
    }

    // 戦略実行の成功
    const strategyDir = path.join(WORKSPACE_PATH, 'strategies');
    try {
      const files = await fs.promises.readdir(strategyDir);
      const activeStrategies = files.filter(f => f.endsWith('.json'));

      if (activeStrategies.length > 0) {
        items.push({
          description: `${activeStrategies.length}件の戦略を運用中`,
          impact: 'high',
          category: 'strategy',
        });
      }
    } catch {
      // 無視
    }

    // デフォルトの成功事例
    if (items.length === 0) {
      items.push({
        description: 'システムが安定稼働',
        impact: 'medium',
        category: 'system',
      });
    }

    return items;
  }

  private async analyzeFailures(
    startDate: Date,
    endDate: Date
  ): Promise<RetrospectiveItem[]> {
    const items: RetrospectiveItem[] = [];

    // エラー履歴から失敗事例を抽出
    const errorFile = path.join(WORKSPACE_PATH, 'ERROR_HISTORY.md');

    try {
      const content = await fs.promises.readFile(errorFile, 'utf-8');
      const lines = content.split('\n');

      // 期間内のエラーをカウント
      let errorCount = 0;
      const errorTypes = new Map<string, number>();

      for (const line of lines) {
        const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const errorDate = new Date(dateMatch[1]);
          if (errorDate >= startDate && errorDate <= endDate) {
            errorCount++;

            // エラータイプを抽出（簡略化）
            const typeMatch = line.match(/type:\s*(\w+)/i);
            if (typeMatch) {
              const type = typeMatch[1];
              errorTypes.set(type, (errorTypes.get(type) ?? 0) + 1);
            }
          }
        }
      }

      if (errorCount > 0) {
        items.push({
          description: `${errorCount}件のエラーが発生`,
          impact: errorCount > 10 ? 'high' : 'medium',
          category: 'error',
          examples: [...errorTypes.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type, count]) => `${type}: ${count}件`),
        });
      }
    } catch {
      // ファイルがない場合は無視
    }

    return items;
  }

  private async identifyImprovements(
    successes: RetrospectiveItem[],
    failures: RetrospectiveItem[]
  ): Promise<RetrospectiveItem[]> {
    const improvements: RetrospectiveItem[] = [];

    // 失敗から改善点を導出
    for (const failure of failures) {
      if (failure.category === 'error') {
        improvements.push({
          description: 'エラーハンドリングの強化',
          impact: 'medium',
          category: 'reliability',
        });
      }
    }

    // 成功パターンの強化
    for (const success of successes) {
      if (success.impact === 'high') {
        improvements.push({
          description: `${success.description}の継続と拡大`,
          impact: 'medium',
          category: success.category,
        });
      }
    }

    // 一般的な改善提案
    if (improvements.length === 0) {
      improvements.push({
        description: '自動化範囲の拡大を検討',
        impact: 'medium',
        category: 'automation',
      });
    }

    return improvements;
  }

  private generateActionItems(improvements: RetrospectiveItem[]): ActionItem[] {
    return improvements.slice(0, 5).map((imp, index) => ({
      id: `action-${Date.now()}-${index}`,
      description: imp.description,
      priority: imp.impact === 'high' ? 'high' : 'medium',
      status: 'pending',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1週間後
    }));
  }

  private generateSummary(
    metrics: RetrospectiveMetrics,
    successes: RetrospectiveItem[],
    failures: RetrospectiveItem[]
  ): string {
    const parts: string[] = [];

    parts.push(`タスク完了率: ${metrics.completionRate.toFixed(1)}%`);

    if (metrics.revenueActual > 0) {
      parts.push(`収益: ¥${metrics.revenueActual.toLocaleString()}`);
    }

    parts.push(`成功事例: ${successes.length}件`);

    if (failures.length > 0) {
      parts.push(`改善点: ${failures.length}件`);
    }

    if (metrics.predictionAccuracy !== undefined) {
      parts.push(`予測精度: ${metrics.predictionAccuracy.toFixed(1)}%`);
    }

    return parts.join('。');
  }

  private calculateAccuracy(predicted: number, actual: number): number {
    if (predicted === 0 && actual === 0) return 100;
    if (predicted === 0 || actual === 0) return 0;

    const ratio = actual / predicted;
    // 予測に対する実績の一致度（100%が完璧）
    return Math.max(0, 100 - Math.abs(ratio - 1) * 100);
  }

  private async analyzeMetricTrend(
    metric: keyof PerformanceSnapshot,
    period: 'weekly' | 'monthly'
  ): Promise<LongTermTrend> {
    const now = new Date();
    const periodMs = period === 'weekly'
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;

    // 期間ごとにデータを集計
    const dataPoints: { date: Date; value: number }[] = [];
    const periods = period === 'weekly' ? 4 : 3;

    for (let i = 0; i < periods; i++) {
      const periodEnd = new Date(now.getTime() - i * periodMs);
      const periodStart = new Date(periodEnd.getTime() - periodMs);

      const periodData = this.performanceHistory.filter(
        p => p.date >= periodStart && p.date < periodEnd
      );

      if (periodData.length > 0) {
        const value = periodData.reduce((s, p) => s + (p[metric] as number), 0) / periodData.length;
        dataPoints.push({ date: periodStart, value });
      }
    }

    // トレンドを計算
    let direction: 'improving' | 'stable' | 'declining' = 'stable';
    let changePercent = 0;

    if (dataPoints.length >= 2) {
      const recent = dataPoints[0].value;
      const older = dataPoints[dataPoints.length - 1].value;

      if (older !== 0) {
        changePercent = ((recent - older) / older) * 100;
      }

      // メトリクスによって「良い方向」が異なる
      const isPositiveGood = metric !== 'errors';

      if (Math.abs(changePercent) > 10) {
        if ((changePercent > 0) === isPositiveGood) {
          direction = 'improving';
        } else {
          direction = 'declining';
        }
      }
    }

    return {
      metric: String(metric),
      period,
      direction,
      changePercent,
      dataPoints,
      analysis: `${metric}は${period === 'weekly' ? '週次' : '月次'}で${
        direction === 'improving' ? '改善' : direction === 'declining' ? '悪化' : '安定'
      }傾向（${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(1)}%）`,
    };
  }

  private async saveRetrospective(report: RetrospectiveReport): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'retrospectives');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${report.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(report, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save retrospective', { error });
    }
  }

  private async notifyRetrospective(report: RetrospectiveReport): Promise<void> {
    const highImpactIssues = report.whatWentWrong.filter(i => i.impact === 'high');

    const description = [
      `**期間:** ${report.startDate.toISOString().slice(0, 10)} 〜 ${report.endDate.toISOString().slice(0, 10)}`,
      '',
      `**サマリー:** ${report.summary}`,
      '',
      `**成功事例:** ${report.whatWentWell.length}件`,
      `**課題:** ${report.whatWentWrong.length}件`,
      `**改善提案:** ${report.improvements.length}件`,
    ].join('\n');

    if (highImpactIssues.length > 0) {
      await this.discord.sendWarning({
        title: '週次振り返り - 要注意事項あり',
        description,
        details: {
          highImpactIssues: highImpactIssues.length,
        },
      });
    } else {
      await this.discord.sendInfo({
        title: '週次振り返りレポート',
        description,
      });
    }
  }

  /**
   * レトロスペクティブ履歴を取得
   */
  getRetrospectiveHistory(): RetrospectiveReport[] {
    return [...this.retrospectives];
  }

  /**
   * 最新のレトロスペクティブを取得
   */
  getLatestRetrospective(): RetrospectiveReport | undefined {
    return this.retrospectives[this.retrospectives.length - 1];
  }
}

// シングルトンインスタンス
let analyzerInstance: RetrospectiveAnalyzer | null = null;

export function getRetrospectiveAnalyzer(
  config?: Partial<RetrospectiveConfig>
): RetrospectiveAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new RetrospectiveAnalyzer(config);
  }
  return analyzerInstance;
}
