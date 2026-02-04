import { getLogger } from '@auto-claude/core';
import { getOpencodeCLI, OpencodeResult } from './opencode-cli.js';
import { getClaudeCLI, ClaudeResult } from './claude-cli.js';
import {
  SkillDefinition,
  SkillInput,
  SkillResult,
  SkillExecutionOptions,
  RegisteredSkill,
  FallbackBehavior,
} from './skills/types.js';
import { getGLMMonitor, GLMExecutionLog } from './glm-monitor.js';

const logger = getLogger('ai-router:task-router');

/**
 * タスクルーター統計情報
 */
export interface TaskRouterStats {
  totalExecutions: number;
  glmExecutions: number;
  claudeExecutions: number;
  glmSuccessRate: number;
  claudeFallbackRate: number;
  avgGlmDuration: number;
  avgClaudeDuration: number;
  tokensSaved: number; // 概算
}

/**
 * タスクルーター
 * GLM-4.7（Opencode）とClaudeの間でタスクをルーティングする
 */
export class TaskRouter {
  private skills: Map<string, RegisteredSkill> = new Map();
  private stats: TaskRouterStats = {
    totalExecutions: 0,
    glmExecutions: 0,
    claudeExecutions: 0,
    glmSuccessRate: 100,
    claudeFallbackRate: 0,
    avgGlmDuration: 0,
    avgClaudeDuration: 0,
    tokensSaved: 0,
  };

  constructor() {
    logger.info('TaskRouter initialized');
  }

  /**
   * スキルを登録する
   */
  registerSkill(definition: SkillDefinition): void {
    if (this.skills.has(definition.name)) {
      logger.warn('Skill already registered, overwriting', { name: definition.name });
    }

    this.skills.set(definition.name, {
      definition,
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      fallbackCount: 0,
      avgDuration: 0,
    });

    logger.info('Skill registered', { name: definition.name });
  }

  /**
   * 複数のスキルを一括登録
   */
  registerSkills(definitions: SkillDefinition[]): void {
    for (const def of definitions) {
      this.registerSkill(def);
    }
  }

  /**
   * スキルを実行する
   */
  async executeSkill<TInput extends SkillInput, TOutput>(
    skillName: string,
    input: TInput,
    options: SkillExecutionOptions = {}
  ): Promise<SkillResult<TOutput>> {
    const registered = this.skills.get(skillName);
    if (!registered) {
      return {
        success: false,
        error: `Skill not found: ${skillName}`,
        retryCount: 0,
        fallbackUsed: false,
        duration: 0,
      };
    }

    const skill = registered.definition as SkillDefinition<TInput, TOutput>;
    const startTime = Date.now();

    // 入力バリデーション
    if (skill.validateInput) {
      const validationError = skill.validateInput(input);
      if (validationError) {
        return {
          success: false,
          error: `Input validation failed: ${validationError}`,
          retryCount: 0,
          fallbackUsed: false,
          duration: Date.now() - startTime,
        };
      }
    }

    this.stats.totalExecutions++;
    registered.executionCount++;

    // 強制Claude実行
    if (options.forceClaude) {
      return this.executeWithClaude(skill, input, options, startTime);
    }

    // GLM-4.7で実行を試みる
    const fallbackBehavior = options.fallbackBehavior ?? skill.fallbackBehavior;
    const maxRetries = skill.maxRetries ?? 2;

    let lastResult: OpencodeResult | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      retryCount = attempt;
      const result = await this.executeWithGLM(skill, input, options);
      lastResult = result.opencodeResult;

      if (result.success && result.data) {
        // 出力バリデーション
        if (skill.validateOutput) {
          const outputError = skill.validateOutput(result.data);
          if (outputError) {
            logger.warn('Output validation failed, retrying', {
              skillName,
              attempt,
              error: outputError,
            });
            continue;
          }
        }

        // 成功
        const duration = Date.now() - startTime;
        this.updateStats(registered, true, false, duration);
        this.logExecution(skillName, input, true, true, false, duration, lastResult?.output);

        return {
          success: true,
          data: result.data,
          rawOutput: result.rawOutput,
          retryCount,
          fallbackUsed: false,
          duration,
        };
      }

      logger.warn('GLM execution attempt failed', {
        skillName,
        attempt,
        error: result.error,
      });
    }

