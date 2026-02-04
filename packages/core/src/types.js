import { z } from 'zod';
export var RiskLevel;
(function (RiskLevel) {
    RiskLevel[RiskLevel["LOW"] = 1] = "LOW";
    RiskLevel[RiskLevel["MEDIUM"] = 2] = "MEDIUM";
    RiskLevel[RiskLevel["HIGH"] = 3] = "HIGH";
    RiskLevel[RiskLevel["CRITICAL"] = 4] = "CRITICAL";
})(RiskLevel || (RiskLevel = {}));
export var TaskStatus;
(function (TaskStatus) {
    TaskStatus["PENDING"] = "pending";
    TaskStatus["RUNNING"] = "running";
    TaskStatus["COMPLETED"] = "completed";
    TaskStatus["FAILED"] = "failed";
    TaskStatus["CANCELLED"] = "cancelled";
})(TaskStatus || (TaskStatus = {}));
export var SystemState;
(function (SystemState) {
    SystemState["HEALTHY"] = "healthy";
    SystemState["DEGRADED"] = "degraded";
    SystemState["SAFE_MODE"] = "safe_mode";
    SystemState["STOPPED"] = "stopped";
})(SystemState || (SystemState = {}));
export var WorkPhase;
(function (WorkPhase) {
    WorkPhase["IDLE"] = "idle";
    WorkPhase["PLANNING"] = "planning";
    WorkPhase["IMPLEMENTING"] = "implementing";
    WorkPhase["REVIEWING"] = "reviewing";
    WorkPhase["ANALYZING"] = "analyzing";
    WorkPhase["MAINTAINING"] = "maintaining";
    WorkPhase["LEARNING"] = "learning";
})(WorkPhase || (WorkPhase = {}));
export var ToolStatus;
(function (ToolStatus) {
    ToolStatus["HEALTHY"] = "healthy";
    ToolStatus["DEGRADED"] = "degraded";
    ToolStatus["UNAVAILABLE"] = "unavailable";
})(ToolStatus || (ToolStatus = {}));
export const ConfigSchema = z.object({
    limits: z.object({
        maxLossJPY: z.number().default(30000),
        maxCpuPercent: z.number().default(30),
        maxMemoryMB: z.number().default(2048),
        maxDiskGB: z.number().default(10),
        maxProcesses: z.number().default(20),
    }),
    intervals: z.object({
        healthCheckMs: z.number().default(5 * 60 * 1000),
        heartbeatMs: z.number().default(30 * 60 * 1000),
        dailyAnalysisHour: z.number().default(6),
        backupHour: z.number().default(3),
    }),
    discord: z.object({
        webhookUrl: z.string().optional(),
        channelId: z.string().optional(),
    }),
    paths: z.object({
        workspace: z.string().default('/home/bacon/AutoClaudeKMP/workspace'),
        backups: z.string().default('/home/bacon/AutoClaudeKMP/backups'),
        sandbox: z.string().default('/home/bacon/AutoClaudeKMP/sandbox'),
        auth: z.string().default('/home/bacon/AutoClaudeKMP/auth'),
    }),
});
// エラーハンドリング関連の型定義
export var ErrorCategory;
(function (ErrorCategory) {
    ErrorCategory["TRANSIENT"] = "transient";
    ErrorCategory["PERMANENT"] = "permanent";
    ErrorCategory["CONFIGURATION"] = "configuration";
    ErrorCategory["RESOURCE"] = "resource";
    ErrorCategory["EXTERNAL"] = "external";
    ErrorCategory["VALIDATION"] = "validation";
    ErrorCategory["UNKNOWN"] = "unknown";
})(ErrorCategory || (ErrorCategory = {}));
//# sourceMappingURL=types.js.map