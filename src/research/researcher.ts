/**
 * Research機能 - ClaudeCodeを使用した攻めの改善
 *
 * アクティブ目標から調査テーマを抽出し、Web検索を含むプロンプトで調査を実行
 * 有望なアプローチをimprovementQueueに登録
 */

import { ClaudeProvider } from "../ai/claude-provider.js";
import { logger } from "../core/logger.js";
import { Goal } from "../goals/types.js";
import {
  ResearchTopic,
  ResearchResult,
  ResearchFinding,
  Approach,
  ResearchContext,
  ResearchAIResponse,
} from "./types.js";

export class Researcher {
  private claude: ClaudeProvider;

  constructor(claude?: ClaudeProvider) {
    this.claude = claude || new ClaudeProvider({ planModel: "opus" });
  }

  /**
   * アクティブ目標から調査トピックを抽出
   */
  extractTopics(goals: Goal[]): ResearchTopic[] {
    const topics: ResearchTopic[] = [];

    for (const goal of goals) {
      // アクティブな目標を調査対象に
      if (goal.active) {
        topics.push({
          id: `topic_${goal.id}_${Date.now()}`,
          topic: this.generateTopicFromGoal(goal),
          source: "goal",
          priority: this.calculatePriority(goal),
          relatedGoalId: goal.id,
          context: goal.description,
        });
      }
    }

    // 優先度順にソート
    return topics.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 目標からトピックを生成
   */
  private generateTopicFromGoal(goal: Goal): string {
    // 目標タイトルと説明から調査テーマを生成
    const keywords = this.extractKeywords(goal.title, goal.description);
    return `${goal.title}の最適な実装方法と最新のベストプラクティス（${keywords.join(", ")}）`;
  }

  /**
   * キーワードを抽出
   */
  private extractKeywords(title: string, description: string): string[] {
    const text = `${title} ${description}`;
    // 技術的なキーワードを抽出（簡易版）
    const techWords = text.match(
      /\b(api|sdk|library|framework|algorithm|pattern|architecture|performance|security|testing|monitoring)\b/gi
    );
    return [...new Set(techWords || [])].slice(0, 5);
  }

  /**
   * 優先度を計算
   */
  private calculatePriority(goal: Goal): number {
    let priority = 50; // ベース

    // メトリクスの進捗状況で調整
    if (goal.metrics && goal.metrics.length > 0) {
      const avgProgress =
        goal.metrics.reduce((sum, m) => sum + (m.current / m.target) * 100, 0) /
        goal.metrics.length;
      // 進捗が中間（30-70%）のものを優先
      if (avgProgress >= 30 && avgProgress <= 70) {
        priority += 20;
      }
    }

    // 永続的な目標（permanent）は少し優先度を上げる
    if (goal.type === "permanent") {
      priority += 10;
    }

    return Math.min(100, priority);
  }

  /**
   * トピックを調査
   */
  async research(topic: ResearchTopic): Promise<ResearchResult> {
    logger.info("Starting research", { topic: topic.topic });

    const prompt = this.buildResearchPrompt(topic);

    try {
      const response = await this.claude.chat(prompt);
      const parsed = this.parseResponse(response);

      const result: ResearchResult = {
        topic,
        findings: parsed.findings.map((f, i) => ({
          source: f.source,
          summary: f.summary,
          relevance: 0.8 - i * 0.1, // 順序に基づく関連度
          timestamp: new Date().toISOString(),
        })),
        approaches: parsed.approaches.map((a, i) => ({
          id: `approach_${topic.id}_${i}`,
          description: a.description,
          pros: a.pros,
          cons: a.cons,
          estimatedEffort: a.effort,
          confidence: a.confidence,
        })),
        recommendations: parsed.recommendations,
        timestamp: new Date().toISOString(),
      };

      logger.info("Research completed", {
        topic: topic.topic,
        findingsCount: result.findings.length,
        approachesCount: result.approaches.length,
      });

      return result;
    } catch (err) {
      logger.error("Research failed", {
        topic: topic.topic,
        error: err instanceof Error ? err.message : String(err),
      });

      // エラー時は空の結果を返す
      return {
        topic,
        findings: [],
        approaches: [],
        recommendations: [],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 調査プロンプトを生成
   */
  private buildResearchPrompt(topic: ResearchTopic): string {
    return `あなたは技術調査エージェントです。以下の目標について調査してください。

## 目標
${topic.topic}

${topic.context ? `## 追加コンテキスト\n${topic.context}` : ""}

## タスク
1. Web検索を使って、この目標に関連する最新のベストプラクティス、ライブラリ、手法を調査
2. 複数の解決アプローチを提案（各アプローチのメリット・デメリット付き）
3. 現在のコードベースに適用可能な具体的な改善案を出力

## 出力形式（JSON）
必ず以下のJSON形式で出力してください。JSON以外のテキストは含めないでください。

{
  "findings": [
    {"source": "調査元（URLまたは情報源の説明）", "summary": "発見した内容の要約"}
  ],
  "approaches": [
    {
      "description": "アプローチの説明（具体的な実装方法を含む）",
      "pros": ["メリット1", "メリット2"],
      "cons": ["デメリット1"],
      "effort": "low|medium|high",
      "confidence": 0.0から1.0の数値（実現可能性と効果の確信度）
    }
  ],
  "recommendations": ["具体的な改善提案1", "具体的な改善提案2"]
}`;
  }

  /**
   * AI応答をパース
   */
  private parseResponse(response: string): ResearchAIResponse {
    try {
      // JSON部分を抽出
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // 必須フィールドの検証とデフォルト値の設定
        return {
          findings: Array.isArray(parsed.findings)
            ? parsed.findings.map((f: Record<string, unknown>) => ({
                source: String(f.source || "unknown"),
                summary: String(f.summary || ""),
              }))
            : [],
          approaches: Array.isArray(parsed.approaches)
            ? parsed.approaches.map((a: Record<string, unknown>) => ({
                description: String(a.description || ""),
                pros: Array.isArray(a.pros) ? a.pros.map(String) : [],
                cons: Array.isArray(a.cons) ? a.cons.map(String) : [],
                effort: this.normalizeEffort(a.effort),
                confidence: this.normalizeConfidence(a.confidence),
              }))
            : [],
          recommendations: Array.isArray(parsed.recommendations)
            ? parsed.recommendations.map(String)
            : [],
        };
      }
    } catch (err) {
      logger.warn("Failed to parse research response", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // パース失敗時のデフォルト
    return {
      findings: [],
      approaches: [],
      recommendations: [],
    };
  }

  /**
   * 工数を正規化
   */
  private normalizeEffort(value: unknown): "low" | "medium" | "high" {
    const str = String(value).toLowerCase();
    if (str === "low" || str === "medium" || str === "high") {
      return str;
    }
    return "medium";
  }

  /**
   * 信頼度を正規化
   */
  private normalizeConfidence(value: unknown): number {
    const num = Number(value);
    if (isNaN(num)) return 0.5;
    return Math.max(0, Math.min(1, num));
  }
}
