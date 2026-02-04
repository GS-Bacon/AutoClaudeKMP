import { RiskLevel, getLogger } from '@auto-claude/core';
import { getBrowserManager } from '@auto-claude/browser';
import { Strategy, StrategyType } from '../strategy-manager';
import {
  BaseExecutor,
  ExecutionPlan,
  ExecutionStep,
  StepResult,
} from './base-executor';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const logger = getLogger('freelance-executor');

interface JobListing {
  id: string;
  title: string;
  description: string;
  budget: { min: number; max: number };
  deadline?: string;
  skills: string[];
  platform: string;
  url: string;
}

interface ProposalDraft {
  jobId: string;
  jobTitle: string;
  introduction: string;
  approach: string;
  timeline: string;
  price: number;
  platform: string;
}

interface FreelanceConfig {
  platforms?: string[];  // crowdworks, lancers, coconala
  skills?: string[];
  minBudget?: number;
  maxBudget?: number;
  preferredCategories?: string[];
}

export class FreelanceExecutor extends BaseExecutor {
  readonly supportedTypes = [StrategyType.FREELANCE];
  private browser = getBrowserManager();
  private proposalsDir = '/home/bacon/AutoClaudeKMP/workspace/proposals';
  private jobsDir = '/home/bacon/AutoClaudeKMP/workspace/jobs';

