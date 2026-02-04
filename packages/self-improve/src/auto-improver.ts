import { getLogger } from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import { getBackupManager } from '@auto-claude/backup';
import type { ProcessImprovement } from './types.js';
import { getProcessImprover } from './process-improver.js';
import { getImprovementRiskAssessor, RiskAssessment } from './improvement-risk-assessor.js';

const logger = getLogger('self-improve:auto');

export interface AutoImproveResult {
  processed: number;
  autoImplemented: number;
  pendingApproval: number;
  rejected: number;
  failed: number;
  details: AutoImproveDetail[];
}

export interface AutoImproveDetail {
  improvementId: string;
  description: string;
  action: 'auto_implemented' | 'pending_approval' | 'rejected' | 'failed';
  reason: string;
}

export interface RollbackInfo {
  improvementId: string;
  restorePointName: string;
  implementedAt: Date;
  problemCount: number;
  rolledBackAt?: Date;
}

export class AutoImprover {
  private processImprover = getProcessImprover();
  private riskAssessor = getImprovementRiskAssessor();
  private backupManager = getBackupManager();
  private discord = getDiscordNotifier();
  private rollbackTracking: Map<string, RollbackInfo> = new Map();

  constructor() {
    logger.info('AutoImprover initialized');
  }

  /**
   * 保留中の改善を自動処理
   */
  async processImprovements(): Promise<AutoImproveResult> {
    const pending = this.processImprover.getPendingImprovements();

    if (pending.length === 0) {
      logger.info('No pending improvements to process');
      return {
        processed: 0,
        autoImplemented: 0,
        pendingApproval: 0,
        rejected: 0,
        failed: 0,
        details: [],
      };
    }

    logger.info('Processing pending improvements', { count: pending.length });

    const result: AutoImproveResult = {
      processed: pending.length,
      autoImplemented: 0,
      pendingApproval: 0,
      rejected: 0,
      failed: 0,
      details: [],
    };

    for (const improvement of pending) {
      const detail = await this.processImprovement(improvement);
      result.details.push(detail);

      switch (detail.action) {
        case 'auto_implemented':
          result.autoImplemented++;
          break;
        case 'pending_approval':
          result.pendingApproval++;
          break;
        case 'rejected':
          result.rejected++;
          break;
        case 'failed':
          result.failed++;
          break;
      }
    }

    // サマリー通知
    if (result.autoImplemented > 0 || result.failed > 0) {
      await this.discord.sendInfo(
        '自動改善処理完了',
        `自動実装: ${result.autoImplemented}件\n承認待ち: ${result.pendingApproval}件\n失敗: ${result.failed}件`
      );
    }

    logger.info('Auto improvement processing completed', result);

    return result;
  }

