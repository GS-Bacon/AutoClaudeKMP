/**
 * 戦略プランナー
 *
 * 戦略実行前の事前検討フェーズを担当
 * - 妥当性検証
 * - リスク分析（What-If シナリオ）
 * - 代替案の検討
 * - 実行条件の定義
 */

import { getLogger, StrategyPlan, ValidityCheck, PlanRiskAnalysis, RiskScenario, AlternativeApproach, ExecutionConditions, RiskLevel } from '@auto-claude/core';
import { getDiscordNotifier, getApprovalGate } from '@auto-claude/notification';
import { Strategy } from './strategy-manager.js';
import { ExecutionPlan } from './executors/base-executor.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('StrategyPlanner');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface PlanningContext {
  strategy: Strategy;
  executionPlan?: ExecutionPlan;
  marketConditions?: Record<string, unknown>;
  historicalPerformance?: {
    successRate: number;
    averageRevenue: number;
    averageCost: number;
    commonFailures: string[];
  };
}

export interface PlanningResult {
  plan: StrategyPlan;
  approved: boolean;
  approvalRequired: boolean;
  blockers: string[];
  readyForExecution: boolean;
}

export class StrategyPlanner {
  private readonly discord = getDiscordNotifier();
  private readonly approvalGate = getApprovalGate();
  private readonly plans = new Map<string, StrategyPlan>();

  /**
   * 戦略の事前検討を実行
   */
  async planStrategy(context: PlanningContext): Promise<PlanningResult> {
    const { strategy } = context;

    logger.info('Starting strategy planning', {
      strategyId: strategy.id,
      strategyName: strategy.name,
    });

    // 1. 妥当性検証
    const validityCheck = await this.performValidityCheck(context);

    // 2. リスク分析
    const riskAnalysis = await this.performRiskAnalysis(context);

    // 3. 代替案の検討
    const alternatives = await this.evaluateAlternatives(context);

    // 4. 実行条件の定義
    const executionConditions = this.defineExecutionConditions(context, riskAnalysis);

    // 最適なアプローチを選択
    const selectedApproach = this.selectBestApproach(alternatives);

    // 計画を作成
    const plan: StrategyPlan = {
      id: `plan-${strategy.id}-${Date.now()}`,
      strategyId: strategy.id,
      createdAt: new Date(),
      validityCheck,
      riskAnalysis,
      alternatives,
      selectedApproach,
      executionConditions,
      approved: false,
    };

    // 計画を保存
    this.plans.set(strategy.id, plan);
    await this.savePlan(plan);

    // 承認が必要かどうかを判定
    const approvalRequired = this.isApprovalRequired(plan);
    const blockers = this.identifyBlockers(plan);

    logger.info('Strategy planning completed', {
      strategyId: strategy.id,
      planId: plan.id,
      approvalRequired,
      blockerCount: blockers.length,
    });

    return {
      plan,
      approved: !approvalRequired,
      approvalRequired,
      blockers,
      readyForExecution: blockers.length === 0 && (!approvalRequired || plan.approved),
    };
  }

  /**
   * 計画の承認を要求
   */
  async requestPlanApproval(strategyId: string): Promise<boolean> {
    const plan = this.plans.get(strategyId);
    if (!plan) {
      throw new Error(`Plan not found for strategy: ${strategyId}`);
    }

    const approved = await this.approvalGate.requestApproval({
      type: 'strategy',
      title: `戦略計画の承認: ${strategyId}`,
      description: this.formatPlanForApproval(plan),
      riskLevel: plan.riskAnalysis.overallRisk === 'high'
        ? RiskLevel.HIGH
        : plan.riskAnalysis.overallRisk === 'medium'
        ? RiskLevel.MEDIUM
        : RiskLevel.LOW,
    });

    if (approved) {
      plan.approved = true;
      plan.approvedAt = new Date();
      await this.savePlan(plan);
    }

    return approved;
  }

