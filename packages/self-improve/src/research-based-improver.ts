/**
 * 調査ベース改善プロセス
 *
 * 改善実行前の調査フェーズを実装
 * - 問題の調査
 * - 解決策の調査
 * - 実装方法の調査
 * - 調査結果の記録
 */

import {
  getLogger,
  ResearchLog,
} from '@auto-claude/core';
import { getClaudeCLI } from '@auto-claude/ai-router';
import { getDiscordNotifier } from '@auto-claude/notification';
import type { ProcessImprovement, RootCause } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('ResearchBasedImprover');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface ResearchPhase {
  name: string;
  queries: string[];
  findings: string[];
  sources: string[];
  conclusion: string;
  conductedAt: Date;
}

export interface ImprovementResearch {
  improvementId: string;
  rootCauseId?: string;
  phases: {
    problem?: ResearchPhase;
    solution?: ResearchPhase;
    implementation?: ResearchPhase;
  };
  overallConclusion: string;
  confidence: 'low' | 'medium' | 'high';
  recommendedApproach: string;
  risks: string[];
  completedAt?: Date;
}

export interface ResearchConfig {
  enableWebSearch: boolean;
  maxQueriesPerPhase: number;
  researchDepth: 'quick' | 'standard' | 'thorough';
}

const DEFAULT_CONFIG: ResearchConfig = {
  enableWebSearch: true,
  maxQueriesPerPhase: 3,
  researchDepth: 'standard',
};

export class ResearchBasedImprover {
  private readonly claudeCLI = getClaudeCLI();
  private readonly discord = getDiscordNotifier();
  private readonly config: ResearchConfig;
  private readonly researchHistory: Map<string, ImprovementResearch> = new Map();

