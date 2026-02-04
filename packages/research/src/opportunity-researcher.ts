/**
 * 収益機会リサーチャー
 *
 * 新規収益機会の幅広い探索を担当
 * 既存の3タイプ（アフィリエイト、フリーランス、デジタルプロダクト）に縛られない発想
 */

import {
  getLogger,
  OpportunityCandidate,
  OpportunityEvaluation,
  ResearchResult,
  ResearchFinding,
} from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('OpportunityResearcher');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

// 探索対象のカテゴリとアイデア
export const OPPORTUNITY_CATEGORIES = {
  tech_skills: {
    name: '技術スキル活用',
    ideas: [
      'OSS貢献での報酬（GitHub Sponsors、Bounties）',
      'バグバウンティ（脆弱性発見報酬）',
      '技術コンサルティング',
      'コードレビュー代行',
      '技術翻訳・ローカライゼーション',
    ],
  },
  content_education: {
    name: 'コンテンツ・教育',
    ideas: [
      'オンライン講座作成（Udemy、Techpit）',
      '技術書執筆',
      'YouTube/ポッドキャスト',
      '有料ニュースレター',
      '技術ブログ（広告収入）',
    ],
  },
  service: {
    name: 'サービス提供',
    ideas: [
      'SaaS開発・運用',
      'API提供',
      '自動化ツール販売',
      'Discord Bot販売',
      'Chrome拡張機能',
    ],
  },
  community: {
    name: 'コミュニティ・マーケットプレイス',
    ideas: [
      '技術コミュニティ運営',
      'メンタリング',
      '案件仲介',
    ],
  },
  ai_focused: {
    name: 'AI特化',
    ideas: [
      'AIプロンプト販売',
      'カスタムGPT作成',
      'AI活用コンサルティング',
      'データセット作成・販売',
    ],
  },
  other: {
    name: 'その他',
    ideas: [
      'ドメイン転売',
      'アフィリエイトの新分野開拓',
      '新興プラットフォームの早期参入',
    ],
  },
};

export interface ResearchConfig {
  enableWebSearch: boolean;
  maxOpportunities: number;
  evaluationDepth: 'quick' | 'standard' | 'thorough';
  focusCategories?: string[];
}

const DEFAULT_CONFIG: ResearchConfig = {
  enableWebSearch: true,
  maxOpportunities: 10,
  evaluationDepth: 'standard',
};

export class OpportunityResearcher {
  private readonly discord = getDiscordNotifier();
  private readonly config: ResearchConfig;
  private readonly discoveredOpportunities: OpportunityCandidate[] = [];