  /**
   * 妥当性検証
   */
  private async performValidityCheck(context: PlanningContext): Promise<ValidityCheck> {
    const { strategy, executionPlan } = context;
    const issues: string[] = [];
    const assumptions: string[] = [];
    const dependencies: string[] = [];

    // 戦略設定の検証
    if (!strategy.config || Object.keys(strategy.config).length === 0) {
      issues.push('戦略の詳細設定がありません');
    }

    if (strategy.expectedRevenue === 0) {
      issues.push('期待収益が設定されていません');
    }

    if (strategy.expectedCost > strategy.expectedRevenue) {
      issues.push('期待コストが期待収益を上回っています');
    }

    // 実行計画の検証
    if (executionPlan) {
      if (executionPlan.steps.length === 0) {
        issues.push('実行ステップが定義されていません');
      }

      // 依存関係の抽出
      for (const step of executionPlan.steps) {
        if (step.action.includes('API') || step.action.includes('外部')) {
          dependencies.push(`外部サービス: ${step.name}`);
        }
      }
    }

    // 前提条件の抽出
    assumptions.push('市場状況が大きく変化しない');
    assumptions.push('必要なツール・リソースが利用可能');

    if (strategy.type === 'affiliate') {
      assumptions.push('アフィリエイトプログラムの条件が維持される');
    }

    if (strategy.type === 'freelance') {
      assumptions.push('クライアントの需要が存在する');
      dependencies.push('フリーランスプラットフォーム');
    }

    if (strategy.type === 'digital_product') {
      assumptions.push('製品への需要が存在する');
      dependencies.push('販売プラットフォーム');
    }

    return {
      isValid: issues.length === 0,
      issues,
      assumptions,
      dependencies,
    };
  }

  /**
   * リスク分析（What-If シナリオ）
   */
  private async performRiskAnalysis(context: PlanningContext): Promise<PlanRiskAnalysis> {
    const { strategy, historicalPerformance } = context;
    const scenarios: RiskScenario[] = [];
    const mitigationStrategies: string[] = [];

    // 一般的なリスクシナリオ
    scenarios.push({
      description: '外部サービスが一時的に利用不可になる',
      probability: 'medium',
      impact: 'medium',
      mitigation: 'リトライ機構とフォールバック処理を実装',
    });

    scenarios.push({
      description: '期待した収益が得られない',
      probability: historicalPerformance && historicalPerformance.successRate < 0.5
        ? 'high'
        : 'medium',
      impact: 'medium',
      mitigation: '損失上限を設定し、早期撤退基準を定義',
    });

    scenarios.push({
      description: 'コストが予算を超過する',
      probability: 'low',
      impact: 'medium',
      mitigation: 'コスト監視と警告閾値を設定',
    });

    // 戦略タイプ別のリスク
    if (strategy.type === 'affiliate') {
      scenarios.push({
        description: 'アフィリエイトプログラムの条件が変更される',
        probability: 'low',
        impact: 'high',
        mitigation: '複数のプログラムに分散投資',
      });
    }

    if (strategy.type === 'freelance') {
      scenarios.push({
        description: 'クライアントからのキャンセルや支払い遅延',
        probability: 'medium',
        impact: 'high',
        mitigation: '前払い条件の設定、契約書の整備',
      });
    }

    if (strategy.type === 'digital_product') {
      scenarios.push({
        description: '製品の需要が想定を下回る',
        probability: 'medium',
        impact: 'medium',
        mitigation: '事前の市場調査、MVP での検証',
      });
    }

    // リスクレベル別のシナリオ
    if (strategy.riskLevel >= RiskLevel.HIGH) {
      scenarios.push({
        description: 'システム全体に影響を与える障害が発生',
        probability: 'low',
        impact: 'high',
        mitigation: 'サンドボックス環境でのテスト、ロールバック計画の策定',
      });
    }

    // 緩和策の集約
    for (const scenario of scenarios) {
      if (!mitigationStrategies.includes(scenario.mitigation)) {
        mitigationStrategies.push(scenario.mitigation);
      }
    }

    // 全体リスクレベルの決定
    const hasHighImpact = scenarios.some(s => s.impact === 'high');
    const hasHighProbability = scenarios.some(s => s.probability === 'high');

    let overallRisk: 'low' | 'medium' | 'high' = 'low';
    if (hasHighImpact && hasHighProbability) {
      overallRisk = 'high';
    } else if (hasHighImpact || hasHighProbability) {
      overallRisk = 'medium';
    }

    return {
      scenarios,
      overallRisk,
      mitigationStrategies,
    };
  }

