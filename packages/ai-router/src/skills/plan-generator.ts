import {
  SkillDefinition,
  SkillInput,
  buildStructuredPrompt,
  parseJsonFromOutput,
  validateRequiredFields,
} from './types.js';

/**
 * 実行計画生成スキルの入力
 */
export interface PlanGeneratorInput extends SkillInput {
  /** 戦略名 */
  strategyName: string;
  /** 戦略の説明 */
  strategyDescription: string;
  /** 期待収益 */
  expectedRevenue: number;
  /** 戦略タイプ */
  strategyType: 'affiliate' | 'digital_product' | 'freelance' | 'content_creation';
  /** 戦略固有の設定 */
  config?: Record<string, unknown>;
}

/**
 * 実行ステップの定義
 */
export interface ExecutionStepOutput {
  /** ステップ名 */
  name: string;
  /** ステップの説明 */
  description: string;
  /** リスクレベル */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** 実行アクション */
  action: string;
  /** 期待される成果物 */
  expectedOutput: string;
}

/**
 * 実行計画生成スキルの出力
 */
export interface PlanGeneratorOutput {
  /** 実行ステップ一覧 */
  steps: ExecutionStepOutput[];
  /** 推定収益 */
  estimatedRevenue: number;
  /** 推定コスト */
  estimatedCost: number;
  /** 計画の概要 */
  summary?: string;
}

/**
 * 実行計画生成スキル定義
 */
export const planGeneratorSkill: SkillDefinition<PlanGeneratorInput, PlanGeneratorOutput> = {
  name: 'plan-generator',
  description: '戦略から具体的な実行計画を生成する',
  fallbackBehavior: 'claude', // 計画生成は重要なのでClaudeにフォールバック
  maxRetries: 2,
  timeout: 90000, // 1.5分

  validateInput(input: PlanGeneratorInput): string | null {
    if (!input.strategyName) {
      return 'strategyNameは必須です';
    }
    if (!input.strategyDescription) {
      return 'strategyDescriptionは必須です';
    }
    const validTypes = ['affiliate', 'digital_product', 'freelance', 'content_creation'];
    if (!validTypes.includes(input.strategyType)) {
      return `strategyTypeは${validTypes.join(', ')}のいずれかです`;
    }
    return null;
  },

  buildPrompt(input: PlanGeneratorInput): string {
    const typeDescriptions: Record<string, string> = {
      affiliate: 'アフィリエイト・コンテンツマーケティング',
      digital_product: 'デジタル商品販売',
      freelance: 'フリーランス案件獲得',
      content_creation: 'コンテンツ作成',
    };

    const configText = input.config
      ? Object.entries(input.config)
          .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
          .join('\n')
      : 'なし';

    return buildStructuredPrompt({
      taskName: '実行計画生成',
      inputs: {
        戦略名: input.strategyName,
        戦略説明: input.strategyDescription,
        戦略タイプ: typeDescriptions[input.strategyType],
        期待収益: `¥${input.expectedRevenue}`,
        追加設定: configText,
      },
      requirements: [
        '3〜7ステップの具体的な実行計画を作成する',
        '各ステップにリスクレベルを設定する（LOW/MEDIUM/HIGH/CRITICAL）',
        'LOW: 下書き作成、情報収集（承認不要）',
        'MEDIUM: 記事公開、SNS投稿（条件付き自動承認）',
        'HIGH: 有料サービス登録、契約（要承認）',
        'CRITICAL: 30,000円以上の支出（複数承認必要）',
        '各ステップに明確なアクション名を付ける',
        '現実的な収益・コスト見積もりを行う',
      ],
      outputSchema: {
        steps: [
          {
            name: 'ステップ名',
            description: '何をするか',
            riskLevel: 'LOW|MEDIUM|HIGH|CRITICAL',
            action: '具体的なアクション名',
            expectedOutput: '期待される成果物',
          },
        ],
        estimatedRevenue: 0,
        estimatedCost: 0,
        summary: '計画の概要（1〜2文）',
      },
    });
  },

  parseOutput(rawOutput: string): PlanGeneratorOutput | undefined {
    const parsed = parseJsonFromOutput<PlanGeneratorOutput>(rawOutput);
    if (!parsed) {
      return undefined;
    }

    const error = validateRequiredFields(parsed as unknown as Record<string, unknown>, [
      'steps',
      'estimatedRevenue',
      'estimatedCost',
    ]);
    if (error) {
      return undefined;
    }

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return undefined;
    }

    // 各ステップの検証
    const validRiskLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    for (const step of parsed.steps) {
      if (!step.name || !step.action || !step.riskLevel) {
        return undefined;
      }
      if (!validRiskLevels.includes(step.riskLevel)) {
        return undefined;
      }
    }

    return parsed;
  },

  validateOutput(output: PlanGeneratorOutput): string | null {
    if (output.steps.length < 2) {
      return 'ステップが少なすぎます（最低2ステップ必要）';
    }
    if (output.steps.length > 10) {
      return 'ステップが多すぎます（最大10ステップ）';
    }
    return null;
  },
};