  constructor(config: Partial<ResearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 新規収益機会の幅広い探索を実行
   */
  async discoverOpportunities(): Promise<ResearchResult> {
    logger.info('Starting opportunity discovery');

    const findings: ResearchFinding[] = [];
    const recommendations: string[] = [];
    const sources: string[] = [];

    // カテゴリごとに探索
    const categories = this.config.focusCategories ?? Object.keys(OPPORTUNITY_CATEGORIES);

    for (const categoryKey of categories) {
      const category = OPPORTUNITY_CATEGORIES[categoryKey as keyof typeof OPPORTUNITY_CATEGORIES];
      if (!category) continue;

      logger.debug(`Exploring category: ${category.name}`);

      // 各アイデアを評価
      for (const idea of category.ideas) {
        try {
          const candidate = await this.evaluateIdea(categoryKey, idea);

          if (candidate.evaluation.overallScore >= 50) {
            this.discoveredOpportunities.push(candidate);

            findings.push({
              topic: category.name,
              insight: `${idea}: スコア ${candidate.evaluation.overallScore}/100`,
              confidence: candidate.evaluation.overallScore >= 70 ? 'high' : 'medium',
              relevance: candidate.evaluation.overallScore,
              actionable: candidate.evaluation.overallScore >= 60,
              suggestedAction: candidate.evaluation.reasoning,
            });
          }
        } catch (error) {
          logger.warn(`Failed to evaluate idea: ${idea}`, { error });
        }
      }
    }

    // 最も有望な機会を推奨
    const topOpportunities = this.discoveredOpportunities
      .sort((a, b) => b.evaluation.overallScore - a.evaluation.overallScore)
      .slice(0, 5);

    for (const opp of topOpportunities) {
      recommendations.push(
        `${opp.title} (スコア: ${opp.evaluation.overallScore}) - ${opp.evaluation.reasoning}`
      );
    }

    // Web検索で追加情報を収集
    if (this.config.enableWebSearch) {
      const webFindings = await this.searchWebForOpportunities();
      findings.push(...webFindings);
      sources.push('Web検索');
    }

    const result: ResearchResult = {
      id: `research-opportunity-${Date.now()}`,
      type: 'opportunity',
      title: '新規収益機会の探索',
      summary: `${this.discoveredOpportunities.length}件の機会を発見。上位${topOpportunities.length}件を推奨。`,
      sources,
      findings,
      recommendations,
      conductedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1週間
    };

    // 結果を保存
    await this.saveResearchResult(result);

    // 有望な機会があれば通知
    if (topOpportunities.length > 0) {
      await this.notifyDiscoveries(topOpportunities);
    }

    logger.info('Opportunity discovery completed', {
      totalDiscovered: this.discoveredOpportunities.length,
      topRecommendations: topOpportunities.length,
    });

    return result;
  }

  /**
   * 特定のアイデアを評価
   */
  private async evaluateIdea(
    category: string,
    idea: string
  ): Promise<OpportunityCandidate> {
    // AI を使った評価（簡略版）
    let evaluation: OpportunityEvaluation;

    if (this.config.evaluationDepth === 'thorough') {
      evaluation = await this.aiEvaluateIdea(category, idea);
    } else {
      evaluation = this.quickEvaluateIdea(category, idea);
    }

    return {
      id: `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      category,
      title: idea,
      description: `${OPPORTUNITY_CATEGORIES[category as keyof typeof OPPORTUNITY_CATEGORIES]?.name}: ${idea}`,
      evaluation,
      status: 'discovered',
      discoveredAt: new Date(),
    };
  }

  /**
   * 簡易評価（ルールベース）
   */
  private quickEvaluateIdea(category: string, idea: string): OpportunityEvaluation {
    // カテゴリ別のベーススコア
    const categoryScores: Record<string, number> = {
      tech_skills: 70,
      content_education: 65,
      service: 75,
      community: 55,
      ai_focused: 80,
      other: 50,
    };

    const baseScore = categoryScores[category] ?? 60;

    // キーワードによる調整
    let scoreAdjustment = 0;
    const ideaLower = idea.toLowerCase();

    // 高評価キーワード
    if (ideaLower.includes('ai') || ideaLower.includes('自動')) scoreAdjustment += 10;
    if (ideaLower.includes('api') || ideaLower.includes('saas')) scoreAdjustment += 5;
    if (ideaLower.includes('bot') || ideaLower.includes('ツール')) scoreAdjustment += 5;

    // 低評価キーワード（労力が高い）
    if (ideaLower.includes('書籍') || ideaLower.includes('講座')) scoreAdjustment -= 5;
    if (ideaLower.includes('youtube') || ideaLower.includes('podcast')) scoreAdjustment -= 10;

    const overallScore = Math.min(100, Math.max(0, baseScore + scoreAdjustment));

    return {
      skillFit: this.assessSkillFit(idea),
      initialInvestment: this.assessInvestment(idea),
      timeToRevenue: this.assessTimeToRevenue(idea),
      scalability: this.assessScalability(idea),
      competition: this.assessCompetition(category),
      sustainability: this.assessSustainability(idea),
      riskLevel: this.assessRisk(idea),
      overallScore,
      reasoning: this.generateReasoning(idea, overallScore),
    };
  }

  /**
   * AIによる詳細評価
   */
  private async aiEvaluateIdea(
    category: string,
    idea: string
  ): Promise<OpportunityEvaluation> {
    const prompt = `
以下の収益化アイデアを評価してください。

カテゴリ: ${OPPORTUNITY_CATEGORIES[category as keyof typeof OPPORTUNITY_CATEGORIES]?.name}
アイデア: ${idea}

評価基準（各項目を評価し、JSONで回答）:
1. skillFit: 技術スキルとの適合度 (0-100)
2. initialInvestment: 初期投資 ("low", "medium", "high")
3. timeToRevenue: 収益化までの期間 ("immediate", "short", "medium", "long")
4. scalability: スケーラビリティ ("low", "medium", "high")
5. competition: 競争度 ("low", "medium", "high")
6. sustainability: 継続性 ("one-time", "recurring", "passive")
7. riskLevel: リスク ("low", "medium", "high")
8. overallScore: 総合スコア (0-100)
9. reasoning: 評価理由（1-2文）

\`\`\`json
{
  "skillFit": 75,
  "initialInvestment": "low",
  ...
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
          skillFit: parsed.skillFit ?? 50,
          initialInvestment: parsed.initialInvestment ?? 'medium',
          timeToRevenue: parsed.timeToRevenue ?? 'medium',
          scalability: parsed.scalability ?? 'medium',
          competition: parsed.competition ?? 'medium',
          sustainability: parsed.sustainability ?? 'recurring',
          riskLevel: parsed.riskLevel ?? 'medium',
          overallScore: parsed.overallScore ?? 50,
          reasoning: parsed.reasoning ?? 'AI評価完了',
        };
      }
    } catch (error) {
      logger.warn('AI evaluation failed, using fallback', { error });
    }

    // フォールバック
    return this.quickEvaluateIdea(category, idea);
  }

  /**
   * Web検索で追加機会を探索
   */
  private async searchWebForOpportunities(): Promise<ResearchFinding[]> {
    const findings: ResearchFinding[] = [];

    const searchQueries = [
      '2024 tech side hustle ideas',
      'AI freelancing opportunities',
      'passive income for developers',
    ];

    // 実際のWeb検索は省略（将来的にWebSearch機能を統合）
    logger.debug('Web search for opportunities (placeholder)');

    return findings;
  }

  /**
   * 発見した機会を通知
   */
  private async notifyDiscoveries(
    opportunities: OpportunityCandidate[]
  ): Promise<void> {
    await this.discord.sendInfo({
      title: '新規収益機会を発見',
      description: opportunities
        .map(o => `• **${o.title}** (スコア: ${o.evaluation.overallScore})`)
        .join('\n'),
      details: {
        totalDiscovered: this.discoveredOpportunities.length,
        topCount: opportunities.length,
      },
    });
  }

  /**
   * リサーチ結果を保存
   */
  private async saveResearchResult(result: ResearchResult): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'research', 'opportunities');
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const filename = `${result.id}.json`;
      await fs.promises.writeFile(
        path.join(dir, filename),
        JSON.stringify(result, null, 2)
      );

      // 発見した機会も保存
      const opportunitiesFile = path.join(dir, 'candidates.json');
      await fs.promises.writeFile(
        opportunitiesFile,
        JSON.stringify(this.discoveredOpportunities, null, 2)
      );
    } catch (error) {
      logger.warn('Failed to save research result', { error });
    }
  }

  /**
   * 発見した機会を取得
   */
  getDiscoveredOpportunities(): OpportunityCandidate[] {
    return [...this.discoveredOpportunities];
  }

  /**
   * 機会のステータスを更新
   */
  updateOpportunityStatus(
    id: string,
    status: OpportunityCandidate['status']
  ): void {
    const opp = this.discoveredOpportunities.find(o => o.id === id);
    if (opp) {
      opp.status = status;
      logger.info('Opportunity status updated', { id, status });
    }
  }

  // 評価ヘルパーメソッド

  private assessSkillFit(idea: string): number {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('コード') || ideaLower.includes('開発') ||
        ideaLower.includes('api') || ideaLower.includes('bot')) {
      return 80;
    }
    if (ideaLower.includes('ai') || ideaLower.includes('自動')) {
      return 85;
    }
    if (ideaLower.includes('コンサル') || ideaLower.includes('レビュー')) {
      return 70;
    }
    return 60;
  }

  private assessInvestment(idea: string): 'low' | 'medium' | 'high' {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('saas') || ideaLower.includes('プラットフォーム')) {
      return 'high';
    }
    if (ideaLower.includes('講座') || ideaLower.includes('書籍')) {
      return 'medium';
    }
    return 'low';
  }

  private assessTimeToRevenue(
    idea: string
  ): 'immediate' | 'short' | 'medium' | 'long' {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('コンサル') || ideaLower.includes('フリーランス')) {
      return 'immediate';
    }
    if (ideaLower.includes('販売') || ideaLower.includes('プロンプト')) {
      return 'short';
    }
    if (ideaLower.includes('saas') || ideaLower.includes('コース')) {
      return 'long';
    }
    return 'medium';
  }

  private assessScalability(idea: string): 'low' | 'medium' | 'high' {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('saas') || ideaLower.includes('api') ||
        ideaLower.includes('デジタル')) {
      return 'high';
    }
    if (ideaLower.includes('コンサル') || ideaLower.includes('メンタリング')) {
      return 'low';
    }
    return 'medium';
  }

  private assessCompetition(category: string): 'low' | 'medium' | 'high' {
    const competitionMap: Record<string, 'low' | 'medium' | 'high'> = {
      tech_skills: 'medium',
      content_education: 'high',
      service: 'medium',
      community: 'low',
      ai_focused: 'medium',
      other: 'low',
    };
    return competitionMap[category] ?? 'medium';
  }

  private assessSustainability(
    idea: string
  ): 'one-time' | 'recurring' | 'passive' {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('saas') || ideaLower.includes('サブスク') ||
        ideaLower.includes('ニュースレター')) {
      return 'recurring';
    }
    if (ideaLower.includes('販売') || ideaLower.includes('アフィリエイト') ||
        ideaLower.includes('広告')) {
      return 'passive';
    }
    return 'one-time';
  }

  private assessRisk(idea: string): 'low' | 'medium' | 'high' {
    const ideaLower = idea.toLowerCase();
    if (ideaLower.includes('投資') || ideaLower.includes('転売')) {
      return 'high';
    }
    if (ideaLower.includes('saas') || ideaLower.includes('プラットフォーム')) {
      return 'medium';
    }
    return 'low';
  }

  private generateReasoning(idea: string, score: number): string {
    if (score >= 80) {
      return 'スキルとの適合度が高く、比較的低リスクで始められる有望な機会';
    }
    if (score >= 60) {
      return '検討の価値あり。詳細な調査と計画が推奨';
    }
    if (score >= 40) {
      return '一部条件が合わない可能性あり。他の選択肢と比較推奨';
    }
    return '現時点では優先度が低い。市場状況の変化を監視';
  }
}

// シングルトンインスタンス
let researcherInstance: OpportunityResearcher | null = null;

export function getOpportunityResearcher(
  config?: Partial<ResearchConfig>
): OpportunityResearcher {
  if (!researcherInstance) {
    researcherInstance = new OpportunityResearcher(config);
  }
  return researcherInstance;
}
