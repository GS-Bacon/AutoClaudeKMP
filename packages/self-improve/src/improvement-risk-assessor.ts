import { RiskLevel, getLogger } from '@auto-claude/core';
import type { ProcessImprovement } from './types.js';
import { getProcessImprover } from './process-improver.js';
import { execSync } from 'child_process';

const logger = getLogger('self-improve:risk-assessor');

export interface RiskAssessment {
  improvementId: string;
  riskLevel: RiskLevel;
  confidence: number;  // 0-100
  factors: RiskFactor[];
  recommendation: 'auto_implement' | 'conditional_auto' | 'require_approval' | 'reject';
  reason: string;
}

export interface RiskFactor {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;  // 影響度 1-10
  description: string;
}

export interface AutoImplementConditions {
  pastSuccessRate: number;  // 過去の同種改善の成功率
  minConfidence: number;    // 最低信頼度
  maxRiskLevel: RiskLevel;  // 最大許容リスクレベル
}

const DEFAULT_CONDITIONS: AutoImplementConditions = {
  pastSuccessRate: 0.8,
  minConfidence: 70,
  maxRiskLevel: RiskLevel.MEDIUM,
};

export class ImprovementRiskAssessor {
  private processImprover = getProcessImprover();

  /**
   * 改善のリスクを評価
   */
  async assessRisk(improvement: ProcessImprovement): Promise<RiskAssessment> {
    logger.info('Assessing improvement risk', {
      improvementId: improvement.id,
      target: improvement.target,
    });

    const factors: RiskFactor[] = [];

    // 1. ターゲット種別によるリスク評価
    factors.push(this.assessTargetRisk(improvement.target));

    // 2. 変更タイプによるリスク評価
    factors.push(this.assessChangeTypeRisk(improvement.type));

    // 3. 過去の類似改善の成功率
    const historicalFactor = this.assessHistoricalSuccess(improvement);
    factors.push(historicalFactor);

    // 4. 実装内容の複雑さ
    factors.push(this.assessComplexity(improvement.implementation));

    // 5. AIによる詳細評価（オプション）
    try {
      const aiFactor = await this.assessWithAI(improvement);
      factors.push(aiFactor);
    } catch (error) {
      logger.warn('AI assessment failed, using heuristics only', { error });
    }

    // 総合リスクレベルを計算
    const { riskLevel, confidence } = this.calculateOverallRisk(factors);

    // 推奨アクションを決定
    const recommendation = this.determineRecommendation(
      improvement,
      riskLevel,
      confidence,
      historicalFactor
    );

    const assessment: RiskAssessment = {
      improvementId: improvement.id,
      riskLevel,
      confidence,
      factors,
      recommendation,
      reason: this.generateReasonText(recommendation, factors),
    };

    logger.info('Risk assessment completed', {
      improvementId: improvement.id,
      riskLevel,
      recommendation,
    });

    return assessment;
  }

  private assessTargetRisk(target: ProcessImprovement['target']): RiskFactor {
    const riskMap: Record<ProcessImprovement['target'], { weight: number; impact: 'positive' | 'negative' | 'neutral' }> = {
      knowledge: { weight: 1, impact: 'positive' },      // 最も安全
      process: { weight: 2, impact: 'neutral' },         // ドキュメント更新
      config: { weight: 4, impact: 'neutral' },          // 設定変更
      strategy: { weight: 5, impact: 'neutral' },        // 戦略変更
      code: { weight: 7, impact: 'negative' },           // コード変更は高リスク
    };

    const { weight, impact } = riskMap[target];

    return {
      name: 'ターゲット種別',
      impact,
      weight,
      description: `${target}への変更（リスク重み: ${weight}/10）`,
    };
  }

  private assessChangeTypeRisk(type: ProcessImprovement['type']): RiskFactor {
    const riskMap: Record<ProcessImprovement['type'], { weight: number; impact: 'positive' | 'negative' | 'neutral' }> = {
      add: { weight: 3, impact: 'neutral' },      // 追加は比較的安全
      modify: { weight: 5, impact: 'negative' },  // 変更は中リスク
      remove: { weight: 7, impact: 'negative' },  // 削除は高リスク
    };

    const { weight, impact } = riskMap[type];

    return {
      name: '変更タイプ',
      impact,
      weight,
      description: `${type}操作（リスク重み: ${weight}/10）`,
    };
  }

  private assessHistoricalSuccess(improvement: ProcessImprovement): RiskFactor {
    const allImprovements = this.processImprover.getImprovements();

    // 同じtargetとtypeの改善を検索
    const similar = allImprovements.filter(
      (i) =>
        i.target === improvement.target &&
        i.type === improvement.type &&
        (i.status === 'verified' || i.status === 'failed')
    );

    if (similar.length === 0) {
      return {
        name: '過去の実績',
        impact: 'neutral',
        weight: 5,
        description: '類似の改善実績なし（初回）',
      };
    }

    const successCount = similar.filter(
      (i) => i.status === 'verified' && (i.effectivenessScore ?? 0) > 0.5
    ).length;
    const successRate = successCount / similar.length;

    return {
      name: '過去の実績',
      impact: successRate >= 0.8 ? 'positive' : successRate >= 0.5 ? 'neutral' : 'negative',
      weight: successRate >= 0.8 ? 2 : successRate >= 0.5 ? 5 : 8,
      description: `成功率: ${(successRate * 100).toFixed(0)}% (${successCount}/${similar.length})`,
    };
  }

