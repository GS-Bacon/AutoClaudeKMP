/**
 * Rule Engine - 高速パターンマッチングエンジン
 *
 * 学習済みパターンを使用して高速にコードをマッチングし、
 * 解決策を適用する。
 */

import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import {
  LearnedPattern,
  PatternMatch,
  MatchContext,
  ExecuteContext,
  PatternCondition,
  needsAIVerification,
} from "./types.js";
import { patternRepository } from "./pattern-repository.js";
import { logger } from "../core/logger.js";

interface CompiledPattern {
  pattern: LearnedPattern;
  compiledRegexes: Map<string, RegExp>;
}

export class RuleEngine {
  private compiledPatterns: Map<string, CompiledPattern> = new Map();
  private initialized: boolean = false;

  /**
   * ルールエンジンを初期化
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await patternRepository.initialize();
    this.compilePatterns();
    this.initialized = true;
    logger.debug("Rule engine initialized", {
      compiledPatterns: this.compiledPatterns.size,
    });
  }

  /**
   * パターンをコンパイル（正規表現のキャッシュ）
   */
  private compilePatterns(): void {
    this.compiledPatterns.clear();

    for (const pattern of patternRepository.getAllPatterns()) {
      const compiledRegexes = new Map<string, RegExp>();

      for (const condition of pattern.conditions) {
        if (condition.type === "regex") {
          try {
            compiledRegexes.set(condition.value, new RegExp(condition.value, "gm"));
          } catch (error) {
            logger.warn("Failed to compile regex", {
              patternId: pattern.id,
              regex: condition.value,
              error,
            });
          }
        }
      }

      this.compiledPatterns.set(pattern.id, { pattern, compiledRegexes });
    }
  }

  /**
   * パターンキャッシュをリフレッシュ
   */
  refresh(): void {
    this.compilePatterns();
  }

