/**
 * システム診断エンジン
 *
 * 日次システム診断、改善機会の自動発見、診断レポート生成を担当
 */

import {
  getLogger,
  SystemDiagnosticReport,
  DiagnosticResult,
  PerformanceTrend,
  DiagnosticIssue,
  DiagnosticRecommendation,
  SystemHealth,
  SystemState,
} from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger('SystemDiagnostician');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface DiagnosticConfig {
  enablePerformanceTracking: boolean;
  historyDays: number;
  alertThresholds: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    errorRate: number;
  };
}

const DEFAULT_CONFIG: DiagnosticConfig = {
  enablePerformanceTracking: true,
  historyDays: 7,
  alertThresholds: {
    cpuPercent: 80,
    memoryPercent: 85,
    diskPercent: 90,
    errorRate: 0.1,
  },
};

interface HistoricalMetric {
  timestamp: Date;
  cpuPercent: number;
  memoryMB: number;
  diskPercent: number;
  errorCount: number;
  taskCount: number;
}

export class SystemDiagnostician {
  private readonly discord = getDiscordNotifier();
  private readonly config: DiagnosticConfig;
  private readonly metricsHistory: HistoricalMetric[] = [];
  private readonly issues: Map<string, DiagnosticIssue> = new Map();

  constructor(config: Partial<DiagnosticConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 完全なシステム診断を実行
   */
  async runFullDiagnosis(): Promise<SystemDiagnosticReport> {
    logger.info('Starting full system diagnosis');

    const components = await this.diagnoseAllComponents();
    const performanceTrends = await this.analyzePerformanceTrends();
    const issues = await this.detectIssues(components);
    const recommendations = await this.generateRecommendations(components, issues);

    // 全体ステータスの決定
    const overallStatus = this.determineOverallStatus(components, issues);

    const report: SystemDiagnosticReport = {
      id: `diag-${Date.now()}`,
      generatedAt: new Date(),
      overallStatus,
      components,
      performanceTrends,
      issues,
      recommendations,
    };

    // レポートを保存
    await this.saveReport(report);

    // 問題があれば通知
    if (overallStatus !== 'healthy') {
      await this.notifyDiagnosticResult(report);
    }

    logger.info('System diagnosis completed', {
      overallStatus,
      componentCount: components.length,
      issueCount: issues.length,
      recommendationCount: recommendations.length,
    });

    return report;
  }

  /**
   * 全コンポーネントを診断
   */
  private async diagnoseAllComponents(): Promise<DiagnosticResult[]> {
    const results: DiagnosticResult[] = [];

    // システムリソース
    results.push(await this.diagnoseSystemResources());

    // ファイルシステム
    results.push(await this.diagnoseFileSystem());

    // 戦略システム
    results.push(await this.diagnoseStrategies());

    // 学習サイクル
    results.push(await this.diagnoseLearningCycle());

    // 通知システム
    results.push(await this.diagnoseNotifications());

    // スケジューラー
    results.push(await this.diagnoseScheduler());

    // エラー履歴
    results.push(await this.diagnoseErrorHistory());

    return results;
  }

  /**
   * システムリソースの診断
   */
  private async diagnoseSystemResources(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      // CPU使用率
      const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
      details.cpuPercent = cpuUsage.toFixed(1);

      if (cpuUsage > this.config.alertThresholds.cpuPercent) {
        status = 'warning';
        recommendations.push('CPU使用率が高くなっています。不要なプロセスを終了してください');
      }

      // メモリ使用率
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memPercent = ((totalMem - freeMem) / totalMem) * 100;
      details.memoryPercent = memPercent.toFixed(1);
      details.memoryUsedMB = ((totalMem - freeMem) / 1024 / 1024).toFixed(0);

      if (memPercent > this.config.alertThresholds.memoryPercent) {
        status = status === 'warning' ? 'critical' : 'warning';
        recommendations.push('メモリ使用率が高くなっています。メモリを解放してください');
      }

      // アップタイム
      details.uptimeHours = (os.uptime() / 3600).toFixed(1);

      // 現在のメトリクスを記録
      this.recordMetric({
        timestamp: new Date(),
        cpuPercent: cpuUsage,
        memoryMB: (totalMem - freeMem) / 1024 / 1024,
        diskPercent: 0, // 別途取得
        errorCount: 0,
        taskCount: 0,
      });

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'system_resources',
      status,
      message: status === 'healthy'
        ? 'システムリソースは正常です'
        : 'リソースに関する注意が必要です',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * ファイルシステムの診断
   */
  private async diagnoseFileSystem(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      // ワークスペースディレクトリの確認
      const workspaceExists = await this.checkDirectory(WORKSPACE_PATH);
      details.workspaceExists = workspaceExists;

      if (!workspaceExists) {
        status = 'critical';
        recommendations.push('ワークスペースディレクトリが存在しません');
      }

      // 重要なサブディレクトリの確認
      const subDirs = ['strategies', 'logs', 'reports', 'suggestions'];
      const missingDirs: string[] = [];

      for (const dir of subDirs) {
        const exists = await this.checkDirectory(path.join(WORKSPACE_PATH, dir));
        if (!exists) {
          missingDirs.push(dir);
        }
      }

      details.missingDirectories = missingDirs;
      if (missingDirs.length > 0) {
        status = 'warning';
        recommendations.push(`次のディレクトリが見つかりません: ${missingDirs.join(', ')}`);
      }

      // ログファイルのサイズ確認
      const logsDir = path.join(WORKSPACE_PATH, 'logs');
      if (await this.checkDirectory(logsDir)) {
        const totalLogSize = await this.getDirectorySize(logsDir);
        details.logSizeMB = (totalLogSize / 1024 / 1024).toFixed(1);

        if (totalLogSize > 100 * 1024 * 1024) { // 100MB
          recommendations.push('ログファイルが大きくなっています。古いログのアーカイブを検討してください');
        }
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'file_system',
      status,
      message: status === 'healthy'
        ? 'ファイルシステムは正常です'
        : 'ファイルシステムに問題があります',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * 戦略システムの診断
   */
  private async diagnoseStrategies(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      const strategiesDir = path.join(WORKSPACE_PATH, 'strategies');

      if (await this.checkDirectory(strategiesDir)) {
        const files = await fs.promises.readdir(strategiesDir);
        const strategyFiles = files.filter(f => f.endsWith('.json'));
        details.strategyCount = strategyFiles.length;

        // 各戦略のステータスを確認
        let activeCount = 0;
        let failedCount = 0;

        for (const file of strategyFiles) {
          try {
            const content = await fs.promises.readFile(
              path.join(strategiesDir, file),
              'utf-8'
            );
            const strategy = JSON.parse(content);

            if (strategy.status === 'active') activeCount++;
            if (strategy.performance?.failureCount > strategy.performance?.successCount) {
              failedCount++;
            }
          } catch {
            // ファイル読み込みエラーは無視
          }
        }

        details.activeStrategies = activeCount;
        details.failingStrategies = failedCount;

        if (failedCount > 0) {
          status = 'warning';
          recommendations.push(`${failedCount}個の戦略が失敗率が高いです。見直しを検討してください`);
        }

        if (activeCount === 0 && strategyFiles.length > 0) {
          status = 'warning';
          recommendations.push('アクティブな戦略がありません');
        }
      } else {
        status = 'warning';
        details.strategyCount = 0;
        recommendations.push('戦略ディレクトリが見つかりません');
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'strategies',
      status,
      message: status === 'healthy'
        ? '戦略システムは正常に動作しています'
        : '戦略システムに注意が必要です',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * 学習サイクルの診断
   */
  private async diagnoseLearningCycle(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      const learningFile = path.join(WORKSPACE_PATH, 'LEARNING_CYCLES.md');

      if (await this.checkFile(learningFile)) {
        const content = await fs.promises.readFile(learningFile, 'utf-8');
        const lines = content.split('\n');

        // 最後の学習サイクルの日付を確認
        const datePattern = /## (\d{4}-\d{2}-\d{2})/g;
        const dates = [...content.matchAll(datePattern)].map(m => m[1]);

        if (dates.length > 0) {
          const lastDate = new Date(dates[dates.length - 1]);
          const daysSinceLastLearning = Math.floor(
            (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          details.lastLearningDate = dates[dates.length - 1];
          details.daysSinceLastLearning = daysSinceLastLearning;

          if (daysSinceLastLearning > 3) {
            status = 'warning';
            recommendations.push('学習サイクルが3日以上実行されていません');
          }
        }

        details.totalLearningCycles = dates.length;
      } else {
        status = 'warning';
        recommendations.push('学習サイクルの記録が見つかりません');
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'learning_cycle',
      status,
      message: status === 'healthy'
        ? '学習サイクルは正常に機能しています'
        : '学習サイクルに注意が必要です',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * 通知システムの診断
   */
  private async diagnoseNotifications(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      const settingsFile = path.join(WORKSPACE_PATH, 'notification-settings.json');

      if (await this.checkFile(settingsFile)) {
        const content = await fs.promises.readFile(settingsFile, 'utf-8');
        const settings = JSON.parse(content);

        details.discordEnabled = settings.discord?.error || settings.discord?.critical;

        if (!settings.discord?.error && !settings.discord?.critical) {
          status = 'warning';
          recommendations.push('重要な通知（エラー・クリティカル）が無効になっています');
        }
      } else {
        status = 'warning';
        recommendations.push('通知設定ファイルが見つかりません');
      }

      // 通知履歴の確認
      const historyFile = path.join(WORKSPACE_PATH, 'notification-history.json');
      if (await this.checkFile(historyFile)) {
        const content = await fs.promises.readFile(historyFile, 'utf-8');
        const history = JSON.parse(content);

        if (Array.isArray(history)) {
          details.recentNotifications = history.length;

          // エラー通知の頻度を確認
          const errorNotifications = history.filter(
            (n: any) => n.type === 'error' || n.type === 'critical'
          );
          details.recentErrors = errorNotifications.length;

          if (errorNotifications.length > 10) {
            status = 'warning';
            recommendations.push('エラー通知が多発しています。根本原因を調査してください');
          }
        }
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'notifications',
      status,
      message: status === 'healthy'
        ? '通知システムは正常です'
        : '通知システムに注意が必要です',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * スケジューラーの診断
   */
  private async diagnoseScheduler(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      const statusFile = path.join(WORKSPACE_PATH, 'scheduler-status.json');

      if (await this.checkFile(statusFile)) {
        const content = await fs.promises.readFile(statusFile, 'utf-8');
        const schedulerStatus = JSON.parse(content);

        details.isRunning = schedulerStatus.isRunning;
        details.taskCount = schedulerStatus.tasks?.length ?? 0;

        if (!schedulerStatus.isRunning) {
          status = 'critical';
          recommendations.push('スケジューラーが停止しています');
        }

        // 最後のタスク実行を確認
        if (schedulerStatus.lastExecutions) {
          const lastExec = Object.values(schedulerStatus.lastExecutions)
            .filter((v): v is string => typeof v === 'string')
            .map(d => new Date(d))
            .sort((a, b) => b.getTime() - a.getTime())[0];

          if (lastExec) {
            const hoursSinceLastTask = (Date.now() - lastExec.getTime()) / (1000 * 60 * 60);
            details.hoursSinceLastTask = hoursSinceLastTask.toFixed(1);

            if (hoursSinceLastTask > 2) {
              status = status === 'critical' ? 'critical' : 'warning';
              recommendations.push('2時間以上タスクが実行されていません');
            }
          }
        }
      } else {
        status = 'unknown';
        recommendations.push('スケジューラーステータスファイルが見つかりません');
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'scheduler',
      status,
      message: status === 'healthy'
        ? 'スケジューラーは正常に動作しています'
        : 'スケジューラーに問題があります',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * エラー履歴の診断
   */
  private async diagnoseErrorHistory(): Promise<DiagnosticResult> {
    const recommendations: string[] = [];
    let status: DiagnosticResult['status'] = 'healthy';
    const details: Record<string, unknown> = {};

    try {
      const errorFile = path.join(WORKSPACE_PATH, 'ERROR_HISTORY.md');

      if (await this.checkFile(errorFile)) {
        const content = await fs.promises.readFile(errorFile, 'utf-8');
        const lines = content.split('\n');

        // エラーのカウント
        const errorPattern = /^## /;
        const errorCount = lines.filter(l => errorPattern.test(l)).length;
        details.totalErrors = errorCount;

        // 直近のエラーを確認
        const recentPattern = /\d{4}-\d{2}-\d{2}/g;
        const dates = content.match(recentPattern) || [];
        const recentDates = dates
          .map(d => new Date(d))
          .filter(d => Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000);

        details.errorsLast7Days = recentDates.length;

        if (recentDates.length > 20) {
          status = 'warning';
          recommendations.push('過去7日間のエラーが多発しています。システムの安定性を確認してください');
        }

        // 繰り返しエラーの検出
        const errorTypes = new Map<string, number>();
        const typePattern = /type: (\w+)/gi;
        let match;
        while ((match = typePattern.exec(content)) !== null) {
          const type = match[1];
          errorTypes.set(type, (errorTypes.get(type) || 0) + 1);
        }

        const repeatingErrors = [...errorTypes.entries()]
          .filter(([_, count]) => count >= 3)
          .map(([type]) => type);

        if (repeatingErrors.length > 0) {
          details.repeatingErrors = repeatingErrors;
          recommendations.push(`繰り返し発生しているエラー: ${repeatingErrors.join(', ')}`);
        }

      } else {
        details.totalErrors = 0;
      }

    } catch (error) {
      status = 'unknown';
      details.error = error instanceof Error ? error.message : String(error);
    }

    return {
      component: 'error_history',
      status,
      message: status === 'healthy'
        ? 'エラー履歴は正常な範囲内です'
        : 'エラー履歴に注意すべき点があります',
      details,
      recommendations,
      timestamp: new Date(),
    };
  }

  /**
   * パフォーマンストレンドの分析
   */
  private async analyzePerformanceTrends(): Promise<PerformanceTrend[]> {
    const trends: PerformanceTrend[] = [];

    if (this.metricsHistory.length < 2) {
      return trends;
    }

    // CPU使用率のトレンド
    const cpuValues = this.metricsHistory.map(m => ({
      timestamp: m.timestamp,
      value: m.cpuPercent,
    }));
    trends.push(this.calculateTrend('cpu_percent', cpuValues));

    // メモリ使用量のトレンド
    const memValues = this.metricsHistory.map(m => ({
      timestamp: m.timestamp,
      value: m.memoryMB,
    }));
    trends.push(this.calculateTrend('memory_mb', memValues));

    return trends;
  }

  /**
   * トレンドを計算
   */
  private calculateTrend(
    metric: string,
    values: { timestamp: Date; value: number }[]
  ): PerformanceTrend {
    if (values.length < 2) {
      return {
        metric,
        values,
        trend: 'stable',
      };
    }

    // 単純な線形回帰で傾向を判定
    const n = values.length;
    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, v) => sum + v.value, 0);
    const sumXY = values.reduce((sum, v, i) => sum + i * v.value, 0);
    const sumXX = values.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const avgValue = sumY / n;
    const slopePercent = (slope / avgValue) * 100;

    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    let alert: string | undefined;

    if (slopePercent > 5) {
      trend = 'degrading';
      alert = `${metric}が増加傾向にあります`;
    } else if (slopePercent < -5) {
      trend = 'improving';
    }

    return {
      metric,
      values,
      trend,
      alert,
    };
  }

  /**
   * 問題を検出
   */
  private async detectIssues(components: DiagnosticResult[]): Promise<DiagnosticIssue[]> {
    const issues: DiagnosticIssue[] = [];

    for (const component of components) {
      if (component.status === 'critical' || component.status === 'warning') {
        const issueId = `${component.component}-${Date.now()}`;

        // 既存の問題を更新または新規作成
        const existingIssue = this.issues.get(component.component);
        if (existingIssue) {
          existingIssue.occurrences++;
          issues.push(existingIssue);
        } else {
          const newIssue: DiagnosticIssue = {
            id: issueId,
            severity: component.status === 'critical' ? 'critical' : 'medium',
            component: component.component,
            description: component.message,
            firstDetected: new Date(),
            occurrences: 1,
            suggestedFix: component.recommendations?.[0],
          };
          this.issues.set(component.component, newIssue);
          issues.push(newIssue);
        }
      } else {
        // 問題が解決された場合は削除
        this.issues.delete(component.component);
      }
    }

    return issues;
  }

  /**
   * 推奨事項を生成
   */
  private async generateRecommendations(
    components: DiagnosticResult[],
    issues: DiagnosticIssue[]
  ): Promise<DiagnosticRecommendation[]> {
    const recommendations: DiagnosticRecommendation[] = [];
    let priority = 1;

    // 各コンポーネントからの推奨事項
    for (const component of components) {
      if (component.recommendations && component.recommendations.length > 0) {
        for (const rec of component.recommendations) {
          recommendations.push({
            priority: priority++,
            category: this.categorizeRecommendation(component.component),
            title: rec,
            description: `${component.component}に関する改善提案`,
            estimatedImpact: component.status === 'critical' ? '高' : '中',
            actionItems: [rec],
          });
        }
      }
    }

    // 繰り返し発生している問題への対応
    for (const issue of issues) {
      if (issue.occurrences >= 3) {
        recommendations.push({
          priority: priority++,
          category: 'reliability',
          title: `繰り返し発生: ${issue.description}`,
          description: `この問題は${issue.occurrences}回発生しています。根本的な対策が必要です`,
          estimatedImpact: '高',
          actionItems: [
            issue.suggestedFix ?? '根本原因の調査',
            '恒久的な解決策の実装',
          ],
        });
      }
    }

    // 優先度でソート
    return recommendations.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 推奨事項のカテゴリを決定
   */
  private categorizeRecommendation(
    component: string
  ): DiagnosticRecommendation['category'] {
    switch (component) {
      case 'system_resources':
        return 'performance';
      case 'file_system':
      case 'scheduler':
        return 'reliability';
      case 'strategies':
        return 'cost';
      case 'notifications':
      case 'error_history':
        return 'maintenance';
      default:
        return 'maintenance';
    }
  }

  /**
   * 全体ステータスを決定
   */
  private determineOverallStatus(
    components: DiagnosticResult[],
    issues: DiagnosticIssue[]
  ): 'healthy' | 'warning' | 'critical' {
    const hasCritical = components.some(c => c.status === 'critical') ||
      issues.some(i => i.severity === 'critical');

    if (hasCritical) {
      return 'critical';
    }

    const hasWarning = components.some(c => c.status === 'warning') ||
      issues.some(i => i.severity === 'high' || i.severity === 'medium');

    if (hasWarning) {
      return 'warning';
    }

    return 'healthy';
  }

  /**
   * 診断結果を通知
   */
  private async notifyDiagnosticResult(report: SystemDiagnosticReport): Promise<void> {
    const criticalIssues = report.issues.filter(i => i.severity === 'critical');
    const warningIssues = report.issues.filter(i =>
      i.severity === 'high' || i.severity === 'medium'
    );

    if (criticalIssues.length > 0) {
      await this.discord.sendCritical({
        title: 'システム診断: クリティカルな問題を検出',
        description: criticalIssues.map(i => `- ${i.description}`).join('\n'),
        details: {
          reportId: report.id,
          issueCount: report.issues.length,
        },
      });
    } else if (warningIssues.length > 0) {
      await this.discord.sendWarning({
        title: 'システム診断: 注意が必要な問題を検出',
        description: warningIssues.slice(0, 5).map(i => `- ${i.description}`).join('\n'),
        details: {
          reportId: report.id,
          issueCount: report.issues.length,
        },
      });
    }
  }

  /**
   * メトリクスを記録
   */
  private recordMetric(metric: HistoricalMetric): void {
    this.metricsHistory.push(metric);

    // 履歴の上限を維持
    const maxEntries = this.config.historyDays * 24 * 12; // 5分ごと想定
    while (this.metricsHistory.length > maxEntries) {
      this.metricsHistory.shift();
    }
  }

  /**
   * レポートを保存
   */
  private async saveReport(report: SystemDiagnosticReport): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'diagnostics');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${report.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(report, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save diagnostic report', { error });
    }
  }

  // ユーティリティメソッド

  private async checkDirectory(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  private async checkFile(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;
    try {
      const files = await fs.promises.readdir(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        } else if (stat.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        }
      }
    } catch {
      // エラーは無視
    }
    return totalSize;
  }

  /**
   * 最新の診断レポートを取得
   */
  async getLatestReport(): Promise<SystemDiagnosticReport | null> {
    const dir = path.join(WORKSPACE_PATH, 'diagnostics');
    try {
      const files = await fs.promises.readdir(dir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      if (jsonFiles.length === 0) {
        return null;
      }

      // 最新のファイルを取得
      const latestFile = jsonFiles.sort().reverse()[0];
      const content = await fs.promises.readFile(
        path.join(dir, latestFile),
        'utf-8'
      );

      return JSON.parse(content) as SystemDiagnosticReport;
    } catch {
      return null;
    }
  }
}

// シングルトンインスタンス
let diagnosticianInstance: SystemDiagnostician | null = null;

export function getSystemDiagnostician(
  config?: Partial<DiagnosticConfig>
): SystemDiagnostician {
  if (!diagnosticianInstance) {
    diagnosticianInstance = new SystemDiagnostician(config);
  }
  return diagnosticianInstance;
}
