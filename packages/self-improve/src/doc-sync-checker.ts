import { getLogger } from '@auto-claude/core';
import { existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const logger = getLogger('self-improve:doc-sync');

/**
 * ソースファイルとドキュメントのマッピング
 */
const SYNC_MAP: Record<string, string[]> = {
  'apps/orchestrator/src/orchestrator.ts': ['docs/WORKFLOWS.md'],
  'apps/orchestrator/src/scheduler.ts': ['docs/WORKFLOWS.md'],
  'apps/orchestrator/src/heartbeat.ts': ['docs/WORKFLOWS.md'],
  'packages/self-improve/src/learning-cycle.ts': ['docs/WORKFLOWS.md'],
  'packages/notification/src/suggestion-gate.ts': ['docs/WORKFLOWS.md'],
  'packages/strategies/src/strategy-manager.ts': ['docs/WORKFLOWS.md'],
};

export interface DocSyncStatus {
  lastChecked: string | null;
  lastUpdated: string | null;
  syncStatus: 'initialized' | 'synced' | 'outdated';
  trackedFiles: Record<string, {
    lastModified: string | null;
    linkedDocs: string[];
  }>;
  documentMetadata: Record<string, {
    lastModified: string | null;
    version: string;
  }>;
}

export interface OutdatedFile {
  sourcePath: string;
  sourceModified: Date;
  linkedDocs: string[];
  docModified: Date | null;
}

export interface UpdateSuggestion {
  title: string;
  content: string;
  category: 'improvement';
  priority: 'medium';
  outdatedFiles: OutdatedFile[];
}

export class DocSyncChecker {
  private rootDir: string;
  private statusFilePath: string;

  constructor(rootDir: string = '/home/bacon/AutoClaudeKMP') {
    this.rootDir = rootDir;
    this.statusFilePath = join(rootDir, 'docs/sync/DOC_SYNC_STATUS.json');
    logger.info('DocSyncChecker initialized', { rootDir });
  }

  /**
   * ステータスファイルを読み込む
   */
  private readStatus(): DocSyncStatus {
    try {
      if (existsSync(this.statusFilePath)) {
        const content = readFileSync(this.statusFilePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.error('Failed to read doc sync status', { error });
    }

    // デフォルトステータスを返す
    return {
      lastChecked: null,
      lastUpdated: null,
      syncStatus: 'initialized',
      trackedFiles: {},
      documentMetadata: {},
    };
  }

  /**
   * ステータスファイルを書き込む
   */
  private writeStatus(status: DocSyncStatus): void {
    try {
      writeFileSync(this.statusFilePath, JSON.stringify(status, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to write doc sync status', { error });
    }
  }

  /**
   * ファイルの最終更新日時を取得
   */
  private getFileModifiedTime(relativePath: string): Date | null {
    const fullPath = join(this.rootDir, relativePath);
    try {
      if (existsSync(fullPath)) {
        const stats = statSync(fullPath);
        return stats.mtime;
      }
    } catch (error) {
      logger.debug('Failed to get file stats', { path: relativePath, error });
    }
    return null;
  }

  /**
   * 同期状態をチェックし、古くなったファイルを返す
   */
  async checkSyncStatus(): Promise<OutdatedFile[]> {
    logger.info('Checking document sync status');

    const status = this.readStatus();
    const outdatedFiles: OutdatedFile[] = [];

    for (const [sourcePath, linkedDocs] of Object.entries(SYNC_MAP)) {
      const sourceModified = this.getFileModifiedTime(sourcePath);

      if (!sourceModified) {
        continue; // ソースファイルが存在しない
      }

      for (const docPath of linkedDocs) {
        const docModified = this.getFileModifiedTime(docPath);

        // ドキュメントが存在しない、またはソースより古い場合
        if (!docModified || sourceModified > docModified) {
          outdatedFiles.push({
            sourcePath,
            sourceModified,
            linkedDocs,
            docModified,
          });
          break; // 同じソースファイルを重複して追加しない
        }
      }

      // トラッキング情報を更新
      status.trackedFiles[sourcePath] = {
        lastModified: sourceModified.toISOString(),
        linkedDocs,
      };
    }

    // ステータスを更新
    status.lastChecked = new Date().toISOString();
    status.syncStatus = outdatedFiles.length > 0 ? 'outdated' : 'synced';
    this.writeStatus(status);

    logger.info('Document sync check completed', {
      outdatedCount: outdatedFiles.length,
      status: status.syncStatus,
    });

    return outdatedFiles;
  }

  /**
   * ドキュメント更新提案を生成
   */
  async generateUpdateSuggestion(): Promise<UpdateSuggestion | null> {
    const outdatedFiles = await this.checkSyncStatus();

    if (outdatedFiles.length === 0) {
      return null;
    }

    // 影響を受けるドキュメントを集計
    const affectedDocs = new Set<string>();
    for (const file of outdatedFiles) {
      for (const doc of file.linkedDocs) {
        affectedDocs.add(doc);
      }
    }

    const fileList = outdatedFiles
      .map((f) => `- ${f.sourcePath} (更新: ${f.sourceModified.toISOString().slice(0, 10)})`)
      .join('\n');

    const docList = Array.from(affectedDocs).join(', ');

    return {
      title: `ドキュメント更新が必要: ${outdatedFiles.length}件`,
      content: `以下のソースファイルがドキュメントより新しくなっています：\n\n${fileList}\n\n影響を受けるドキュメント: ${docList}\n\nワークフローの変更がある場合は、対応するMermaidフローチャートの更新を検討してください。`,
      category: 'improvement',
      priority: 'medium',
      outdatedFiles,
    };
  }

  /**
   * 同期完了をマーク
   */
  markSynced(): void {
    const status = this.readStatus();
    status.lastUpdated = new Date().toISOString();
    status.syncStatus = 'synced';

    // ドキュメントのメタデータを更新
    for (const docPath of Object.keys(status.documentMetadata)) {
      const modified = this.getFileModifiedTime(docPath);
      if (modified) {
        status.documentMetadata[docPath].lastModified = modified.toISOString();
      }
    }

    this.writeStatus(status);
    logger.info('Documents marked as synced');
  }

  /**
   * 現在のステータスを取得
   */
  getStatus(): DocSyncStatus {
    return this.readStatus();
  }
}

let instance: DocSyncChecker | null = null;

export function getDocSyncChecker(rootDir?: string): DocSyncChecker {
  if (!instance) {
    instance = new DocSyncChecker(rootDir);
  }
  return instance;
}
