/**
 * Pattern Repository - パターンの永続化と管理
 *
 * 学習済みパターンの保存・読み込み・更新・統計管理を担当。
 */

import * as fs from "fs";
import * as path from "path";
import {
  LearnedPattern,
  PatternStats,
  LearningStats,
  determinePhase,
  calculateConfidence,
  isDeprecationCandidate,
} from "./types.js";
import { logger } from "../core/logger.js";

const WORKSPACE_DIR = path.join(process.cwd(), "workspace");
const PATTERNS_FILE = path.join(WORKSPACE_DIR, "patterns.json");
const STATS_FILE = path.join(WORKSPACE_DIR, "learning-stats.json");

interface PatternsData {
  version: number;
  patterns: LearnedPattern[];
  lastUpdated: string;
}

export class PatternRepository {
  private patterns: Map<string, LearnedPattern> = new Map();
  private stats: LearningStats;
  private initialized: boolean = false;

  constructor() {
    this.stats = this.createDefaultStats();
  }

  private createDefaultStats(): LearningStats {
    return {
      totalCycles: 0,
      patternHits: 0,
      aiCalls: 0,
      patternHitRate: 0,
      avgConfidence: 0,
      topPatterns: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * リポジトリを初期化（永続化ファイルから読み込み）
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadPatterns();
      await this.loadStats();
      this.initialized = true;
      logger.info("Pattern repository initialized", {
        patternCount: this.patterns.size,
      });
    } catch (error) {
      logger.warn("Failed to load patterns, starting fresh", { error });
      this.initialized = true;
    }
  }

  private async loadPatterns(): Promise<void> {
    if (!fs.existsSync(PATTERNS_FILE)) {
      logger.debug("No patterns file found, starting with empty repository");
      return;
    }

    const data = JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf-8")) as PatternsData;
    for (const pattern of data.patterns) {
      this.patterns.set(pattern.id, pattern);
    }
  }

  private async loadStats(): Promise<void> {
    if (!fs.existsSync(STATS_FILE)) {
      logger.debug("No stats file found, starting with default stats");
      return;
    }

    this.stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")) as LearningStats;
  }

  /**
   * パターンを永続化
   */
  async save(): Promise<void> {
    await this.savePatternsToFile();
    await this.saveStats();
  }

  private async savePatternsToFile(): Promise<void> {
    const data: PatternsData = {
      version: 1,
      patterns: Array.from(this.patterns.values()),
      lastUpdated: new Date().toISOString(),
    };

    if (!fs.existsSync(WORKSPACE_DIR)) {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }

    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(data, null, 2));
    logger.debug("Patterns saved", { count: this.patterns.size });
  }

  private async saveStats(): Promise<void> {
    this.stats.lastUpdated = new Date().toISOString();
    fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
  }

  /**
   * 全パターンを取得
   */
  getAllPatterns(): LearnedPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * パターンをIDで取得
   */
  getPattern(id: string): LearnedPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * 信頼度でソートしたパターンを取得
   */
  getPatternsByConfidence(): LearnedPattern[] {
    return Array.from(this.patterns.values()).sort(
      (a, b) => b.stats.confidence - a.stats.confidence
    );
  }

  /**
   * 新しいパターンを追加
   */
  addPattern(pattern: LearnedPattern): void {
    if (this.patterns.has(pattern.id)) {
      logger.warn("Pattern already exists, updating instead", { id: pattern.id });
      this.updatePattern(pattern.id, pattern);
      return;
    }

    this.patterns.set(pattern.id, pattern);
    logger.info("Pattern added", { id: pattern.id, name: pattern.name });
  }

  /**
   * パターンを更新
   */
  updatePattern(id: string, updates: Partial<LearnedPattern>): void {
    const existing = this.patterns.get(id);
    if (!existing) {
      logger.warn("Pattern not found for update", { id });
      return;
    }

    const updated: LearnedPattern = {
      ...existing,
      ...updates,
      id: existing.id, // IDは変更不可
    };

    this.patterns.set(id, updated);
  }

  /**
   * パターンを削除
   */
  removePattern(id: string): boolean {
    const removed = this.patterns.delete(id);
    if (removed) {
      logger.info("Pattern removed", { id });
    }
    return removed;
  }

  /**
   * パターンの信頼度を更新（成功/失敗を記録）
   */
  updateConfidence(patternId: string, success: boolean): void {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      logger.warn("Pattern not found for confidence update", { patternId });
      return;
    }

    const stats = pattern.stats;
    stats.usageCount++;
    if (success) {
      stats.successCount++;
    }

    stats.confidence = calculateConfidence(stats.successCount, stats.usageCount);
    stats.phase = determinePhase(stats.usageCount);
    stats.lastUsed = new Date().toISOString();

    // 廃棄候補チェック
    if (isDeprecationCandidate(pattern)) {
      logger.warn("Pattern is deprecation candidate", {
        id: patternId,
        confidence: stats.confidence,
      });
    }

    this.patterns.set(patternId, pattern);

    // 統計更新
    this.stats.patternHits++;
    this.updateTopPatterns();
  }

  /**
   * 複数のパターンを一括追加・保存
   */
  async addAndSavePatterns(patterns: LearnedPattern[]): Promise<void> {
    for (const pattern of patterns) {
      this.addPattern(pattern);
    }
    await this.save();
  }

  /**
   * サイクル完了を記録
   */
  recordCycleCompletion(patternHits: number, aiCalls: number): void {
    this.stats.totalCycles++;
    this.stats.patternHits += patternHits;
    this.stats.aiCalls += aiCalls;

    // ヒット率を計算
    const totalOperations = this.stats.patternHits + this.stats.aiCalls;
    this.stats.patternHitRate =
      totalOperations > 0 ? this.stats.patternHits / totalOperations : 0;

    // 平均信頼度を計算
    const patterns = this.getAllPatterns();
    if (patterns.length > 0) {
      const totalConfidence = patterns.reduce((sum, p) => sum + p.stats.confidence, 0);
      this.stats.avgConfidence = totalConfidence / patterns.length;
    }

    this.updateTopPatterns();
  }

  private updateTopPatterns(): void {
    const patterns = this.getAllPatterns();
    this.stats.topPatterns = patterns
      .sort((a, b) => b.stats.usageCount - a.stats.usageCount)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        name: p.name,
        usage: p.stats.usageCount,
      }));
  }

  /**
   * 統計情報を取得
   */
  getStats(): LearningStats {
    return { ...this.stats };
  }

  /**
   * 廃棄候補のパターンを取得
   */
  getDeprecationCandidates(): LearnedPattern[] {
    return this.getAllPatterns().filter(isDeprecationCandidate);
  }

  /**
   * 類似パターンを検索
   */
  findSimilarPatterns(description: string): LearnedPattern[] {
    const keywords = description.toLowerCase().split(/\s+/);
    return this.getAllPatterns().filter((pattern) => {
      const patternText = `${pattern.name} ${pattern.conditions.map((c) => c.value).join(" ")}`.toLowerCase();
      return keywords.some((keyword) => patternText.includes(keyword));
    });
  }

  /**
   * パターンのバージョンを上げる（履歴追跡）
   */
  upgradePatternVersion(id: string, changeReason: string): void {
    const pattern = this.patterns.get(id);
    if (!pattern) return;

    pattern.version++;
    pattern.history.push({
      version: pattern.version,
      timestamp: new Date().toISOString(),
      changeReason,
    });

    this.patterns.set(id, pattern);
  }
}

// シングルトンインスタンス
export const patternRepository = new PatternRepository();
