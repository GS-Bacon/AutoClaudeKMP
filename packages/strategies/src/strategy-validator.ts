/**
 * 戦略バリデーター
 *
 * 戦略のテスト実行（ドライラン）、段階的展開、事後検証を担当
 */

import { getLogger, RiskLevel } from '@auto-claude/core';
import { getDiscordNotifier, getApprovalGate } from '@auto-claude/notification';
import { Strategy, StrategyType } from './strategy-manager.js';
import { ExecutionPlan, ExecutionResult, StepResult } from './executors/base-executor.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('StrategyValidator');

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestions: string[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  severity: 'error' | 'critical';
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
}

export interface DryRunResult {
  strategyId: string;
  success: boolean;
  simulatedSteps: SimulatedStep[];
  potentialIssues: string[];
  estimatedOutcome: {
    revenue: number;
    cost: number;
    risk: RiskLevel;
  };
  recommendations: string[];
  timestamp: Date;
}

export interface SimulatedStep {
  stepId: string;
  stepName: string;
  wouldExecute: boolean;
  mockResult: 'success' | 'failure' | 'unknown';
  potentialRisks: string[];
  dependencies: string[];
  estimatedDuration: string;
}

export interface StagedRollout {
  strategyId: string;
  stages: RolloutStage[];
  currentStage: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  startedAt?: Date;
  completedAt?: Date;
}

export interface RolloutStage {
  id: number;
  name: string;
  scope: 'test' | 'limited' | 'full';
  percentage: number;
  successThreshold: number;
  status: 'pending' | 'running' | 'success' | 'failure';
  results?: ExecutionResult;
}

