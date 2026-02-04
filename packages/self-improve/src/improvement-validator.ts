/**
 * 改善バリデーター
 *
 * 改善のテスト実行（ドライラン）、段階的展開、事後検証の自動化を担当
 */

import { getLogger, RiskLevel } from '@auto-claude/core';
import { getDiscordNotifier, getApprovalGate } from '@auto-claude/notification';
import { getBackupManager } from '@auto-claude/backup';
import type { ProcessImprovement } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('ImprovementValidator');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface ImprovementDryRunResult {
  improvementId: string;
  success: boolean;
  simulatedChanges: SimulatedChange[];
  potentialIssues: string[];
  rollbackPlan: string;
  recommendations: string[];
  timestamp: Date;
}

export interface SimulatedChange {
  target: string;
  changeType: 'add' | 'modify' | 'remove';
  description: string;
  risk: 'low' | 'medium' | 'high';
  reversible: boolean;
}

export interface StagedDeployment {
  improvementId: string;
  stages: DeploymentStage[];
  currentStage: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  startedAt?: Date;
  completedAt?: Date;
}

export interface DeploymentStage {
  id: number;
  name: string;
  scope: 'test' | 'limited' | 'full';
  successCriteria: string[];
  status: 'pending' | 'running' | 'success' | 'failure';
  result?: StageResult;
}

export interface StageResult {
  success: boolean;
  metrics: Record<string, number>;
  issues: string[];
  notes: string;
}

export interface PostVerificationReport {
  improvementId: string;
  verifiedAt: Date;
  daysAfterImplementation: number;
  expectedOutcomes: ExpectedOutcome[];
  overallSuccess: boolean;
  effectivenessScore: number; // 0-100
  sideEffects: string[];
  recommendations: string[];
}

export interface ExpectedOutcome {
  description: string;
  expected: string;
  actual: string;
  met: boolean;
}

export class ImprovementValidator {
  private readonly discord = getDiscordNotifier();
  private readonly approvalGate = getApprovalGate();
  private readonly backupManager = getBackupManager();
  private readonly deployments: Map<string, StagedDeployment> = new Map();
  private readonly verificationReports: PostVerificationReport[] = [];

  /**
   * ドライラン（シミュレーション実行）
   */
  async performDryRun(improvement: ProcessImprovement): Promise<ImprovementDryRunResult> {
    logger.info('Performing dry run', { improvementId: improvement.id });

    const simulatedChanges: SimulatedChange[] = [];
    const potentialIssues: string[] = [];
    const recommendations: string[] = [];

    // 変更をシミュレート
    switch (improvement.target) {
      case 'code':
        simulatedChanges.push({
          target: 'コードベース',
          changeType: improvement.type,
          description: improvement.implementation,
          risk: 'medium',
          reversible: true,
        });
        potentialIssues.push('テストの失敗の可能性');
        recommendations.push('変更前にテストスイートを実行');
        break;

      case 'config':
        simulatedChanges.push({
          target: '設定ファイル',
          changeType: improvement.type,
          description: improvement.implementation,
          risk: 'low',
          reversible: true,
        });
        recommendations.push('変更後に設定の検証を実行');
        break;

      case 'process':
        simulatedChanges.push({
          target: 'プロセスドキュメント',
          changeType: improvement.type,
          description: improvement.implementation,
          risk: 'low',
          reversible: true,
        });
        break;

      case 'strategy':
        simulatedChanges.push({
          target: '戦略設定',
          changeType: improvement.type,
          description: improvement.implementation,
          risk: 'medium',
          reversible: true,
        });
        potentialIssues.push('収益への影響の可能性');
        recommendations.push('小規模テストから開始');
        break;

      case 'knowledge':
        simulatedChanges.push({
          target: 'ナレッジベース',
          changeType: improvement.type,
          description: improvement.implementation,
          risk: 'low',
          reversible: true,
        });
        break;
    }

    // リスク分析
    const highRiskChanges = simulatedChanges.filter(c => c.risk === 'high');
    if (highRiskChanges.length > 0) {
      potentialIssues.push(`${highRiskChanges.length}件の高リスク変更があります`);
      recommendations.push('高リスク変更は個別に承認を取得');
    }

    // ロールバック計画を生成
    const rollbackPlan = this.generateRollbackPlan(improvement, simulatedChanges);

    const result: ImprovementDryRunResult = {
      improvementId: improvement.id,
      success: potentialIssues.length === 0 || !potentialIssues.some(i => i.includes('高リスク')),
      simulatedChanges,
      potentialIssues,
      rollbackPlan,
      recommendations,
      timestamp: new Date(),
    };

    // 結果を保存
    await this.saveDryRunResult(result);

    logger.info('Dry run completed', {
      improvementId: improvement.id,
      success: result.success,
      issueCount: potentialIssues.length,
    });

    return result;
  }

