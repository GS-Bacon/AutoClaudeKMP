/**
 * 統一的エラーハンドリングシステム
 *
 * エラーを分類し、適切なリカバリーアクションを提案する
 */
import { Logger } from './logger.js';
import { ErrorCategory, } from './types.js';
const logger = new Logger('ErrorHandler');
// デフォルトのリトライ設定
const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryableCategories: [
        ErrorCategory.TRANSIENT,
        ErrorCategory.RESOURCE,
        ErrorCategory.EXTERNAL,
    ],
};
// エラーパターンとカテゴリのマッピング
const ERROR_PATTERNS = [
    // 一時的エラー
    { pattern: /ECONNRESET/i, category: ErrorCategory.TRANSIENT },
    { pattern: /ETIMEDOUT/i, category: ErrorCategory.TRANSIENT },
    { pattern: /ECONNREFUSED/i, category: ErrorCategory.TRANSIENT },
    { pattern: /network/i, category: ErrorCategory.TRANSIENT },
    { pattern: /timeout/i, category: ErrorCategory.TRANSIENT },
    { pattern: /rate limit/i, category: ErrorCategory.TRANSIENT },
    { pattern: /429/i, category: ErrorCategory.TRANSIENT },
    { pattern: /503/i, category: ErrorCategory.TRANSIENT },
    { pattern: /502/i, category: ErrorCategory.TRANSIENT },
    { pattern: /504/i, category: ErrorCategory.TRANSIENT },
    // リソースエラー
    { pattern: /ENOMEM/i, category: ErrorCategory.RESOURCE },
    { pattern: /ENOSPC/i, category: ErrorCategory.RESOURCE },
    { pattern: /out of memory/i, category: ErrorCategory.RESOURCE },
    { pattern: /disk full/i, category: ErrorCategory.RESOURCE },
    { pattern: /quota exceeded/i, category: ErrorCategory.RESOURCE },
    // 設定エラー
    { pattern: /ENOENT/i, category: ErrorCategory.CONFIGURATION },
    { pattern: /invalid config/i, category: ErrorCategory.CONFIGURATION },
    { pattern: /missing.*key/i, category: ErrorCategory.CONFIGURATION },
    { pattern: /invalid.*path/i, category: ErrorCategory.CONFIGURATION },
    { pattern: /permission denied/i, category: ErrorCategory.CONFIGURATION },
    { pattern: /EACCES/i, category: ErrorCategory.CONFIGURATION },
    // 検証エラー
    { pattern: /validation/i, category: ErrorCategory.VALIDATION },
    { pattern: /invalid.*input/i, category: ErrorCategory.VALIDATION },
    { pattern: /schema/i, category: ErrorCategory.VALIDATION },
    { pattern: /required/i, category: ErrorCategory.VALIDATION },
    // 外部サービスエラー
    { pattern: /api.*error/i, category: ErrorCategory.EXTERNAL },
    { pattern: /service unavailable/i, category: ErrorCategory.EXTERNAL },
    { pattern: /external/i, category: ErrorCategory.EXTERNAL },
    // 永続的エラー
    { pattern: /401/i, category: ErrorCategory.PERMANENT },
    { pattern: /403/i, category: ErrorCategory.PERMANENT },
    { pattern: /404/i, category: ErrorCategory.PERMANENT },
    { pattern: /not found/i, category: ErrorCategory.PERMANENT },
    { pattern: /unauthorized/i, category: ErrorCategory.PERMANENT },
    { pattern: /forbidden/i, category: ErrorCategory.PERMANENT },
];
/**
 * エラーを分類する
 */
export function classifyError(error, context) {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message || String(error);
    // パターンマッチでカテゴリを特定
    let category = ErrorCategory.UNKNOWN;
    for (const { pattern, category: cat } of ERROR_PATTERNS) {
        if (pattern.test(message)) {
            category = cat;
            break;
        }
    }
    // リトライ可能かどうかを判定
    const retryable = [
        ErrorCategory.TRANSIENT,
        ErrorCategory.RESOURCE,
        ErrorCategory.EXTERNAL,
    ].includes(category);
    // 推奨アクションを生成
    const suggestedAction = getSuggestedAction(category, message);
    return {
        originalError: err,
        category,
        message,
        code: err.code,
        retryable,
        suggestedAction,
        context,
        timestamp: new Date(),
    };
}
/**
 * カテゴリに基づいた推奨アクションを取得
 */