  private assessComplexity(implementation: string): RiskFactor {
    // 簡易的な複雑さ評価
    const length = implementation.length;
    const hasCode = /```|function|class|import|export/i.test(implementation);
    const hasMultipleSteps = (implementation.match(/\d\./g) || []).length > 3;

    let weight = 3;
    let impact: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (length > 1000) weight += 2;
    if (hasCode) weight += 2;
    if (hasMultipleSteps) weight += 1;

    if (weight >= 7) impact = 'negative';
    else if (weight <= 3) impact = 'positive';

    return {
      name: '実装複雑度',
      impact,
      weight: Math.min(weight, 10),
      description: `${length}文字, ${hasCode ? 'コード含む' : 'テキストのみ'}`,
    };
  }

  private async assessWithAI(improvement: ProcessImprovement): Promise<RiskFactor> {
    const prompt = `以下の改善提案のリスクを1-10で評価してください（1=低リスク、10=高リスク）。

改善内容:
- タイプ: ${improvement.type}
- 対象: ${improvement.target}
- 説明: ${improvement.description}
- 実装: ${improvement.implementation}

JSON形式で回答:
\`\`\`json
{
  "riskScore": 1-10の数値,
  "reason": "理由（1文）"
}
\`\`\``;

    const result = execSync(
      `claude --print "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
      {
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      throw new Error('No JSON block in AI response');
    }

    const parsed = JSON.parse(jsonMatch[1]);

    return {
      name: 'AI評価',
      impact: parsed.riskScore <= 3 ? 'positive' : parsed.riskScore >= 7 ? 'negative' : 'neutral',
      weight: parsed.riskScore,
      description: parsed.reason,
    };
  }

  private calculateOverallRisk(factors: RiskFactor[]): {
    riskLevel: RiskLevel;
    confidence: number;
  } {
    // 重み付き平均を計算
    const negativeFactors = factors.filter((f) => f.impact === 'negative');
    const positiveFactors = factors.filter((f) => f.impact === 'positive');

    const avgWeight =
      factors.reduce((sum, f) => sum + f.weight, 0) / factors.length;

    // リスクレベルを決定
    let riskLevel: RiskLevel;
    if (avgWeight <= 3) {
      riskLevel = RiskLevel.LOW;
    } else if (avgWeight <= 5) {
      riskLevel = RiskLevel.MEDIUM;
    } else if (avgWeight <= 7) {
      riskLevel = RiskLevel.HIGH;
    } else {
      riskLevel = RiskLevel.CRITICAL;
    }

    // 信頼度を計算（要因数と一貫性に基づく）
    const consistency =
      1 - Math.abs(positiveFactors.length - negativeFactors.length) / factors.length;
    const confidence = Math.round(
      50 + 30 * consistency + 20 * Math.min(factors.length / 5, 1)
    );

    return { riskLevel, confidence };
  }

  private determineRecommendation(
    improvement: ProcessImprovement,
    riskLevel: RiskLevel,
    confidence: number,
    historicalFactor: RiskFactor,
    conditions: AutoImplementConditions = DEFAULT_CONDITIONS
  ): RiskAssessment['recommendation'] {
    // 過去の成功率を抽出
    const successRateMatch = historicalFactor.description.match(/成功率: (\d+)%/);
    const pastSuccessRate = successRateMatch
      ? parseInt(successRateMatch[1]) / 100
      : 0.5;

    // LOWリスクは自動実装
    if (riskLevel === RiskLevel.LOW && confidence >= conditions.minConfidence) {
      return 'auto_implement';
    }

    // MEDIUMリスクで過去の成功率が高ければ条件付き自動実装
    if (
      riskLevel === RiskLevel.MEDIUM &&
      pastSuccessRate >= conditions.pastSuccessRate &&
      confidence >= conditions.minConfidence
    ) {
      return 'conditional_auto';
    }

    // HIGH以上は承認必須
    if (riskLevel >= RiskLevel.HIGH) {
      return 'require_approval';
    }

    // その他はMEDIUMでも承認必要
    return 'require_approval';
  }

  private generateReasonText(
    recommendation: RiskAssessment['recommendation'],
    factors: RiskFactor[]
  ): string {
    const negativeFactors = factors
      .filter((f) => f.impact === 'negative')
      .map((f) => f.name);
    const positiveFactors = factors
      .filter((f) => f.impact === 'positive')
      .map((f) => f.name);

    switch (recommendation) {
      case 'auto_implement':
        return `低リスクのため自動実装可能。${positiveFactors.length > 0 ? `好材料: ${positiveFactors.join(', ')}` : ''}`;
      case 'conditional_auto':
        return `過去の実績が良好なため条件付き自動実装。`;
      case 'require_approval':
        return `${negativeFactors.length > 0 ? `懸念点: ${negativeFactors.join(', ')}` : 'リスク評価により'}承認が必要。`;
      case 'reject':
        return `リスクが高すぎるため実装を推奨しない。`;
    }
  }

  /**
   * 改善が自動実装可能かチェック
   */
  canAutoImplement(assessment: RiskAssessment): boolean {
    return (
      assessment.recommendation === 'auto_implement' ||
      assessment.recommendation === 'conditional_auto'
    );
  }
}

let instance: ImprovementRiskAssessor | null = null;

export function getImprovementRiskAssessor(): ImprovementRiskAssessor {
  if (!instance) {
    instance = new ImprovementRiskAssessor();
  }
  return instance;
}
