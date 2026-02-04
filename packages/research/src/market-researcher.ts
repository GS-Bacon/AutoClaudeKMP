/**
 * 市場リサーチャー
 *
 * 市場情報の収集と競合分析を担当
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

const logger = getLogger('MarketResearcher');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface MarketSegment {
  name: string;
  description: string;
  size: 'small' | 'medium' | 'large';
  growth: 'declining' | 'stable' | 'growing' | 'rapid';
  competition: 'low' | 'medium' | 'high';
  opportunities: string[];
}

export interface CompetitorProfile {
  name: string;
  category: string;
  strengths: string[];
  weaknesses: string[];
  pricing?: string;
  marketShare?: string;
  differentiators: string[];
}

export interface MarketTrend {
  topic: string;
  direction: 'up' | 'down' | 'stable';
  impact: 'low' | 'medium' | 'high';
  timeframe: 'short' | 'medium' | 'long';
  description: string;
  implications: string[];
}

export interface MarketResearchConfig {
  enableWebSearch: boolean;
  focusAreas: string[];
  competitorTracking: boolean;
  updateFrequency: 'daily' | 'weekly' | 'monthly';
}

const DEFAULT_CONFIG: MarketResearchConfig = {
  enableWebSearch: true,
  focusAreas: ['tech_freelance', 'digital_products', 'ai_services'],
  competitorTracking: true,
  updateFrequency: 'daily',
};

// 監視対象の市場セグメント
const MARKET_SEGMENTS: MarketSegment[] = [
  {
    name: 'テック系フリーランス市場',
    description: 'ソフトウェア開発・ITコンサルのフリーランス市場',
    size: 'large',
    growth: 'growing',
    competition: 'high',
    opportunities: ['AI/ML専門', 'クラウドセキュリティ', 'リモートワーク'],
  },
  {
    name: 'デジタルコンテンツ市場',
    description: 'オンライン講座、電子書籍、テンプレート販売',
    size: 'medium',
    growth: 'rapid',
    competition: 'medium',
    opportunities: ['AIツール解説', 'プロンプトエンジニアリング', 'ノーコード開発'],
  },
  {
    name: 'AIサービス市場',
    description: 'AI活用サービス、カスタムGPT、自動化ツール',
    size: 'medium',
    growth: 'rapid',
    competition: 'medium',
    opportunities: ['業界特化ボット', 'ワークフロー自動化', 'データ分析'],
  },
  {
    name: 'アフィリエイト市場',
    description: 'Web広告、アフィリエイトマーケティング',
    size: 'large',
    growth: 'stable',
    competition: 'high',
    opportunities: ['ニッチ市場', 'AI関連製品', 'SaaS紹介'],
  },
];

export class MarketResearcher {
  private readonly discord = getDiscordNotifier();
  private readonly config: MarketResearchConfig;
  private readonly marketData: Map<string, MarketSegment> = new Map();
  private readonly competitors: Map<string, CompetitorProfile[]> = new Map();
  private readonly trends: MarketTrend[] = [];

  constructor(config: Partial<MarketResearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初期データをロード
    for (const segment of MARKET_SEGMENTS) {
      this.marketData.set(segment.name, segment);
    }
  }

  /**
   * 市場調査を実行
   */
  async conductMarketResearch(): Promise<ResearchResult> {
    logger.info('Starting market research');

    const findings: ResearchFinding[] = [];
    const recommendations: string[] = [];
    const sources: string[] = [];

    // 各市場セグメントを分析
    for (const segment of MARKET_SEGMENTS) {
      const segmentFindings = await this.analyzeMarketSegment(segment);
      findings.push(...segmentFindings);
    }

    // トレンド分析
    const trendFindings = await this.analyzeTrends();
    findings.push(...trendFindings);

    // 競合分析
    if (this.config.competitorTracking) {
      const competitorFindings = await this.analyzeCompetitors();
      findings.push(...competitorFindings);
    }

    // 推奨事項を生成
    const topFindings = findings
      .filter(f => f.actionable && f.confidence !== 'low')
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);

    for (const finding of topFindings) {
      if (finding.suggestedAction) {
        recommendations.push(finding.suggestedAction);
      }
    }

    const result: ResearchResult = {
      id: `market-research-${Date.now()}`,
      type: 'market',
      title: '市場調査レポート',
      summary: this.generateSummary(findings),
      sources,
      findings,
      recommendations,
      conductedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    // 結果を保存
    await this.saveResearchResult(result);

    logger.info('Market research completed', {
      findingCount: findings.length,
      recommendationCount: recommendations.length,
    });

    return result;
  }

  /**
   * 市場セグメントを分析
   */
  private async analyzeMarketSegment(
    segment: MarketSegment
  ): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];

    // 成長率に基づく分析
    if (segment.growth === 'rapid') {
      findings.push({
        topic: segment.name,
        insight: `急成長市場: ${segment.opportunities.join(', ')}などの機会あり`,
        confidence: 'high',
        relevance: 90,
        actionable: true,
        suggestedAction: `${segment.name}への参入を優先的に検討`,
      });
    } else if (segment.growth === 'growing') {
      findings.push({
        topic: segment.name,
        insight: `成長市場: 競争は${segment.competition}レベル`,
        confidence: 'medium',
        relevance: 70,
        actionable: true,
        suggestedAction: `${segment.opportunities[0]}での差別化を検討`,
      });
    }

    // 競争度に基づく分析
    if (segment.competition === 'low') {
      findings.push({
        topic: segment.name,
        insight: '競争が少なく参入しやすい市場',
        confidence: 'medium',
        relevance: 75,
        actionable: true,
        suggestedAction: '早期参入で先行者優位を獲得',
      });
    }

    // 機会の分析
    for (const opportunity of segment.opportunities) {
      findings.push({
        topic: `${segment.name} - ${opportunity}`,
        insight: `注目分野: ${opportunity}`,
        confidence: 'medium',
        relevance: 60,
        actionable: true,
      });
    }

    return findings;
  }

  /**
   * トレンド分析
   */
  private async analyzeTrends(): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];

    // 定義済みトレンド
    const currentTrends: MarketTrend[] = [
      {
        topic: 'AIツール・サービス',
        direction: 'up',
        impact: 'high',
        timeframe: 'short',
        description: 'AI関連の需要が急増中',
        implications: ['AI活用スキルの価値上昇', 'AIツール販売機会'],
      },
      {
        topic: 'リモートワーク',
        direction: 'stable',
        impact: 'medium',
        timeframe: 'long',
        description: 'リモートワークが定着',
        implications: ['グローバル案件の増加', '地理的制約の減少'],
      },
      {
        topic: 'ノーコード/ローコード',
        direction: 'up',
        impact: 'medium',
        timeframe: 'medium',
        description: '非エンジニアによる開発が増加',
        implications: ['教材需要', 'ツール開発機会', '既存スキルの価値変化'],
      },
      {
        topic: 'サブスクリプションモデル',
        direction: 'up',
        impact: 'medium',
        timeframe: 'long',
        description: '継続課金モデルが主流に',
        implications: ['安定収益の機会', '顧客維持の重要性'],
      },
    ];

    for (const trend of currentTrends) {
      this.trends.push(trend);

      const directionText = trend.direction === 'up' ? '上昇' :
        trend.direction === 'down' ? '下降' : '安定';

      findings.push({
        topic: `トレンド: ${trend.topic}`,
        insight: `${trend.description}（方向: ${directionText}、影響: ${trend.impact}）`,
        confidence: 'medium',
        relevance: trend.impact === 'high' ? 85 : 65,
        actionable: trend.direction === 'up',
        suggestedAction: trend.implications[0],
      });
    }

    return findings;
  }

  /**
   * 競合分析
   */
  private async analyzeCompetitors(): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];

    // 一般的な競合パターン
    const competitorPatterns: CompetitorProfile[] = [
      {
        name: '大手プラットフォーマー',
        category: 'platform',
        strengths: ['資金力', 'ユーザー基盤', 'ブランド力'],
        weaknesses: ['意思決定の遅さ', 'ニッチ対応の難しさ'],
        differentiators: ['特化・専門性', '迅速な対応', 'パーソナライズ'],
      },
      {
        name: '個人クリエイター',
        category: 'individual',
        strengths: ['柔軟性', '低コスト', '直接の顧客関係'],
        weaknesses: ['スケーラビリティ', 'マーケティング力'],
        differentiators: ['自動化', 'AI活用', 'ニッチ専門性'],
      },
    ];

    for (const competitor of competitorPatterns) {
      this.competitors.set(competitor.category, [
        ...(this.competitors.get(competitor.category) ?? []),
        competitor,
      ]);

      findings.push({
        topic: `競合: ${competitor.name}`,
        insight: `強み: ${competitor.strengths.slice(0, 2).join(', ')}。差別化ポイント: ${competitor.differentiators[0]}`,
        confidence: 'medium',
        relevance: 70,
        actionable: true,
        suggestedAction: `${competitor.differentiators[0]}を強化して差別化`,
      });
    }

    return findings;
  }

  /**
   * サマリーを生成
   */
  private generateSummary(findings: ResearchFinding[]): string {
    const highRelevance = findings.filter(f => f.relevance >= 80).length;
    const actionable = findings.filter(f => f.actionable).length;
    const growingMarkets = MARKET_SEGMENTS.filter(
      s => s.growth === 'growing' || s.growth === 'rapid'
    ).length;

    return `市場調査完了: ${findings.length}件の知見、うち${highRelevance}件が高関連性。` +
      `${growingMarkets}市場が成長中。アクション可能: ${actionable}件。`;
  }

  /**
   * 結果を保存
   */
  private async saveResearchResult(result: ResearchResult): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'research', 'market');
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
   * 市場セグメントを取得
   */
  getMarketSegments(): MarketSegment[] {
    return [...this.marketData.values()];
  }

  /**
   * トレンドを取得
   */
  getTrends(): MarketTrend[] {
    return [...this.trends];
  }

  /**
   * 成長市場を取得
   */
  getGrowingMarkets(): MarketSegment[] {
    return [...this.marketData.values()].filter(
      s => s.growth === 'growing' || s.growth === 'rapid'
    );
  }

  /**
   * 特定セグメントの機会を取得
   */
  getOpportunities(segmentName: string): string[] {
    const segment = this.marketData.get(segmentName);
    return segment?.opportunities ?? [];
  }
}

// シングルトンインスタンス
let marketResearcherInstance: MarketResearcher | null = null;

export function getMarketResearcher(
  config?: Partial<MarketResearchConfig>
): MarketResearcher {
  if (!marketResearcherInstance) {
    marketResearcherInstance = new MarketResearcher(config);
  }
  return marketResearcherInstance;
}
