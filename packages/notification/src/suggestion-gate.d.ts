import { type Suggestion, type SuggestionCategory, type SuggestionPriority, type SuggestionStatus, type SuggestionSystemResponse } from '@auto-claude/core';
export interface SuggestionGateConfig {
    suggestionsDir: string;
}
export interface CreateSuggestionInput {
    title: string;
    content: string;
    category: SuggestionCategory;
    priority: SuggestionPriority;
}
export declare class SuggestionGate {
    private config;
    private pendingFile;
    private processedFile;
    constructor(config?: Partial<SuggestionGateConfig>);
    private ensureDirectories;
    private readPending;
    private writePending;
    private readProcessed;
    private writeProcessed;
    create(input: CreateSuggestionInput): Suggestion;
    getPending(): Suggestion[];
    getDeferred(): Suggestion[];
    getAccepted(): Suggestion[];
    incrementReviewCount(id: string): number;
    updateSuggestion(id: string, updates: {
        status?: SuggestionStatus;
        systemResponse?: Omit<SuggestionSystemResponse, 'respondedAt'>;
    }): boolean;
    getAll(): Suggestion[];
    getById(id: string): Suggestion | null;
    respond(id: string, response: Omit<SuggestionSystemResponse, 'respondedAt'>, newStatus: SuggestionStatus): boolean;
    private archiveToHistory;
    updateStatus(id: string, status: SuggestionStatus): boolean;
}
export declare function getSuggestionGate(config?: Partial<SuggestionGateConfig>): SuggestionGate;
//# sourceMappingURL=suggestion-gate.d.ts.map