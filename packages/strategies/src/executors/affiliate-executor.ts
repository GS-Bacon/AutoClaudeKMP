import { RiskLevel, getLogger } from '@auto-claude/core';
import { getBrowserManager } from '@auto-claude/browser';
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

const logger = getLogger('affiliate-executor');

interface ArticleDraft {
  title: string;
  content: string;
  keywords: string[];
  affiliateLinks: string[];
  platform: 'qiita' | 'zenn' | 'note' | 'blog';
}

interface AffiliateConfig {
  targetPlatform?: string;
  productCategory?: string;
  keywords?: string[];
  affiliatePrograms?: string[];
  contentType?: 'review' | 'tutorial' | 'comparison' | 'guide';
}

export class AffiliateExecutor extends BaseExecutor {
  readonly supportedTypes = [StrategyType.AFFILIATE, StrategyType.CONTENT_CREATION];
  private browser = getBrowserManager();
  private draftsDir = '/home/bacon/AutoClaudeKMP/workspace/drafts';

  constructor() {
    super();
    this.ensureDraftsDir();
  }

  private ensureDraftsDir(): void {
    if (!existsSync(this.draftsDir)) {
      mkdirSync(this.draftsDir, { recursive: true });
    }
  }

  protected buildPlanPrompt(strategy: Strategy): string {
    const config = strategy.config as AffiliateConfig;

    return `あなたはアフィリエイト戦略の実行プランナーです。

以下の戦略に対して、具体的な実行ステップを JSON 形式で出力してください。

戦略情報:
- 名前: ${strategy.name}
- 説明: ${strategy.description}
- 期待収益: ¥${strategy.expectedRevenue}
- ターゲットプラットフォーム: ${config.targetPlatform || '未指定'}
- 商品カテゴリ: ${config.productCategory || '未指定'}
- キーワード: ${config.keywords?.join(', ') || '未指定'}
- コンテンツタイプ: ${config.contentType || 'review'}

出力形式（必ずこのJSON形式で出力）:
\`\`\`json
{
  "steps": [
    {
      "name": "ステップ名",
      "description": "何をするか",
      "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
      "action": "具体的なアクション（コード生成、記事作成など）",
      "expectedOutput": "期待される成果物"
    }
  ],
  "estimatedRevenue": 0,
  "estimatedCost": 0
}
\`\`\`

リスクレベル基準:
- LOW: 下書き作成、情報収集（承認不要）
- MEDIUM: 記事公開、SNS投稿（条件付き自動承認）
- HIGH: 有料サービス登録、契約（要承認）
- CRITICAL: 30,000円以上の支出（複数承認必要）

最低でも以下のステップを含めてください:
1. キーワードリサーチ（LOW）
2. 記事構成作成（LOW）
3. 記事本文作成（LOW）
4. 下書き保存（LOW）
5. （オプション）記事公開（MEDIUM）`;
  }

