import { RiskLevel } from '@auto-claude/core';
import type { ApprovalRequest } from '@auto-claude/core';
export interface ApprovalGateConfig {
    requestDir: string;
    defaultTimeoutMs: number;
    autoApproveRiskLevel: RiskLevel;
}
export interface RequestApprovalOptions {
    type: ApprovalRequest['type'];
    title: string;
    description: string;
    riskLevel: RiskLevel;
    timeoutMs?: number;
    metadata?: Record<string, unknown>;
}
export declare class ApprovalGate {
    private config;
    private pendingRequests;
    private discord;
    constructor(config?: Partial<ApprovalGateConfig>);
    private ensureRequestDir;
    private loadPendingRequests;
    private savePendingRequests;
    requestApproval(options: RequestApprovalOptions): Promise<boolean>;
    waitForApproval(requestId: string, checkIntervalMs?: number): Promise<boolean>;
    approve(requestId: string, approvedBy?: string): boolean;
    reject(requestId: string, rejectedBy?: string, reason?: string): boolean;
    getPendingRequests(): ApprovalRequest[];
    getRequest(requestId: string): ApprovalRequest | undefined;
    cleanupExpired(): number;
}
export declare function getApprovalGate(config?: Partial<ApprovalGateConfig>): ApprovalGate;
//# sourceMappingURL=approval-gate.d.ts.map