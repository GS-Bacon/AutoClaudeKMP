/**
 * リカバリーマネージャー
 *
 * 戦略実行時のエラーからの自動回復を管理する
 */

import { getLogger, ErrorCategory, RecoveryAction, RiskLevel } from '@auto-claude/core';
import {
  classifyError,
  determineRecoveryAction,
  CircuitBreaker,
  executeWithRetry,
  calculateBackoffDelay,
} from '@auto-claude/core';
import { getDiscordNotifier, getApprovalGate } from '@auto-claude/notification';
import { ExecutionResult, StepResult } from './executors/base-executor.js';
import { Strategy } from './strategy-manager.js';

const logger = getLogger('RecoveryManager');

export interface RecoveryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  notifyOnRecovery?: boolean;
  autoFixConfig?: boolean;
}

export interface RecoveryAttempt {
  strategyId: string;
  attemptNumber: number;
  error: Error;
  category: ErrorCategory;
  action: RecoveryAction;
  outcome: 'success' | 'failure' | 'skipped' | 'escalated';
  timestamp: Date;
}

export interface RecoveryState {
  strategyId: string;
  failureCount: number;
  lastFailure?: Date;
  recoveryAttempts: RecoveryAttempt[];
  circuitState: 'closed' | 'open' | 'half-open';
  currentAction?: RecoveryAction;
}

const DEFAULT_OPTIONS: RecoveryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
  notifyOnRecovery: true,
  autoFixConfig: false,
};

export class RecoveryManager {
  private readonly discord = getDiscordNotifier();
  private readonly approvalGate = getApprovalGate();
  private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly recoveryStates = new Map<string, RecoveryState>();
  private readonly options: RecoveryOptions;

