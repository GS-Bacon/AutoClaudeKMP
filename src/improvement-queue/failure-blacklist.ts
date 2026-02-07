/**
 * Implementation Failure Blacklist
 *
 * 実装に失敗した改善をブラックリスト管理し、
 * 同じ改善が無限ループで再選択されるのを防ぐ。
 * 指数バックオフでcooldown期間を設定。
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { logger } from "../core/logger.js";

const FAILURE_FILE = join(process.cwd(), "workspace", "implementation-failures.json");

/** Cooldown期間（ミリ秒）: 3h → 12h → 7d */
const COOLDOWN_STEPS_MS = [
  3 * 60 * 60 * 1000,      // 3時間
  12 * 60 * 60 * 1000,     // 12時間
  7 * 24 * 60 * 60 * 1000, // 7日
];

export interface FailureRecord {
  id: string;
  file: string;
  descriptionHash: string;
  description: string;
  errorSummary: string;
  failureCount: number;
  firstFailedAt: string;
  lastFailedAt: string;
  cooldownUntil: string;
}

interface FailureStore {
  version: number;
  failures: FailureRecord[];
  lastUpdated: string;
}

export class ImplementationFailureTracker {
  private failures: FailureRecord[] = [];
  private loaded = false;

  private hashDescription(description: string): string {
    const normalized = description.toLowerCase().trim().replace(/\s+/g, " ");
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  private getCooldownMs(failureCount: number): number {
    const index = Math.min(failureCount - 1, COOLDOWN_STEPS_MS.length - 1);
    return COOLDOWN_STEPS_MS[Math.max(0, index)];
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      if (existsSync(FAILURE_FILE)) {
        const content = await readFile(FAILURE_FILE, "utf-8");
        const store: FailureStore = JSON.parse(content);
        this.failures = store.failures || [];
      }
    } catch (error) {
      logger.warn("Failed to load implementation-failures.json, starting fresh", { error });
      this.failures = [];
    }

    this.loaded = true;
  }

  private async save(): Promise<void> {
    const store: FailureStore = {
      version: 1,
      failures: this.failures,
      lastUpdated: new Date().toISOString(),
    };

    await atomicWriteFile(FAILURE_FILE, JSON.stringify(store, null, 2));
  }

  /**
   * 実装失敗を記録し、指数バックオフでcooldownを設定
   */
  async recordFailure(
    file: string,
    description: string,
    errorSummary: string,
    cycleId?: string
  ): Promise<FailureRecord> {
    await this.load();

    const descHash = this.hashDescription(description);
    const now = new Date().toISOString();

    let record = this.failures.find(
      (f) => f.file === file && f.descriptionHash === descHash
    );

    if (record) {
      record.failureCount++;
      record.lastFailedAt = now;
      record.errorSummary = errorSummary;
      const cooldownMs = this.getCooldownMs(record.failureCount);
      record.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
    } else {
      const cooldownMs = this.getCooldownMs(1);
      record = {
        id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        descriptionHash: descHash,
        description: description.slice(0, 500),
        errorSummary: errorSummary.slice(0, 300),
        failureCount: 1,
        firstFailedAt: now,
        lastFailedAt: now,
        cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
      };
      this.failures.push(record);
    }

    logger.info("Recorded implementation failure", {
      file,
      failureCount: record.failureCount,
      cooldownUntil: record.cooldownUntil,
      cycleId,
    });

    await this.save();
    return record;
  }

  /**
   * 指定ファイル+説明がcooldown中かどうかチェック
   */
  async isBlacklisted(file: string, description: string): Promise<boolean> {
    await this.load();

    const descHash = this.hashDescription(description);
    const record = this.failures.find(
      (f) => f.file === file && f.descriptionHash === descHash
    );

    if (!record) return false;

    return new Date(record.cooldownUntil) > new Date();
  }

  /**
   * 古い失敗記録をクリーンアップ
   */
  async cleanup(daysOld: number = 30): Promise<number> {
    await this.load();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const cutoffStr = cutoff.toISOString();

    const before = this.failures.length;
    this.failures = this.failures.filter(
      (f) => f.lastFailedAt >= cutoffStr
    );

    const removed = before - this.failures.length;
    if (removed > 0) {
      await this.save();
      logger.info("Cleaned up old failure records", { removed });
    }

    return removed;
  }

  /**
   * 全失敗記録を取得
   */
  async getAll(): Promise<FailureRecord[]> {
    await this.load();
    return [...this.failures];
  }
}

export const failureTracker = new ImplementationFailureTracker();
