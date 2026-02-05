/**
 * .gitignore 自動更新マネージャー
 *
 * 新しいファイルパターンを検出し、.gitignoreを自動更新
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, appendFileSync } from "fs";
import { logger } from "../core/logger.js";
import { GitignorePattern, GitignoreUpdateResult } from "./types.js";

export class GitignoreManager {
  private gitignorePath: string;

  // デフォルトの検出ルール
  private detectionRules: GitignorePattern[] = [
    { glob: "**/*.backup", pattern: "*.backup", description: "Backup files" },
    { glob: "**/*.tmp", pattern: "*.tmp", description: "Temporary files" },
    { glob: "**/*.bak", pattern: "*.bak", description: "Backup files" },
    { glob: "**/*.log", pattern: "*.log", description: "Log files" },
    { glob: "**/dist/", pattern: "dist/", description: "Build output" },
    { glob: "**/build/", pattern: "build/", description: "Build output" },
    { glob: "**/.env.local", pattern: ".env.local", description: "Local env" },
    { glob: "**/.env.*.local", pattern: ".env.*.local", description: "Local env variants" },
    { glob: "**/node_modules/", pattern: "node_modules/", description: "Node modules" },
    { glob: "**/.DS_Store", pattern: ".DS_Store", description: "macOS files" },
    { glob: "**/Thumbs.db", pattern: "Thumbs.db", description: "Windows files" },
    { glob: "**/*.swp", pattern: "*.swp", description: "Vim swap files" },
    { glob: "**/*~", pattern: "*~", description: "Editor backup files" },
    { glob: "**/.idea/", pattern: ".idea/", description: "JetBrains IDE" },
    { glob: "**/.vscode/", pattern: ".vscode/", description: "VS Code settings" },
    { glob: "**/coverage/", pattern: "coverage/", description: "Test coverage" },
    { glob: "**/.nyc_output/", pattern: ".nyc_output/", description: "NYC coverage" },
  ];

  constructor(gitignorePath: string = "./.gitignore") {
    this.gitignorePath = gitignorePath;
  }

  /**
   * 追加の検出ルールを設定
   */
  addDetectionRules(rules: GitignorePattern[]): void {
    this.detectionRules.push(...rules);
  }

  /**
   * Untrackedファイルを取得
   */
  private getUntrackedFiles(): string[] {
    try {
      const output = execSync("git ls-files --others --exclude-standard", {
        encoding: "utf-8",
        stdio: "pipe",
      });
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch (err) {
      logger.warn("Failed to get untracked files", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * 現在の.gitignoreパターンを取得
   */
  private parseCurrentGitignore(): Set<string> {
    const patterns = new Set<string>();

    if (!existsSync(this.gitignorePath)) {
      return patterns;
    }

    try {
      const content = readFileSync(this.gitignorePath, "utf-8");
      const lines = content.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        // コメントと空行をスキップ
        if (trimmed && !trimmed.startsWith("#")) {
          patterns.add(trimmed);
        }
      }
    } catch (err) {
      logger.warn("Failed to parse .gitignore", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return patterns;
  }

  /**
   * ファイルがパターンにマッチするかチェック
   */
  private matchesPattern(file: string, rule: GitignorePattern): boolean {
    // 簡易的なglobマッチング
    const globPattern = rule.glob
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, ".");

    const regex = new RegExp(`^${globPattern}$`);
    return regex.test(file);
  }

  /**
   * untrackedファイルからパターンをマッチ
   */
  private matchPatterns(
    untrackedFiles: string[],
    existingPatterns: Set<string>
  ): string[] {
    const patternsToAdd = new Set<string>();

    for (const file of untrackedFiles) {
      for (const rule of this.detectionRules) {
        if (this.matchesPattern(file, rule)) {
          // パターンが既に存在しなければ追加候補に
          if (!existingPatterns.has(rule.pattern)) {
            patternsToAdd.add(rule.pattern);
          }
          break; // 1ファイルにつき1パターンのみ
        }
      }
    }

    return Array.from(patternsToAdd);
  }

  /**
   * .gitignoreにパターンを追加
   */
  private appendPatterns(patterns: string[]): void {
    if (patterns.length === 0) {
      return;
    }

    const timestamp = new Date().toISOString();
    let content = "";

    // .gitignoreが存在しない場合はヘッダーを追加
    if (!existsSync(this.gitignorePath)) {
      content += "# Auto-generated .gitignore\n";
    }

    content += `\n# Auto-added by KairosAgent (${timestamp})\n`;
    for (const pattern of patterns) {
      content += `${pattern}\n`;
    }

    try {
      appendFileSync(this.gitignorePath, content);
      logger.info("Updated .gitignore", { addedPatterns: patterns });
    } catch (err) {
      logger.error("Failed to update .gitignore", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * .gitignoreを検出・更新
   */
  async detectAndUpdate(): Promise<GitignoreUpdateResult> {
    const untrackedFiles = this.getUntrackedFiles();
    const existingPatterns = this.parseCurrentGitignore();
    const patternsToAdd = this.matchPatterns(untrackedFiles, existingPatterns);

    if (patternsToAdd.length > 0) {
      this.appendPatterns(patternsToAdd);
      logger.info("Gitignore patterns added", {
        count: patternsToAdd.length,
        patterns: patternsToAdd,
      });
    }

    return {
      updated: patternsToAdd.length > 0,
      addedPatterns: patternsToAdd,
      existingPatterns: Array.from(existingPatterns),
    };
  }

  /**
   * 現在の状態を取得
   */
  getStatus(): {
    gitignorePath: string;
    exists: boolean;
    patternCount: number;
    detectionRulesCount: number;
  } {
    const patterns = this.parseCurrentGitignore();
    return {
      gitignorePath: this.gitignorePath,
      exists: existsSync(this.gitignorePath),
      patternCount: patterns.size,
      detectionRulesCount: this.detectionRules.length,
    };
  }
}

// シングルトンインスタンス
export const gitignoreManager = new GitignoreManager();
