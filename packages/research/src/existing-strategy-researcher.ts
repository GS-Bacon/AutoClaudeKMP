/**
 * 既存戦略リサーチャー
 *
 * 既存の戦略タイプ（アフィリエイト、フリーランス、デジタルプロダクト）の
 * 最新動向調査とキャッチアップを担当
 */

import {
  getLogger,
  ResearchResult,
  ResearchFinding,
} from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('ExistingStrategyResearcher');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export type StrategyType = 'affiliate' | 'freelance' | 'digital_product';

export interface StrategyResearchConfig {
  enableWebSearch: boolean;
  researchDepth: 'quick' | 'standard' | 'comprehensive';
  includeCompetitorAnalysis: boolean;
}

const DEFAULT_CONFIG: StrategyResearchConfig = {
  enableWebSearch: true,
  researchDepth: 'standard',
  includeCompetitorAnalysis: true,
};

export interface StrategyInsight {
  category: string;
  insight: string;
  source: string;
  confidence: 'low' | 'medium' | 'high';
  actionable: boolean;
  suggestedAction?: string;
}

export interface CompetitorInfo {
  name: string;
  description: string;
  strengths: string[];
  differentiators: string[];
}

export interface MarketUpdate {
  strategyType: StrategyType;
  trends: string[];
  opportunities: string[];
  risks: string[];
  recommendedActions: string[];
}

// 各戦略タイプのリサーチポイント
const RESEARCH_TOPICS = {
  affiliate: {
    name: 'アフィリエイト',
    topics: [
      '新規ASP・アフィリエイトプログラム',
      '高単価案件・報酬率の高い分野',
      'トレンドキーワード・ニッチ市場',
      '成功しているアフィリエイターの手法',
      'SEO・コンテンツマーケティングの最新動向',
    ],
  },
  freelance: {
    name: 'フリーランス',
    topics: [
      '需要の高いスキル・技術',
      '単価相場・報酬トレンド',
      '新しいフリーランスプラットフォーム',
      'リモートワーク市場の動向',
      '案件獲得のベストプラクティス',
    ],
  },
  digital_product: {
    name: 'デジタルプロダクト',
    topics: [
      '売れ筋カテゴリ・製品タイプ',
      '価格帯・価格戦略',
      '新しい販売チャネル・プラットフォーム',
      'マーケティング手法',
      '製品開発のトレンド',
    ],
  },
};

export class ExistingStrategyResearcher {
  private readonly discord = getDiscordNotifier();
  private readonly config: StrategyResearchConfig;
  private readonly researchHistory: Map<StrategyType, ResearchResult[]> = new Map();