  /**
   * 段階的デプロイを初期化
   */
  initializeStagedDeployment(
    improvement: ProcessImprovement,
    options: {
      stages?: number;
    } = {}
  ): StagedDeployment {
    const numStages = options.stages ?? 3;
    const stages: DeploymentStage[] = [];

    // ステージを作成
    for (let i = 0; i < numStages; i++) {
      let name: string;
      let scope: 'test' | 'limited' | 'full';
      let successCriteria: string[];

      if (i === 0) {
        name = 'テスト環境';
        scope = 'test';
        successCriteria = ['エラーなく実行される', 'テストがパスする'];
      } else if (i === numStages - 1) {
        name = '本番展開';
        scope = 'full';
        successCriteria = ['期待される効果が確認される', '問題が発生しない'];
      } else {
        name = `限定展開 ${i}`;
        scope = 'limited';
        successCriteria = ['限定環境で正常動作', 'パフォーマンス低下なし'];
      }

      stages.push({
        id: i + 1,
        name,
        scope,
        successCriteria,
        status: 'pending',
      });
    }

    const deployment: StagedDeployment = {
      improvementId: improvement.id,
      stages,
      currentStage: 0,
      status: 'pending',
    };

    this.deployments.set(improvement.id, deployment);

    logger.info('Staged deployment initialized', {
      improvementId: improvement.id,
      stageCount: stages.length,
    });

    return deployment;
  }

  /**
   * 次のステージを実行
   */
  async advanceDeploymentStage(
    improvementId: string,
    executeStage: () => Promise<StageResult>
  ): Promise<{ advanced: boolean; deployment: StagedDeployment; message: string }> {
    const deployment = this.deployments.get(improvementId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${improvementId}`);
    }

    if (deployment.status === 'completed' || deployment.status === 'failed') {
      return {
        advanced: false,
        deployment,
        message: `デプロイメントは既に${deployment.status}です`,
      };
    }

    const currentStage = deployment.stages[deployment.currentStage];
    if (!currentStage) {
      deployment.status = 'completed';
      deployment.completedAt = new Date();
      return {
        advanced: false,
        deployment,
        message: '全ステージが完了しました',
      };
    }

    // ステージを開始
    deployment.status = 'in_progress';
    deployment.startedAt = deployment.startedAt ?? new Date();
    currentStage.status = 'running';

    logger.info('Executing deployment stage', {
      improvementId,
      stageId: currentStage.id,
      stageName: currentStage.name,
    });

    try {
      const result = await executeStage();
      currentStage.result = result;

      if (result.success) {
        currentStage.status = 'success';
        deployment.currentStage++;

        if (deployment.currentStage >= deployment.stages.length) {
          deployment.status = 'completed';
          deployment.completedAt = new Date();
        }

        return {
          advanced: true,
          deployment,
          message: `ステージ ${currentStage.name} が成功しました`,
        };
      } else {
        currentStage.status = 'failure';
        deployment.status = 'failed';

        return {
          advanced: false,
          deployment,
          message: `ステージ ${currentStage.name} が失敗しました: ${result.issues.join(', ')}`,
        };
      }
    } catch (error) {
      currentStage.status = 'failure';
      deployment.status = 'failed';
      throw error;
    }
  }

  /**
   * デプロイメントをロールバック
   */
  async rollbackDeployment(improvementId: string): Promise<StagedDeployment> {
    const deployment = this.deployments.get(improvementId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${improvementId}`);
    }

