/**
 * 3段階レビュー（三審制）
 *
 * 第一審 → 控訴審 → 上告審の最大3段階で審理
 * 各審理結果をTrialRecordとして蓄積し、前審の履歴を次審に引き継ぐ
 */

import { logger } from "../core/logger.js";
import { ClaudeProvider } from "../ai/claude-provider.js";
import { parseJSONObject } from "../ai/json-parser.js";
import { TrialSystemResult, TrialRecord, TrialLevel } from "./review-types.js";

export class AppealManager {
  private claudeProvider: ClaudeProvider;

  constructor() {
    this.claudeProvider = new ClaudeProvider();
  }

  /**
   * 三審制レビュー: 最大3回の審理を実行
   * 第一審 → 控訴審 → 上告審。承認された時点で終了。
   */
  async runTrialSystem(
    filePath: string,
    changeDescription: string,
    proposedCode?: string
  ): Promise<TrialSystemResult> {
    logger.info("Protected file review started (三審制)", { file: filePath });

    const trialLevels: TrialLevel[] = ["first", "appeal", "final"];
    const trialHistory: TrialRecord[] = [];

    for (let i = 0; i < trialLevels.length; i++) {
      const level = trialLevels[i];
      const previousRejections = trialHistory
        .filter(t => !t.approved)
        .map(t => `[${t.level}] ${t.reason}`);

      const result = await this.reviewOnce(
        filePath, changeDescription, proposedCode,
        previousRejections.length > 0 ? previousRejections.join("\n") : undefined
      );

      trialHistory.push({
        level, approved: result.approved,
        reason: result.reason, timestamp: new Date().toISOString(),
      });

      if (result.approved) {
        return { approved: true, trialsCompleted: i + 1, trialHistory, finalReason: result.reason };
      }

      logger.info(`Review rejected at ${level} trial`, { file: filePath, reason: result.reason });
    }

    return {
      approved: false, trialsCompleted: 3, trialHistory,
      finalReason: `全3審で拒否: ${trialHistory[trialHistory.length - 1].reason}`,
    };
  }

  private async reviewOnce(
    filePath: string,
    changeDescription: string,
    proposedCode?: string,
    previousRejectionReason?: string
  ): Promise<{ approved: boolean; reason: string }> {
    const prompt = this.buildPrompt(filePath, changeDescription, proposedCode, previousRejectionReason);

    try {
      const response = await this.claudeProvider.chat(prompt);
      const parsed = parseJSONObject<{ approved: boolean; reason: string }>(response);

      if (parsed && typeof parsed.approved === "boolean") {
        return { approved: parsed.approved, reason: parsed.reason || "No reason" };
      }

      return { approved: false, reason: "Failed to parse review response" };
    } catch (err) {
      logger.warn("Review request failed", { error: err instanceof Error ? err.message : String(err) });
      return { approved: false, reason: "Review unavailable" };
    }
  }

  private buildPrompt(
    filePath: string,
    changeDescription: string,
    proposedCode?: string,
    previousRejectionReason?: string
  ): string {
    let prompt = `あなたはセキュリティレビュアーです。保護ファイルへの変更が正当か判断してください。

## 対象ファイル
${filePath}

## 変更の説明
${changeDescription}

${proposedCode ? `## 提案されたコード（一部）
\`\`\`
${proposedCode.slice(0, 1500)}
\`\`\`` : ""}`;

    if (previousRejectionReason) {
      prompt += `

## 前回までの審理結果
${previousRejectionReason}

上記の審理履歴を踏まえ、変更の正当性を再評価してください。正当な改善であれば承認してください。`;
    }

    prompt += `

## 判断基準
1. システムの安定性を損なわないか
2. セキュリティ機構を弱体化させないか
3. 正当な改善（バグ修正、パフォーマンス改善等）であるか
4. 変更が必要最小限であるか

## 回答形式（JSON）
{"approved": true/false, "reason": "判断理由"}

JSONのみを出力してください。`;

    return prompt;
  }
}