  constructor(config: Partial<StrategyResearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 特定の戦略タイプのリサーチを実行
   */
  async researchStrategy(strategyType: StrategyType): Promise<ResearchResult> {
    const topics = RESEARCH_TOPICS[strategyType];
    if (!topics) {
      throw new Error(`Unknown strategy type: ${strategyType}`);
    }

    logger.info(`Starting research for ${topics.name}`);

    const findings: ResearchFinding[] = [];
    const recommendations: string[] = [];
    const sources: string[] = [];

    // 各トピックについてリサーチ
    for (const topic of topics.topics) {
      try {
        const insight = await this.researchTopic(strategyType, topic);
        if (insight) {
          findings.push({
            topic,
            insight: insight.insight,
            confidence: insight.confidence,
            relevance: insight.confidence === 'high' ? 90 : insight.confidence === 'medium' ? 70 : 50,
            actionable: insight.actionable,
            suggestedAction: insight.suggestedAction,
          });

          if (insight.source) {
            sources.push(insight.source);
          }

          if (insight.suggestedAction) {
            recommendations.push(insight.suggestedAction);
          }
        }
      } catch (error) {
        logger.warn(`Failed to research topic: ${topic}`, { error });
      }
    }

    // 競合分析
    if (this.config.includeCompetitorAnalysis) {
      const competitorInsights = await this.analyzeCompetitors(strategyType);
      findings.push(...competitorInsights);
    }

    // 市場アップデートを生成
    const marketUpdate = this.generateMarketUpdate(strategyType, findings);

    const result: ResearchResult = {
      id: `research-${strategyType}-${Date.now()}`,
      type: 'strategy_update',
      title: `${topics.name}戦略の最新動向`,
      summary: this.generateSummary(strategyType, findings),
      sources: [...new Set(sources)],
      findings,
      recommendations,
      conductedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24時間
    };

    // 履歴に追加
    const history = this.researchHistory.get(strategyType) ?? [];
    history.push(result);
    if (history.length > 10) history.shift(); // 最大10件
    this.researchHistory.set(strategyType, history);

    // 結果を保存
    await this.saveResearchResult(result, strategyType);

    // 重要な発見があれば通知
    const importantFindings = findings.filter(
      f => f.confidence === 'high' && f.actionable
    );
    if (importantFindings.length > 0) {
      await this.notifyFindings(strategyType, importantFindings);
    }

    logger.info(`Research completed for ${topics.name}`, {
      findingCount: findings.length,
      recommendationCount: recommendations.length,
    });

    return result;
  }

  /**
   * 特定のトピックをリサーチ
   */
  private async researchTopic(
    strategyType: StrategyType,
    topic: string
  ): Promise<StrategyInsight | null> {
    if (this.config.researchDepth === 'comprehensive') {
      return this.aiResearchTopic(strategyType, topic);
    }

    // 標準/クイックリサーチはルールベース
    return this.basicResearchTopic(strategyType, topic);
  }

  /**
   * 基本的なリサーチ（ルールベース）
   */
  private basicResearchTopic(
    strategyType: StrategyType,
    topic: string
  ): StrategyInsight {
    // 戦略タイプ別の基本インサイト
    const baseInsights: Record<StrategyType, Record<string, string>> = {
      affiliate: {
        '新規ASP': 'A8.net、もしもアフィリエイト、バリューコマース等の主要ASPに加え、ニッチ分野の専門ASPも検討',
        '高単価案件': '金融・保険・転職分野は高単価だが競争激化。ニッチ市場での差別化が重要',
        'トレンドキーワード': 'AI関連、サブスク系、ヘルスケアなどが注目分野',
        '成功事例': '特化型サイト、比較サイト、レビューサイトが成功パターン',
        'SEO': 'E-E-A-T重視のコンテンツ、ユーザー意図の理解が重要',
      },
      freelance: {
        '需要の高いスキル': 'クラウド、AI/ML、セキュリティ、モバイル開発が高需要',
        '単価相場': '専門性とスキルレベルにより時給3000-15000円',
        '新プラットフォーム': 'Toptal、Upwork、クラウドワークス、ランサーズ等',
        'リモートワーク': 'フルリモート案件増加、グローバル案件も視野に',
        '案件獲得': 'ポートフォリオ充実、専門性アピール、継続受注が鍵',
      },
      digital_product: {
        '売れ筋': 'テンプレート、ツール、教材コンテンツが人気',
        '価格戦略': '低価格で volume か高価格で value か、ニッチによる',
        '販売チャネル': 'Gumroad、BOOTH、note、Shopify等',
        'マーケティング': 'SNS活用、コミュニティ構築、無料版→有料版誘導',
        '製品開発': 'ユーザーフィードバック重視、MVP からの改善',
      },
    };

    const insights = baseInsights[strategyType];
    const matchingKey = Object.keys(insights).find(k =>
      topic.toLowerCase().includes(k.toLowerCase()) ||
      k.toLowerCase().includes(topic.split('・')[0].toLowerCase())
    );

    if (matchingKey) {
      return {
        category: topic,
        insight: insights[matchingKey],
        source: 'internal knowledge base',
        confidence: 'medium',
        actionable: true,
        suggestedAction: `${topic}について詳細調査を検討`,
      };
    }

    return {
      category: topic,
      insight: `${topic}に関する情報を収集中`,
      source: 'pending research',
      confidence: 'low',
      actionable: false,
    };
  }

  /**
   * AIを使った詳細リサーチ
   */
  private async aiResearchTopic(
    strategyType: StrategyType,
    topic: string
  ): Promise<StrategyInsight | null> {
    const prompt = `
${RESEARCH_TOPICS[strategyType].name}戦略に関して、以下のトピックについて最新情報を教えてください。

トピック: ${topic}

以下の形式でJSONで回答してください:
\`\`\`json
{
  "insight": "主要なインサイト（1-2文）",
  "confidence": "low" | "medium" | "high",
  "actionable": true/false,
  "suggestedAction": "推奨アクション（任意）"
}
\`\`\`
`;

    try {
      const result = execSync(
        `claude --print "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
        {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          category: topic,
          insight: parsed.insight ?? '情報なし',
          source: 'Claude AI analysis',
          confidence: parsed.confidence ?? 'medium',
          actionable: parsed.actionable ?? false,
          suggestedAction: parsed.suggestedAction,
        };
      }
    } catch (error) {
      logger.warn('AI research failed, using fallback', { error });
    }

    return this.basicResearchTopic(strategyType, topic);
  }

  /**
   * 競合分析
   */
  private async analyzeCompetitors(
    strategyType: StrategyType
  ): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];

    // 戦略タイプ別の競合情報（基本版）
    const competitorInfo: Record<StrategyType, CompetitorInfo[]> = {
      affiliate: [
        {
          name: '大手アフィリエイトサイト',
          description: '資金力と知名度で優位',
          strengths: ['ブランド力', '大量コンテンツ', 'SEO最適化'],
          differentiators: ['ニッチ市場への特化', '独自視点', '専門性'],
        },
      ],
      freelance: [
        {
          name: '大手フリーランサー',
          description: '経験と実績で優位',
          strengths: ['豊富な実績', 'クライアント基盤', '専門スキル'],
          differentiators: ['AI活用の効率化', '新技術への迅速対応', '柔軟な価格'],
        },
      ],
      digital_product: [
        {
          name: '既存製品提供者',
          description: '市場での認知度で優位',
          strengths: ['既存ユーザー基盤', 'ブランド', 'レビュー'],
          differentiators: ['AI特化', '自動化', 'ユニークな機能'],
        },
      ],
    };

    const competitors = competitorInfo[strategyType] ?? [];
    for (const competitor of competitors) {
      findings.push({
        topic: '競合分析',
        insight: `${competitor.name}: ${competitor.description}。差別化ポイント: ${competitor.differentiators.join(', ')}`,
        confidence: 'medium',
        relevance: 75,
        actionable: true,
        suggestedAction: `差別化要素（${competitor.differentiators[0]}）を強化`,
      });
    }

    return findings;
  }

  /**
   * 市場アップデートを生成
   */
  private generateMarketUpdate(
    strategyType: StrategyType,
    findings: ResearchFinding[]
  ): MarketUpdate {
    const trends = findings
      .filter(f => f.confidence !== 'low')
      .map(f => f.insight)
      .slice(0, 3);

    const opportunities = findings
      .filter(f => f.actionable)
      .map(f => f.suggestedAction)
      .filter((a): a is string => !!a)
      .slice(0, 3);

    return {
      strategyType,
      trends,
      opportunities,
      risks: ['市場の競争激化', '技術変化への対応'],
      recommendedActions: opportunities.slice(0, 2),
    };
  }

  /**
   * サマリーを生成
   */
  private generateSummary(
    strategyType: StrategyType,
    findings: ResearchFinding[]
  ): string {
    const highConfidence = findings.filter(f => f.confidence === 'high').length;
    const actionable = findings.filter(f => f.actionable).length;

    return `${RESEARCH_TOPICS[strategyType].name}戦略について${findings.length}件の知見を収集。` +
      `高信頼度: ${highConfidence}件、アクション可能: ${actionable}件。`;
  }

  /**
   * 発見を通知
   */
  private async notifyFindings(
    strategyType: StrategyType,
    findings: ResearchFinding[]
  ): Promise<void> {
    await this.discord.sendInfo({
      title: `${RESEARCH_TOPICS[strategyType].name}戦略: 重要な発見`,
      description: findings
        .slice(0, 3)
        .map(f => `• ${f.topic}: ${f.insight}`)
        .join('\n'),
      details: {
        strategyType,
        findingCount: findings.length,
      },
    });
  }

  /**
   * リサーチ結果を保存
   */
  private async saveResearchResult(
    result: ResearchResult,
    strategyType: StrategyType
  ): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'research', 'strategies', strategyType);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${result.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(result, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save research result', { error });
    }
  }

  /**
   * 全戦略タイプのリサーチを実行
   */
  async researchAllStrategies(): Promise<Map<StrategyType, ResearchResult>> {
    const results = new Map<StrategyType, ResearchResult>();

    for (const strategyType of Object.keys(RESEARCH_TOPICS) as StrategyType[]) {
      try {
        const result = await this.researchStrategy(strategyType);
        results.set(strategyType, result);
      } catch (error) {
        logger.error(`Failed to research ${strategyType}`, { error });
      }
    }

    return results;
  }

  /**
   * 日替わりでリサーチを実行（ローテーション）
   */
  async researchDailyRotation(): Promise<ResearchResult> {
    const types: StrategyType[] = ['affiliate', 'freelance', 'digital_product'];
    const dayOfWeek = new Date().getDay();
    const strategyType = types[dayOfWeek % types.length];

    logger.info(`Daily rotation: researching ${strategyType}`);
    return this.researchStrategy(strategyType);
  }

  /**
   * リサーチ履歴を取得
   */
  getResearchHistory(strategyType: StrategyType): ResearchResult[] {
    return this.researchHistory.get(strategyType) ?? [];
  }
}

// シングルトンインスタンス
let researcherInstance: ExistingStrategyResearcher | null = null;

export function getExistingStrategyResearcher(
  config?: Partial<StrategyResearchConfig>
): ExistingStrategyResearcher {
  if (!researcherInstance) {
    researcherInstance = new ExistingStrategyResearcher(config);
  }
  return researcherInstance;
}
