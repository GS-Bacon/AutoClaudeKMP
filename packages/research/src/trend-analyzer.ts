/**
 * トレンドアナライザー
 *
 * 技術トレンドの調査と分析を担当
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

const logger = getLogger('TrendAnalyzer');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface TechnologyTrend {
  name: string;
  category: string;
  maturity: 'emerging' | 'growing' | 'mature' | 'declining';
  adoptionRate: 'low' | 'medium' | 'high';
  relevance: number; // 0-100
  description: string;
  useCases: string[];
  learningResources?: string[];
}

export interface TrendReport {
  period: string;
  analyzedAt: Date;
  trends: TechnologyTrend[];
  topTrends: string[];
  emergingTrends: string[];
  decliningTrends: string[];
  recommendations: string[];
}

export interface TrendAnalysisConfig {
  enableWebSearch: boolean;
  categories: string[];
  includeEmergingTech: boolean;
  analysisDepth: 'quick' | 'standard' | 'comprehensive';
}

const DEFAULT_CONFIG: TrendAnalysisConfig = {
  enableWebSearch: true,
  categories: ['ai', 'web', 'cloud', 'mobile', 'devops'],
  includeEmergingTech: true,
  analysisDepth: 'standard',
};

// 監視対象の技術トレンド
const TECHNOLOGY_TRENDS: TechnologyTrend[] = [
  // AI/ML
  {
    name: 'Large Language Models (LLM)',
    category: 'ai',
    maturity: 'growing',
    adoptionRate: 'high',
    relevance: 95,
    description: 'ChatGPT、Claude等の大規模言語モデル',
    useCases: ['チャットボット', 'コード生成', 'コンテンツ作成', 'データ分析'],
  },
  {
    name: 'AIエージェント',
    category: 'ai',
    maturity: 'emerging',
    adoptionRate: 'low',
    relevance: 90,
    description: '自律的にタスクを遂行するAIシステム',
    useCases: ['タスク自動化', 'リサーチ', 'コード開発', 'カスタマーサポート'],
  },
  {
    name: 'プロンプトエンジニアリング',
    category: 'ai',
    maturity: 'growing',
    adoptionRate: 'medium',
    relevance: 85,
    description: 'AI出力を最適化するプロンプト設計',
    useCases: ['AI活用最適化', 'カスタムAI開発', 'コンサルティング'],
  },
  {
    name: 'RAG (Retrieval-Augmented Generation)',
    category: 'ai',
    maturity: 'growing',
    adoptionRate: 'medium',
    relevance: 80,
    description: '外部知識を統合したAI生成',
    useCases: ['企業ナレッジベース', 'カスタムAIアシスタント', 'ドキュメント検索'],
  },

  // Web/フロントエンド
  {
    name: 'Next.js / React Server Components',
    category: 'web',
    maturity: 'mature',
    adoptionRate: 'high',
    relevance: 75,
    description: 'サーバーサイドレンダリングフレームワーク',
    useCases: ['Webアプリ開発', 'SEO対応サイト', 'フルスタック開発'],
  },
  {
    name: 'Astro / 静的サイトジェネレーター',
    category: 'web',
    maturity: 'growing',
    adoptionRate: 'medium',
    relevance: 65,
    description: 'コンテンツ中心のWebフレームワーク',
    useCases: ['ブログ', 'ドキュメントサイト', 'ポートフォリオ'],
  },

  // クラウド/インフラ
  {
    name: 'サーバーレス/Edge Computing',
    category: 'cloud',
    maturity: 'mature',
    adoptionRate: 'high',
    relevance: 70,
    description: 'サーバーレスアーキテクチャとエッジコンピューティング',
    useCases: ['API開発', 'マイクロサービス', 'グローバル配信'],
  },
  {
    name: 'Kubernetes / コンテナオーケストレーション',
    category: 'cloud',
    maturity: 'mature',
    adoptionRate: 'high',
    relevance: 65,
    description: 'コンテナ管理プラットフォーム',
    useCases: ['スケーラブルシステム', 'マイクロサービス', 'DevOps'],
  },

  // 開発ツール
  {
    name: 'AI支援コーディング',
    category: 'devops',
    maturity: 'growing',
    adoptionRate: 'high',
    relevance: 90,
    description: 'GitHub Copilot、Cursor等のAIコーディング支援',
    useCases: ['生産性向上', 'コード品質改善', '学習支援'],
  },
  {
    name: 'ローカルLLM',
    category: 'ai',
    maturity: 'emerging',
    adoptionRate: 'low',
    relevance: 75,
    description: 'Ollama、llama.cpp等のローカル実行LLM',
    useCases: ['プライバシー重視アプリ', 'オフライン対応', 'コスト削減'],
  },

  // モバイル
  {
    name: 'React Native / Flutter',
    category: 'mobile',
    maturity: 'mature',
    adoptionRate: 'high',
    relevance: 60,
    description: 'クロスプラットフォームモバイル開発',
    useCases: ['モバイルアプリ', 'MVP開発', 'マルチプラットフォーム'],
  },
];

export class TrendAnalyzer {
  private readonly discord = getDiscordNotifier();
  private readonly config: TrendAnalysisConfig;
  private readonly trendHistory: TrendReport[] = [];
  private readonly watchedTrends: Map<string, TechnologyTrend> = new Map();

  constructor(config: Partial<TrendAnalysisConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初期トレンドをロード
    for (const trend of TECHNOLOGY_TRENDS) {
      this.watchedTrends.set(trend.name, trend);
    }
  }

  /**
   * トレンド分析を実行
   */
  async analyzeTrends(): Promise<ResearchResult> {
    logger.info('Starting trend analysis');

    const findings: ResearchFinding[] = [];
    const recommendations: string[] = [];

    // カテゴリ別に分析
    for (const category of this.config.categories) {
      const categoryTrends = TECHNOLOGY_TRENDS.filter(t => t.category === category);

      for (const trend of categoryTrends) {
        const finding = this.analyzeTrend(trend);
        findings.push(finding);

        if (finding.actionable && finding.suggestedAction) {
          recommendations.push(finding.suggestedAction);
        }
      }
    }

    // レポートを生成
    const report = this.generateTrendReport(findings);
    this.trendHistory.push(report);

    // トップトレンドを抽出
    const topTrends = findings
      .filter(f => f.confidence === 'high')
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);

    const result: ResearchResult = {
      id: `trend-analysis-${Date.now()}`,
      type: 'trend',
      title: '技術トレンド分析',
      summary: this.generateSummary(report),
      sources: ['Technology Radar', 'Industry Reports', 'Developer Surveys'],
      findings,
      recommendations: recommendations.slice(0, 5),
      conductedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    // 結果を保存
    await this.saveAnalysisResult(result);

    // 重要な新興トレンドがあれば通知
    if (report.emergingTrends.length > 0) {
      await this.notifyEmergingTrends(report.emergingTrends);
    }

    logger.info('Trend analysis completed', {
      trendCount: findings.length,
      emergingCount: report.emergingTrends.length,
    });

    return result;
  }

  /**
   * 個別トレンドを分析
   */
  private analyzeTrend(trend: TechnologyTrend): ResearchFinding {
    let confidence: 'low' | 'medium' | 'high' = 'medium';
    let actionable = false;
    let suggestedAction: string | undefined;

    // 成熟度と採用率に基づく分析
    if (trend.maturity === 'emerging' && trend.relevance >= 80) {
      confidence = 'high';
      actionable = true;
      suggestedAction = `新興技術「${trend.name}」の習得を検討。早期参入で優位性を確保`;
    } else if (trend.maturity === 'growing' && trend.adoptionRate === 'high') {
      confidence = 'high';
      actionable = true;
      suggestedAction = `成長中の「${trend.name}」を活用したサービス開発を検討`;
    } else if (trend.maturity === 'mature' && trend.adoptionRate === 'high') {
      confidence = 'high';
      actionable = trend.relevance >= 70;
      if (actionable) {
        suggestedAction = `成熟技術「${trend.name}」での差別化ポイントを探索`;
      }
    } else if (trend.maturity === 'declining') {
      confidence = 'medium';
      actionable = true;
      suggestedAction = `「${trend.name}」からの移行を計画`;
    }

    const maturityText = {
      emerging: '新興',
      growing: '成長中',
      mature: '成熟',
      declining: '衰退',
    }[trend.maturity];

    return {
      topic: trend.name,
      insight: `${trend.description}（${maturityText}、採用率: ${trend.adoptionRate}）。用途: ${trend.useCases.slice(0, 2).join(', ')}`,
      confidence,
      relevance: trend.relevance,
      actionable,
      suggestedAction,
    };
  }

  /**
   * トレンドレポートを生成
   */
  private generateTrendReport(findings: ResearchFinding[]): TrendReport {
    const trends = TECHNOLOGY_TRENDS.filter(t =>
      this.config.categories.includes(t.category)
    );

    const topTrends = trends
      .filter(t => t.adoptionRate === 'high' && t.maturity !== 'declining')
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5)
      .map(t => t.name);

    const emergingTrends = trends
      .filter(t => t.maturity === 'emerging')
      .sort((a, b) => b.relevance - a.relevance)
      .map(t => t.name);

    const decliningTrends = trends
      .filter(t => t.maturity === 'declining')
      .map(t => t.name);

    const recommendations = findings
      .filter(f => f.actionable && f.suggestedAction)
      .map(f => f.suggestedAction!)
      .slice(0, 3);

    return {
      period: new Date().toISOString().slice(0, 7), // YYYY-MM
      analyzedAt: new Date(),
      trends,
      topTrends,
      emergingTrends,
      decliningTrends,
      recommendations,
    };
  }

  /**
   * サマリーを生成
   */
  private generateSummary(report: TrendReport): string {
    return `${report.trends.length}件の技術トレンドを分析。` +
      `トップトレンド: ${report.topTrends.slice(0, 3).join(', ')}。` +
      `新興: ${report.emergingTrends.length}件、衰退: ${report.decliningTrends.length}件。`;
  }

  /**
   * 新興トレンドを通知
   */
  private async notifyEmergingTrends(trends: string[]): Promise<void> {
    if (trends.length === 0) return;

    await this.discord.sendInfo({
      title: '注目の新興技術トレンド',
      description: trends.map(t => {
        const trend = this.watchedTrends.get(t);
        return `• **${t}**: ${trend?.description ?? ''}`;
      }).join('\n'),
      details: {
        count: trends.length,
        analyzedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * 結果を保存
   */
  private async saveAnalysisResult(result: ResearchResult): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'research', 'trends');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${result.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(result, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save trend analysis', { error });
    }
  }

  /**
   * カテゴリ別トレンドを取得
   */
  getTrendsByCategory(category: string): TechnologyTrend[] {
    return TECHNOLOGY_TRENDS.filter(t => t.category === category);
  }

  /**
   * 高関連性トレンドを取得
   */
  getHighRelevanceTrends(minRelevance: number = 80): TechnologyTrend[] {
    return TECHNOLOGY_TRENDS.filter(t => t.relevance >= minRelevance);
  }

  /**
   * 新興トレンドを取得
   */
  getEmergingTrends(): TechnologyTrend[] {
    return TECHNOLOGY_TRENDS.filter(t => t.maturity === 'emerging');
  }

  /**
   * トレンド履歴を取得
   */
  getTrendHistory(): TrendReport[] {
    return [...this.trendHistory];
  }

  /**
   * 特定トレンドの詳細を取得
   */
  getTrendDetails(name: string): TechnologyTrend | undefined {
    return this.watchedTrends.get(name);
  }

  /**
   * トレンドを追加（カスタム監視）
   */
  addTrendToWatch(trend: TechnologyTrend): void {
    this.watchedTrends.set(trend.name, trend);
    logger.info('Added trend to watch', { name: trend.name });
  }
}

// シングルトンインスタンス
let trendAnalyzerInstance: TrendAnalyzer | null = null;

export function getTrendAnalyzer(
  config?: Partial<TrendAnalysisConfig>
): TrendAnalyzer {
  if (!trendAnalyzerInstance) {
    trendAnalyzerInstance = new TrendAnalyzer(config);
  }
  return trendAnalyzerInstance;
}
