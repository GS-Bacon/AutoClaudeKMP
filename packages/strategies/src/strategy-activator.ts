import { RiskLevel, getLogger } from '@auto-claude/core';
import { getApprovalGate, getDiscordNotifier } from '@auto-claude/notification';
import { Strategy, StrategyStatus, getStrategyManager } from './strategy-manager.js';
import { getStrategyExecutor } from './strategy-executor.js';
import { execSync } from 'child_process';

const logger = getLogger('strategy-activator');

interface StrategyEvaluation {
  shouldActivate: boolean;
  confidence: number;  // 0-100
  reason: string;
  suggestedModifications?: string[];
  estimatedSuccessRate: number;  // 0-100
}

export class StrategyActivator {
  private strategyManager = getStrategyManager();
  private strategyExecutor = getStrategyExecutor();
  private approvalGate = getApprovalGate();
  private discord = getDiscordNotifier();

  constructor() {
    logger.info('StrategyActivator initialized');
  }

  /**
   * DRAFT状態の戦略を評価し、適切なものを自動アクティベート
   */
  async evaluateAndActivateDrafts(): Promise<{
    evaluated: number;
    activated: number;
    pending: number;
  }> {
    const allStrategies = this.strategyManager.getAllStrategies();
    const draftStrategies = allStrategies.filter(
      (s) => s.status === StrategyStatus.DRAFT
    );

    if (draftStrategies.length === 0) {
      logger.info('No draft strategies to evaluate');
      return { evaluated: 0, activated: 0, pending: 0 };
    }

    logger.info('Evaluating draft strategies', { count: draftStrategies.length });

    let activated = 0;
    let pending = 0;

    for (const strategy of draftStrategies) {
      // Executorが対応しているかチェック
      const executor = this.strategyExecutor.findExecutor(strategy);
      if (!executor) {
        logger.debug('No executor for strategy type, skipping', {
          strategyId: strategy.id,
          type: strategy.type,
        });
        continue;
      }

      // AIで戦略を評価
      const evaluation = await this.evaluateStrategy(strategy);

      logger.info('Strategy evaluated', {
        strategyId: strategy.id,
        shouldActivate: evaluation.shouldActivate,
        confidence: evaluation.confidence,
        estimatedSuccessRate: evaluation.estimatedSuccessRate,
      });

      if (!evaluation.shouldActivate) {
        logger.info('Strategy not recommended for activation', {
          strategyId: strategy.id,
          reason: evaluation.reason,
        });
        continue;
      }

      // リスクレベルに基づいて自動/承認を決定
      if (strategy.riskLevel <= RiskLevel.LOW) {
        // LOW以下は自動アクティベート
        const success = await this.strategyManager.activateStrategy(strategy.id);
        if (success) {
          activated++;
          await this.discord.sendSuccess(
            '戦略自動アクティベート',
            `${strategy.name}\n理由: ${evaluation.reason}\n推定成功率: ${evaluation.estimatedSuccessRate}%`
          );
        }
      } else {
        // MEDIUM以上は承認リクエスト（既存の承認フローを使用）
        const approved = await this.approvalGate.requestApproval({
          type: 'strategy',
          title: `戦略アクティベート承認: ${strategy.name}`,
          description: `AI評価結果:\n- 推奨: ${evaluation.shouldActivate ? 'はい' : 'いいえ'}\n- 信頼度: ${evaluation.confidence}%\n- 推定成功率: ${evaluation.estimatedSuccessRate}%\n- 理由: ${evaluation.reason}`,
          riskLevel: strategy.riskLevel,
        });

        if (approved) {
          await this.strategyManager.activateStrategy(strategy.id);
          activated++;
        } else {
          pending++;
        }
      }
    }

    logger.info('Draft evaluation completed', {
      evaluated: draftStrategies.length,
      activated,
      pending,
    });

    return {
      evaluated: draftStrategies.length,
      activated,
      pending,
    };
  }

  /**
   * 個別の戦略をAIで評価
   */
  async evaluateStrategy(strategy: Strategy): Promise<StrategyEvaluation> {
    const prompt = `あなたは収益化戦略の評価者です。以下の戦略を評価してください。

戦略情報:
- 名前: ${strategy.name}
- タイプ: ${strategy.type}
- 説明: ${strategy.description}
- 期待収益: ¥${strategy.expectedRevenue}
- 期待コスト: ¥${strategy.expectedCost}
- リスクレベル: ${this.riskLevelToString(strategy.riskLevel)}
- 設定: ${JSON.stringify(strategy.config, null, 2)}

評価基準:
1. 実現可能性（現実的に実行可能か）
2. 収益性（投資対効果は妥当か）
3. リスク（想定されるリスクは許容範囲か）
4. タイミング（今実行するべきか）

JSON形式で評価結果を出力:
\`\`\`json
{
  "shouldActivate": true/false,
  "confidence": 0-100,
  "reason": "判断理由（1-2文）",
  "estimatedSuccessRate": 0-100,
  "suggestedModifications": ["改善提案1", "改善提案2"]
}
\`\`\``;

    try {
      const result = execSync(
        `claude --print "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
        {
          encoding: 'utf-8',
          timeout: 60000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]) as StrategyEvaluation;
      }
    } catch (error) {
      logger.warn('Failed to evaluate strategy with AI, using heuristics', {
        strategyId: strategy.id,
        error,
      });
    }

    // フォールバック: ヒューリスティクスで判断
    return this.evaluateWithHeuristics(strategy);
  }

  private evaluateWithHeuristics(strategy: Strategy): StrategyEvaluation {
    // 基本的なヒューリスティクス
    const roi = strategy.expectedCost > 0
      ? ((strategy.expectedRevenue - strategy.expectedCost) / strategy.expectedCost) * 100
      : strategy.expectedRevenue > 0 ? 100 : 0;

    const hasExecutor = !!this.strategyExecutor.findExecutor(strategy);
    const isLowRisk = strategy.riskLevel <= RiskLevel.LOW;
    const hasPositiveROI = roi > 0;

    const shouldActivate = hasExecutor && isLowRisk && hasPositiveROI;
    const confidence = hasExecutor ? (isLowRisk ? 70 : 50) : 20;
    const estimatedSuccessRate = hasPositiveROI ? Math.min(roi / 2, 80) : 30;

    return {
      shouldActivate,
      confidence,
      reason: shouldActivate
        ? `実行可能で低リスク、ROI ${roi.toFixed(0)}%`
        : `条件未達成: ${!hasExecutor ? 'Executor無し' : ''} ${!isLowRisk ? '中リスク以上' : ''} ${!hasPositiveROI ? 'ROI負' : ''}`,
      estimatedSuccessRate,
    };
  }

  private riskLevelToString(level: RiskLevel): string {
    switch (level) {
      case RiskLevel.LOW:
        return 'LOW';
      case RiskLevel.MEDIUM:
        return 'MEDIUM';
      case RiskLevel.HIGH:
        return 'HIGH';
      case RiskLevel.CRITICAL:
        return 'CRITICAL';
      default:
        return 'UNKNOWN';
    }
  }
}

let instance: StrategyActivator | null = null;

export function getStrategyActivator(): StrategyActivator {
  if (!instance) {
    instance = new StrategyActivator();
  }
  return instance;
}
