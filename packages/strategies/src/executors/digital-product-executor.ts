import { RiskLevel, getLogger } from '@auto-claude/core';
import { Strategy, StrategyType } from '../strategy-manager.js';
import {
  BaseExecutor,
  ExecutionPlan,
  ExecutionStep,
  StepResult,
} from './base-executor.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const logger = getLogger('digital-product-executor');

interface ProductDraft {
  name: string;
  description: string;
  features: string[];
  price: number;
  format: string;
  targetAudience: string;
  content?: string;
}

interface DigitalProductConfig {
  productType?: 'ebook' | 'template' | 'tool' | 'course' | 'asset';
  category?: string;
  targetAudience?: string;
  priceRange?: { min: number; max: number };
  platforms?: string[];  // booth, gumroad, note
}

export class DigitalProductExecutor extends BaseExecutor {
  readonly supportedTypes = [StrategyType.DIGITAL_PRODUCT];
  private productsDir = '/home/bacon/AutoClaudeKMP/workspace/products';

  constructor() {
    super();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    if (!existsSync(this.productsDir)) {
      mkdirSync(this.productsDir, { recursive: true });
    }
  }

  protected buildPlanPrompt(strategy: Strategy): string {
    const config = strategy.config as DigitalProductConfig;

    return `あなたはデジタル商品販売戦略のプランナーです。

以下の戦略に対して、具体的な実行ステップを JSON 形式で出力してください。

戦略情報:
- 名前: ${strategy.name}
- 説明: ${strategy.description}
- 期待収益: ¥${strategy.expectedRevenue}
- 商品タイプ: ${config.productType || '未指定'}
- カテゴリ: ${config.category || '未指定'}
- ターゲット: ${config.targetAudience || '未指定'}
- 価格帯: ¥${config.priceRange?.min || 0} - ¥${config.priceRange?.max || 10000}

出力形式（必ずこのJSON形式で出力）:
\`\`\`json
{
  "steps": [
    {
      "name": "ステップ名",
      "description": "何をするか",
      "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
      "action": "具体的なアクション",
      "expectedOutput": "期待される成果物"
    }
  ],
  "estimatedRevenue": 0,
  "estimatedCost": 0
}
\`\`\`

リスクレベル基準:
- LOW: 市場調査、コンテンツ作成、下書き保存（承認不要）
- MEDIUM: 商品ページ作成、価格設定（条件付き自動承認）
- HIGH: 商品出品、販売開始（要承認）
- CRITICAL: 有料広告、30,000円以上の投資（複数承認必要）

最低でも以下のステップを含めてください:
1. 市場調査（LOW）
2. 商品企画（LOW）
3. コンテンツ作成（LOW）
4. 商品ページ下書き（LOW）
5. （オプション）出品（HIGH）`;
  }