function getSuggestedAction(category, message) {
    switch (category) {
        case ErrorCategory.TRANSIENT:
            return '一時的なエラーです。指数バックオフでリトライしてください。';
        case ErrorCategory.PERMANENT:
            return '永続的なエラーです。代替手段を検討するか、設定を確認してください。';
        case ErrorCategory.CONFIGURATION:
            return '設定エラーです。設定ファイルやパス、権限を確認してください。';
        case ErrorCategory.RESOURCE:
            return 'リソース不足です。ディスク/メモリを確認し、不要なプロセスを終了してください。';
        case ErrorCategory.EXTERNAL:
            return '外部サービスエラーです。サービスの状態を確認し、時間をおいてリトライしてください。';
        case ErrorCategory.VALIDATION:
            return '入力検証エラーです。入力データの形式を確認してください。';
        default:
            return `不明なエラー: ${message}。ログを確認し、必要に応じてエスカレーションしてください。`;
    }
}
/**
 * リカバリーアクションを決定
 */
export function determineRecoveryAction(classifiedError, failureCount, maxRetries = DEFAULT_RETRY_CONFIG.maxRetries) {
    const { category, retryable } = classifiedError;
    // リトライ可能で最大リトライ数に達していない場合
    if (retryable && failureCount < maxRetries) {
        return {
            type: 'retry',
            description: `${failureCount + 1}回目のリトライを実行します（最大${maxRetries}回）`,
        };
    }
    // カテゴリ別のリカバリーアクション
    switch (category) {
        case ErrorCategory.CONFIGURATION:
            return {
                type: 'fix_config',
                description: '設定を確認・修正してください',
                requiredApproval: true,
            };
        case ErrorCategory.PERMANENT:
            return {
                type: 'fallback',
                description: '代替手段への切り替えを検討してください',
                requiredApproval: true,
            };
        case ErrorCategory.RESOURCE:
            return {
                type: 'escalate',
                description: 'リソース不足のため、管理者への通知が必要です',
                requiredApproval: true,
            };
        case ErrorCategory.EXTERNAL:
            if (failureCount >= maxRetries) {
                return {
                    type: 'fallback',
                    description: '外部サービスが回復するまで、代替処理を実行します',
                };
            }
            return {
                type: 'retry',
                description: '外部サービスの回復を待ってリトライします',
            };
        default:
            if (failureCount >= maxRetries) {
                return {
                    type: 'abort',
                    description: '最大リトライ数に達しました。処理を中止します',
                };
            }
            return {
                type: 'escalate',
                description: '原因不明のエラーです。調査が必要です',
                requiredApproval: true,
            };
    }
}
/**
 * 指数バックオフの遅延時間を計算
 */
export function calculateBackoffDelay(attempt, config = {}) {
    const { baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs, maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs, backoffMultiplier = DEFAULT_RETRY_CONFIG.backoffMultiplier, } = config;
    // ジッターを追加してサンダリングハード問題を回避
    const jitter = Math.random() * 0.3 + 0.85; // 0.85 - 1.15
    const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt) * jitter, maxDelayMs);
    return Math.floor(delay);
}
/**
 * サーキットブレーカー
 */
