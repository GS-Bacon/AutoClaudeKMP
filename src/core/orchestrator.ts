import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { Phase, CycleContext, createCycleContext } from "../phases/types.js";
import { goalManager } from "../goals/index.js";
import { getAIProvider } from "../ai/factory.js";
import { HybridProvider, PhaseName } from "../ai/hybrid-provider.js";

import { HealthCheckPhase } from "../phases/1-health-check/index.js";
import { ErrorDetectPhase } from "../phases/2-error-detect/index.js";
import { ImproveFindPhase } from "../phases/3-improve-find/index.js";
import { SearchPhase } from "../phases/4-search/index.js";
import { PlanPhase } from "../phases/5-plan/index.js";
import { ImplementPhase } from "../phases/6-implement/index.js";
import { TestGenPhase } from "../phases/7-test-gen/index.js";
import { VerifyPhase } from "../phases/8-verify/index.js";

import {
  patternRepository,
  patternExtractor,
  initializeLearningSystem,
  ExtractionContext,
} from "../learning/index.js";

export class Orchestrator {
  private phases: Phase[];
  private isRunning: boolean = false;
  private currentContext: CycleContext | null = null;

  constructor() {
    this.phases = [
      new HealthCheckPhase(),
      new ErrorDetectPhase(),
      new ImproveFindPhase(),
      new SearchPhase(),
      new PlanPhase(),
      new ImplementPhase(),
      new TestGenPhase(),
      new VerifyPhase(),
    ];
  }

  async runCycle(): Promise<CycleContext> {
    if (this.isRunning) {
      logger.warn("Cycle already running, skipping");
      throw new Error("Cycle already in progress");
    }

    this.isRunning = true;
    const context = createCycleContext();
    this.currentContext = context;

    // Initialize learning system
    try {
      await initializeLearningSystem();
    } catch (error) {
      logger.warn("Failed to initialize learning system", { error });
    }

    // Load active goals into context
    context.activeGoals = goalManager.getActiveGoals();
    context.goalProgress = [];

    // Initialize learning context
    context.usedPatterns = [];
    context.patternMatches = 0;
    context.aiCalls = 0;

    logger.info("Starting improvement cycle", {
      cycleId: context.cycleId,
      activeGoals: context.activeGoals.length,
    });
    await eventBus.emit({ type: "cycle_started", timestamp: context.startTime });

    try {
      for (const phase of this.phases) {
        logger.info(`Executing phase: ${phase.name}`);

        // Set current phase on hybrid provider if in use
        try {
          const provider = getAIProvider();
          if (provider instanceof HybridProvider) {
            provider.setCurrentPhase(phase.name as PhaseName);
          }
        } catch {
          // Provider not yet initialized, skip
        }

        await eventBus.emit({
          type: "phase_started",
          phase: phase.name,
          timestamp: new Date(),
        });

        const result = await phase.execute(context);

        await eventBus.emit({
          type: "phase_completed",
          phase: phase.name,
          success: result.success,
          timestamp: new Date(),
        });

        if (!result.success) {
          logger.warn(`Phase ${phase.name} failed`, { message: result.message });
        }

        if (result.shouldStop) {
          logger.info(`Phase ${phase.name} requested stop`, { message: result.message });
          break;
        }
      }

      // Feedback Loop: パターン学習と信頼度更新
      await this.executeFeedbackLoop(context);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Cycle failed with error", { error: errorMessage });
      await eventBus.emit({
        type: "error",
        error: errorMessage,
        context: { cycleId: context.cycleId },
      });

      // 失敗時も使用パターンの信頼度を更新
      await this.updatePatternConfidence(context, false);

    } finally {
      this.isRunning = false;
      const duration = Date.now() - context.startTime.getTime();

      // Record goal progress if any
      if (context.goalProgress && context.goalProgress.length > 0) {
        for (const progress of context.goalProgress) {
          goalManager.recordProgress(
            progress.goalId,
            context.cycleId,
            progress.metricUpdates,
            progress.notes
          );
        }
      }

      // Record learning statistics
      try {
        patternRepository.recordCycleCompletion(
          context.patternMatches || 0,
          context.aiCalls || 0
        );
        await patternRepository.save();
      } catch (error) {
        logger.warn("Failed to save learning statistics", { error });
      }

      await eventBus.emit({
        type: "cycle_completed",
        timestamp: new Date(),
        duration,
      });
      logger.info("Cycle completed", {
        cycleId: context.cycleId,
        duration,
        patternMatches: context.patternMatches,
        aiCalls: context.aiCalls,
        usedPatterns: context.usedPatterns?.length || 0,
      });
    }

    return context;
  }

  /**
   * Feedback Loop: サイクル完了後にパターン学習と信頼度更新
   */
  private async executeFeedbackLoop(context: CycleContext): Promise<void> {
    const testSuccess = context.testResults?.passed === true;

    if (testSuccess) {
      // 解決成功 → パターン学習
      await this.extractAndSavePatterns(context);
    }

    // 使用したパターンの信頼度を更新
    await this.updatePatternConfidence(context, testSuccess);
  }

  /**
   * 解決からパターンを抽出して保存
   */
  private async extractAndSavePatterns(context: CycleContext): Promise<void> {
    if (!context.plan || !context.implementedChanges) {
      return;
    }

    try {
      // 問題と解決策から抽出コンテキストを作成
      const extractionContexts: ExtractionContext[] = [];

      // Issues からの抽出
      for (const issue of context.issues) {
        if (context.plan.targetIssue?.id === issue.id) {
          extractionContexts.push({
            problem: {
              type: issue.type,
              description: issue.message,
              file: issue.file || "",
            },
            solution: {
              description: context.plan.description,
              changes: context.implementedChanges.map((c) => ({
                file: c.file,
                before: "", // 実際の変更内容は取得困難なため空
                after: "",
              })),
            },
            success: true,
          });
        }
      }

      // Improvements からの抽出
      for (const improvement of context.improvements) {
        if (context.plan.targetImprovement?.id === improvement.id) {
          extractionContexts.push({
            problem: {
              type: improvement.type,
              description: improvement.description,
              file: improvement.file,
            },
            solution: {
              description: context.plan.description,
              changes: context.implementedChanges.map((c) => ({
                file: c.file,
                before: "",
                after: "",
              })),
            },
            success: true,
          });
        }
      }

      if (extractionContexts.length > 0) {
        const newPatterns = await patternExtractor.extractPatterns(extractionContexts);

        if (newPatterns.length > 0) {
          await patternRepository.addAndSavePatterns(newPatterns);
          logger.info("New patterns learned", {
            count: newPatterns.length,
            patterns: newPatterns.map((p) => p.name),
          });
        }
      }
    } catch (error) {
      logger.warn("Failed to extract patterns", { error });
    }
  }

  /**
   * 使用したパターンの信頼度を更新
   */
  private async updatePatternConfidence(
    context: CycleContext,
    success: boolean
  ): Promise<void> {
    const usedPatterns = context.usedPatterns || [];

    for (const patternId of usedPatterns) {
      try {
        patternRepository.updateConfidence(patternId, success);
        logger.debug("Pattern confidence updated", {
          patternId,
          success,
        });
      } catch (error) {
        logger.warn("Failed to update pattern confidence", { patternId, error });
      }
    }
  }

  getStatus(): {
    isRunning: boolean;
    currentCycleId?: string;
    phases: string[];
  } {
    return {
      isRunning: this.isRunning,
      currentCycleId: this.currentContext?.cycleId,
      phases: this.phases.map((p) => p.name),
    };
  }
}

export const orchestrator = new Orchestrator();