  constructor(options: Partial<RecoveryOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 戦略実行時のエラーをハンドリング
   */
  async handleExecutionError(
    strategy: Strategy,
    error: Error,
    context?: Record<string, unknown>
  ): Promise<{ shouldRetry: boolean; action: RecoveryAction; delay?: number }> {
    const state = this.getOrCreateState(strategy.id);
    state.failureCount++;
    state.lastFailure = new Date();

    // エラーを分類
    const classifiedError = classifyError(error, {
      strategyId: strategy.id,
      strategyName: strategy.name,
      ...context,
    });

    logger.warn('Handling execution error', {
      strategyId: strategy.id,
      category: classifiedError.category,
      message: classifiedError.message,
      failureCount: state.failureCount,
    });

    // サーキットブレーカーのチェック
    const circuitBreaker = this.getCircuitBreaker(strategy.id);
    if (!circuitBreaker.canExecute()) {
      logger.info('Circuit breaker is open, skipping recovery', {
        strategyId: strategy.id,
      });

      return {
        shouldRetry: false,
        action: {
          type: 'abort',
          description: 'サーキットブレーカーがオープン状態のため、処理を中断します',
        },
      };
    }

    // リカバリーアクションを決定
    const action = determineRecoveryAction(
      classifiedError,
      state.failureCount,
      this.options.maxRetries
    );

    // アクションを記録
    const attempt: RecoveryAttempt = {
      strategyId: strategy.id,
      attemptNumber: state.recoveryAttempts.length + 1,
      error,
      category: classifiedError.category,
      action,
      outcome: 'skipped',
      timestamp: new Date(),
    };

    state.recoveryAttempts.push(attempt);
    state.currentAction = action;

    // アクションタイプに応じた処理
    switch (action.type) {
      case 'retry': {
        circuitBreaker.recordFailure();
        const delay = calculateBackoffDelay(state.failureCount - 1, {
          baseDelayMs: this.options.baseDelayMs,
        });
        attempt.outcome = 'success';

        logger.info('Scheduling retry', {
          strategyId: strategy.id,
          delay,
          attempt: state.failureCount,
        });

        return { shouldRetry: true, action, delay };
      }

      case 'fallback': {
        attempt.outcome = 'success';
        return { shouldRetry: false, action };
      }

      case 'fix_config': {
        if (this.options.autoFixConfig) {
          const fixed = await this.attemptConfigFix(strategy, classifiedError.message);
          if (fixed) {
            attempt.outcome = 'success';
            return { shouldRetry: true, action, delay: 1000 };
          }
        }
        attempt.outcome = 'escalated';
        await this.escalateError(strategy, classifiedError, action);
        return { shouldRetry: false, action };
      }

      case 'escalate': {
        attempt.outcome = 'escalated';
        await this.escalateError(strategy, classifiedError, action);
        return { shouldRetry: false, action };
      }

      case 'abort':
      default: {
        attempt.outcome = 'failure';
        circuitBreaker.recordFailure();

        if (this.options.notifyOnRecovery) {
          await this.notifyAbort(strategy, classifiedError, state);
        }

        return { shouldRetry: false, action };
      }
    }
  }

  /**
   * 成功を記録してリカバリー状態をリセット
   */
  recordSuccess(strategyId: string): void {
    const state = this.recoveryStates.get(strategyId);
    if (state) {
      state.failureCount = 0;
      state.currentAction = undefined;
    }

    const circuitBreaker = this.circuitBreakers.get(strategyId);
    circuitBreaker?.recordSuccess();

    logger.debug('Recorded success', { strategyId });
  }

  /**
   * 失敗したステップのリカバリーを試みる
   */
  async recoverFailedStep(
    strategy: Strategy,
    stepResult: StepResult,
    retryStep: () => Promise<StepResult>
  ): Promise<StepResult> {
    const error = new Error(stepResult.error || 'Step failed');
    const { shouldRetry, delay } = await this.handleExecutionError(strategy, error, {
      stepId: stepResult.stepId,
    });

    if (shouldRetry && delay) {
      await this.sleep(delay);
      try {
        const result = await retryStep();
        if (result.success) {
          this.recordSuccess(strategy.id);
        }
        return result;
      } catch (retryError) {
        return {
          ...stepResult,
          error: retryError instanceof Error ? retryError.message : String(retryError),
        };
      }
    }

    return stepResult;
  }

  /**
   * グレースフルデグラデーション: プライマリ操作が失敗した場合にフォールバックを実行
   */
  async executeWithFallback<T>(
    strategyId: string,
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    description: string
  ): Promise<{ result: T; usedFallback: boolean }> {
    const circuitBreaker = this.getCircuitBreaker(strategyId);

    if (!circuitBreaker.canExecute()) {
      logger.info('Circuit breaker open, using fallback directly', {
        strategyId,
        description,
      });
      const result = await fallback();
      return { result, usedFallback: true };
    }

    try {
      const result = await primary();
      circuitBreaker.recordSuccess();
      return { result, usedFallback: false };
    } catch (error) {
      circuitBreaker.recordFailure();
      logger.warn('Primary operation failed, trying fallback', {
        strategyId,
        description,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        const result = await fallback();
        return { result, usedFallback: true };
      } catch (fallbackError) {
        logger.error('Fallback also failed', {
          strategyId,
          description,
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        throw fallbackError;
      }
    }
  }

  /**
   * リカバリー状態を取得
   */
  getRecoveryState(strategyId: string): RecoveryState | undefined {
    return this.recoveryStates.get(strategyId);
  }

  /**
   * サーキットブレーカーの状態を取得
   */
  getCircuitBreakerState(strategyId: string): 'closed' | 'open' | 'half-open' {
    const cb = this.circuitBreakers.get(strategyId);
    return cb?.getState().state ?? 'closed';
  }

  /**
   * 特定の戦略のリカバリー状態をリセット
   */
  resetRecoveryState(strategyId: string): void {
    this.recoveryStates.delete(strategyId);
    this.circuitBreakers.get(strategyId)?.reset();
    logger.info('Recovery state reset', { strategyId });
  }

  /**
   * 全てのリカバリー状態をリセット
   */
  resetAll(): void {
    this.recoveryStates.clear();
    for (const cb of this.circuitBreakers.values()) {
      cb.reset();
    }
    logger.info('All recovery states reset');
  }

  /**
   * リカバリー統計を取得
   */
  getStatistics(): {
    totalStrategies: number;
    openCircuits: number;
    totalRecoveryAttempts: number;
    successfulRecoveries: number;
  } {
    let openCircuits = 0;
    let totalRecoveryAttempts = 0;
    let successfulRecoveries = 0;

    for (const cb of this.circuitBreakers.values()) {
      if (cb.getState().state === 'open') {
        openCircuits++;
      }
    }

    for (const state of this.recoveryStates.values()) {
      totalRecoveryAttempts += state.recoveryAttempts.length;
      successfulRecoveries += state.recoveryAttempts.filter(
        a => a.outcome === 'success'
      ).length;
    }

    return {
      totalStrategies: this.recoveryStates.size,
      openCircuits,
      totalRecoveryAttempts,
      successfulRecoveries,
    };
  }

  // Private methods

  private getOrCreateState(strategyId: string): RecoveryState {
    let state = this.recoveryStates.get(strategyId);
    if (!state) {
      state = {
        strategyId,
        failureCount: 0,
        recoveryAttempts: [],
        circuitState: 'closed',
      };
      this.recoveryStates.set(strategyId, state);
    }
    return state;
  }

  private getCircuitBreaker(strategyId: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(strategyId);
    if (!cb && this.options.enableCircuitBreaker) {
      cb = new CircuitBreaker(strategyId, {
        failureThreshold: this.options.circuitBreakerThreshold,
      });
      this.circuitBreakers.set(strategyId, cb);
    }
    return cb ?? new CircuitBreaker(strategyId);
  }

  private async attemptConfigFix(
    strategy: Strategy,
    errorMessage: string
  ): Promise<boolean> {
    // 設定自動修正のロジック（将来的に拡張）
    logger.info('Attempting config fix', { strategyId: strategy.id, errorMessage });

    // 現時点では自動修正は無効
    // 将来的にはAIによる設定修正提案を実装
    return false;
  }

  private async escalateError(
    strategy: Strategy,
    classifiedError: ReturnType<typeof classifyError>,
    action: RecoveryAction
  ): Promise<void> {
    logger.warn('Escalating error', {
      strategyId: strategy.id,
      category: classifiedError.category,
      action: action.type,
    });

    await this.discord.sendWarning(
      `戦略エラーのエスカレーション: ${strategy.name}`,
      [
        `**エラー種別:** ${classifiedError.category}`,
        `**メッセージ:** ${classifiedError.message}`,
        `**推奨アクション:** ${classifiedError.suggestedAction}`,
        '',
        `対応: ${action.description}`,
        '',
        `戦略ID: ${strategy.id}`,
        `戦略タイプ: ${strategy.type}`,
      ].join('\n')
    );

    // 承認が必要なアクションの場合
    if (action.requiredApproval) {
      await this.approvalGate.requestApproval({
        type: 'action',
        title: `リカバリーアクション承認: ${strategy.name}`,
        description: action.description,
        riskLevel: RiskLevel.HIGH,
      });
    }
  }

  private async notifyAbort(
    strategy: Strategy,
    classifiedError: ReturnType<typeof classifyError>,
    state: RecoveryState
  ): Promise<void> {
    await this.discord.sendError(
      `戦略実行中断: ${strategy.name}`,
      [
        `**理由:** ${classifiedError.message}`,
        `**試行回数:** ${state.failureCount}`,
        `**エラー種別:** ${classifiedError.category}`,
        '',
        '最大リトライ回数に達したため、処理を中断しました。',
        '',
        `戦略ID: ${strategy.id}`,
        `リカバリー試行回数: ${state.recoveryAttempts.length}`,
      ].join('\n')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// シングルトンインスタンス
let recoveryManagerInstance: RecoveryManager | null = null;

export function getRecoveryManager(options?: Partial<RecoveryOptions>): RecoveryManager {
  if (!recoveryManagerInstance) {
    recoveryManagerInstance = new RecoveryManager(options);
  }
  return recoveryManagerInstance;
}