export class CircuitBreaker {
    name;
    state = {
        state: 'closed',
        failureCount: 0,
        successCount: 0,
    };
    failureThreshold;
    successThreshold;
    resetTimeoutMs;
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold ?? 5;
        this.successThreshold = options.successThreshold ?? 3;
        this.resetTimeoutMs = options.resetTimeoutMs ?? 60000;
    }
    /**
     * 操作の実行を許可するかチェック
     */
    canExecute() {
        if (this.state.state === 'closed') {
            return true;
        }
        if (this.state.state === 'open') {
            // リセット時間が経過したらhalf-openに移行
            if (this.state.nextRetryTime &&
                new Date() >= this.state.nextRetryTime) {
                this.state.state = 'half-open';
                this.state.successCount = 0;
                logger.info(`CircuitBreaker[${this.name}]: open -> half-open`);
                return true;
            }
            return false;
        }
        // half-openの場合は実行を許可
        return true;
    }
    /**
     * 成功を記録
     */
    recordSuccess() {
        this.state.successCount++;
        this.state.lastSuccessTime = new Date();
        if (this.state.state === 'half-open') {
            if (this.state.successCount >= this.successThreshold) {
                this.state.state = 'closed';
                this.state.failureCount = 0;
                logger.info(`CircuitBreaker[${this.name}]: half-open -> closed`);
            }
        }
        else if (this.state.state === 'closed') {
            // 成功時は失敗カウントをリセット
            this.state.failureCount = 0;
        }
    }
    /**
     * 失敗を記録
     */
    recordFailure() {
        this.state.failureCount++;
        this.state.lastFailureTime = new Date();
        if (this.state.state === 'half-open') {
            // half-openで失敗したら即座にopenに戻る
            this.transitionToOpen();
        }
        else if (this.state.state === 'closed') {
            if (this.state.failureCount >= this.failureThreshold) {
                this.transitionToOpen();
            }
        }
    }
    transitionToOpen() {
        this.state.state = 'open';
        this.state.nextRetryTime = new Date(Date.now() + this.resetTimeoutMs);
        logger.warn(`CircuitBreaker[${this.name}]: -> open (次のリトライ: ${this.state.nextRetryTime.toISOString()})`);
    }
    /**
     * 現在の状態を取得
     */
    getState() {
        return { ...this.state };
    }
    /**
     * 強制的にリセット
     */
    reset() {
        this.state = {
            state: 'closed',
            failureCount: 0,
            successCount: 0,
        };
        logger.info(`CircuitBreaker[${this.name}]: リセットされました`);
    }
}
/**
 * リトライ付きで関数を実行
 */
export async function executeWithRetry(operation, options) {
    const { name, retryConfig = {}, circuitBreaker, onRetry } = options;
    const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        // サーキットブレーカーのチェック
        if (circuitBreaker && !circuitBreaker.canExecute()) {
            throw new Error(`CircuitBreaker[${name}]がオープン状態です。操作を実行できません。`);
        }
        try {
            const result = await operation();
            // 成功を記録
            circuitBreaker?.recordSuccess();
            if (attempt > 0) {
                logger.info(`${name}: ${attempt}回のリトライ後に成功`);
            }
            return result;
        }
        catch (error) {
            lastError = classifyError(error, { operation: name, attempt });
            // 失敗を記録
            circuitBreaker?.recordFailure();
            logger.warn(`${name}: 失敗 (試行 ${attempt + 1}/${config.maxRetries + 1})`, {
                category: lastError.category,
                message: lastError.message,
                retryable: lastError.retryable,
            });
            // リトライ可能でない場合は即座に終了
            if (!lastError.retryable || !config.retryableCategories.includes(lastError.category)) {
                throw error;
            }
            // 最大リトライ数に達した場合
            if (attempt >= config.maxRetries) {
                break;
            }
            // コールバックを呼び出し
            onRetry?.(attempt + 1, lastError);
            // バックオフ待機
            const delay = calculateBackoffDelay(attempt, config);
            logger.debug(`${name}: ${delay}ms後にリトライ`);
            await sleep(delay);
        }
    }
    throw lastError?.originalError ?? new Error(`${name}: 最大リトライ数に達しました`);
}
/**
 * グレースフルデグラデーション付きで実行
 */
export async function executeWithFallback(primary, fallback, options) {
    const { name, retryConfig } = options;
    try {
        const result = await executeWithRetry(primary, { name, retryConfig });
        return { result, usedFallback: false };
    }
    catch (primaryError) {
        logger.warn(`${name}: プライマリ操作が失敗。フォールバックを実行`, {
            error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        });
        try {
            const result = await fallback();
            logger.info(`${name}: フォールバックが成功`);
            return { result, usedFallback: true };
        }
        catch (fallbackError) {
            logger.error(`${name}: フォールバックも失敗`, {
                primaryError: primaryError instanceof Error ? primaryError.message : String(primaryError),
                fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            });
            throw fallbackError;
        }
    }
}
/**
 * エラーをログ記録用にフォーマット
 */
export function formatErrorForLog(error) {
    return {
        category: error.category,
        message: error.message,
        code: error.code,
        retryable: error.retryable,
        suggestedAction: error.suggestedAction,
        context: error.context,
        timestamp: error.timestamp.toISOString(),
        stack: error.originalError.stack,
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=error-handler.js.map