    // リトライ上限到達
    const duration = Date.now() - startTime;

    if (fallbackBehavior === 'claude') {
      logger.info('Falling back to Claude', { skillName });
      return this.executeWithClaude(skill, input, options, startTime, retryCount);
    }

    // エラー返却
    this.updateStats(registered, false, false, duration);
    this.logExecution(skillName, input, false, false, false, duration, lastResult?.output, 'Max retries exceeded');

    return {
      success: false,
      rawOutput: lastResult?.output,
      error: `Max retries exceeded (${maxRetries + 1} attempts)`,
      retryCount,
      fallbackUsed: false,
      duration,
    };
  }

  /**
   * GLM-4.7で実行
   */
  private async executeWithGLM<TInput extends SkillInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options: SkillExecutionOptions
  ): Promise<{
    success: boolean;
    data?: TOutput;
    rawOutput?: string;
    error?: string;
    opencodeResult: OpencodeResult;
  }> {
    const opencode = getOpencodeCLI();
    const prompt = skill.buildPrompt(input);

    const result = await opencode.executeTask({
      prompt,
      timeout: options.timeout ?? skill.timeout,
      workingDir: options.workingDir,
    });

    this.stats.glmExecutions++;

    if (!result.success) {
      return {
        success: false,
        rawOutput: result.output,
        error: result.error ?? 'Opencode execution failed',
        opencodeResult: result,
      };
    }

    // パース試行
    const parsed = skill.parseOutput(result.output);
    if (!parsed) {
      return {
        success: false,
        rawOutput: result.output,
        error: 'Failed to parse output',
        opencodeResult: result,
      };
    }

    return {
      success: true,
      data: parsed,
      rawOutput: result.output,
      opencodeResult: result,
    };
  }

  /**
   * Claudeで実行（フォールバック）
   */
  private async executeWithClaude<TInput extends SkillInput, TOutput>(
    skill: SkillDefinition<TInput, TOutput>,
    input: TInput,
    options: SkillExecutionOptions,
    startTime: number,
    previousRetries: number = 0
  ): Promise<SkillResult<TOutput>> {
    const claude = getClaudeCLI();
    const prompt = skill.buildPrompt(input);

    const registered = this.skills.get(skill.name)!;

    const result = await claude.executeTask({
      prompt,
      timeout: options.timeout ?? skill.timeout ?? 300000,
      workingDir: options.workingDir,
      allowedTools: [], // プロンプト実行のみ
    });

    this.stats.claudeExecutions++;

    const duration = Date.now() - startTime;

    if (!result.success) {
      this.updateStats(registered, false, true, duration);
      this.logExecution(skill.name, input, false, false, true, duration, result.output, result.error);

      return {
        success: false,
        rawOutput: result.output,
        error: result.error ?? 'Claude execution failed',
        retryCount: previousRetries,
        fallbackUsed: true,
        duration,
      };
    }

    // パース試行
    const parsed = skill.parseOutput(result.output);
    if (!parsed) {
      this.updateStats(registered, false, true, duration);
      this.logExecution(skill.name, input, false, false, true, duration, result.output, 'Parse failed');

      return {
        success: false,
        rawOutput: result.output,
        error: 'Failed to parse Claude output',
        retryCount: previousRetries,
        fallbackUsed: true,
        duration,
      };
    }

    // 出力バリデーション
    if (skill.validateOutput) {
      const outputError = skill.validateOutput(parsed);
      if (outputError) {
        this.updateStats(registered, false, true, duration);
        this.logExecution(skill.name, input, false, false, true, duration, result.output, outputError);

        return {
          success: false,
          data: parsed,
          rawOutput: result.output,
          error: outputError,
          retryCount: previousRetries,
          fallbackUsed: true,
          duration,
        };
      }
    }

    // 成功
    this.updateStats(registered, true, true, duration);
    this.logExecution(skill.name, input, true, true, true, duration, result.output);

    // トークン節約計算（概算: GLMで成功していたら節約できた分）
    // Claude は約 $15/1M tokens、GLM は約 $0.5/1M tokens として計算
    // ここではフォールバックなので節約はなし

    return {
      success: true,
      data: parsed,
      rawOutput: result.output,
      retryCount: previousRetries,
      fallbackUsed: true,
      duration,
    };
  }

  /**
   * 統計情報を更新
   */
  private updateStats(
    registered: RegisteredSkill,
    success: boolean,
    fallbackUsed: boolean,
    duration: number
  ): void {
    if (success) {
      registered.successCount++;
    } else {
      registered.failureCount++;
    }

    if (fallbackUsed) {
      registered.fallbackCount++;
    }

    // 移動平均で duration を更新
    const count = registered.successCount + registered.failureCount;
    registered.avgDuration = (registered.avgDuration * (count - 1) + duration) / count;

    // 全体統計の更新
    const glmSuccess = this.stats.glmExecutions > 0
      ? ((this.stats.glmExecutions - registered.failureCount + (fallbackUsed ? 0 : registered.successCount)) / this.stats.glmExecutions) * 100
      : 100;
    this.stats.glmSuccessRate = glmSuccess;

    this.stats.claudeFallbackRate = this.stats.totalExecutions > 0
      ? (this.stats.claudeExecutions / this.stats.totalExecutions) * 100
      : 0;

    // トークン節約計算（GLMで成功した場合）
    if (success && !fallbackUsed) {
      // 概算: 1回のスキル実行で約1000トークン使用と仮定
      // Claude: $0.015/1K tokens, GLM: $0.0005/1K tokens
      // 節約額 ≈ $0.0145/1K tokens ≈ 1000 tokens saved per execution
      this.stats.tokensSaved += 1000;
    }
  }

  /**
   * 実行ログを記録
   */
  private logExecution(
    skillName: string,
    input: SkillInput,
    success: boolean,
    parseSuccess: boolean,
    fallbackUsed: boolean,
    duration: number,
    rawOutput?: string,
    error?: string
  ): void {
    const log: GLMExecutionLog = {
      timestamp: new Date().toISOString(),
      skillName,
      input: input as Record<string, unknown>,
      success,
      parseSuccess,
      fallbackUsed,
      duration,
      rawOutput: rawOutput?.slice(0, 1000), // ログサイズ制限
      error,
      retryCount: 0, // executeSkillで設定
    };

    try {
      const monitor = getGLMMonitor();
      monitor.logExecution(log);
    } catch (e) {
      logger.warn('Failed to log execution to GLM monitor', { error: e });
    }
  }

  /**
   * 統計情報を取得
   */
  getStats(): TaskRouterStats {
    return { ...this.stats };
  }

  /**
   * スキル別統計を取得
   */
  getSkillStats(): Record<string, Omit<RegisteredSkill, 'definition'>> {
    const result: Record<string, Omit<RegisteredSkill, 'definition'>> = {};
    for (const [name, registered] of this.skills) {
      result[name] = {
        executionCount: registered.executionCount,
        successCount: registered.successCount,
        failureCount: registered.failureCount,
        fallbackCount: registered.fallbackCount,
        avgDuration: registered.avgDuration,
      };
    }
    return result;
  }

  /**
   * 登録済みスキル一覧を取得
   */
  getRegisteredSkills(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * スキル定義を取得
   */
  getSkillDefinition(name: string): SkillDefinition | undefined {
    return this.skills.get(name)?.definition;
  }
}

let instance: TaskRouter | null = null;

export function getTaskRouter(): TaskRouter {
  if (!instance) {
    instance = new TaskRouter();
  }
  return instance;
}
