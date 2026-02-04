import { getLogger, generateId, } from '@auto-claude/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
const logger = getLogger('suggestion-gate');
export class SuggestionGate {
    config;
    pendingFile;
    processedFile;
    constructor(config = {}) {
        this.config = {
            suggestionsDir: config.suggestionsDir ?? '/home/bacon/AutoClaudeKMP/workspace/suggestions',
        };
        this.pendingFile = join(this.config.suggestionsDir, 'pending.json');
        this.processedFile = join(this.config.suggestionsDir, 'processed.json');
        this.ensureDirectories();
        logger.info('SuggestionGate initialized', { suggestionsDir: this.config.suggestionsDir });
    }
    ensureDirectories() {
        if (!existsSync(this.config.suggestionsDir)) {
            mkdirSync(this.config.suggestionsDir, { recursive: true });
        }
        const historyDir = join(this.config.suggestionsDir, 'history');
        if (!existsSync(historyDir)) {
            mkdirSync(historyDir, { recursive: true });
        }
        // 初期ファイルがなければ作成
        if (!existsSync(this.pendingFile)) {
            writeFileSync(this.pendingFile, '[]', 'utf-8');
        }
        if (!existsSync(this.processedFile)) {
            writeFileSync(this.processedFile, '[]', 'utf-8');
        }
    }
    readPending() {
        try {
            const content = readFileSync(this.pendingFile, 'utf-8');
            const suggestions = JSON.parse(content);
            return suggestions.map((s) => ({
                ...s,
                createdAt: new Date(s.createdAt),
                systemResponse: s.systemResponse
                    ? { ...s.systemResponse, respondedAt: new Date(s.systemResponse.respondedAt) }
                    : undefined,
            }));
        }
        catch (error) {
            logger.error('Failed to read pending suggestions', { error });
            return [];
        }
    }
    writePending(suggestions) {
        try {
            writeFileSync(this.pendingFile, JSON.stringify(suggestions, null, 2), 'utf-8');
        }
        catch (error) {
            logger.error('Failed to write pending suggestions', { error });
        }
    }
    readProcessed() {
        try {
            const content = readFileSync(this.processedFile, 'utf-8');
            const suggestions = JSON.parse(content);
            return suggestions.map((s) => ({
                ...s,
                createdAt: new Date(s.createdAt),
                systemResponse: s.systemResponse
                    ? { ...s.systemResponse, respondedAt: new Date(s.systemResponse.respondedAt) }
                    : undefined,
            }));
        }
        catch (error) {
            logger.error('Failed to read processed suggestions', { error });
            return [];
        }
    }
    writeProcessed(suggestions) {
        try {
            writeFileSync(this.processedFile, JSON.stringify(suggestions, null, 2), 'utf-8');
        }
        catch (error) {
            logger.error('Failed to write processed suggestions', { error });
        }
    }
    create(input) {
        const suggestion = {
            id: generateId('sug'),
            title: input.title,
            content: input.content,
            category: input.category,
            priority: input.priority,
            status: 'pending',
            createdAt: new Date(),
        };
        const pending = this.readPending();
        pending.push(suggestion);
        this.writePending(pending);
        logger.info('Suggestion created', { id: suggestion.id, title: suggestion.title });
        return suggestion;
    }
    getPending() {
        return this.readPending().filter((s) => s.status === 'pending');
    }
    getDeferred() {
        const pending = this.readPending().filter((s) => s.status === 'deferred');
        const processed = this.readProcessed().filter((s) => s.status === 'deferred');
        return [...pending, ...processed];
    }
    getAccepted() {
        const pending = this.readPending().filter((s) => s.status === 'accepted');
        const processed = this.readProcessed().filter((s) => s.status === 'accepted');
        return [...pending, ...processed];
    }
    incrementReviewCount(id) {
        const pending = this.readPending();
        const index = pending.findIndex((s) => s.id === id);
        if (index !== -1) {
            pending[index].reviewCount = (pending[index].reviewCount ?? 0) + 1;
            this.writePending(pending);
            return pending[index].reviewCount;
        }
        const processed = this.readProcessed();
        const procIndex = processed.findIndex((s) => s.id === id);
        if (procIndex !== -1) {
            processed[procIndex].reviewCount = (processed[procIndex].reviewCount ?? 0) + 1;
            this.writeProcessed(processed);
            return processed[procIndex].reviewCount;
        }
        return 0;
    }
    updateSuggestion(id, updates) {
        const pending = this.readPending();
        const index = pending.findIndex((s) => s.id === id);
        if (index !== -1) {
            if (updates.status) {
                pending[index].status = updates.status;
            }
            if (updates.systemResponse) {
                pending[index].systemResponse = {
                    ...updates.systemResponse,
                    respondedAt: new Date(),
                };
            }
            this.writePending(pending);
            logger.info('Suggestion updated', { id, updates });
            return true;
        }
        const processed = this.readProcessed();
        const procIndex = processed.findIndex((s) => s.id === id);
        if (procIndex !== -1) {
            if (updates.status) {
                processed[procIndex].status = updates.status;
            }
            if (updates.systemResponse) {
                processed[procIndex].systemResponse = {
                    ...updates.systemResponse,
                    respondedAt: new Date(),
                };
            }
            this.writeProcessed(processed);
            logger.info('Suggestion updated', { id, updates });
            return true;
        }
        return false;
    }
    getAll() {
        const pending = this.readPending();
        const processed = this.readProcessed();
        return [...pending, ...processed].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    getById(id) {
        const pending = this.readPending();
        const found = pending.find((s) => s.id === id);
        if (found)
            return found;
        const processed = this.readProcessed();
        return processed.find((s) => s.id === id) ?? null;
    }
    respond(id, response, newStatus) {
        const pending = this.readPending();
        const index = pending.findIndex((s) => s.id === id);
        if (index === -1) {
            logger.warn('Suggestion not found in pending', { id });
            return false;
        }
        const suggestion = pending[index];
        suggestion.status = newStatus;
        suggestion.systemResponse = {
            ...response,
            respondedAt: new Date(),
        };
        // pendingから削除してprocessedに移動
        pending.splice(index, 1);
        this.writePending(pending);
        const processed = this.readProcessed();
        processed.push(suggestion);
        this.writeProcessed(processed);
        // 月別履歴にも保存
        this.archiveToHistory(suggestion);
        logger.info('Suggestion responded', { id, status: newStatus });
        return true;
    }
    archiveToHistory(suggestion) {
        const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
        const historyFile = join(this.config.suggestionsDir, 'history', `${monthKey}.json`);
        let history = [];
        if (existsSync(historyFile)) {
            try {
                history = JSON.parse(readFileSync(historyFile, 'utf-8'));
            }
            catch {
                history = [];
            }
        }
        history.push(suggestion);
        writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
    }
    updateStatus(id, status) {
        const pending = this.readPending();
        const index = pending.findIndex((s) => s.id === id);
        if (index !== -1) {
            pending[index].status = status;
            this.writePending(pending);
            return true;
        }
        const processed = this.readProcessed();
        const procIndex = processed.findIndex((s) => s.id === id);
        if (procIndex !== -1) {
            processed[procIndex].status = status;
            this.writeProcessed(processed);
            return true;
        }
        return false;
    }
}
let instance = null;
export function getSuggestionGate(config) {
    if (!instance) {
        instance = new SuggestionGate(config);
    }
    return instance;
}
//# sourceMappingURL=suggestion-gate.js.map