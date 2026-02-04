import { RiskLevel, getLogger } from '@auto-claude/core';
import { getBrowserManager } from '@auto-claude/browser';
import {
  KeywordResearchInput,
  KeywordResearchOutput,
  OutlineInput,
  OutlineOutput,
  ArticleWriterInput,
  ArticleWriterOutput,
} from '@auto-claude/ai-router';
import { Strategy, StrategyType } from '../strategy-manager.js';
import {
  BaseExecutor,
  ExecutionPlan,
  ExecutionStep,
  StepResult,
} from './base-executor.js';
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

    const input: KeywordResearchInput = {
      baseKeywords,
      productCategory: config.productCategory,
      language: '日本語',
      keywordCount: 10,
    };

    const result = await this.taskRouter.executeSkill<KeywordResearchInput, KeywordResearchOutput>(
      'keyword-research',
      input
    );

    if (!result.success || !result.data) {
      logger.warn('Keyword research failed', { error: result.error });
      // フォールバック: 入力キーワードをそのまま使用
      const fallbackKeywords = {
        mainKeywords: baseKeywords,
        relatedKeywords: [],
        longTailKeywords: [],
      };
      strategy.config._researchedKeywords = fallbackKeywords;
      return {
        stepId: step.id,
        success: true,
        output: JSON.stringify(fallbackKeywords),
        revenue: 0,
        cost: 0,
        artifacts: { keywords: fallbackKeywords, fallbackUsed: true },
      };
    }

    // 戦略のcontextに保存
    strategy.config._researchedKeywords = result.data;

    return {
      stepId: step.id,
      success: true,
      output: JSON.stringify(result.data),
      revenue: 0,
      cost: 0,
      artifacts: { keywords: result.data, duration: result.duration },
    };
  }

  private async createOutline(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const researchedKeywords = strategy.config._researchedKeywords as KeywordResearchOutput | undefined;

    // キーワードを統合
    const keywords: string[] = [];
    if (researchedKeywords) {
      keywords.push(...researchedKeywords.mainKeywords);
      keywords.push(...researchedKeywords.relatedKeywords.slice(0, 3));
    } else if (config.keywords) {
      keywords.push(...config.keywords);
    } else {
      keywords.push(strategy.name);
    }

    const input: OutlineInput = {
      keywords,
      contentType: config.contentType || 'review',
      productCategory: config.productCategory,
    };

    const result = await this.taskRouter.executeSkill<OutlineInput, OutlineOutput>(
      'outline-generator',
      input
    );

    if (!result.success || !result.data) {
      logger.warn('Outline generation failed', { error: result.error });
      // フォールバック: シンプルなデフォルトアウトライン
      const fallbackOutline: OutlineOutput = {
        title: `${keywords[0]}の完全ガイド`,
        sections: [
          { heading: 'はじめに', points: ['この記事の目的', '対象読者'] },
          { heading: `${keywords[0]}とは`, points: ['基本的な説明', '特徴'] },
          { heading: 'おすすめポイント', points: ['メリット1', 'メリット2'] },
          { heading: 'まとめ', points: ['重要ポイントの振り返り'] },
        ],
        cta: '詳細はこちらからご確認ください',
      };
      strategy.config._outline = fallbackOutline;
      return {
        stepId: step.id,
        success: true,
        output: JSON.stringify(fallbackOutline),
        revenue: 0,
        cost: 0,
        artifacts: { outline: fallbackOutline, fallbackUsed: true },
      };
    }

    strategy.config._outline = result.data;

    return {
      stepId: step.id,
      success: true,
      output: JSON.stringify(result.data),
      revenue: 0,
      cost: 0,
      artifacts: { outline: result.data, duration: result.duration },
    };
  }

  private async writeArticle(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as AffiliateConfig;
    const outline = strategy.config._outline as OutlineOutput | undefined;
    const researchedKeywords = strategy.config._researchedKeywords as KeywordResearchOutput | undefined;

    if (!outline) {
      return {
        stepId: step.id,
        success: false,
        error: 'アウトラインが生成されていません',
        revenue: 0,
        cost: 0,
      };
    }

    // キーワードを統合
    const keywords: string[] = [];
    if (researchedKeywords) {
      keywords.push(...researchedKeywords.mainKeywords);
      keywords.push(...researchedKeywords.relatedKeywords);
    } else if (config.keywords) {
      keywords.push(...config.keywords);
    }

    const input: ArticleWriterInput = {
      outline,
      keywords,
      productCategory: config.productCategory,
      affiliatePrograms: config.affiliatePrograms,
    };

    const result = await this.taskRouter.executeSkill<ArticleWriterInput, ArticleWriterOutput>(
      'article-writer',
      input
    );

    if (!result.success || !result.data) {
      logger.warn('Article writing failed', { error: result.error });
      // フォールバック: 最小限の記事
      const fallbackArticle: ArticleWriterOutput = {
        title: outline.title,
        content: `# ${outline.title}\n\n${outline.sections.map((s: { heading: string; points: string[] }) => `## ${s.heading}\n\n${s.points.join('\n\n')}`).join('\n\n')}\n\n${outline.cta}`,
        keywords,
        affiliateLinkPositions: ['記事末尾'],
      };
      strategy.config._article = fallbackArticle;
      return {
        stepId: step.id,
        success: true,
        output: fallbackArticle.title,
        revenue: 0,
        cost: 0,
        artifacts: { article: fallbackArticle, fallbackUsed: true },
      };
    }

    strategy.config._article = result.data;

    return {
      stepId: step.id,
      success: true,
      output: result.data.title,
      revenue: 0,
      cost: 0,
      artifacts: { article: result.data, duration: result.duration },
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
    // 汎用アクションはClaudeを直接使用（スキル定義がないため）
    const { getClaudeCLI } = await import('@auto-claude/ai-router');
    const claude = getClaudeCLI();

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

    const result = await claude.executeTask({
      prompt,
      timeout: 120000,
      allowedTools: [],
    });

    if (!result.success) {
      return {
        stepId: step.id,
        success: false,
        error: result.error,
        revenue: 0,
        cost: 0,
      };
    }

    // JSONをパース
    const jsonMatch = result.output.match(/```json\n([\s\S]*?)\n```/);
    let parsed: { success?: boolean; output?: string; artifacts?: Record<string, unknown> } = {};
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch {
        parsed = { output: result.output };
      }
    } else {
      parsed = { output: result.output };
    }

    return {
      stepId: step.id,
      success: parsed.success ?? true,
      output: parsed.output || result.output,
      revenue: 0,
      cost: 0,
      artifacts: parsed.artifacts,
    };
  }
}
