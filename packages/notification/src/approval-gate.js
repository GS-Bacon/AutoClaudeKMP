import { RiskLevel, getLogger, generateId, sleep } from '@auto-claude/core';
import { getDiscordNotifier } from './discord.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
const logger = getLogger('notification:approval');
export class ApprovalGate {
    config;
    pendingRequests = new Map();
    discord = getDiscordNotifier();
    constructor(config = {}) {
        this.config = {
            requestDir: config.requestDir ?? '/home/bacon/AutoClaudeKMP/workspace/approvals',
            defaultTimeoutMs: config.defaultTimeoutMs ?? 24 * 60 * 60 * 1000,
            autoApproveRiskLevel: config.autoApproveRiskLevel ?? RiskLevel.LOW,
        };
        this.ensureRequestDir();
        this.loadPendingRequests();
        logger.info('ApprovalGate initialized');
    }
    ensureRequestDir() {
        if (!existsSync(this.config.requestDir)) {
            mkdirSync(this.config.requestDir, { recursive: true });
        }
    }
    loadPendingRequests() {
        const indexFile = join(this.config.requestDir, 'pending.json');
        if (existsSync(indexFile)) {
            try {
                const data = JSON.parse(readFileSync(indexFile, 'utf-8'));
                for (const request of data) {
                    request.createdAt = new Date(request.createdAt);
                    request.expiresAt = new Date(request.expiresAt);
                    this.pendingRequests.set(request.id, request);
                }
            }
            catch (error) {
                logger.error('Failed to load pending requests', { error });
            }
        }
    }
    savePendingRequests() {
        const indexFile = join(this.config.requestDir, 'pending.json');
        const data = Array.from(this.pendingRequests.values());
        try {
            writeFileSync(indexFile, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (error) {
            logger.error('Failed to save pending requests', { error });
        }
    }
    async requestApproval(options) {
        // 低リスクは自動承認
        if (options.riskLevel <= this.config.autoApproveRiskLevel) {
            logger.info('Auto-approved low risk action', { title: options.title });
            return true;
        }
        const request = {
            id: generateId('approval'),
            type: options.type,
            title: options.title,
            description: options.description,
            riskLevel: options.riskLevel,
            requiredApprovals: options.riskLevel >= RiskLevel.CRITICAL ? 2 : 1,
            approvals: [],
            rejections: [],
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + (options.timeoutMs ?? this.config.defaultTimeoutMs)),
            status: 'pending',
            metadata: options.metadata,
        };
        this.pendingRequests.set(request.id, request);
        this.savePendingRequests();
        // Discord通知
        await this.discord.send({
            type: options.riskLevel >= RiskLevel.CRITICAL ? 'critical' : 'warning',
            title: `承認リクエスト: ${options.title}`,
            description: options.description,
            fields: [
                { name: 'ID', value: request.id, inline: true },
                { name: 'リスクレベル', value: `Level ${options.riskLevel}`, inline: true },
                { name: 'タイプ', value: options.type, inline: true },
                { name: '有効期限', value: request.expiresAt.toISOString() },
            ],
        });
        logger.info('Approval request created', {
            id: request.id,
            title: options.title,
            riskLevel: options.riskLevel,
        });
        return false;
    }
    async waitForApproval(requestId, checkIntervalMs = 5000) {
        while (true) {
            const request = this.pendingRequests.get(requestId);
            if (!request) {
                return false;
            }
            if (request.status === 'approved') {
                return true;
            }
            if (request.status === 'rejected') {
                return false;
            }
            if (new Date() >= request.expiresAt) {
                request.status = 'expired';
                this.savePendingRequests();
                return false;
            }
            await sleep(checkIntervalMs);
        }
    }
    approve(requestId, approvedBy = 'human') {
        const request = this.pendingRequests.get(requestId);
        if (!request || request.status !== 'pending') {
            return false;
        }
        request.approvals.push(approvedBy);
        if (request.approvals.length >= request.requiredApprovals) {
            request.status = 'approved';
            logger.info('Request approved', { id: requestId, approvedBy });
            this.discord.sendSuccess(`承認: ${request.title}`, `承認者: ${approvedBy}`);
        }
        this.savePendingRequests();
        return true;
    }
    reject(requestId, rejectedBy = 'human', reason) {
        const request = this.pendingRequests.get(requestId);
        if (!request || request.status !== 'pending') {
            return false;
        }
        request.rejections.push(rejectedBy);
        request.status = 'rejected';
        logger.info('Request rejected', { id: requestId, rejectedBy, reason });
        this.discord.sendError(`拒否: ${request.title}`, reason ?? `拒否者: ${rejectedBy}`);
        this.savePendingRequests();
        return true;
    }
    getPendingRequests() {
        const now = new Date();
        const pending = [];
        for (const request of this.pendingRequests.values()) {
            if (request.status === 'pending' && request.expiresAt > now) {
                pending.push(request);
            }
        }
        return pending;
    }
    getRequest(requestId) {
        return this.pendingRequests.get(requestId);
    }
    cleanupExpired() {
        const now = new Date();
        let cleaned = 0;
        for (const [id, request] of this.pendingRequests.entries()) {
            if (request.status === 'pending' && request.expiresAt <= now) {
                request.status = 'expired';
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.savePendingRequests();
            logger.info('Cleaned up expired requests', { count: cleaned });
        }
        return cleaned;
    }
}
let instance = null;
export function getApprovalGate(config) {
    if (!instance) {
        instance = new ApprovalGate(config);
    }
    return instance;
}
//# sourceMappingURL=approval-gate.js.map