  constructor(config: Partial<ResearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 改善のための完全な調査を実行
   */
  async conductResearch(
    improvement: ProcessImprovement,
    rootCause?: RootCause
  ): Promise<ImprovementResearch> {
    logger.info('Starting research for improvement', {
      improvementId: improvement.id,
      description: improvement.description,
    });

    const research: ImprovementResearch = {
      improvementId: improvement.id,
      rootCauseId: rootCause?.problemId,
      phases: {},
      overallConclusion: '',
      confidence: 'low',
      recommendedApproach: '',
      risks: [],
    };

    try {
      // Phase 1: 問題の調査
      research.phases.problem = await this.researchProblem(improvement, rootCause);

      // Phase 2: 解決策の調査
      research.phases.solution = await this.researchSolution(
        improvement,
        research.phases.problem
      );

      // Phase 3: 実装方法の調査
      research.phases.implementation = await this.researchImplementation(
        improvement,
        research.phases.solution
      );

      // 全体の結論を導出
      research.overallConclusion = this.synthesizeConclusion(research);
      research.confidence = this.assessConfidence(research);
      research.recommendedApproach = this.determineApproach(research);
      research.risks = this.identifyRisks(research);
      research.completedAt = new Date();

      // 結果を保存
      this.researchHistory.set(improvement.id, research);
      await this.saveResearch(research);

      logger.info('Research completed', {
        improvementId: improvement.id,
        confidence: research.confidence,
      });

    } catch (error) {
      logger.error('Research failed', {
        improvementId: improvement.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return research;
  }

  /**
   * Phase 1: 問題の調査
   */
  private async researchProblem(
    improvement: ProcessImprovement,
    rootCause?: RootCause
  ): Promise<ResearchPhase> {
    logger.debug('Researching problem', { improvementId: improvement.id });

    const queries: string[] = [];
    const findings: string[] = [];
    const sources: string[] = [];

    // 問題に関する検索クエリを生成
    const problemContext = rootCause
      ? `${rootCause.category}: ${rootCause.description}`
      : improvement.description;

    queries.push(
      `${problemContext} 一般的な解決策`,
      `${problemContext} ベストプラクティス`,
      `${problemContext} 原因と対策`
    );

    // AIに問題分析を依頼
    const prompt = `以下の問題について調査し、一般的な解決策とベストプラクティスを教えてください。

問題: ${problemContext}

提案されている改善: ${improvement.description}

以下の形式で回答してください:
1. 問題の一般的な原因（箇条書き）
2. よく使われる解決策（箇条書き）
3. ベストプラクティス（箇条書き）
4. 注意点（箇条書き）`;

    try {
      const result = await this.claudeCLI.executeTask({
        prompt,
        allowedTools: ['Read', 'WebSearch'],
        timeout: 60 * 1000,
      });

      if (result.success && result.output) {
        findings.push(result.output);
        sources.push('Claude AI Analysis');
      }
    } catch (error) {
      logger.warn('Problem research failed', { error });
      findings.push('調査エラー: AIによる分析が失敗しました');
    }

    return {
      name: '問題の調査',
      queries,
      findings,
      sources,
      conclusion: this.summarizeFindings(findings, 'problem'),
      conductedAt: new Date(),
    };
  }

  /**
   * Phase 2: 解決策の調査
   */
  private async researchSolution(
    improvement: ProcessImprovement,
    problemResearch: ResearchPhase
  ): Promise<ResearchPhase> {
    logger.debug('Researching solution', { improvementId: improvement.id });

    const queries: string[] = [];
    const findings: string[] = [];
    const sources: string[] = [];

    queries.push(
      `${improvement.description} 実装方法`,
      `${improvement.description} 副作用`,
      `${improvement.description} 代替案`
    );

    // 解決策の妥当性を検証
    const prompt = `以下の改善策について、その妥当性と潜在的なリスクを評価してください。

問題の調査結果:
${problemResearch.conclusion}

提案されている改善策:
${improvement.implementation}

期待される効果:
${improvement.expectedOutcome}

以下の形式で回答してください:
1. 解決策の妥当性評価（有効/部分的に有効/要検討）
2. この解決策が有効な理由または問題点
3. 潜在的なリスクや副作用
4. より良い代替案があれば`;

    try {
      const result = await this.claudeCLI.executeTask({
        prompt,
        allowedTools: ['Read', 'WebSearch'],
        timeout: 60 * 1000,
      });

      if (result.success && result.output) {
        findings.push(result.output);
        sources.push('Claude AI Evaluation');
      }
    } catch (error) {
      logger.warn('Solution research failed', { error });
      findings.push('調査エラー: 解決策の評価が失敗しました');
    }

    return {
      name: '解決策の調査',
      queries,
      findings,
      sources,
      conclusion: this.summarizeFindings(findings, 'solution'),
      conductedAt: new Date(),
    };
  }

  /**
   * Phase 3: 実装方法の調査
   */
  private async researchImplementation(
    improvement: ProcessImprovement,
    solutionResearch: ResearchPhase
  ): Promise<ResearchPhase> {
    logger.debug('Researching implementation', { improvementId: improvement.id });

    const queries: string[] = [];
    const findings: string[] = [];
    const sources: string[] = [];

    queries.push(
      `${improvement.target} 変更方法`,
      `${improvement.target} 安全な更新手順`,
      `${improvement.implementation} 実装パターン`
    );

    // 実装方法の詳細を調査
    const prompt = `以下の改善を実装する具体的な方法を教えてください。

改善内容: ${improvement.implementation}
対象: ${improvement.target}
タイプ: ${improvement.type}

解決策の評価結果:
${solutionResearch.conclusion}

以下の形式で回答してください:
1. 推奨される実装手順（ステップバイステップ）
2. 使用すべきツールやライブラリ
3. テスト方法
4. ロールバック手順`;

    try {
      const result = await this.claudeCLI.executeTask({
        prompt,
        allowedTools: ['Read', 'Grep', 'Glob'],
        timeout: 60 * 1000,
      });

      if (result.success && result.output) {
        findings.push(result.output);
        sources.push('Claude AI Implementation Guide');
      }
    } catch (error) {
      logger.warn('Implementation research failed', { error });
      findings.push('調査エラー: 実装方法の調査が失敗しました');
    }

    return {
      name: '実装方法の調査',
      queries,
      findings,
      sources,
      conclusion: this.summarizeFindings(findings, 'implementation'),
      conductedAt: new Date(),
    };
  }

  /**
   * 調査結果を要約
   */
  private summarizeFindings(findings: string[], phase: string): string {
    if (findings.length === 0) {
      return `${phase}フェーズ: 調査結果なし`;
    }

    // 最初の発見をメインの結論として使用
    const mainFinding = findings[0];
    if (mainFinding.length > 500) {
      return mainFinding.substring(0, 500) + '...';
    }

    return mainFinding;
  }

  /**
   * 全体の結論を導出
   */
  private synthesizeConclusion(research: ImprovementResearch): string {
    const parts: string[] = [];

    if (research.phases.problem?.conclusion) {
      parts.push(`【問題分析】${research.phases.problem.conclusion.substring(0, 200)}`);
    }

    if (research.phases.solution?.conclusion) {
      parts.push(`【解決策評価】${research.phases.solution.conclusion.substring(0, 200)}`);
    }

    if (research.phases.implementation?.conclusion) {
      parts.push(`【実装方法】${research.phases.implementation.conclusion.substring(0, 200)}`);
    }

    return parts.join('\n\n');
  }

  /**
   * 信頼度を評価
   */
  private assessConfidence(research: ImprovementResearch): 'low' | 'medium' | 'high' {
    let score = 0;

    // 各フェーズの完了度をチェック
    if (research.phases.problem?.findings.length) score += 1;
    if (research.phases.solution?.findings.length) score += 1;
    if (research.phases.implementation?.findings.length) score += 1;

    // ソースの多様性
    const allSources = [
      ...(research.phases.problem?.sources ?? []),
      ...(research.phases.solution?.sources ?? []),
      ...(research.phases.implementation?.sources ?? []),
    ];
    const uniqueSources = new Set(allSources);
    if (uniqueSources.size >= 3) score += 1;

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  /**
   * 推奨アプローチを決定
   */
  private determineApproach(research: ImprovementResearch): string {
    if (research.confidence === 'high') {
      return '調査結果に基づき、提案された改善を実装することを推奨';
    }

    if (research.confidence === 'medium') {
      return '追加の検証を行いながら、段階的に実装することを推奨';
    }

    return '追加の調査または代替案の検討を推奨';
  }

  /**
   * リスクを特定
   */
  private identifyRisks(research: ImprovementResearch): string[] {
    const risks: string[] = [];

    if (research.confidence === 'low') {
      risks.push('調査が不十分なため、予期しない問題が発生する可能性');
    }

    // 解決策調査からリスクを抽出（簡略化）
    const solutionConclusion = research.phases.solution?.conclusion ?? '';
    if (solutionConclusion.includes('リスク') || solutionConclusion.includes('副作用')) {
      risks.push('解決策に潜在的なリスクが特定されています');
    }

    if (risks.length === 0) {
      risks.push('重大なリスクは特定されていません');
    }

    return risks;
  }

  /**
   * 調査結果を保存
   */
  private async saveResearch(research: ImprovementResearch): Promise<void> {
    const dir = path.join(WORKSPACE_PATH, 'research', 'improvements');

    try {
      await fs.promises.mkdir(dir, { recursive: true });

      // 詳細な調査結果をJSONで保存
      const jsonFile = path.join(dir, `${research.improvementId}.json`);
      await fs.promises.writeFile(
        jsonFile,
        JSON.stringify(research, null, 2)
      );

      // 調査ログをMDで保存
      const mdFile = path.join(dir, `${research.improvementId}.md`);
      const mdContent = this.formatResearchAsMarkdown(research);
      await fs.promises.writeFile(mdFile, mdContent);

      logger.debug('Research saved', { improvementId: research.improvementId });
    } catch (error) {
      logger.warn('Failed to save research', { error });
    }
  }

  /**
   * 調査結果をMarkdown形式でフォーマット
   */
  private formatResearchAsMarkdown(research: ImprovementResearch): string {
    const lines: string[] = [
      `# 改善調査レポート: ${research.improvementId}`,
      '',
      `**完了日時:** ${research.completedAt?.toISOString() ?? '未完了'}`,
      `**信頼度:** ${research.confidence}`,
      '',
      '---',
      '',
    ];

    // 各フェーズの結果
    if (research.phases.problem) {
      lines.push('## 1. 問題の調査');
      lines.push('');
      lines.push('### 検索クエリ');
      for (const query of research.phases.problem.queries) {
        lines.push(`- ${query}`);
      }
      lines.push('');
      lines.push('### 結論');
      lines.push(research.phases.problem.conclusion);
      lines.push('');
    }

    if (research.phases.solution) {
      lines.push('## 2. 解決策の調査');
      lines.push('');
      lines.push('### 検索クエリ');
      for (const query of research.phases.solution.queries) {
        lines.push(`- ${query}`);
      }
      lines.push('');
      lines.push('### 結論');
      lines.push(research.phases.solution.conclusion);
      lines.push('');
    }

    if (research.phases.implementation) {
      lines.push('## 3. 実装方法の調査');
      lines.push('');
      lines.push('### 検索クエリ');
      for (const query of research.phases.implementation.queries) {
        lines.push(`- ${query}`);
      }
      lines.push('');
      lines.push('### 結論');
      lines.push(research.phases.implementation.conclusion);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## 総合結論');
    lines.push('');
    lines.push(research.overallConclusion);
    lines.push('');
    lines.push('## 推奨アプローチ');
    lines.push('');
    lines.push(research.recommendedApproach);
    lines.push('');
    lines.push('## 特定されたリスク');
    lines.push('');
    for (const risk of research.risks) {
      lines.push(`- ${risk}`);
    }

    return lines.join('\n');
  }

  /**
   * 調査履歴を取得
   */
  getResearchHistory(): ImprovementResearch[] {
    return Array.from(this.researchHistory.values());
  }

  /**
   * 特定の改善の調査結果を取得
   */
  getResearch(improvementId: string): ImprovementResearch | undefined {
    return this.researchHistory.get(improvementId);
  }

  /**
   * 調査が必要かどうかを判定
   */
  needsResearch(improvement: ProcessImprovement): boolean {
    // 既に調査済みの場合はスキップ
    if (this.researchHistory.has(improvement.id)) {
      return false;
    }

    // 低リスクなコード以外の変更は調査推奨
    if (improvement.target === 'code') {
      return true;
    }

    // 設定変更は調査推奨
    if (improvement.target === 'config') {
      return true;
    }

    // その他は調査を推奨
    return true;
  }
}

// シングルトンインスタンス
let improverInstance: ResearchBasedImprover | null = null;

export function getResearchBasedImprover(
  config?: Partial<ResearchConfig>
): ResearchBasedImprover {
  if (!improverInstance) {
    improverInstance = new ResearchBasedImprover(config);
  }
  return improverInstance;
}
