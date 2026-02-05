/**
 * アプローチ探索機能
 *
 * 複数の解決アプローチを生成・評価し、有望なアプローチをimprovementQueueに登録
 */

import { logger } from "../core/logger.js";
import { improvementQueue, QueuedImprovementInput } from "../improvement-queue/index.js";
import { Approach, ResearchResult, ResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./types.js";

export class ApproachExplorer {
  private config: ResearchConfig;

  constructor(config?: Partial<ResearchConfig>) {
    this.config = { ...DEFAULT_RESEARCH_CONFIG, ...config };
  }

  /**
   * 調査結果から有望なアプローチを抽出してキューに登録
   */
  async processResearchResult(result: ResearchResult): Promise<number> {
    const qualifiedApproaches = this.filterQualifiedApproaches(result.approaches);

    if (qualifiedApproaches.length === 0) {
      logger.debug("No qualified approaches found", {
        topic: result.topic.topic,
        totalApproaches: result.approaches.length,
        minConfidence: this.config.minConfidenceToQueue,
      });
      return 0;
    }

    let queuedCount = 0;

    for (const approach of qualifiedApproaches) {
      const improvementItem = this.createImprovementItem(result, approach);

      try {
        improvementQueue.enqueue(improvementItem);
        queuedCount++;
        logger.info("Approach queued for improvement", {
          approachId: approach.id,
          description: approach.description.substring(0, 100),
          confidence: approach.confidence,
          effort: approach.estimatedEffort,
        });
      } catch (err) {
        logger.warn("Failed to queue approach", {
          approachId: approach.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return queuedCount;
  }

  /**
   * 信頼度が閾値以上のアプローチをフィルタ
   */
  private filterQualifiedApproaches(approaches: Approach[]): Approach[] {
    return approaches
      .filter((a) => a.confidence >= this.config.minConfidenceToQueue)
      .sort((a, b) => {
        // 信頼度が高く、工数が低いものを優先
        const confidenceScore = b.confidence - a.confidence;
        const effortScore = this.getEffortScore(a.estimatedEffort) - this.getEffortScore(b.estimatedEffort);
        return confidenceScore * 0.7 + effortScore * 0.3;
      });
  }

  /**
   * 工数をスコアに変換（低いほど高スコア）
   */
  private getEffortScore(effort: "low" | "medium" | "high"): number {
    switch (effort) {
      case "low":
        return 1;
      case "medium":
        return 0.5;
      case "high":
        return 0;
    }
  }

  /**
   * アプローチからQueuedImprovementInputを作成
   */
  private createImprovementItem(result: ResearchResult, approach: Approach): QueuedImprovementInput {
    // 優先度を計算（0-100）
    const priority = Math.round(
      approach.confidence * 60 + // 信頼度（最大60点）
      this.getEffortScore(approach.estimatedEffort) * 20 + // 工数（最大20点）
      (result.topic.priority / 100) * 20 // トピック優先度（最大20点）
    );

    // メリット・デメリットを含む詳細説明
    const details = this.buildDescription(result, approach);

    return {
      source: "research",
      type: "research-finding",
      title: approach.description.substring(0, 100),
      description: approach.description,
      priority: Math.min(100, priority),
      details,
      relatedGoalId: result.topic.relatedGoalId,
      metadata: {
        approachId: approach.id,
        confidence: approach.confidence,
        effort: approach.estimatedEffort,
        pros: approach.pros,
        cons: approach.cons,
        researchTimestamp: result.timestamp,
        findings: result.findings.map((f) => f.source),
      },
    };
  }

  /**
   * 詳細説明を生成
   */
  private buildDescription(result: ResearchResult, approach: Approach): string {
    const parts: string[] = [];

    parts.push(`## アプローチ\n${approach.description}`);

    if (approach.pros.length > 0) {
      parts.push(`\n## メリット\n${approach.pros.map((p) => `- ${p}`).join("\n")}`);
    }

    if (approach.cons.length > 0) {
      parts.push(`\n## デメリット\n${approach.cons.map((c) => `- ${c}`).join("\n")}`);
    }

    parts.push(`\n## 推定工数: ${approach.estimatedEffort}`);
    parts.push(`## 信頼度: ${Math.round(approach.confidence * 100)}%`);

    if (result.findings.length > 0) {
      parts.push(`\n## 参考情報\n${result.findings.slice(0, 3).map((f) => `- ${f.source}: ${f.summary}`).join("\n")}`);
    }

    return parts.join("\n");
  }

  /**
   * 複数のアプローチを比較評価
   */
  compareApproaches(approaches: Approach[]): {
    best: Approach | null;
    ranking: Array<{ approach: Approach; score: number }>;
  } {
    if (approaches.length === 0) {
      return { best: null, ranking: [] };
    }

    const ranking = approaches
      .map((approach) => ({
        approach,
        score: this.calculateOverallScore(approach),
      }))
      .sort((a, b) => b.score - a.score);

    return {
      best: ranking[0].approach,
      ranking,
    };
  }

  /**
   * アプローチの総合スコアを計算
   */
  private calculateOverallScore(approach: Approach): number {
    // 信頼度（40%）
    const confidenceScore = approach.confidence * 40;

    // 工数効率（30%）
    const effortScore = this.getEffortScore(approach.estimatedEffort) * 30;

    // メリット/デメリット比（30%）
    const prosConsRatio =
      approach.pros.length > 0
        ? approach.pros.length / (approach.pros.length + approach.cons.length)
        : 0.5;
    const prosConsScore = prosConsRatio * 30;

    return confidenceScore + effortScore + prosConsScore;
  }
}

// シングルトンインスタンス
export const approachExplorer = new ApproachExplorer();