  protected getDefaultPlan(strategy: Strategy): ExecutionPlan {
    const config = strategy.config as DigitalProductConfig;

    const steps: ExecutionStep[] = [
      {
        id: 'step-1',
        name: '市場調査',
        description: '競合商品と需要を調査',
        riskLevel: RiskLevel.LOW,
        action: 'market_research',
        expectedOutput: '市場調査レポート',
        requiresApproval: false,
      },
      {
        id: 'step-2',
        name: '商品企画',
        description: '商品コンセプトと仕様を決定',
        riskLevel: RiskLevel.LOW,
        action: 'product_planning',
        expectedOutput: '商品企画書',
        requiresApproval: false,
      },
      {
        id: 'step-3',
        name: 'コンテンツ作成',
        description: '商品のコンテンツを作成',
        riskLevel: RiskLevel.LOW,
        action: 'create_content',
        expectedOutput: '商品コンテンツ',
        requiresApproval: false,
      },
      {
        id: 'step-4',
        name: '商品ページ下書き',
        description: '商品ページの説明文を作成',
        riskLevel: RiskLevel.LOW,
        action: 'create_listing_draft',
        expectedOutput: '商品ページ下書き',
        requiresApproval: false,
      },
    ];

    // 自動出品が有効な場合のみ出品ステップを追加
    if (strategy.config.autoList) {
      steps.push({
        id: 'step-5',
        name: '商品出品',
        description: `${config.platforms?.[0] || 'BOOTH'}に商品を出品`,
        riskLevel: RiskLevel.HIGH,
        action: 'list_product',
        expectedOutput: '出品完了通知',
        requiresApproval: true,
      });
    }

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      steps,
      totalRiskLevel: RiskLevel.LOW,
      estimatedRevenue: strategy.expectedRevenue,
      estimatedCost: strategy.expectedCost,
    };
  }

  protected async executeStep(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    logger.info('Executing step', {
      strategyId: strategy.id,
      stepId: step.id,
      action: step.action,
    });

    try {
      switch (step.action) {
        case 'market_research':
          return await this.marketResearch(strategy, step);

        case 'product_planning':
          return await this.productPlanning(strategy, step);

        case 'create_content':
          return await this.createContent(strategy, step);

        case 'create_listing_draft':
          return await this.createListingDraft(strategy, step);

        case 'list_product':
          return await this.listProduct(strategy, step);

        default:
          return await this.executeGenericAction(strategy, step);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Step execution failed', {
        strategyId: strategy.id,
        stepId: step.id,
        error: errorMessage,
      });

      return {
        stepId: step.id,
        success: false,
        error: errorMessage,
        revenue: 0,
        cost: 0,
      };
    }
  }

  private async marketResearch(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as DigitalProductConfig;

    const prompt = `以下の条件でデジタル商品市場を調査してください。

条件:
- 商品タイプ: ${config.productType || 'テンプレート'}
- カテゴリ: ${config.category || 'IT・テクノロジー'}
- ターゲット: ${config.targetAudience || '開発者'}

調査項目:
1. 競合商品（価格帯、特徴）
2. 市場需要
3. 差別化ポイント
4. 推奨価格帯

JSON形式で出力:
\`\`\`json
{
  "competitors": [
    { "name": "商品名", "price": 価格, "features": ["特徴1"] }
  ],
  "marketDemand": "高|中|低",
  "differentiationPoints": ["差別化ポイント1"],
  "recommendedPrice": { "min": 0, "max": 0 },
  "insights": ["市場インサイト1"]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const research = this.parseJsonFromResponse(result);

    strategy.config._marketResearch = research;

    return {
      stepId: step.id,
      success: true,
      output: `市場調査完了: 需要${research.marketDemand}, 推奨価格¥${research.recommendedPrice?.min}-¥${research.recommendedPrice?.max}`,
      revenue: 0,
      cost: 0,
      artifacts: { research },
    };
  }

  private async productPlanning(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as DigitalProductConfig;
    const research = strategy.config._marketResearch as any;

    const prompt = `以下の情報を元に、デジタル商品の企画を作成してください。

市場調査結果:
${JSON.stringify(research, null, 2)}

商品タイプ: ${config.productType || 'テンプレート'}
ターゲット: ${config.targetAudience || '開発者'}

企画内容:
1. 商品名
2. コンセプト
3. 主要機能・特徴
4. 価格
5. 想定フォーマット

JSON形式で出力:
\`\`\`json
{
  "name": "商品名",
  "concept": "コンセプト（1-2文）",
  "features": ["機能1", "機能2"],
  "price": 価格,
  "format": "PDF|ZIP|テンプレート|etc",
  "targetAudience": "ターゲット",
  "uniqueValue": "独自の価値提案"
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const plan = this.parseJsonFromResponse(result);

    strategy.config._productPlan = plan;

    return {
      stepId: step.id,
      success: true,
      output: `商品企画: ${plan.name} (¥${plan.price})`,
      revenue: 0,
      cost: 0,
      artifacts: { plan },
    };
  }

  private async createContent(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as DigitalProductConfig;
    const plan = strategy.config._productPlan as ProductDraft;

    if (!plan) {
      return {
        stepId: step.id,
        success: false,
        error: '商品企画がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const prompt = `以下の商品企画に基づいて、商品コンテンツの骨子を作成してください。

商品企画:
${JSON.stringify(plan, null, 2)}

商品タイプ: ${config.productType || 'テンプレート'}

要件:
- 商品の価値が伝わる構成
- 購入者がすぐに使えるレベル
- ${plan.format}形式での提供を想定

JSON形式で出力:
\`\`\`json
{
  "outline": "商品コンテンツの全体構成",
  "sections": [
    { "title": "セクション名", "content": "セクション内容の要約" }
  ],
  "bonusContent": ["特典1", "特典2"],
  "fileList": ["ファイル1.pdf", "ファイル2.zip"]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const content = this.parseJsonFromResponse(result);

    strategy.config._productContent = content;

    // コンテンツ骨子をファイルに保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${strategy.id}-content-${timestamp}.json`;
    const filepath = join(this.productsDir, filename);
    writeFileSync(filepath, JSON.stringify({ plan, content }, null, 2), 'utf-8');

    return {
      stepId: step.id,
      success: true,
      output: `コンテンツ骨子作成: ${content.sections?.length || 0}セクション`,
      revenue: 0,
      cost: 0,
      artifacts: { content, filepath },
    };
  }

  private async createListingDraft(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const plan = strategy.config._productPlan as ProductDraft;
    const content = strategy.config._productContent as any;

    if (!plan) {
      return {
        stepId: step.id,
        success: false,
        error: '商品企画がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const prompt = `以下の商品情報に基づいて、販売ページの説明文を作成してください。

商品企画:
${JSON.stringify(plan, null, 2)}

コンテンツ:
${JSON.stringify(content, null, 2)}

要件:
- 魅力的で購買意欲を高める文章
- 商品の価値が明確に伝わる
- SEOを意識したキーワード配置

JSON形式で出力:
\`\`\`json
{
  "title": "商品タイトル（50字以内）",
  "catchCopy": "キャッチコピー（30字以内）",
  "description": "商品説明（500-1000字）",
  "features": ["特徴1（箇条書き用）", "特徴2"],
  "targetDescription": "こんな人におすすめ（200字程度）",
  "faq": [
    { "question": "よくある質問1", "answer": "回答1" }
  ],
  "tags": ["タグ1", "タグ2"]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const listing = this.parseJsonFromResponse(result);

    strategy.config._listingDraft = listing;

    // 商品ページ下書きを保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${strategy.id}-listing-${timestamp}.md`;
    const filepath = join(this.productsDir, filename);

    const markdown = `# ${listing.title}

> ${listing.catchCopy}

## 商品説明

${listing.description}

## 特徴

${listing.features?.map((f: string) => `- ${f}`).join('\n') || ''}

## こんな人におすすめ

${listing.targetDescription}

## よくある質問

${listing.faq?.map((f: any) => `### ${f.question}\n${f.answer}`).join('\n\n') || ''}

---
価格: ¥${plan.price}
タグ: ${listing.tags?.join(', ') || ''}
`;

    writeFileSync(filepath, markdown, 'utf-8');

    return {
      stepId: step.id,
      success: true,
      output: `商品ページ下書き作成: ${listing.title}`,
      revenue: 0,
      cost: 0,
      artifacts: { listing, filepath },
    };
  }

  private async listProduct(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as DigitalProductConfig;
    const plan = strategy.config._productPlan as ProductDraft;
    const listing = strategy.config._listingDraft as any;

    if (!plan || !listing) {
      return {
        stepId: step.id,
        success: false,
        error: '出品に必要な情報がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const platform = config.platforms?.[0] || 'BOOTH';

    // 実際の出品はプラットフォームアダプター経由で行う
    logger.info('Product listing requested', {
      platform,
      title: listing.title,
      price: plan.price,
    });

    await this.discord.sendInfo(
      '商品出品準備完了',
      `「${listing.title}」を${platform}に出品する準備ができました。\n価格: ¥${plan.price}\n\nプラットフォームアダプターの実装後に自動出品されます。`
    );

    return {
      stepId: step.id,
      success: true,
      output: `出品準備完了: ${platform}`,
      revenue: 0,
      cost: 0,
      artifacts: { platform, title: listing.title, price: plan.price },
    };
  }

  private async executeGenericAction(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const prompt = `以下のデジタル商品関連タスクを実行し、結果をJSON形式で報告してください。

戦略: ${strategy.name}
タスク: ${step.name}
説明: ${step.description}

JSON形式で出力:
\`\`\`json
{
  "success": true,
  "output": "実行結果の説明"
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const parsed = this.parseJsonFromResponse(result);

    return {
      stepId: step.id,
      success: parsed.success ?? true,
      output: parsed.output || result,
      revenue: 0,
      cost: 0,
    };
  }

  private executeClaudeCommand(prompt: string): string {
    try {
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const result = execSync(`claude --print "${escapedPrompt}"`, {
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return result;
    } catch (error) {
      logger.error('Claude command failed', { error });
      throw error;
    }
  }

  private parseJsonFromResponse(response: string): any {
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    try {
      return JSON.parse(response);
    } catch {
      return { raw: response };
    }
  }
}