  /**
   * 代替案の検討
   */
  private async evaluateAlternatives(context: PlanningContext): Promise<AlternativeApproach[]> {
    const { strategy } = context;
    const alternatives: AlternativeApproach[] = [];

    // 標準アプローチ
    alternatives.push({
      name: '標準実行',
      description: '計画通りに戦略を実行',
      pros: ['シンプル', '予測可能'],
      cons: ['リスク対応が限定的'],
      estimatedEffort: 'low',
      recommended: true,
    });

    // 段階的アプローチ
    alternatives.push({
      name: '段階的展開',
      description: '小規模テストから始めて徐々に拡大',
      pros: ['リスクを最小化', '途中での調整が可能'],
      cons: ['時間がかかる', '初期収益が少ない'],
      estimatedEffort: 'medium',
      recommended: strategy.riskLevel >= RiskLevel.MEDIUM,
    });

    // 並行実験アプローチ
    if (strategy.type === 'affiliate' || strategy.type === 'digital_product') {
      alternatives.push({
        name: 'A/Bテスト',
        description: '複数のバリエーションを同時にテスト',
        pros: ['データに基づく最適化', '学習効率が高い'],
        cons: ['複雑性が増す', 'リソース消費が多い'],
        estimatedEffort: 'high',
        recommended: false,
      });
    }

    // 保守的アプローチ
    alternatives.push({
      name: '最小限実行',
      description: '最も安全な部分のみ実行',
      pros: ['リスク最小', '失敗時の影響が限定的'],
      cons: ['潜在的な収益を逃す可能性'],
      estimatedEffort: 'low',
      recommended: strategy.riskLevel >= RiskLevel.HIGH,
    });

    return alternatives;
  }

  /**
   * 最適なアプローチを選択
   */
  private selectBestApproach(alternatives: AlternativeApproach[]): string {
    // 推奨されているアプローチを優先
    const recommended = alternatives.find(a => a.recommended);
    if (recommended) {
      return recommended.name;
    }

    // 労力が最小のアプローチを選択
    const byEffort = alternatives.sort((a, b) => {
      const effortOrder = { low: 1, medium: 2, high: 3 };
      return effortOrder[a.estimatedEffort] - effortOrder[b.estimatedEffort];
    });

    return byEffort[0]?.name ?? '標準実行';
  }

  /**
   * 実行条件を定義
   */
  private defineExecutionConditions(
    context: PlanningContext,
    riskAnalysis: PlanRiskAnalysis
  ): ExecutionConditions {
    const { strategy } = context;

    // 成功基準
    const successCriteria: string[] = [
      '全ての必須ステップが正常に完了する',
      `収益が期待値の80%以上（¥${Math.floor(strategy.expectedRevenue * 0.8)}以上）`,
      `コストが予算の120%以下（¥${Math.floor(strategy.expectedCost * 1.2)}以下）`,
    ];

    // 中止基準
    const abortCriteria: string[] = [
      '連続3回のステップ失敗',
      `コストが予算の150%を超過（¥${Math.floor(strategy.expectedCost * 1.5)}超過）`,
      '致命的なエラーの発生',
    ];

    if (riskAnalysis.overallRisk === 'high') {
      abortCriteria.push('予期しない外部サービスの長時間停止');
    }

    // 必要リソース
    const requiredResources: string[] = [
      'ClaudeCode CLI',
      'インターネット接続',
    ];

    if (strategy.type === 'affiliate') {
      requiredResources.push('アフィリエイトアカウント');
    }

    if (strategy.type === 'freelance') {
      requiredResources.push('フリーランスプラットフォームアカウント');
    }

    if (strategy.type === 'digital_product') {
      requiredResources.push('販売プラットフォームアカウント');
    }

    // タイムアウト設定
    let timeoutMinutes = 60; // デフォルト1時間
    if (strategy.riskLevel >= RiskLevel.HIGH) {
      timeoutMinutes = 120; // 高リスクは2時間
    }

    return {
      successCriteria,
      abortCriteria,
      timeoutMinutes,
      requiredResources,
    };
  }