    // バックアップからの復元を試みる
    try {
      await this.backupManager.restore(`improvement_${improvementId}`);
      deployment.status = 'rolled_back';

      await this.discord.sendWarning({
        title: '改善がロールバックされました',
        description: `改善ID: ${improvementId}`,
      });

      logger.warn('Deployment rolled back', { improvementId });
    } catch (error) {
      logger.error('Rollback failed', { improvementId, error });
      throw error;
    }

    return deployment;
  }

  /**
   * 事後検証を実行
   */
  async performPostVerification(
    improvement: ProcessImprovement,
    expectedOutcomes: { description: string; expected: string }[],
    actualChecker: (expected: string) => Promise<string>
  ): Promise<PostVerificationReport> {
    logger.info('Performing post-verification', { improvementId: improvement.id });

    const appliedAt = improvement.appliedAt;
    const daysAfter = appliedAt
      ? Math.floor((Date.now() - appliedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const outcomes: ExpectedOutcome[] = [];
    let metCount = 0;

    for (const eo of expectedOutcomes) {
      try {
        const actual = await actualChecker(eo.expected);
        const met = this.evaluateOutcome(eo.expected, actual);
        outcomes.push({
          description: eo.description,
          expected: eo.expected,
          actual,
          met,
        });
        if (met) metCount++;
      } catch (error) {
        outcomes.push({
          description: eo.description,
          expected: eo.expected,
          actual: `エラー: ${error instanceof Error ? error.message : String(error)}`,
          met: false,
        });
      }
    }

    // 効果スコアを計算
    const effectivenessScore = outcomes.length > 0
      ? Math.round((metCount / outcomes.length) * 100)
      : 0;

    // サイドエフェクトを検出
    const sideEffects = await this.detectSideEffects(improvement);

    // 推奨事項を生成
    const recommendations = this.generateVerificationRecommendations(
      effectivenessScore,
      outcomes,
      sideEffects
    );

    const report: PostVerificationReport = {
      improvementId: improvement.id,
      verifiedAt: new Date(),
      daysAfterImplementation: daysAfter,
      expectedOutcomes: outcomes,
      overallSuccess: effectivenessScore >= 70,
      effectivenessScore,
      sideEffects,
      recommendations,
    };

    this.verificationReports.push(report);

    // 結果を保存
    await this.saveVerificationReport(report);

    logger.info('Post-verification completed', {
      improvementId: improvement.id,
      effectivenessScore,
      overallSuccess: report.overallSuccess,
    });

    return report;
  }

  /**
   * デプロイメント状態を取得
   */
  getDeployment(improvementId: string): StagedDeployment | undefined {
    return this.deployments.get(improvementId);
  }

  /**
   * 検証レポート履歴を取得
   */
  getVerificationReports(improvementId?: string): PostVerificationReport[] {
    if (improvementId) {
      return this.verificationReports.filter(r => r.improvementId === improvementId);
    }
    return [...this.verificationReports];
  }

  /**
   * 検証が必要な改善を取得
   */
  getImprovementsNeedingVerification(
    improvements: ProcessImprovement[],
    minDaysAfterImplementation: number = 7
  ): ProcessImprovement[] {
    const now = Date.now();
    const verified = new Set(this.verificationReports.map(r => r.improvementId));

    return improvements.filter(imp => {
      if (imp.status !== 'implemented' || !imp.appliedAt) {
        return false;
      }

      if (verified.has(imp.id)) {
        return false;
      }

      const daysSince = Math.floor(
        (now - imp.appliedAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      return daysSince >= minDaysAfterImplementation;
    });
  }

  // Private methods

  private generateRollbackPlan(
    improvement: ProcessImprovement,
    changes: SimulatedChange[]
  ): string {
    const steps: string[] = [
      `1. バックアップポイント improvement_${improvement.id} から復元`,
    ];

    for (const change of changes) {
      if (change.reversible) {
        steps.push(`2. ${change.target}の変更を元に戻す`);
      }
    }

    steps.push('3. システムの正常動作を確認');
    steps.push('4. ロールバック完了をログに記録');

    return steps.join('\n');
  }

  private evaluateOutcome(expected: string, actual: string): boolean {
    // 簡易的な評価ロジック
    const expectedLower = expected.toLowerCase();
    const actualLower = actual.toLowerCase();

    // 数値比較
    const expectedNum = parseFloat(expected);
    const actualNum = parseFloat(actual);
    if (!isNaN(expectedNum) && !isNaN(actualNum)) {
      // 20%以内の誤差を許容
      return Math.abs(actualNum - expectedNum) <= expectedNum * 0.2;
    }

    // キーワードマッチ
    if (expectedLower.includes('改善') || expectedLower.includes('向上')) {
      return actualLower.includes('改善') || actualLower.includes('向上') ||
        actualLower.includes('成功') || actualLower.includes('達成');
    }

    if (expectedLower.includes('削減') || expectedLower.includes('減少')) {
      return actualLower.includes('削減') || actualLower.includes('減少') ||
        actualLower.includes('成功') || actualLower.includes('達成');
    }

    // デフォルト: 含まれているかどうか
    return actualLower.includes(expectedLower) || expectedLower.includes(actualLower);
  }

  private async detectSideEffects(improvement: ProcessImprovement): Promise<string[]> {
    const sideEffects: string[] = [];

    // 実装後に発生したエラーをチェック（簡略化）
    const errorFile = path.join(WORKSPACE_PATH, 'ERROR_HISTORY.md');
    try {
      const content = await fs.promises.readFile(errorFile, 'utf-8');

      if (improvement.appliedAt) {
        const appliedDate = improvement.appliedAt.toISOString().slice(0, 10);
        const afterApplied = content.split(appliedDate)[1];

        if (afterApplied) {
          const errorCount = (afterApplied.match(/^## /gm) || []).length;
          if (errorCount > 5) {
            sideEffects.push(`改善後に${errorCount}件のエラーが発生`);
          }
        }
      }
    } catch {
      // ファイルがない場合は無視
    }

    return sideEffects;
  }

  private generateVerificationRecommendations(
    score: number,
    outcomes: ExpectedOutcome[],
    sideEffects: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (score < 50) {
      recommendations.push('改善の効果が低いため、見直しまたはロールバックを検討');
    } else if (score < 70) {
      recommendations.push('改善は部分的に効果あり。追加の調整を検討');
    } else {
      recommendations.push('改善は効果的。この手法を他の改善にも適用を検討');
    }

    const failedOutcomes = outcomes.filter(o => !o.met);
    if (failedOutcomes.length > 0) {
      recommendations.push(`${failedOutcomes.length}件の期待結果が未達成。原因を調査`);
    }

    if (sideEffects.length > 0) {
      recommendations.push('副作用が検出されました。影響を調査してください');
    }

    return recommendations;
  }

  private async saveDryRunResult(result: ImprovementDryRunResult): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'validation', 'dry-runs');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${result.improvementId}-${result.timestamp.toISOString().replace(/[:.]/g, '-')}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(result, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save dry run result', { error });
    }
  }

  private async saveVerificationReport(report: PostVerificationReport): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'validation', 'verifications');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${report.improvementId}-${report.verifiedAt.toISOString().replace(/[:.]/g, '-')}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(report, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save verification report', { error });
    }
  }
}

// シングルトンインスタンス
let validatorInstance: ImprovementValidator | null = null;

export function getImprovementValidator(): ImprovementValidator {
  if (!validatorInstance) {
    validatorInstance = new ImprovementValidator();
  }
  return validatorInstance;
}