  /**
   * 単一のコンテキストに対してマッチングを実行
   */
  match(context: MatchContext): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const [, compiled] of this.compiledPatterns) {
      const result = this.evaluatePattern(compiled, context);
      if (result) {
        matches.push(result);
      }
    }

    // 信頼度順にソート
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 複数ファイルに対してマッチングを実行
   */
  async matchAll(files: string[]): Promise<PatternMatch[]> {
    await this.initialize();

    const allMatches: PatternMatch[] = [];

    for (const file of files) {
      if (!fs.existsSync(file)) continue;

      const content = fs.readFileSync(file, "utf-8");
      const context: MatchContext = {
        file,
        content,
      };

      const matches = this.match(context);
      allMatches.push(...matches);
    }

    return allMatches;
  }

  /**
   * パターンの条件を評価
   */
  private evaluatePattern(
    compiled: CompiledPattern,
    context: MatchContext
  ): PatternMatch | null {
    const { pattern, compiledRegexes } = compiled;

    // 全ての条件を評価（AND）
    let matchedContent = "";
    let matchLine: number | undefined;

    for (const condition of pattern.conditions) {
      const result = this.evaluateCondition(condition, context, compiledRegexes);
      if (!result.matched) {
        return null;
      }
      if (result.content) {
        matchedContent = result.content;
      }
      if (result.line !== undefined) {
        matchLine = result.line;
      }
    }

    // マッチ成功
    return {
      patternId: pattern.id,
      patternName: pattern.name,
      confidence: pattern.stats.confidence,
      file: context.file,
      line: matchLine,
      matchedContent,
      suggestedFix: this.getSuggestedFix(pattern, context),
    };
  }

  /**
   * 単一の条件を評価
   */
  private evaluateCondition(
    condition: PatternCondition,
    context: MatchContext,
    compiledRegexes: Map<string, RegExp>
  ): { matched: boolean; content?: string; line?: number } {
    const target = this.getTarget(condition.target, context);
    if (!target) {
      return { matched: false };
    }

    switch (condition.type) {
      case "regex": {
        const regex = compiledRegexes.get(condition.value);
        if (!regex) {
          return { matched: false };
        }
        regex.lastIndex = 0;
        const match = regex.exec(target);
        if (match) {
          const line = this.getLineNumber(target, match.index);
          return { matched: true, content: match[0], line };
        }
        return { matched: false };
      }

      case "file-glob": {
        const matched = minimatch(context.file, condition.value);
        return { matched, content: context.file };
      }

      case "error-code": {
        if (context.errorMessage?.includes(condition.value)) {
          return { matched: true, content: context.errorMessage };
        }
        return { matched: false };
      }

      case "ast-pattern": {
        // AST パターンは将来実装
        // 現時点では単純な文字列マッチとして扱う
        if (target.includes(condition.value)) {
          return { matched: true, content: condition.value };
        }
        return { matched: false };
      }

      default:
        return { matched: false };
    }
  }

  /**
   * 条件ターゲットを取得
   */
  private getTarget(target: string, context: MatchContext): string | null {
    switch (target) {
      case "content":
        return context.content;
      case "filename":
        return context.file;
      case "error-message":
        return context.errorMessage || null;
      default:
        return null;
    }
  }

  /**
   * 文字インデックスから行番号を計算
   */
  private getLineNumber(content: string, index: number): number {
    const lines = content.substring(0, index).split("\n");
    return lines.length;
  }

  /**
   * 提案される修正を取得
   */
  private getSuggestedFix(pattern: LearnedPattern, context: MatchContext): string | undefined {
    const solution = pattern.solution;

    switch (solution.type) {
      case "template":
        return this.expandTemplate(solution.content, context);
      case "script":
        return `[Script available: ${pattern.name}]`;
      case "ai-prompt":
        return `[AI analysis recommended: ${solution.content.substring(0, 50)}...]`;
      default:
        return undefined;
    }
  }

  /**
   * テンプレートを展開
   */
  expandTemplate(template: string, context: MatchContext | ExecuteContext): string {
    let result = template;

    // 基本変数を置換
    result = result.replace(/\$\{file\}/g, context.file);

    // ExecuteContext の変数を置換
    if ("variables" in context) {
      for (const [key, value] of Object.entries(context.variables)) {
        result = result.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value);
      }
    }

    return result;
  }

  /**
   * スクリプトを実行（修正を適用）
   */
  async executeScript(
    pattern: LearnedPattern,
    context: ExecuteContext
  ): Promise<{ success: boolean; output: string }> {
    if (pattern.solution.type !== "script") {
      return { success: false, output: "Pattern solution is not a script" };
    }

    // AI検証が必要かチェック
    if (needsAIVerification(pattern)) {
      logger.warn("Pattern needs AI verification before execution", {
        patternId: pattern.id,
        confidence: pattern.stats.confidence,
      });
      return {
        success: false,
        output: "Pattern confidence is low, AI verification required",
      };
    }

    const script = this.expandTemplate(pattern.solution.content, context);

    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(script, {
        cwd: context.workDir,
        timeout: 30000, // 30秒タイムアウト
      });

      logger.info("Script executed", { patternId: pattern.id, stdout });

      return {
        success: true,
        output: stdout || stderr,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Script execution failed", { patternId: pattern.id, error: errorMessage });

      return {
        success: false,
        output: errorMessage,
      };
    }
  }

  /**
   * 類似の問題に対する解決策を検索
   */
  findSimilarSolutions(issues: Array<{ message?: string; description?: string }>): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const issue of issues) {
      const text = issue.message || issue.description || "";
      const similar = patternRepository.findSimilarPatterns(text);

      for (const pattern of similar) {
        matches.push({
          patternId: pattern.id,
          patternName: pattern.name,
          confidence: pattern.stats.confidence,
          file: "",
          matchedContent: text,
          suggestedFix: pattern.solution.content,
        });
      }
    }

    return matches;
  }

  /**
   * パターンの実行結果を記録
   */
  recordResult(patternId: string, success: boolean): void {
    patternRepository.updateConfidence(patternId, success);
    this.refresh(); // 信頼度変更を反映
  }

  /**
   * 使用可能なパターンの数を取得
   */
  getPatternCount(): number {
    return this.compiledPatterns.size;
  }
}

// シングルトンインスタンス
export const ruleEngine = new RuleEngine();