  private async processImprovement(
    improvement: ProcessImprovement
  ): Promise<AutoImproveDetail> {
    logger.info('Processing improvement', {
      id: improvement.id,
      description: improvement.description,
    });

    try {
      // リスク評価
      const assessment = await this.riskAssessor.assessRisk(improvement);

      // 自動実装可能かチェック
      if (this.riskAssessor.canAutoImplement(assessment)) {
        return await this.autoImplement(improvement, assessment);
      }

      // 承認が必要な場合
      if (assessment.recommendation === 'require_approval') {
        // ProcessImproverの既存の承認フローを使用
        await this.processImprover.implementImprovement(improvement.id);

        return {
          improvementId: improvement.id,
          description: improvement.description,
          action: 'pending_approval',
          reason: assessment.reason,
        };
      }

      // 推奨されない場合
      return {
        improvementId: improvement.id,
        description: improvement.description,
        action: 'rejected',
        reason: assessment.reason,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to process improvement', {
        id: improvement.id,
        error: errorMessage,
      });

      return {
        improvementId: improvement.id,
        description: improvement.description,
        action: 'failed',
        reason: errorMessage,
      };
    }
  }

  private async autoImplement(
    improvement: ProcessImprovement,
    assessment: RiskAssessment
  ): Promise<AutoImproveDetail> {
    logger.info('Auto-implementing improvement', {
      id: improvement.id,
      riskLevel: assessment.riskLevel,
    });

    try {
      // ロールバックポイントを作成
      const restorePointName = `auto_improve_${improvement.id}`;
      await this.backupManager.createRestorePoint(restorePointName);

      // ロールバック追跡を開始
      this.rollbackTracking.set(improvement.id, {
        improvementId: improvement.id,
        restorePointName,
        implementedAt: new Date(),
        problemCount: 0,
      });

      // ProcessImproverを使用して実装（承認をスキップ）
      // 直接applyを行うため、statusをapprovedに変更
      const improvements = this.processImprover.getImprovements();
      const target = improvements.find((i) => i.id === improvement.id);
      if (target) {
        target.status = 'approved';
        await this.processImprover.implementImprovement(improvement.id);
      }

      await this.discord.sendSuccess(
        '改善を自動実装',
        `${improvement.description}\n\n理由: ${assessment.reason}`
      );

      return {
        improvementId: improvement.id,
        description: improvement.description,
        action: 'auto_implemented',
        reason: assessment.reason,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Auto implementation failed', {
        id: improvement.id,
        error: errorMessage,
      });

      // 失敗した場合はロールバック追跡を削除
      this.rollbackTracking.delete(improvement.id);

      return {
        improvementId: improvement.id,
        description: improvement.description,
        action: 'failed',
        reason: `自動実装エラー: ${errorMessage}`,
      };
    }
  }

  /**
   * 改善後の問題をチェックし、必要に応じてロールバック
   */
  async checkForRollback(): Promise<string[]> {
    const rolledBack: string[] = [];
    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const [improvementId, info] of this.rollbackTracking) {
      const elapsed = now.getTime() - info.implementedAt.getTime();

      // 7日以内に問題が3回以上発生したらロールバック
      if (info.problemCount >= 3 && elapsed < sevenDaysMs) {
        logger.warn('Triggering rollback due to repeated problems', {
          improvementId,
          problemCount: info.problemCount,
        });

        try {
          await this.backupManager.restore(info.restorePointName);
          info.rolledBackAt = now;

          await this.discord.sendCritical({
            title: '改善を自動ロールバック',
            description: `改善ID: ${improvementId}\n問題発生回数: ${info.problemCount}回\n実装後${Math.floor(elapsed / (24 * 60 * 60 * 1000))}日でロールバック`,
          });

          rolledBack.push(improvementId);
        } catch (error) {
          logger.error('Rollback failed', { improvementId, error });
        }
      }

      // 7日経過したら追跡を終了
      if (elapsed >= sevenDaysMs) {
        this.rollbackTracking.delete(improvementId);
        logger.info('Improvement tracking completed without issues', {
          improvementId,
        });
      }
    }

    return rolledBack;
  }

  /**
   * 改善に関連する問題を報告
   */
  reportProblem(improvementId: string): void {
    const info = this.rollbackTracking.get(improvementId);
    if (info) {
      info.problemCount++;
      logger.info('Problem reported for improvement', {
        improvementId,
        problemCount: info.problemCount,
      });
    }
  }

  /**
   * 実装済みの改善を検証
   */
  async verifyImplementedImprovements(): Promise<{
    verified: number;
    failed: number;
    pending: number;
  }> {
    const implemented = this.processImprover.getImplementedImprovements();
    let verified = 0;
    let failed = 0;
    let pending = 0;

    for (const improvement of implemented) {
      const score = await this.processImprover.verifyImprovement(improvement.id);

      if (score < 0) {
        pending++;
      } else if (score > 0.5) {
        verified++;
        // ロールバック追跡を終了
        this.rollbackTracking.delete(improvement.id);
      } else {
        failed++;
        // 検証失敗の改善は問題としてカウント
        this.reportProblem(improvement.id);
      }
    }

    return { verified, failed, pending };
  }

  getRollbackTracking(): RollbackInfo[] {
    return Array.from(this.rollbackTracking.values());
  }
}

let instance: AutoImprover | null = null;

export function getAutoImprover(): AutoImprover {
  if (!instance) {
    instance = new AutoImprover();
  }
  return instance;
}