  constructor() {
    super();
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    for (const dir of [this.proposalsDir, this.jobsDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  protected buildPlanPrompt(strategy: Strategy): string {
    const config = strategy.config as FreelanceConfig;

    return `あなたはフリーランス案件獲得戦略のプランナーです。

以下の戦略に対して、具体的な実行ステップを JSON 形式で出力してください。

戦略情報:
- 名前: ${strategy.name}
- 説明: ${strategy.description}
- 期待収益: ¥${strategy.expectedRevenue}
- 対象プラットフォーム: ${config.platforms?.join(', ') || 'crowdworks, lancers'}
- スキル: ${config.skills?.join(', ') || '未指定'}
- 予算範囲: ¥${config.minBudget || 0} - ¥${config.maxBudget || '上限なし'}

出力形式（必ずこのJSON形式で出力）:
\`\`\`json
{
  "steps": [
    {
      "name": "ステップ名",
      "description": "何をするか",
      "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
      "action": "具体的なアクション",
      "expectedOutput": "期待される成果物"
    }
  ],
  "estimatedRevenue": 0,
  "estimatedCost": 0
}
\`\`\`

リスクレベル基準:
- LOW: 案件検索、情報収集（承認不要）
- MEDIUM: 提案文作成、案件応募（条件付き自動承認）
- HIGH: 契約締結、有料サービス利用（要承認）

最低でも以下のステップを含めてください:
1. 案件検索（LOW）
2. 案件フィルタリング・評価（LOW）
3. 提案文作成（LOW）
4. （オプション）案件応募（MEDIUM）`;
  }

  protected getDefaultPlan(strategy: Strategy): ExecutionPlan {
    const config = strategy.config as FreelanceConfig;

    const steps: ExecutionStep[] = [
      {
        id: 'step-1',
        name: '案件検索',
        description: '条件に合う案件を検索',
        riskLevel: RiskLevel.LOW,
        action: 'search_jobs',
        expectedOutput: '案件リスト',
        requiresApproval: false,
      },
      {
        id: 'step-2',
        name: '案件評価',
        description: '案件を評価してスコアリング',
        riskLevel: RiskLevel.LOW,
        action: 'evaluate_jobs',
        expectedOutput: '評価済み案件リスト',
        requiresApproval: false,
      },
      {
        id: 'step-3',
        name: '提案文作成',
        description: '選定した案件への提案文を作成',
        riskLevel: RiskLevel.LOW,
        action: 'create_proposals',
        expectedOutput: '提案文ドラフト',
        requiresApproval: false,
      },
    ];

    // 自動応募が有効な場合のみ応募ステップを追加
    if (strategy.config.autoApply) {
      steps.push({
        id: 'step-4',
        name: '案件応募',
        description: '提案文を使って案件に応募',
        riskLevel: RiskLevel.MEDIUM,
        action: 'apply_to_jobs',
        expectedOutput: '応募完了通知',
        requiresApproval: true,
      });
    }

    return {
      strategyId: strategy.id,
      strategyName: strategy.name,
      steps,
      totalRiskLevel: RiskLevel.LOW,
      estimatedRevenue: strategy.expectedRevenue,
      estimatedCost: strategy.expectedCost,
    };
  }

  protected async executeStep(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    logger.info('Executing step', {
      strategyId: strategy.id,
      stepId: step.id,
      action: step.action,
    });

    try {
      switch (step.action) {
        case 'search_jobs':
          return await this.searchJobs(strategy, step);

        case 'evaluate_jobs':
          return await this.evaluateJobs(strategy, step);

        case 'create_proposals':
          return await this.createProposals(strategy, step);

        case 'apply_to_jobs':
          return await this.applyToJobs(strategy, step);

        default:
          return await this.executeGenericAction(strategy, step);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Step execution failed', {
        strategyId: strategy.id,
        stepId: step.id,
        error: errorMessage,
      });

      return {
        stepId: step.id,
        success: false,
        error: errorMessage,
        revenue: 0,
        cost: 0,
      };
    }
  }

  private async searchJobs(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const config = strategy.config as FreelanceConfig;
    const platforms = config.platforms || ['crowdworks'];

    // ClaudeAIにシミュレートされた案件検索を依頼
    // 実際のプラットフォームAPIやスクレイピングは別途実装が必要
    const prompt = `以下の条件でフリーランス案件を検索したと仮定し、見つかりそうな案件を5件シミュレートしてください。

条件:
- プラットフォーム: ${platforms.join(', ')}
- スキル: ${config.skills?.join(', ') || 'プログラミング全般'}
- 予算範囲: ¥${config.minBudget || 0} - ¥${config.maxBudget || 100000}
- カテゴリ: ${config.preferredCategories?.join(', ') || 'IT・Web'}

JSON形式で出力:
\`\`\`json
{
  "jobs": [
    {
      "id": "job-xxx",
      "title": "案件タイトル",
      "description": "案件の説明",
      "budget": { "min": 10000, "max": 50000 },
      "skills": ["スキル1", "スキル2"],
      "platform": "crowdworks",
      "url": "https://example.com/job/xxx"
    }
  ]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const parsed = this.parseJsonFromResponse(result);
    const jobs = parsed.jobs || [];

    // 案件をファイルに保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${strategy.id}-jobs-${timestamp}.json`;
    const filepath = join(this.jobsDir, filename);
    writeFileSync(filepath, JSON.stringify(jobs, null, 2), 'utf-8');

    strategy.config._searchedJobs = jobs;

    return {
      stepId: step.id,
      success: true,
      output: `${jobs.length}件の案件が見つかりました`,
      revenue: 0,
      cost: 0,
      artifacts: { jobs, filepath },
    };
  }

  private async evaluateJobs(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const jobs = (strategy.config._searchedJobs as JobListing[]) || [];

    if (jobs.length === 0) {
      return {
        stepId: step.id,
        success: false,
        error: '評価する案件がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const config = strategy.config as FreelanceConfig;

    const prompt = `以下の案件リストを評価し、応募すべき優先度を付けてください。

案件リスト:
${JSON.stringify(jobs, null, 2)}

評価基準:
- スキルマッチ度（${config.skills?.join(', ') || '不明'}）
- 予算妥当性
- 競争率（推測）
- 成功確率

JSON形式で出力:
\`\`\`json
{
  "evaluatedJobs": [
    {
      "jobId": "job-xxx",
      "score": 85,
      "recommendation": "強く推奨|推奨|検討|見送り",
      "reason": "理由"
    }
  ]
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const parsed = this.parseJsonFromResponse(result);
    const evaluatedJobs = parsed.evaluatedJobs || [];

    // スコア80以上の案件のみ残す
    const recommendedJobs = evaluatedJobs
      .filter((e: any) => e.score >= 80)
      .map((e: any) => {
        const job = jobs.find((j) => j.id === e.jobId);
        return { ...job, evaluation: e };
      });

    strategy.config._evaluatedJobs = recommendedJobs;

    return {
      stepId: step.id,
      success: true,
      output: `${recommendedJobs.length}件の推奨案件を選定`,
      revenue: 0,
      cost: 0,
      artifacts: { evaluatedJobs, recommendedJobs },
    };
  }

  private async createProposals(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const jobs = (strategy.config._evaluatedJobs as any[]) || [];

    if (jobs.length === 0) {
      return {
        stepId: step.id,
        success: false,
        error: '提案を作成する案件がありません',
        revenue: 0,
        cost: 0,
      };
    }

    const config = strategy.config as FreelanceConfig;
    const proposals: ProposalDraft[] = [];

    for (const job of jobs.slice(0, 3)) {  // 最大3件まで
      const prompt = `以下の案件に対する提案文を作成してください。

案件情報:
${JSON.stringify(job, null, 2)}

自分のスキル: ${config.skills?.join(', ') || 'プログラミング全般'}

要件:
- プロフェッショナルで誠実なトーン
- 具体的なアプローチを提示
- 現実的なスケジュール
- 適切な価格設定

JSON形式で出力:
\`\`\`json
{
  "introduction": "自己紹介と案件への関心（100-200字）",
  "approach": "具体的なアプローチ・実装方針（200-400字）",
  "timeline": "作業スケジュール",
  "price": 提案金額（数値）
}
\`\`\``;

      const result = this.executeClaudeCommand(prompt);
      const parsed = this.parseJsonFromResponse(result);

      proposals.push({
        jobId: job.id,
        jobTitle: job.title,
        introduction: parsed.introduction,
        approach: parsed.approach,
        timeline: parsed.timeline,
        price: parsed.price,
        platform: job.platform,
      });
    }

    // 提案をファイルに保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const proposal of proposals) {
      const filename = `${strategy.id}-proposal-${proposal.jobId}-${timestamp}.json`;
      const filepath = join(this.proposalsDir, filename);
      writeFileSync(filepath, JSON.stringify(proposal, null, 2), 'utf-8');
    }

    strategy.config._proposals = proposals;

    return {
      stepId: step.id,
      success: true,
      output: `${proposals.length}件の提案文を作成`,
      revenue: 0,
      cost: 0,
      artifacts: { proposals },
    };
  }

  private async applyToJobs(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const proposals = (strategy.config._proposals as ProposalDraft[]) || [];

    if (proposals.length === 0) {
      return {
        stepId: step.id,
        success: false,
        error: '応募する提案がありません',
        revenue: 0,
        cost: 0,
      };
    }

    // 実際の応募はプラットフォームアダプター経由で行う
    // 現時点ではログ出力と通知のみ
    logger.info('Job application requested', {
      proposalCount: proposals.length,
    });

    await this.discord.sendInfo(
      '案件応募準備完了',
      `${proposals.length}件の案件への提案準備が完了しました。\n` +
      proposals.map((p) => `- ${p.jobTitle}: ¥${p.price}`).join('\n')
    );

    return {
      stepId: step.id,
      success: true,
      output: `${proposals.length}件の応募準備完了`,
      revenue: 0,
      cost: 0,
      artifacts: { proposals },
    };
  }

  private async executeGenericAction(
    strategy: Strategy,
    step: ExecutionStep
  ): Promise<StepResult> {
    const prompt = `以下のフリーランス関連タスクを実行し、結果をJSON形式で報告してください。

戦略: ${strategy.name}
タスク: ${step.name}
説明: ${step.description}

JSON形式で出力:
\`\`\`json
{
  "success": true,
  "output": "実行結果の説明"
}
\`\`\``;

    const result = this.executeClaudeCommand(prompt);
    const parsed = this.parseJsonFromResponse(result);

    return {
      stepId: step.id,
      success: parsed.success ?? true,
      output: parsed.output || result,
      revenue: 0,
      cost: 0,
    };
  }

  private executeClaudeCommand(prompt: string): string {
    try {
      const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const result = execSync(`claude --print "${escapedPrompt}"`, {
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return result;
    } catch (error) {
      logger.error('Claude command failed', { error });
      throw error;
    }
  }

  private parseJsonFromResponse(response: string): any {
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    try {
      return JSON.parse(response);
    } catch {
      return { raw: response };
    }
  }
}
