import { z } from 'zod';
export declare enum RiskLevel {
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3,
    CRITICAL = 4
}
export declare enum TaskStatus {
    PENDING = "pending",
    RUNNING = "running",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled"
}
export declare enum SystemState {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    SAFE_MODE = "safe_mode",
    STOPPED = "stopped"
}
export declare enum WorkPhase {
    IDLE = "idle",// 待機中
    PLANNING = "planning",// 戦略・計画立案中
    IMPLEMENTING = "implementing",// 実装中
    REVIEWING = "reviewing",// レビュー・検証中
    ANALYZING = "analyzing",// 分析中
    MAINTAINING = "maintaining",// メンテナンス中
    LEARNING = "learning"
}
export interface CurrentPhase {
    phase: WorkPhase;
    description: string;
    startedAt: Date;
    taskId?: string;
    progress?: number;
    currentGoal?: string;
    nextSteps?: string[];
}
export declare enum ToolStatus {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    UNAVAILABLE = "unavailable"
}
export interface Task {
    id: string;
    type: string;
    description: string;
    priority: number;
    status: TaskStatus;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: unknown;
    error?: string;
    retryCount: number;
    maxRetries: number;
}
export interface FinancialTransaction {
    id: string;
    timestamp: Date;
    type: 'income' | 'expense' | 'investment';
    amount: number;
    currency: string;
    category: string;
    description: string;
    source?: string;
    metadata?: Record<string, unknown>;
}
export interface AuditEntry {
    timestamp: Date;
    actionId: string;
    actionType: string;
    description: string;
    actor: 'system' | 'ai' | 'human';
    input?: unknown;
    output?: unknown;
    riskLevel: RiskLevel;
    approved: boolean;
    approvedBy?: string;
    financialImpact?: number;
    success: boolean;
    error?: string;
}
export interface ApprovalRequest {
    id: string;
    type: 'action' | 'financial' | 'boundary' | 'strategy';
    title: string;
    description: string;
    riskLevel: RiskLevel;
    requiredApprovals: number;
    approvals: string[];
    rejections: string[];
    createdAt: Date;
    expiresAt: Date;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    metadata?: Record<string, unknown>;
}
export interface ResourceUsage {
    cpuPercent: number;
    memoryMB: number;
    memoryPercent: number;
    diskGB: number;
    diskPercent: number;
    networkMbps: number;
    processCount: number;
}
export interface ToolHealth {
    claudeCode: ToolStatus;
    browser: ToolStatus;
    network: ToolStatus;
    discord: ToolStatus;
}
export interface SystemHealth {
    state: SystemState;
    uptime: number;
    lastHeartbeat: Date;
    resources: ResourceUsage;
    tools: ToolHealth;
    errors: string[];
    warnings: string[];
    currentPhase?: CurrentPhase;
}
export declare const ConfigSchema: z.ZodObject<{
    limits: z.ZodObject<{
        maxLossJPY: z.ZodDefault<z.ZodNumber>;
        maxCpuPercent: z.ZodDefault<z.ZodNumber>;
        maxMemoryMB: z.ZodDefault<z.ZodNumber>;
        maxDiskGB: z.ZodDefault<z.ZodNumber>;
        maxProcesses: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        maxLossJPY: number;
        maxCpuPercent: number;
        maxMemoryMB: number;
        maxDiskGB: number;
        maxProcesses: number;
    }, {
        maxLossJPY?: number | undefined;
        maxCpuPercent?: number | undefined;
        maxMemoryMB?: number | undefined;
        maxDiskGB?: number | undefined;
        maxProcesses?: number | undefined;
    }>;
    intervals: z.ZodObject<{
        healthCheckMs: z.ZodDefault<z.ZodNumber>;
        heartbeatMs: z.ZodDefault<z.ZodNumber>;
        dailyAnalysisHour: z.ZodDefault<z.ZodNumber>;
        backupHour: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        healthCheckMs: number;
        heartbeatMs: number;
        dailyAnalysisHour: number;
        backupHour: number;
    }, {
        healthCheckMs?: number | undefined;
        heartbeatMs?: number | undefined;
        dailyAnalysisHour?: number | undefined;
        backupHour?: number | undefined;
    }>;
    discord: z.ZodObject<{
        webhookUrl: z.ZodOptional<z.ZodString>;
        channelId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        webhookUrl?: string | undefined;
        channelId?: string | undefined;
    }, {
        webhookUrl?: string | undefined;
        channelId?: string | undefined;
    }>;
    paths: z.ZodObject<{
        workspace: z.ZodDefault<z.ZodString>;
        backups: z.ZodDefault<z.ZodString>;
        sandbox: z.ZodDefault<z.ZodString>;
        auth: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        workspace: string;
        backups: string;
        sandbox: string;
        auth: string;
    }, {
        workspace?: string | undefined;
        backups?: string | undefined;
        sandbox?: string | undefined;
        auth?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    limits: {
        maxLossJPY: number;
        maxCpuPercent: number;
        maxMemoryMB: number;
        maxDiskGB: number;
        maxProcesses: number;
    };
    intervals: {
        healthCheckMs: number;
        heartbeatMs: number;
        dailyAnalysisHour: number;
        backupHour: number;
    };
    discord: {
        webhookUrl?: string | undefined;
        channelId?: string | undefined;
    };
    paths: {
        workspace: string;
        backups: string;
        sandbox: string;
        auth: string;
    };
}, {
    limits: {
        maxLossJPY?: number | undefined;
        maxCpuPercent?: number | undefined;
        maxMemoryMB?: number | undefined;
        maxDiskGB?: number | undefined;
        maxProcesses?: number | undefined;
    };
    intervals: {
        healthCheckMs?: number | undefined;
        heartbeatMs?: number | undefined;
        dailyAnalysisHour?: number | undefined;
        backupHour?: number | undefined;
    };
    discord: {
        webhookUrl?: string | undefined;
        channelId?: string | undefined;
    };
    paths: {
        workspace?: string | undefined;
        backups?: string | undefined;
        sandbox?: string | undefined;
        auth?: string | undefined;
    };
}>;
export type Config = z.infer<typeof ConfigSchema>;
export type SuggestionCategory = 'feature' | 'bug' | 'improvement' | 'question' | 'other';
export type SuggestionPriority = 'low' | 'medium' | 'high';
export type SuggestionStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'implemented' | 'deferred';
export interface SuggestionSystemResponse {
    analysis: string;
    decision: string;
    actionPlan?: string;
    respondedAt: Date;
}
export interface Suggestion {
    id: string;
    title: string;
    content: string;
    category: SuggestionCategory;
    priority: SuggestionPriority;
    status: SuggestionStatus;
    createdAt: Date;
    systemResponse?: SuggestionSystemResponse;
    reviewCount?: number;
}
export interface DailyReportActivities {
    tasksCompleted: number;
    strategiesRun: number;
    suggestionsProcessed: number;
}
export interface DailyReportFinancials {
    income: number;
    expense: number;
    net: number;
}
export interface DailyReport {
    date: string;
    generatedAt: Date;
    summary: string;
    activities: DailyReportActivities;
    accomplishments: string[];
    failures: string[];
    improvements: string[];
    financials: DailyReportFinancials;
    healthStatus: string;
}
export interface WeeklyReportTotals {
    tasksCompleted: number;
    strategiesRun: number;
    suggestionsProcessed: number;
    income: number;
    expense: number;
    net: number;
}
export interface WeeklyReport {
    week: string;
    startDate: string;
    endDate: string;
    generatedAt: Date;
    summary: string;
    totals: WeeklyReportTotals;
    highlights: string[];
    challenges: string[];
    learnings: string[];
    dailyReports: string[];
}
export declare enum ErrorCategory {
    TRANSIENT = "transient",// 一時的エラー（リトライで解決可能）
    PERMANENT = "permanent",// 永続的エラー（代替手段が必要）
    CONFIGURATION = "configuration",// 設定ミス（修正が必要）
    RESOURCE = "resource",// リソース不足
    EXTERNAL = "external",// 外部サービス依存
    VALIDATION = "validation",// 入力検証エラー
    UNKNOWN = "unknown"
}
export interface ClassifiedError {
    originalError: Error;
    category: ErrorCategory;
    message: string;
    code?: string;
    retryable: boolean;
    suggestedAction: string;
    context?: Record<string, unknown>;
    timestamp: Date;
}
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableCategories: ErrorCategory[];
}
export interface CircuitBreakerState {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    successCount: number;
    lastFailureTime?: Date;
    lastSuccessTime?: Date;
    nextRetryTime?: Date;
}
export interface RecoveryAction {
    type: 'retry' | 'fallback' | 'escalate' | 'abort' | 'fix_config';
    description: string;
    execute?: () => Promise<void>;
    requiredApproval?: boolean;
}
export interface DiagnosticResult {
    component: string;
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    message: string;
    details?: Record<string, unknown>;
    recommendations?: string[];
    timestamp: Date;
}
export interface SystemDiagnosticReport {
    id: string;
    generatedAt: Date;
    overallStatus: 'healthy' | 'warning' | 'critical';
    components: DiagnosticResult[];
    performanceTrends: PerformanceTrend[];
    issues: DiagnosticIssue[];
    recommendations: DiagnosticRecommendation[];
}
export interface PerformanceTrend {
    metric: string;
    values: {
        timestamp: Date;
        value: number;
    }[];
    trend: 'improving' | 'stable' | 'degrading';
    alert?: string;
}
export interface DiagnosticIssue {
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    component: string;
    description: string;
    firstDetected: Date;
    occurrences: number;
    suggestedFix?: string;
}
export interface DiagnosticRecommendation {
    priority: number;
    category: 'performance' | 'reliability' | 'cost' | 'security' | 'maintenance';
    title: string;
    description: string;
    estimatedImpact: string;
    actionItems: string[];
}
export interface ResearchResult {
    id: string;
    type: 'opportunity' | 'strategy_update' | 'market' | 'trend' | 'methodology';
    title: string;
    summary: string;
    sources: string[];
    findings: ResearchFinding[];
    recommendations: string[];
    conductedAt: Date;
    expiresAt?: Date;
}
export interface ResearchFinding {
    topic: string;
    insight: string;
    confidence: 'low' | 'medium' | 'high';
    relevance: number;
    actionable: boolean;
    suggestedAction?: string;
}
export interface OpportunityCandidate {
    id: string;
    category: string;
    title: string;
    description: string;
    evaluation: OpportunityEvaluation;
    status: 'discovered' | 'evaluating' | 'promising' | 'rejected' | 'adopted';
    discoveredAt: Date;
}
export interface OpportunityEvaluation {
    skillFit: number;
    initialInvestment: 'low' | 'medium' | 'high';
    timeToRevenue: 'immediate' | 'short' | 'medium' | 'long';
    scalability: 'low' | 'medium' | 'high';
    competition: 'low' | 'medium' | 'high';
    sustainability: 'one-time' | 'recurring' | 'passive';
    riskLevel: 'low' | 'medium' | 'high';
    overallScore: number;
    reasoning: string;
}
export type ExperimentPhase = 'idea' | 'planning' | 'sandbox' | 'trial' | 'evaluate' | 'adopted' | 'abandoned';
export interface Experiment {
    id: string;
    title: string;
    description: string;
    category: 'monetization' | 'technology' | 'process' | 'tool';
    phase: ExperimentPhase;
    hypothesis: string;
    successCriteria: string[];
    resourceAllocation: number;
    startedAt: Date;
    milestones: ExperimentMilestone[];
    results?: ExperimentResults;
    sandboxPath?: string;
}
export interface ExperimentMilestone {
    id: string;
    title: string;
    targetDate: Date;
    completedAt?: Date;
    status: 'pending' | 'in_progress' | 'completed' | 'missed';
    notes?: string;
}
export interface ExperimentResults {
    outcome: 'success' | 'partial' | 'failure';
    summary: string;
    metrics: Record<string, number>;
    learnings: string[];
    nextSteps?: string[];
}
export interface SuccessPattern {
    id: string;
    type: 'query' | 'procedure' | 'solution' | 'approach';
    title: string;
    description: string;
    context: string;
    steps?: string[];
    successCount: number;
    lastUsedAt: Date;
    discoveredAt: Date;
    reusableAs?: 'script' | 'skill' | 'template' | 'knowledge';
    reusableArtifactPath?: string;
}
export interface SkillDefinition {
    name: string;
    description: string;
    promptTemplate: string;
    parameters: SkillParameter[];
    createdFrom: string;
    createdAt: Date;
}
export interface SkillParameter {
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    default?: unknown;
}
export interface RetrospectiveReport {
    id: string;
    period: 'daily' | 'weekly' | 'monthly';
    startDate: Date;
    endDate: Date;
    generatedAt: Date;
    summary: string;
    whatWentWell: RetrospectiveItem[];
    whatWentWrong: RetrospectiveItem[];
    improvements: RetrospectiveItem[];
    metrics: RetrospectiveMetrics;
    actionItems: ActionItem[];
}
export interface RetrospectiveItem {
    description: string;
    impact: 'low' | 'medium' | 'high';
    category: string;
    examples?: string[];
}
export interface RetrospectiveMetrics {
    tasksCompleted: number;
    tasksPlanned: number;
    completionRate: number;
    predictionAccuracy?: number;
    revenueActual: number;
    revenueTarget?: number;
    errorsEncountered: number;
    errorsResolved: number;
}
export interface ActionItem {
    id: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    assignedTo?: string;
    dueDate?: Date;
    status: 'pending' | 'in_progress' | 'completed';
}
export interface ResearchLog {
    id: string;
    improvementId: string;
    phase: 'problem' | 'solution' | 'implementation';
    query: string;
    sources: string[];
    findings: string;
    conclusion: string;
    conductedAt: Date;
}
export interface StrategyPlan {
    id: string;
    strategyId: string;
    createdAt: Date;
    validityCheck: ValidityCheck;
    riskAnalysis: PlanRiskAnalysis;
    alternatives: AlternativeApproach[];
    selectedApproach: string;
    executionConditions: ExecutionConditions;
    approved: boolean;
    approvedAt?: Date;
}
export interface ValidityCheck {
    isValid: boolean;
    issues: string[];
    assumptions: string[];
    dependencies: string[];
}
export interface PlanRiskAnalysis {
    scenarios: RiskScenario[];
    overallRisk: 'low' | 'medium' | 'high';
    mitigationStrategies: string[];
}
export interface RiskScenario {
    description: string;
    probability: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
}
export interface AlternativeApproach {
    name: string;
    description: string;
    pros: string[];
    cons: string[];
    estimatedEffort: 'low' | 'medium' | 'high';
    recommended: boolean;
}
export interface ExecutionConditions {
    successCriteria: string[];
    abortCriteria: string[];
    timeoutMinutes?: number;
    requiredResources: string[];
}
//# sourceMappingURL=types.d.ts.map