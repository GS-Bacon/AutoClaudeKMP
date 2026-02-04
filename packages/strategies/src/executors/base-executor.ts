import { RiskLevel, getLogger } from '@auto-claude/core';
import { getApprovalGate, getDiscordNotifier } from '@auto-claude/notification';
import { Strategy, StrategyType } from '../strategy-manager';
import { execSync } from 'child_process';

const logger = getLogger('base-executor');

export interface ExecutionStep {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  action: string;  // ClaudeAIが実行する具体的なアクション
  expectedOutput: string;
  requiresApproval: boolean;
}

export interface ExecutionPlan {
  strategyId: string;
  strategyName: string;
  steps: ExecutionStep[];
  totalRiskLevel: RiskLevel;
  estimatedRevenue: number;
  estimatedCost: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output?: string;
  error?: string;
  revenue: number;
  cost: number;
  artifacts?: Record<string, unknown>;
}

export interface ExecutionResult {
  strategyId: string;
  success: boolean;
  stepResults: StepResult[];
  totalRevenue: number;
  totalCost: number;
  summary: string;
  artifacts?: Record<string, unknown>;
}

export abstract class BaseExecutor {
  protected approvalGate = getApprovalGate();
  protected discord = getDiscordNotifier();
  protected logger = logger;

  abstract readonly supportedTypes: StrategyType[];

  canExecute(strategy: Strategy): boolean {
    return this.supportedTypes.includes(strategy.type);
  }

  async execute(strategy: Strategy): Promise<ExecutionResult> {
    this.logger.info('Starting strategy execution', {
      id: strategy.id,
      name: strategy.name,
      type: strategy.type,
    });

    const stepResults: StepResult[] = [];
    let totalRevenue = 0;
    let totalCost = 0;

    try {
      // 1. ClaudeAIに実行計画を生成させる
      const plan = await this.generateExecutionPlan(strategy);

      this.logger.info('Execution plan generated', {
        strategyId: strategy.id,
        stepCount: plan.steps.length,
        totalRiskLevel: plan.totalRiskLevel,
      });

      // 高リスク計画は承認を求める
      if (plan.totalRiskLevel >= RiskLevel.HIGH) {
        const approved = await this.approvalGate.requestApproval({
          type: 'strategy',
          title: `戦略実行承認: ${strategy.name}`,
          description: `計画内容:\n${plan.steps.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`,
          riskLevel: plan.totalRiskLevel,
        });

        if (!approved) {
          this.logger.info('Strategy execution awaiting approval', {
            strategyId: strategy.id,
          });
          return {
            strategyId: strategy.id,
            success: false,
            stepResults: [],
            totalRevenue: 0,
            totalCost: 0,
            summary: '高リスク計画のため承認待ち',
          };
        }
      }

      // 2. 各ステップを実行
      for (const step of plan.steps) {
        // ステップ単位の承認チェック
        if (step.requiresApproval) {
          const stepApproved = await this.approvalGate.requestApproval({
            type: 'action',
            title: `ステップ承認: ${step.name}`,
            description: step.description,
            riskLevel: step.riskLevel,
          });

          if (!stepApproved) {
            this.logger.info('Step awaiting approval', {
              strategyId: strategy.id,
              stepId: step.id,
            });
            stepResults.push({
              stepId: step.id,
              success: false,
              error: '承認待ち',
              revenue: 0,
              cost: 0,
            });
            continue;
          }
        }

        // ステップ実行
        const result = await this.executeStep(strategy, step);
        stepResults.push(result);
        totalRevenue += result.revenue;
        totalCost += result.cost;

        // 失敗したステップがあれば、戦略設定に応じて中断判定
        if (!result.success && strategy.config.stopOnFailure !== false) {
          this.logger.warn('Step failed, stopping execution', {
            strategyId: strategy.id,
            stepId: step.id,
            error: result.error,
          });
          break;
        }
      }

      const successCount = stepResults.filter((r) => r.success).length;
      const success = successCount > 0 && successCount === stepResults.length;

      const summary = success
        ? `全${stepResults.length}ステップ完了。収益: ¥${totalRevenue}, コスト: ¥${totalCost}`
        : `${successCount}/${stepResults.length}ステップ完了。一部失敗あり。`;

      this.logger.info('Strategy execution completed', {
        strategyId: strategy.id,
        success,
        totalRevenue,
        totalCost,
      });

      return {
        strategyId: strategy.id,
        success,
        stepResults,
        totalRevenue,
        totalCost,
        summary,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Strategy execution failed', {
        strategyId: strategy.id,
        error: errorMessage,
      });

      return {
        strategyId: strategy.id,
        success: false,
        stepResults,
        totalRevenue,
        totalCost,
        summary: `実行エラー: ${errorMessage}`,
      };
    }
  }

  /**
   * 戦略に基づいた実行計画を生成する（ClaudeAIを使用）
   */
  protected async generateExecutionPlan(strategy: Strategy): Promise<ExecutionPlan> {
    const prompt = this.buildPlanPrompt(strategy);

    try {
      const result = execSync(
        `claude --print "${prompt.replace(/"/g, '\\"')}"`,
        {
          encoding: 'utf-8',
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const plan = this.parsePlanResponse(strategy, result);
      return plan;
    } catch (error) {
      this.logger.warn('Failed to generate plan via Claude, using default plan', {
        strategyId: strategy.id,
        error,
      });
      return this.getDefaultPlan(strategy);
    }
  }

  /**
   * 計画生成プロンプトを構築する（サブクラスでオーバーライド可能）
   */
  protected abstract buildPlanPrompt(strategy: Strategy): string;

  /**
   * ClaudeAIの応答から計画をパースする
   */
  protected parsePlanResponse(strategy: Strategy, response: string): ExecutionPlan {
    // JSONブロックを抽出
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('No JSON block found in response');
    }

    const parsed = JSON.parse(jsonMatch[1]);
    const steps: ExecutionStep[] = parsed.steps.map((step: any, index: number) => ({
      id: `step-${index + 1}`,
      name: step.name || `ステップ${index + 1}`,
      description: step.description || '',
      riskLevel: this.parseRiskLevel(step.riskLevel),
      action: step.action || '',
      expectedOutput: step.expectedOutput || '',
      requiresApproval: step.riskLevel === 'HIGH' || step.riskLevel === 'CRITICAL',
    }));

    const maxRisk = Math.max(...steps.map((s) => s.riskLevel));

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      steps,
      totalRiskLevel: maxRisk,
      estimatedRevenue: parsed.estimatedRevenue || strategy.expectedRevenue,
      estimatedCost: parsed.estimatedCost || strategy.expectedCost,
    };
  }

  protected parseRiskLevel(level: string | undefined): RiskLevel {
    switch (level?.toUpperCase()) {
      case 'LOW':
        return RiskLevel.LOW;
      case 'MEDIUM':
        return RiskLevel.MEDIUM;
      case 'HIGH':
        return RiskLevel.HIGH;
      case 'CRITICAL':
        return RiskLevel.CRITICAL;
      default:
        return RiskLevel.LOW;
    }
  }

  /**
   * デフォルトの実行計画を返す（サブクラスで実装）
   */
  protected abstract getDefaultPlan(strategy: Strategy): ExecutionPlan;

  /**
   * 個別のステップを実行する（サブクラスで実装）
   */
  protected abstract executeStep(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult>;
}
