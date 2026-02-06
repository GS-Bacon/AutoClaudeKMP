/**
 * Cycle Logger
 *
 * 作業が発生したサイクルのみ、ログを自動保存
 * 保存先: workspace/logs/YYYY-MM-DD-cycle-{cycleId}.md
 */

import { writeFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { CycleContext, CycleType, ResearchCycleData } from "../phases/types.js";
import { logger } from "./logger.js";
import { aiSummarizer, CycleSummary, CycleSummaryInput } from "../ai/summarizer.js";

const LOG_DIR = "./workspace/logs";
const MAX_MESSAGE_LENGTH = 200;  // エラーメッセージの最大長

export interface CycleLogData {
  cycleId: string;
  cycleType: CycleType;  // サイクルタイプ
  startTime: Date;
  endTime: Date;
  duration: number;
  success: boolean;
  skippedEarly: boolean;
  issuesDetected: Array<{
    type: string;
    message: string;
    file?: string;
    detectedProblem?: string;
    resolution?: string;
    resolved?: boolean;
  }>;
  changesMade: Array<{
    file: string;
    changeType: string;
    summary?: string;
    relatedIssue?: string;
  }>;
  troubles: Array<{
    type: string;
    message: string;
  }>;
  tokenUsage?: {
    totalInput: number;
    totalOutput: number;
  };
  failedPhase?: string;
  failureReason?: string;
  aiSummary?: CycleSummary;
  // リサーチサイクル用データ
  researchData?: {
    topic: { id: string; topic: string; source: string; priority: number; relatedGoalId?: string; };
    findings: Array<{ source: string; summary: string; relevance: number; }>;
    approaches: Array<{ id: string; description: string; pros: string[]; cons: string[]; estimatedEffort: string; confidence: number; }>;
    recommendations: string[];
    queuedImprovements: number;
  };
}

class CycleLogger {
  /**
   * サイクル完了時にログを保存するかどうかを判定
   */
  shouldLog(context: CycleContext, skippedEarly: boolean): boolean {
    // 早期終了した場合はログ不要
    if (skippedEarly) {
      return false;
    }

    // タイプ別判定
    if (context.cycleData) {
      switch (context.cycleData.type) {
        case "research": {
          const data = context.cycleData as ResearchCycleData;
          // findingsまたはapproachesがあればログ
          return data.findings.length > 0 || data.approaches.length > 0;
        }
        // 将来のタイプもここに追加
        default:
          break;
      }
    }

    // 既存のrepairロジック
    // 変更があった場合はログ
    if (context.implementedChanges && context.implementedChanges.length > 0) {
      return true;
    }

    // トラブルがあった場合はログ
    if (context.troubles && context.troubles.length > 0) {
      return true;
    }

    // 問題が検出された場合もログ
    if (context.issues && context.issues.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * サイクルログを保存
   */
  async saveLog(context: CycleContext, success: boolean, skippedEarly: boolean = false): Promise<string | null> {
    if (!this.shouldLog(context, skippedEarly)) {
      logger.debug("Skipping cycle log - no significant work");
      return null;
    }

    const logData = this.buildLogData(context, success, skippedEarly);

    // AI要約を生成
    try {
      const summaryInput: CycleSummaryInput = {
        cycleId: logData.cycleId,
        success: logData.success,
        duration: logData.duration,
        failedPhase: logData.failedPhase,
        failureReason: logData.failureReason,
        issues: logData.issuesDetected,
        changes: logData.changesMade,
        troubles: logData.troubles,
      };

      const aiSummary = await aiSummarizer.summarizeCycle(summaryInput);
      if (aiSummary) {
        logData.aiSummary = aiSummary;
      } else {
        // フォールバック要約を使用
        logData.aiSummary = aiSummarizer.generateFallbackCycleSummary(summaryInput);
      }
    } catch (error) {
      logger.warn("Failed to generate AI summary, using fallback", { error });
      // フォールバック要約
      logData.aiSummary = aiSummarizer.generateFallbackCycleSummary({
        cycleId: logData.cycleId,
        success: logData.success,
        duration: logData.duration,
        failedPhase: logData.failedPhase,
        failureReason: logData.failureReason,
        issues: logData.issuesDetected,
        changes: logData.changesMade,
        troubles: logData.troubles,
      });
    }

    const markdown = this.formatMarkdown(logData);
    const filename = this.getFilename(logData);

    try {
      this.ensureLogDir();
      const filepath = join(LOG_DIR, filename);
      writeFileSync(filepath, markdown);
      logger.info("Cycle log saved", { filepath });
      return filepath;
    } catch (error) {
      logger.error("Failed to save cycle log", { error });
      return null;
    }
  }

  /**
   * エラーメッセージを截断（JSON部分を除去）
   */
  private truncateMessage(msg: string, maxLen: number = MAX_MESSAGE_LENGTH): string {
    if (!msg) return "";

    // JSON部分を検出して除去
    const jsonStart = msg.indexOf('{');
    const jsonArrayStart = msg.indexOf('[');

    let cleanMsg = msg;
    if (jsonStart > 0 && (jsonArrayStart < 0 || jsonStart < jsonArrayStart)) {
      cleanMsg = msg.slice(0, jsonStart).trim();
    } else if (jsonArrayStart > 0) {
      cleanMsg = msg.slice(0, jsonArrayStart).trim();
    }

    // 长すぎる場合は截断
    if (cleanMsg.length > maxLen) {
      return cleanMsg.slice(0, maxLen) + "...";
    }

    return cleanMsg;
  }

  /**
   * サイクルタイプを判定
   */
  private determineCycleType(context: CycleContext): CycleType {
    if (context.cycleData) {
      return context.cycleData.type;
    }
    // デフォルトはrepair
    return "repair";
  }

  /**
   * ログデータを構築
   */
  private buildLogData(context: CycleContext, success: boolean, skippedEarly: boolean): CycleLogData {
    const endTime = new Date();
    const duration = endTime.getTime() - context.startTime.getTime();
    const cycleType = this.determineCycleType(context);

    const logData: CycleLogData = {
      cycleId: context.cycleId,
      cycleType,
      startTime: context.startTime,
      endTime,
      duration,
      success,
      skippedEarly,
      issuesDetected: (context.issues || []).map((i) => ({
        type: i.type,
        message: this.truncateMessage(i.message),
        file: i.file,
        detectedProblem: i.detectedProblem,
        resolution: i.resolution,
        resolved: i.resolved,
      })),
      changesMade: (context.implementedChanges || []).map((c) => ({
        file: c.file,
        changeType: c.changeType,
        summary: c.summary,
        relatedIssue: c.relatedIssue,
      })),
      troubles: (context.troubles || []).map((t) => ({
        type: t.category,
        message: this.truncateMessage(t.message),
      })),
      tokenUsage: context.tokenUsage
        ? {
            totalInput: context.tokenUsage.totalInput,
            totalOutput: context.tokenUsage.totalOutput,
          }
        : undefined,
      failedPhase: context.failedPhase,
      failureReason: context.failureReason,
    };

    // リサーチデータを追加
    if (context.cycleData?.type === "research") {
      const researchData = context.cycleData as ResearchCycleData;
      logData.researchData = {
        topic: researchData.topic,
        findings: researchData.findings,
        approaches: researchData.approaches,
        recommendations: researchData.recommendations,
        queuedImprovements: researchData.queuedImprovements,
      };
    }

    return logData;
  }

  /**
   * サマリー統計を計算
   */
  private calculateSummaryStats(data: CycleLogData): {
    resolvedIssues: number;
    unresolvedIssues: number;
    successfulChanges: number;
    troubleCount: number;
  } {
    const resolvedIssues = data.issuesDetected.filter(i => i.resolved).length;
    const unresolvedIssues = data.issuesDetected.filter(i => !i.resolved).length;
    const successfulChanges = data.changesMade.length;
    const troubleCount = data.troubles.length;

    return { resolvedIssues, unresolvedIssues, successfulChanges, troubleCount };
  }

  /**
   * Markdown形式でフォーマット（タイプ別ディスパッチ）
   */
  private formatMarkdown(data: CycleLogData): string {
    switch (data.cycleType) {
      case "research":
        return this.formatResearchMarkdown(data);
      default:
        return this.formatRepairMarkdown(data);
    }
  }

  /**
   * リサーチサイクル用Markdownフォーマット
   */
  private formatResearchMarkdown(data: CycleLogData): string {
    const lines: string[] = [];
    const research = data.researchData;

    lines.push(`# Research Log: ${data.cycleId}`);
    lines.push("");
    lines.push(`**Type**: 🔬 Research Cycle`);
    lines.push("");

    // Topic Section
    if (research?.topic) {
      lines.push("## Research Topic");
      lines.push(`- **Topic**: ${research.topic.topic}`);
      lines.push(`- **Source**: ${research.topic.source}`);
      lines.push(`- **Priority**: ${research.topic.priority}`);
      if (research.topic.relatedGoalId) {
        lines.push(`- **Related Goal**: ${research.topic.relatedGoalId}`);
      }
      lines.push("");
    }

    // Quick Summary
    lines.push("## Quick Summary");
    lines.push(`- **Status**: ${data.success ? "✅ Success" : "❌ Failure"}`);
    lines.push(`- **Duration**: ${(data.duration / 1000).toFixed(1)} seconds`);
    lines.push(`- **Findings**: ${research?.findings.length || 0}`);
    lines.push(`- **Approaches**: ${research?.approaches.length || 0}`);
    lines.push(`- **Queued Improvements**: ${research?.queuedImprovements || 0}`);
    lines.push("");

    // Timing
    lines.push("## Timing");
    lines.push(`- **Start**: ${data.startTime.toISOString()}`);
    lines.push(`- **End**: ${data.endTime.toISOString()}`);
    lines.push("");

    // Findings
    if (research?.findings && research.findings.length > 0) {
      lines.push("## Findings");
      lines.push("");
      for (const finding of research.findings) {
        lines.push(`### ${finding.source}`);
        lines.push(`**Relevance**: ${(finding.relevance * 100).toFixed(0)}%`);
        lines.push("");
        lines.push(finding.summary);
        lines.push("");
      }
    }

    // Approaches
    if (research?.approaches && research.approaches.length > 0) {
      lines.push("## Approaches");
      lines.push("");
      for (const approach of research.approaches) {
        lines.push(`### ${approach.description}`);
        lines.push(`**Confidence**: ${(approach.confidence * 100).toFixed(0)}% | **Effort**: ${approach.estimatedEffort}`);
        lines.push("");
        if (approach.pros.length > 0) {
          lines.push("**Pros:**");
          for (const pro of approach.pros) {
            lines.push(`- ✅ ${pro}`);
          }
          lines.push("");
        }
        if (approach.cons.length > 0) {
          lines.push("**Cons:**");
          for (const con of approach.cons) {
            lines.push(`- ❌ ${con}`);
          }
          lines.push("");
        }
      }
    }

    // Recommendations
    if (research?.recommendations && research.recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (const rec of research.recommendations) {
        lines.push(`- 💡 ${rec}`);
      }
      lines.push("");
    }

    // Token Usage
    if (data.tokenUsage) {
      lines.push("## Token Usage");
      lines.push(`- **Input**: ${data.tokenUsage.totalInput.toLocaleString()} tokens`);
      lines.push(`- **Output**: ${data.tokenUsage.totalOutput.toLocaleString()} tokens`);
      lines.push(`- **Total**: ${(data.tokenUsage.totalInput + data.tokenUsage.totalOutput).toLocaleString()} tokens`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * リペアサイクル用Markdownフォーマット（既存のロジック）
   */
  private formatRepairMarkdown(data: CycleLogData): string {
    const lines: string[] = [];
    const stats = this.calculateSummaryStats(data);

    lines.push(`# Cycle Log: ${data.cycleId}`);
    lines.push("");
    lines.push(`**Type**: 🔧 Repair Cycle`);
    lines.push("");

    // AI Summary Section（最初に表示）
    if (data.aiSummary) {
      lines.push("## AI Summary");
      lines.push(`**Status**: ${data.aiSummary.status}`);
      lines.push("");
      lines.push(`**What Happened**:`);
      lines.push(data.aiSummary.whatHappened);
      lines.push("");
      if (data.aiSummary.recommendation) {
        lines.push(`**Recommendation**:`);
        lines.push(data.aiSummary.recommendation);
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }

    // Quick Summary Section
    lines.push("## Quick Summary");
    lines.push(`- **Status**: ${data.success ? "✅ Success" : "❌ Failure"}`);
    lines.push(`- **Duration**: ${(data.duration / 1000).toFixed(1)} seconds`);
    lines.push(`- **Issues**: ${stats.resolvedIssues} resolved, ${stats.unresolvedIssues} unresolved`);
    lines.push(`- **Changes**: ${stats.successfulChanges} files modified`);
    if (stats.troubleCount > 0) {
      lines.push(`- **Troubles**: ${stats.troubleCount} encountered`);
    }
    lines.push("");

    // Detailed Timing
    lines.push("## Timing");
    lines.push(`- **Start**: ${data.startTime.toISOString()}`);
    lines.push(`- **End**: ${data.endTime.toISOString()}`);
    lines.push("");

    // Issues Detected with details
    if (data.issuesDetected.length > 0) {
      lines.push("## Issues Detected");
      lines.push("");
      for (const issue of data.issuesDetected) {
        const statusIcon = issue.resolved ? "✅" : "⏳";
        const location = issue.file ? ` @ \`${issue.file}\`` : "";
        lines.push(`### ${statusIcon} [${issue.type}]${location}`);

        if (issue.detectedProblem) {
          lines.push(`**Problem**: ${issue.detectedProblem}`);
        } else {
          lines.push(`**Message**: ${issue.message}`);
        }

        if (issue.resolution) {
          lines.push(`**Resolution**: ${issue.resolution}`);
        }
        lines.push("");
      }
    }

    // Changes Made with summaries
    if (data.changesMade.length > 0) {
      lines.push("## Changes Made");
      lines.push("");
      for (const change of data.changesMade) {
        lines.push(`### \`${change.file}\` (${change.changeType})`);
        if (change.summary) {
          lines.push(`${change.summary}`);
        }
        if (change.relatedIssue) {
          lines.push(`*Related to issue: ${change.relatedIssue}*`);
        }
        lines.push("");
      }
    }

    // Troubles Encountered
    if (data.troubles.length > 0) {
      lines.push("## Troubles Encountered");
      lines.push("");
      for (const trouble of data.troubles) {
        lines.push(`- **[${trouble.type}]** ${trouble.message}`);
      }
      lines.push("");
    }

    // Token Usage
    if (data.tokenUsage) {
      lines.push("## Token Usage");
      lines.push(`- **Input**: ${data.tokenUsage.totalInput.toLocaleString()} tokens`);
      lines.push(`- **Output**: ${data.tokenUsage.totalOutput.toLocaleString()} tokens`);
      lines.push(`- **Total**: ${(data.tokenUsage.totalInput + data.tokenUsage.totalOutput).toLocaleString()} tokens`);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * ファイル名を生成
   */
  private getFilename(data: CycleLogData): string {
    const date = data.startTime.toISOString().split("T")[0];
    const shortId = data.cycleId.replace("cycle_", "").replace("research_", "").substring(0, 10);
    // タイプに応じたプレフィックス
    const typePrefix = data.cycleType === "research" ? "research" : "cycle";
    return `${date}-${typePrefix}-${shortId}.md`;
  }

  /**
   * ログディレクトリを確保
   */
  private ensureLogDir(): void {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  /**
   * 指定日のサイクルログを取得
   */
  getCycleLogsForDate(date: string): CycleLogData[] {
    const logs: CycleLogData[] = [];

    if (!existsSync(LOG_DIR)) {
      return logs;
    }

    const files = readdirSync(LOG_DIR).filter(
      (f) => f.startsWith(date) && f.includes("-cycle-") && f.endsWith(".md")
    );

    for (const file of files) {
      try {
        const content = readFileSync(join(LOG_DIR, file), "utf-8");
        const parsed = this.parseLogFile(content);
        if (parsed) {
          logs.push(parsed);
        }
      } catch (error) {
        logger.warn("Failed to parse cycle log", { file, error });
      }
    }

    return logs;
  }

  /**
   * ログファイルをパース
   */
  private parseLogFile(content: string): CycleLogData | null {
    try {
      const lines = content.split("\n");

      // cycleIdを抽出
      const titleMatch = lines[0]?.match(/# Cycle Log: (.+)/);
      if (!titleMatch) return null;
      const cycleId = titleMatch[1];

      // Timing セクションをパース
      const startTimeMatch = content.match(/\*\*Start\*\*: (.+)/);
      const endTimeMatch = content.match(/\*\*End\*\*: (.+)/);
      const durationMatch = content.match(/\*\*Duration\*\*: ([\d.]+) seconds/);
      const statusMatch = content.match(/\*\*Status\*\*: (✅ Success|❌ Failure)/);

      const startTime = startTimeMatch ? new Date(startTimeMatch[1]) : new Date();
      const endTime = endTimeMatch ? new Date(endTimeMatch[1]) : new Date();
      const duration = durationMatch ? parseFloat(durationMatch[1]) * 1000 : 0;
      const success = statusMatch ? statusMatch[1].includes("Success") : false;

      // 各セクションをパース（簡易版）
      const issuesDetected: Array<{ type: string; message: string; file?: string }> = [];
      const changesMade: Array<{ file: string; changeType: string }> = [];
      const troubles: Array<{ type: string; message: string }> = [];

      // Issues Detected セクション
      const issuesSection = content.match(/## Issues Detected\n([\s\S]*?)(?=\n## |$)/);
      if (issuesSection) {
        const issueMatches = issuesSection[1].matchAll(/### [✅⏳] \[(\w+)\](?:\s+@\s+`([^`]+)`)?/g);
        for (const match of issueMatches) {
          issuesDetected.push({
            type: match[1],
            message: "",
            file: match[2],
          });
        }
      }

      // Changes Made セクション
      const changesSection = content.match(/## Changes Made\n([\s\S]*?)(?=\n## |$)/);
      if (changesSection) {
        const changeMatches = changesSection[1].matchAll(/### `([^`]+)` \((\w+)\)/g);
        for (const match of changeMatches) {
          changesMade.push({
            file: match[1],
            changeType: match[2],
          });
        }
      }

      // Troubles セクション
      const troublesSection = content.match(/## Troubles Encountered\n([\s\S]*?)(?=\n## |$)/);
      if (troublesSection) {
        const troubleMatches = troublesSection[1].matchAll(/- \*\*\[(\w+)\]\*\* (.+)/g);
        for (const match of troubleMatches) {
          troubles.push({
            type: match[1],
            message: match[2],
          });
        }
      }

      // Token Usage セクション
      let tokenUsage: { totalInput: number; totalOutput: number } | undefined;
      const inputMatch = content.match(/\*\*Input\*\*: ([\d,]+) tokens/);
      const outputMatch = content.match(/\*\*Output\*\*: ([\d,]+) tokens/);
      if (inputMatch && outputMatch) {
        tokenUsage = {
          totalInput: parseInt(inputMatch[1].replace(/,/g, ""), 10),
          totalOutput: parseInt(outputMatch[1].replace(/,/g, ""), 10),
        };
      }

      // cycleTypeを判定（ファイル内容から）
      const typeMatch = content.match(/\*\*Type\*\*:\s*🔬\s*Research/);
      const cycleType: CycleType = typeMatch ? "research" : "repair";

      return {
        cycleId,
        cycleType,
        startTime,
        endTime,
        duration,
        success,
        skippedEarly: false,
        issuesDetected,
        changesMade,
        troubles,
        tokenUsage,
      };
    } catch {
      return null;
    }
  }
}

export const cycleLogger = new CycleLogger();