export interface PostExecutionVerification {
  strategyId: string;
  executionId: string;
  verifiedAt: Date;
  expectedVsActual: {
    metric: string;
    expected: number | string;
    actual: number | string;
    withinTolerance: boolean;
  }[];
  overallSuccess: boolean;
  findings: string[];
  lessonsLearned: string[];
  suggestedImprovements: string[];
}

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export class StrategyValidator {
  private readonly discord = getDiscordNotifier();
  private readonly approvalGate = getApprovalGate();
  private readonly stagedRollouts = new Map<string, StagedRollout>();
  private readonly verificationHistory: PostExecutionVerification[] = [];

  /**
   * 戦略の基本検証
   */
  validateStrategy(strategy: Strategy): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    // 必須フィールドの検証
    if (!strategy.id) {
      errors.push({
        code: 'MISSING_ID',
        message: '戦略IDが設定されていません',
        field: 'id',
        severity: 'critical',
      });
    }

    if (!strategy.name || strategy.name.trim().length === 0) {
      errors.push({
        code: 'MISSING_NAME',
        message: '戦略名が設定されていません',
        field: 'name',
        severity: 'error',
      });
    }

    if (!strategy.type) {
      errors.push({
        code: 'MISSING_TYPE',
        message: '戦略タイプが設定されていません',
        field: 'type',
        severity: 'critical',
      });
    }

    // 財務設定の検証
    if (strategy.expectedRevenue < 0) {
      errors.push({
        code: 'INVALID_REVENUE',
        message: '期待収益が負の値です',
        field: 'expectedRevenue',
        severity: 'error',
      });
    }

    if (strategy.expectedCost < 0) {
      errors.push({
        code: 'INVALID_COST',
        message: '期待コストが負の値です',
        field: 'expectedCost',
        severity: 'error',
      });
    }

    if (strategy.expectedRevenue > 0 && strategy.expectedCost > strategy.expectedRevenue) {
      warnings.push({
        code: 'NEGATIVE_ROI',
        message: '期待コストが期待収益を上回っています（ROIがマイナス）',
        field: 'expectedCost',
      });
    }

    // リスク設定の検証
    if (strategy.riskLevel === RiskLevel.CRITICAL) {
      warnings.push({
        code: 'CRITICAL_RISK',
        message: 'クリティカルリスクの戦略です。承認が必要です',
        field: 'riskLevel',
      });
    }

    // 設定の検証
    if (!strategy.config) {
      warnings.push({
        code: 'MISSING_CONFIG',
        message: '詳細設定がありません。デフォルト値が使用されます',
        field: 'config',
      });
    }

    // 提案の生成
    if (strategy.expectedRevenue === 0) {
      suggestions.push('期待収益が0です。収益目標を設定することを推奨します');
    }

    if (!strategy.description || strategy.description.length < 20) {
      suggestions.push('より詳細な説明を追加すると、戦略の目的が明確になります');
    }

    const isValid = errors.length === 0;

    logger.info('Strategy validation completed', {
      strategyId: strategy.id,
      isValid,
      errorCount: errors.length,
      warningCount: warnings.length,
    });

    return {
      isValid,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * 実行計画の検証
   */
  validateExecutionPlan(plan: ExecutionPlan): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];

    // ステップの検証
    if (!plan.steps || plan.steps.length === 0) {
      errors.push({
        code: 'NO_STEPS',
        message: '実行ステップが定義されていません',
        severity: 'critical',
      });
    }

    // 各ステップの検証
    for (const step of plan.steps) {
      if (!step.action || step.action.trim().length === 0) {
        errors.push({
          code: 'EMPTY_ACTION',
          message: `ステップ ${step.id} のアクションが空です`,
          field: `steps.${step.id}.action`,
          severity: 'error',
        });
      }

      if (step.riskLevel >= RiskLevel.HIGH && !step.requiresApproval) {
        warnings.push({
          code: 'HIGH_RISK_NO_APPROVAL',
          message: `ステップ ${step.id} は高リスクですが承認不要になっています`,
          field: `steps.${step.id}.requiresApproval`,
        });
      }
    }

    // リスクレベルの一貫性チェック
    const maxStepRisk = Math.max(...plan.steps.map(s => s.riskLevel));
    if (maxStepRisk > plan.totalRiskLevel) {
      warnings.push({
        code: 'RISK_INCONSISTENCY',
        message: '個別ステップのリスクが全体リスクレベルを超えています',
      });
    }

    // コスト/収益の妥当性チェック
    if (plan.estimatedCost > plan.estimatedRevenue * 2) {
      warnings.push({
        code: 'HIGH_COST_RATIO',
        message: 'コストが収益の2倍を超えています',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * ドライラン（シミュレーション実行）
   */
  async performDryRun(
    strategy: Strategy,
    plan: ExecutionPlan
  ): Promise<DryRunResult> {
    logger.info('Starting dry run', { strategyId: strategy.id });

    const simulatedSteps: SimulatedStep[] = [];
    const potentialIssues: string[] = [];
    const recommendations: string[] = [];

    // 各ステップをシミュレート
    for (const step of plan.steps) {
      const simulated = this.simulateStep(step, strategy);
      simulatedSteps.push(simulated);

      if (simulated.potentialRisks.length > 0) {
        potentialIssues.push(...simulated.potentialRisks.map(
          r => `[${step.name}] ${r}`
        ));
      }
    }

    // 依存関係のチェック
    const dependencyIssues = this.checkDependencies(simulatedSteps);
    potentialIssues.push(...dependencyIssues);

    // 推奨事項の生成
    if (simulatedSteps.some(s => s.mockResult === 'unknown')) {
      recommendations.push('一部のステップで結果を予測できません。小規模テストを推奨します');
    }

    if (plan.totalRiskLevel >= RiskLevel.HIGH) {
      recommendations.push('高リスク戦略です。段階的なロールアウトを検討してください');
    }

    const success = !potentialIssues.some(i => i.includes('critical'));

    const result: DryRunResult = {
      strategyId: strategy.id,
      success,
      simulatedSteps,
      potentialIssues,
      estimatedOutcome: {
        revenue: plan.estimatedRevenue,
        cost: plan.estimatedCost,
        risk: plan.totalRiskLevel,
      },
      recommendations,
      timestamp: new Date(),
    };

    // 結果を保存
    await this.saveDryRunResult(result);

    logger.info('Dry run completed', {
      strategyId: strategy.id,
      success,
      issueCount: potentialIssues.length,
    });

    return result;
  }

  /**
   * 段階的ロールアウトを初期化
   */
  initializeStagedRollout(
    strategy: Strategy,
    options: {
      stages?: number;
      percentages?: number[];
      successThresholds?: number[];
    } = {}
  ): StagedRollout {
    const stages: RolloutStage[] = [];
    const numStages = options.stages ?? 3;
    const percentages = options.percentages ?? [10, 50, 100];
    const thresholds = options.successThresholds ?? [0.9, 0.85, 0.8];

    for (let i = 0; i < numStages; i++) {
      stages.push({
        id: i + 1,
        name: i === 0 ? 'テスト' : i === numStages - 1 ? '本番展開' : `段階${i + 1}`,
        scope: i === 0 ? 'test' : i === numStages - 1 ? 'full' : 'limited',
        percentage: percentages[i] ?? (100 * (i + 1)) / numStages,
        successThreshold: thresholds[i] ?? 0.8,
        status: 'pending',
      });
    }

    const rollout: StagedRollout = {
      strategyId: strategy.id,
      stages,
      currentStage: 0,
      status: 'pending',
    };

    this.stagedRollouts.set(strategy.id, rollout);

    logger.info('Staged rollout initialized', {
      strategyId: strategy.id,
      stageCount: stages.length,
    });

    return rollout;
  }

  /**
   * 次のロールアウトステージを実行
   */
  async advanceRolloutStage(
    strategyId: string,
    executeStage: () => Promise<ExecutionResult>
  ): Promise<{ advanced: boolean; rollout: StagedRollout; message: string }> {
    const rollout = this.stagedRollouts.get(strategyId);
    if (!rollout) {
      throw new Error(`Rollout not found for strategy: ${strategyId}`);
    }

    if (rollout.status === 'completed' || rollout.status === 'failed') {
      return {
        advanced: false,
        rollout,
        message: `ロールアウトは既に${rollout.status}です`,
      };
    }

    const currentStage = rollout.stages[rollout.currentStage];
    if (!currentStage) {
      rollout.status = 'completed';
      rollout.completedAt = new Date();
      return {
        advanced: false,
        rollout,
        message: '全ステージが完了しました',
      };
    }

    // ステージを開始
    rollout.status = 'in_progress';
    rollout.startedAt = rollout.startedAt ?? new Date();
    currentStage.status = 'running';

    logger.info('Executing rollout stage', {
      strategyId,
      stageId: currentStage.id,
      stageName: currentStage.name,
      percentage: currentStage.percentage,
    });

    try {
      const result = await executeStage();
      currentStage.results = result;

      // 成功率を計算
      const successRate = result.success ? 1 : 0; // 簡略化版。実際は複数実行の平均を取る

      if (successRate >= currentStage.successThreshold) {
        currentStage.status = 'success';
        rollout.currentStage++;

        if (rollout.currentStage >= rollout.stages.length) {
          rollout.status = 'completed';
          rollout.completedAt = new Date();
        }

        return {
          advanced: true,
          rollout,
          message: `ステージ ${currentStage.name} が成功しました（成功率: ${(successRate * 100).toFixed(1)}%）`,
        };
      } else {
        currentStage.status = 'failure';
        rollout.status = 'failed';

        return {
          advanced: false,
          rollout,
          message: `ステージ ${currentStage.name} が失敗しました（成功率: ${(successRate * 100).toFixed(1)}%、閾値: ${(currentStage.successThreshold * 100).toFixed(1)}%）`,
        };
      }
    } catch (error) {
      currentStage.status = 'failure';
      rollout.status = 'failed';

      throw error;
    }
  }

  /**
   * ロールアウトをロールバック
   */
  rollbackRollout(strategyId: string): StagedRollout {
    const rollout = this.stagedRollouts.get(strategyId);
    if (!rollout) {
      throw new Error(`Rollout not found for strategy: ${strategyId}`);
    }

    rollout.status = 'rolled_back';
    logger.warn('Rollout rolled back', { strategyId });

    return rollout;
  }

  /**
   * 実行後の検証
   */
  async verifyExecution(
    strategy: Strategy,
    result: ExecutionResult,
    expectations: {
      metric: string;
      expected: number | string;
      tolerance?: number;
    }[]
  ): Promise<PostExecutionVerification> {
    logger.info('Verifying execution', {
      strategyId: strategy.id,
      success: result.success,
    });

    const expectedVsActual: PostExecutionVerification['expectedVsActual'] = [];
    const findings: string[] = [];
    const lessonsLearned: string[] = [];
    const suggestedImprovements: string[] = [];

    // 基本メトリクスの検証
    expectedVsActual.push({
      metric: 'success',
      expected: true,
      actual: result.success,
      withinTolerance: result.success === true,
    });

    expectedVsActual.push({
      metric: 'revenue',
      expected: strategy.expectedRevenue,
      actual: result.totalRevenue,
      withinTolerance: Math.abs(result.totalRevenue - strategy.expectedRevenue) <= strategy.expectedRevenue * 0.2,
    });

    expectedVsActual.push({
      metric: 'cost',
      expected: strategy.expectedCost,
      actual: result.totalCost,
      withinTolerance: result.totalCost <= strategy.expectedCost * 1.2,
    });

    // カスタム期待値の検証
    for (const exp of expectations) {
      const tolerance = exp.tolerance ?? 0.1;
      let actual: number | string = 'N/A';
      let withinTolerance = false;

      // 結果から実際の値を取得（簡略化）
      if (exp.metric === 'stepSuccessRate') {
        const successCount = result.stepResults.filter(r => r.success).length;
        actual = result.stepResults.length > 0
          ? successCount / result.stepResults.length
          : 0;
        if (typeof exp.expected === 'number') {
          withinTolerance = Math.abs((actual as number) - exp.expected) <= tolerance;
        }
      }

      expectedVsActual.push({
        metric: exp.metric,
        expected: exp.expected,
        actual,
        withinTolerance,
      });
    }

    // 分析結果の生成
    const failedMetrics = expectedVsActual.filter(e => !e.withinTolerance);
    if (failedMetrics.length > 0) {
      findings.push(`${failedMetrics.length}個のメトリクスが期待値から外れています`);

      for (const fm of failedMetrics) {
        if (fm.metric === 'revenue' && typeof fm.actual === 'number' && typeof fm.expected === 'number') {
          if (fm.actual < fm.expected) {
            lessonsLearned.push(`収益が期待値を下回りました（差: ¥${fm.expected - fm.actual}）`);
            suggestedImprovements.push('ターゲット市場や価格設定を見直す');
          }
        }

        if (fm.metric === 'cost' && typeof fm.actual === 'number' && typeof fm.expected === 'number') {
          if (fm.actual > fm.expected) {
            lessonsLearned.push(`コストが予算を超過しました（超過: ¥${fm.actual - fm.expected}）`);
            suggestedImprovements.push('コスト削減のためプロセスを最適化する');
          }
        }
      }
    }

    // 成功した場合の学び
    if (result.success) {
      findings.push('戦略は正常に完了しました');
      const roi = result.totalRevenue > 0
        ? ((result.totalRevenue - result.totalCost) / result.totalCost * 100).toFixed(1)
        : 0;
      lessonsLearned.push(`ROI: ${roi}%`);
    }

    const verification: PostExecutionVerification = {
      strategyId: strategy.id,
      executionId: `exec-${Date.now()}`,
      verifiedAt: new Date(),
      expectedVsActual,
      overallSuccess: failedMetrics.length === 0 && result.success,
      findings,
      lessonsLearned,
      suggestedImprovements,
    };

    this.verificationHistory.push(verification);

    // 結果を保存
    await this.saveVerification(verification);

    logger.info('Verification completed', {
      strategyId: strategy.id,
      overallSuccess: verification.overallSuccess,
      failedMetricCount: failedMetrics.length,
    });

    return verification;
  }

  /**
   * 検証履歴を取得
   */
  getVerificationHistory(strategyId?: string): PostExecutionVerification[] {
    if (strategyId) {
      return this.verificationHistory.filter(v => v.strategyId === strategyId);
    }
    return [...this.verificationHistory];
  }

  /**
   * ロールアウト状態を取得
   */
  getRolloutStatus(strategyId: string): StagedRollout | undefined {
    return this.stagedRollouts.get(strategyId);
  }

  // Private methods

  private simulateStep(
    step: ExecutionPlan['steps'][0],
    strategy: Strategy
  ): SimulatedStep {
    const potentialRisks: string[] = [];
    const dependencies: string[] = [];

    // リスクの評価
    if (step.riskLevel >= RiskLevel.HIGH) {
      potentialRisks.push('高リスクのアクションです');
    }

    if (step.action.toLowerCase().includes('外部api') ||
        step.action.toLowerCase().includes('external')) {
      potentialRisks.push('外部サービス依存があります');
      dependencies.push('外部APIの可用性');
    }

    if (step.action.toLowerCase().includes('支払い') ||
        step.action.toLowerCase().includes('payment')) {
      potentialRisks.push('金銭取引を含みます');
    }

    // 結果の予測
    let mockResult: 'success' | 'failure' | 'unknown' = 'unknown';
    if (step.riskLevel <= RiskLevel.LOW) {
      mockResult = 'success';
    } else if (step.riskLevel >= RiskLevel.CRITICAL) {
      mockResult = 'unknown'; // 高リスクは予測困難
    }

    return {
      stepId: step.id,
      stepName: step.name,
      wouldExecute: true,
      mockResult,
      potentialRisks,
      dependencies,
      estimatedDuration: this.estimateDuration(step),
    };
  }

  private estimateDuration(step: ExecutionPlan['steps'][0]): string {
    // アクション内容から所要時間を推定
    const action = step.action.toLowerCase();

    if (action.includes('分析') || action.includes('analyze')) {
      return '5-10分';
    }
    if (action.includes('作成') || action.includes('create')) {
      return '15-30分';
    }
    if (action.includes('投稿') || action.includes('post')) {
      return '1-5分';
    }

    return '不明';
  }

  private checkDependencies(steps: SimulatedStep[]): string[] {
    const issues: string[] = [];

    // 全ステップの依存関係を収集
    const allDependencies = steps.flatMap(s => s.dependencies);
    const uniqueDeps = [...new Set(allDependencies)];

    if (uniqueDeps.length > 3) {
      issues.push(`多数の外部依存があります（${uniqueDeps.length}件）`);
    }

    return issues;
  }

  private async saveDryRunResult(result: DryRunResult): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'validation', 'dry-runs');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${result.strategyId}-${result.timestamp.toISOString().replace(/[:.]/g, '-')}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(result, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save dry run result', { error });
    }
  }

  private async saveVerification(verification: PostExecutionVerification): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'validation', 'verifications');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${verification.strategyId}-${verification.verifiedAt.toISOString().replace(/[:.]/g, '-')}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(verification, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save verification', { error });
    }
  }
}

// シングルトンインスタンス
let validatorInstance: StrategyValidator | null = null;

export function getStrategyValidator(): StrategyValidator {
  if (!validatorInstance) {
    validatorInstance = new StrategyValidator();
  }
  return validatorInstance;
}
