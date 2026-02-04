/**
 * 統一的エラーハンドリングシステム
 *
 * エラーを分類し、適切なリカバリーアクションを提案する
 */
import { ClassifiedError, RetryConfig, CircuitBreakerState, RecoveryAction } from './types.js';
/**
 * エラーを分類する
 */
export declare function classifyError(error: Error | unknown, context?: Record<string, unknown>): ClassifiedError;
/**
 * リカバリーアクションを決定
 */
export declare function determineRecoveryAction(classifiedError: ClassifiedError, failureCount: number, maxRetries?: number): RecoveryAction;
/**
 * 指数バックオフの遅延時間を計算
 */
export declare function calculateBackoffDelay(attempt: number, config?: Partial<RetryConfig>): number;
/**
 * サーキットブレーカー
 */
export declare class CircuitBreaker {
    private readonly name;
    private state;
    private readonly failureThreshold;
    private readonly successThreshold;
    private readonly resetTimeoutMs;
    constructor(name: string, options?: {
        failureThreshold?: number;
        successThreshold?: number;
        resetTimeoutMs?: number;
    });
    /**
     * 操作の実行を許可するかチェック
     */
    canExecute(): boolean;
    /**
     * 成功を記録
     */
    recordSuccess(): void;
    /**
     * 失敗を記録
     */
    recordFailure(): void;
    private transitionToOpen;
    /**
     * 現在の状態を取得
     */
    getState(): CircuitBreakerState;
    /**
     * 強制的にリセット
     */
    reset(): void;
}
/**
 * リトライ付きで関数を実行
 */
export declare function executeWithRetry<T>(operation: () => Promise<T>, options: {
    name: string;
    retryConfig?: Partial<RetryConfig>;
    circuitBreaker?: CircuitBreaker;
    onRetry?: (attempt: number, error: ClassifiedError) => void;
}): Promise<T>;
/**
 * グレースフルデグラデーション付きで実行
 */
export declare function executeWithFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>, options: {
    name: string;
    retryConfig?: Partial<RetryConfig>;
}): Promise<{
    result: T;
    usedFallback: boolean;
}>;
/**
 * エラーをログ記録用にフォーマット
 */
export declare function formatErrorForLog(error: ClassifiedError): Record<string, unknown>;
//# sourceMappingURL=error-handler.d.ts.map