  /**
   * 承認が必要かどうかを判定
   */
  private isApprovalRequired(plan: StrategyPlan): boolean {
    // 妥当性に問題がある場合
    if (!plan.validityCheck.isValid) {
      return true;
    }

    // 高リスクの場合
    if (plan.riskAnalysis.overallRisk === 'high') {
      return true;
    }

    // 依存関係が多い場合
    if (plan.validityCheck.dependencies.length >= 3) {
      return true;
    }

    return false;
  }

  /**
   * ブロッカーを特定
   */
  private identifyBlockers(plan: StrategyPlan): string[] {
    const blockers: string[] = [];

    // 妥当性の問題
    for (const issue of plan.validityCheck.issues) {
      blockers.push(`妥当性: ${issue}`);
    }

    // 高影響度のリスクシナリオ
    for (const scenario of plan.riskAnalysis.scenarios) {
      if (scenario.impact === 'high' && scenario.probability !== 'low') {
        blockers.push(`リスク: ${scenario.description}`);
      }
    }

    return blockers;
  }

  /**
   * 計画を承認用にフォーマット
   */
  private formatPlanForApproval(plan: StrategyPlan): string {
    const lines: string[] = [
      `**計画ID:** ${plan.id}`,
      '',
      '**妥当性チェック:**',
      `- 有効: ${plan.validityCheck.isValid ? 'はい' : 'いいえ'}`,
      `- 問題点: ${plan.validityCheck.issues.length > 0 ? plan.validityCheck.issues.join(', ') : 'なし'}`,
      `- 前提条件: ${plan.validityCheck.assumptions.join(', ')}`,
      '',
      '**リスク分析:**',
      `- 全体リスク: ${plan.riskAnalysis.overallRisk}`,
      `- シナリオ数: ${plan.riskAnalysis.scenarios.length}`,
      '',
      '**選択アプローチ:** ' + plan.selectedApproach,
      '',
      '**成功基準:**',
      ...plan.executionConditions.successCriteria.map(c => `- ${c}`),
      '',
      '**中止基準:**',
      ...plan.executionConditions.abortCriteria.map(c => `- ${c}`),
    ];

    return lines.join('\n');
  }

  /**
   * 計画を保存
   */
  private async savePlan(plan: StrategyPlan): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'plans');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${plan.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(plan, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save plan', { error, planId: plan.id });
    }
  }

  /**
   * 保存された計画を読み込む
   */
  async loadPlan(strategyId: string): Promise<StrategyPlan | null> {
    // メモリにあれば返す
    const cached = this.plans.get(strategyId);
    if (cached) {
      return cached;
    }

    // ファイルから読み込む
    const dir = path.join(WORKSPACE_PATH, 'plans');
    try {
      const files = await fs.promises.readdir(dir);
      const planFile = files.find(f => f.includes(strategyId));
      if (planFile) {
        const content = await fs.promises.readFile(
          path.join(dir, planFile),
          'utf-8'
        );
        const plan = JSON.parse(content) as StrategyPlan;
        this.plans.set(strategyId, plan);
        return plan;
      }
    } catch (error) {
      logger.debug('No saved plan found', { strategyId });
    }

    return null;
  }

  /**
   * 計画を取得
   */
  getPlan(strategyId: string): StrategyPlan | undefined {
    return this.plans.get(strategyId);
  }
}

// シングルトンインスタンス
let plannerInstance: StrategyPlanner | null = null;

export function getStrategyPlanner(): StrategyPlanner {
  if (!plannerInstance) {
    plannerInstance = new StrategyPlanner();
  }
  return plannerInstance;
}