  protected getDefaultPlan(strategy: Strategy): ExecutionPlan {
    const config = strategy.config as AffiliateConfig;

    const steps: ExecutionStep[] = [
      {
        id: 'step-1',
        name: 'キーワードリサーチ',
        description: 'ターゲットキーワードの調査と選定',
        riskLevel: RiskLevel.LOW,
        action: 'research_keywords',
        expectedOutput: 'キーワードリスト',
        requiresApproval: false,
      },
      {
        id: 'step-2',
        name: '記事構成作成',
        description: '記事のアウトラインを作成',
        riskLevel: RiskLevel.LOW,
        action: 'create_outline',
        expectedOutput: '記事構成',
        requiresApproval: false,
      },
      {
        id: 'step-3',
        name: '記事本文作成',
        description: 'アフィリエイトリンクを含む記事を作成',
        riskLevel: RiskLevel.LOW,
        action: 'write_article',
        expectedOutput: '記事ドラフト',
        requiresApproval: false,
      },
      {
        id: 'step-4',
        name: '下書き保存',
        description: '記事を下書きとして保存',
        riskLevel: RiskLevel.LOW,
        action: 'save_draft',
        expectedOutput: '保存された下書きファイル',
        requiresApproval: false,
      },
    ];

    // 自動公開が有効な場合のみ公開ステップを追加
    if (config.targetPlatform && strategy.config.autoPublish) {
      steps.push({
        id: 'step-5',
        name: '記事公開',
        description: `${config.targetPlatform}に記事を公開`,
        riskLevel: RiskLevel.MEDIUM,
        action: 'publish_article',
        expectedOutput: '公開された記事URL',
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
        case 'research_keywords':
          return await this.researchKeywords(strategy, step);

        case 'create_outline':
          return await this.createOutline(strategy, step);

        case 'write_article':
          return await this.writeArticle(strategy, step);

        case 'save_draft':
          return await this.saveDraft(strategy, step);

        case 'publish_article':
          return await this.publishArticle(strategy, step);

        default:
          // 未知のアクションはClaudeに実行させる
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

  private async researchKeywords(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const baseKeywords = config.keywords || [config.productCategory || strategy.name];

    const prompt = `以下のキーワードについて、アフィリエイト記事に適した関連キーワードを10個提案してください。

ベースキーワード: ${baseKeywords.join(', ')}
商品カテゴリ: ${config.productCategory || '一般'}

JSON形式で出力:
\`\`\`json
{
  "mainKeywords": ["メインキーワード1", "メインキーワード2"],
  "relatedKeywords": ["関連1", "関連2"],
  "longTailKeywords": ["ロングテール1", "ロングテール2"]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const keywords = this.parseJsonFromResponse(result);

    // 戦略のcontextに保存
    strategy.config._researchedKeywords = keywords;

    return {
      stepId: step.id,
      success: true,
      output: JSON.stringify(keywords),
      revenue: 0,
      cost: 0,
      artifacts: { keywords },
    };
  }

  private async createOutline(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const keywords = (strategy.config._researchedKeywords as any) || {
      mainKeywords: config.keywords || [strategy.name],
    };

    const prompt = `以下のキーワードを使って、SEOに強いアフィリエイト記事の構成を作成してください。

キーワード: ${JSON.stringify(keywords)}
コンテンツタイプ: ${config.contentType || 'review'}
商品カテゴリ: ${config.productCategory || '一般'}

JSON形式で出力:
\`\`\`json
{
  "title": "記事タイトル",
  "sections": [
    {
      "heading": "見出し",
      "points": ["ポイント1", "ポイント2"]
    }
  ],
  "cta": "行動喚起文"
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const outline = this.parseJsonFromResponse(result);

    strategy.config._outline = outline;

    return {
      stepId: step.id,
      success: true,
      output: JSON.stringify(outline),
      revenue: 0,
      cost: 0,
      artifacts: { outline },
    };
  }

  private async writeArticle(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const outline = (strategy.config._outline as any) || {
      title: strategy.name,
      sections: [],
    };

    const prompt = `以下の構成に基づいて、アフィリエイト記事を執筆してください。

記事構成:
${JSON.stringify(outline, null, 2)}

商品カテゴリ: ${config.productCategory || '一般'}
アフィリエイトプログラム: ${config.affiliatePrograms?.join(', ') || '一般的なASP'}

要件:
- SEOを意識した自然な文章
- 読者にとって価値のある情報
- アフィリエイトリンクを挿入する場所を[AFFILIATE_LINK]で示す
- Markdown形式

JSON形式で出力:
\`\`\`json
{
  "title": "記事タイトル",
  "content": "Markdown形式の記事本文",
  "keywords": ["キーワード1", "キーワード2"],
  "affiliateLinkPositions": ["位置の説明1", "位置の説明2"]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const article = this.parseJsonFromResponse(result);

    strategy.config._article = article;

    return {
      stepId: step.id,
      success: true,
      output: article.title,
      revenue: 0,
      cost: 0,
      artifacts: { article },
    };
  }

  private async saveDraft(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const article = (strategy.config._article as ArticleDraft) || {
      title: strategy.name,
      content: '# ' + strategy.name + '\n\n記事内容が生成されませんでした。',
      keywords: [],
      affiliateLinks: [],
      platform: 'qiita',
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${strategy.id}-${timestamp}.md`;
    const filepath = join(this.draftsDir, filename);

    const frontMatter = `---
title: ${article.title}
strategy_id: ${strategy.id}
strategy_name: ${strategy.name}
created_at: ${new Date().toISOString()}
keywords: ${JSON.stringify(article.keywords || [])}
status: draft
---

`;

    writeFileSync(filepath, frontMatter + (article.content || ''), 'utf-8');

    logger.info('Draft saved', { filepath });

    return {
      stepId: step.id,
      success: true,
      output: filepath,
      revenue: 0,
      cost: 0,
      artifacts: { filepath, filename },
    };
  }

  private async publishArticle(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const article = strategy.config._article as ArticleDraft;

    if (!article) {
      return {
        stepId: step.id,
        success: false,
        error: '公開する記事がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const platform = config.targetPlatform || 'qiita';

    // プラットフォームアダプターを使用して公開
    // 現時点ではログだけ出力（Phase 2でアダプターを実装）
    logger.info('Article publish requested', {
      platform,
      title: article.title,
    });

    await this.discord.sendInfo(
      '記事公開準備完了',
      `「${article.title}」を${platform}に公開する準備ができました。\nプラットフォームアダプターの実装後に自動公開されます。`
    );

    return {
      stepId: step.id,
      success: true,
      output: `公開準備完了: ${platform}`,
      revenue: 0,
      cost: 0,
      artifacts: { platform, articleTitle: article.title },
    };
  }

  private async executeGenericAction(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const prompt = `以下のタスクを実行し、結果をJSON形式で報告してください。

戦略: ${strategy.name}
タスク: ${step.name}
説明: ${step.description}
期待される出力: ${step.expectedOutput}

JSON形式で出力:
\`\`\`json
{
  "success": true,
  "output": "実行結果の説明",
  "artifacts": {}
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
      artifacts: parsed.artifacts,
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

    // JSONブロックがない場合、全体をパースしてみる
    try {
      return JSON.parse(response);
    } catch {
      return { raw: response };
    }
  }
}
