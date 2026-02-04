import { getLogger } from '@auto-claude/core';
import { Strategy, StrategyMetadata, getStrategyManager } from './strategy-manager.js';

const logger = getLogger('strategy-recommender');

export type SystemPhase = 'initial' | 'growth' | 'mature';

export interface PhaseConfig {
  minSuccessCount: number;
  maxSuccessCount: number;
  minAiAutonomy: number;
  allowHumanInteraction: boolean;
}

const PHASE_CONFIGS: Record<SystemPhase, PhaseConfig> = {
  initial: {
    minSuccessCount: 0,
    maxSuccessCount: 9,
    minAiAutonomy: 70,
    allowHumanInteraction: false,
  },
  growth: {
    minSuccessCount: 10,
    maxSuccessCount: 49,
    minAiAutonomy: 40,
    allowHumanInteraction: true,
  },
  mature: {
    minSuccessCount: 50,
    maxSuccessCount: Infinity,
    minAiAutonomy: 0,
    allowHumanInteraction: true,
  },
};

export interface RecommendationResult {
  eligible: boolean;
  reason: string;
  phase: SystemPhase;
  strategy: Strategy;
}

export class StrategyRecommender {
  private strategyManager = getStrategyManager();

  constructor() {
    logger.info('StrategyRecommender initialized');
  }

  /**
   * システム全体の累計成功数を取得
   */
  getTotalSuccessCount(): number {
    const strategies = this.strategyManager.getAllStrategies();
    return strategies.reduce((sum, s) => sum + s.performance.successCount, 0);
  }

  /**
   * 現在のシステムフェーズを判定
   */
  determinePhase(): SystemPhase {
    const totalSuccess = this.getTotalSuccessCount();

    if (totalSuccess >= PHASE_CONFIGS.mature.minSuccessCount) {
      return 'mature';
    }
    if (totalSuccess >= PHASE_CONFIGS.growth.minSuccessCount) {
      return 'growth';
    }
    return 'initial';
  }

  /**
   * 戦略が現在のフェーズで適格かどうかをチェック
   */
  isEligible(strategy: Strategy, phase?: SystemPhase): RecommendationResult {
    const currentPhase = phase ?? this.determinePhase();
    const phaseConfig = PHASE_CONFIGS[currentPhase];
    const metadata = strategy.metadata;

    // metadataがない場合はデフォルトで適格とする（後方互換性）
    if (!metadata) {
      logger.debug('Strategy has no metadata, assuming eligible', {
        strategyId: strategy.id,
      });
      return {
        eligible: true,
        reason: 'メタデータ未設定（後方互換性により許可）',
        phase: currentPhase,
        strategy,
      };
    }

    // aiAutonomyチェック
    if (metadata.aiAutonomy < phaseConfig.minAiAutonomy) {
      return {
        eligible: false,
        reason: `AI自律度が不足（必要: ${phaseConfig.minAiAutonomy}%以上、実際: ${metadata.aiAutonomy}%）`,
        phase: currentPhase,
        strategy,
      };
    }

    // humanInteractionチェック
    if (metadata.humanInteractionRequired && !phaseConfig.allowHumanInteraction) {
      return {
        eligible: false,
        reason: '対人やり取りが必要な戦略は初期フェーズでは利用不可',
        phase: currentPhase,
        strategy,
      };
    }

    // requiredExperienceチェック
    const totalSuccess = this.getTotalSuccessCount();
    if (metadata.requiredExperience > totalSuccess) {
      return {
        eligible: false,
        reason: `経験値が不足（必要: ${metadata.requiredExperience}、現在: ${totalSuccess}）`,
        phase: currentPhase,
        strategy,
      };
    }

    return {
      eligible: true,
      reason: '全ての条件を満たしています',
      phase: currentPhase,
      strategy,
    };
  }

  /**
   * 現在のフェーズで推奨される戦略一覧を取得
   */
  getRecommendedStrategies(): RecommendationResult[] {
    const strategies = this.strategyManager.getAllStrategies();
    const phase = this.determinePhase();

    logger.info('Getting recommended strategies', {
      phase,
      totalStrategies: strategies.length,
      totalSuccessCount: this.getTotalSuccessCount(),
    });

    const results: RecommendationResult[] = [];

    for (const strategy of strategies) {
      const result = this.isEligible(strategy, phase);
      results.push(result);

      if (!result.eligible) {
        logger.debug('Strategy filtered out', {
          strategyId: strategy.id,
          strategyName: strategy.name,
          reason: result.reason,
        });
      }
    }

    return results;
  }

  /**
   * 適格な戦略のみを取得
   */
  getEligibleStrategies(): Strategy[] {
    return this.getRecommendedStrategies()
      .filter((r) => r.eligible)
      .map((r) => r.strategy);
  }

  /**
   * フィルタリングされた（不適格な）戦略を取得
   */
  getFilteredStrategies(): RecommendationResult[] {
    return this.getRecommendedStrategies().filter((r) => !r.eligible);
  }

  /**
   * フェーズ情報のサマリーを取得
   */
  getPhaseInfo(): {
    phase: SystemPhase;
    totalSuccessCount: number;
    phaseConfig: PhaseConfig;
    eligibleCount: number;
    filteredCount: number;
  } {
    const phase = this.determinePhase();
    const recommendations = this.getRecommendedStrategies();

    return {
      phase,
      totalSuccessCount: this.getTotalSuccessCount(),
      phaseConfig: PHASE_CONFIGS[phase],
      eligibleCount: recommendations.filter((r) => r.eligible).length,
      filteredCount: recommendations.filter((r) => !r.eligible).length,
    };
  }

  /**
   * デフォルトのメタデータを戦略タイプから推測
   */
  static getDefaultMetadata(strategyType: string): StrategyMetadata {
    const defaults: Record<string, StrategyMetadata> = {
      affiliate: {
        difficulty: 'beginner',
        aiAutonomy: 90,
        requiredExperience: 0,
        humanInteractionRequired: false,
      },
      digital_product: {
        difficulty: 'beginner',
        aiAutonomy: 85,
        requiredExperience: 0,
        humanInteractionRequired: false,
      },
      freelance: {
        difficulty: 'intermediate',
        aiAutonomy: 30,
        requiredExperience: 10,
        humanInteractionRequired: true,
      },
      consulting: {
        difficulty: 'advanced',
        aiAutonomy: 20,
        requiredExperience: 30,
        humanInteractionRequired: true,
      },
      content_creation: {
        difficulty: 'intermediate',
        aiAutonomy: 50,
        requiredExperience: 5,
        humanInteractionRequired: false,
      },
      online_course: {
        difficulty: 'intermediate',
        aiAutonomy: 45,
        requiredExperience: 10,
        humanInteractionRequired: false,
      },
    };

    return defaults[strategyType] ?? {
      difficulty: 'intermediate',
      aiAutonomy: 50,
      requiredExperience: 5,
      humanInteractionRequired: false,
    };
  }
}

let instance: StrategyRecommender | null = null;

export function getStrategyRecommender(): StrategyRecommender {
  if (!instance) {
    instance = new StrategyRecommender();
  }
  return instance;
}
