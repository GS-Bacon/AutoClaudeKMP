/**
 * パターン抽出器
 *
 * 成功パターンの自動検出と再利用可能な形式への変換を担当
 */

import {
  getLogger,
  SuccessPattern,
} from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('PatternExtractor');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface PatternCandidate {
  type: SuccessPattern['type'];
  content: string;
  context: string;
  source: string;
  timestamp: Date;
  successCount: number;
}

export interface ExtractionConfig {
  minSuccessCount: number;
  autoConvert: boolean;
  notifyOnExtraction: boolean;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  minSuccessCount: 2,
  autoConvert: false,
  notifyOnExtraction: true,
};

export class PatternExtractor {
  private readonly discord = getDiscordNotifier();
  private readonly config: ExtractionConfig;
  private readonly patterns: Map<string, SuccessPattern> = new Map();
  private readonly candidates: Map<string, PatternCandidate> = new Map();

  constructor(config: Partial<ExtractionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadPatterns();
  }

  /**
   * 成功事例を記録（パターン検出のため）
   */
  recordSuccess(
    type: SuccessPattern['type'],
    content: string,
    context: string,
    source: string
  ): void {
    const key = this.generatePatternKey(type, content);

    const existing = this.candidates.get(key);
    if (existing) {
      existing.successCount++;
      existing.timestamp = new Date();
      logger.debug('Success count incremented', { key, count: existing.successCount });

      // 閾値に達したらパターンに昇格
      if (existing.successCount >= this.config.minSuccessCount) {
        this.promoteToPattern(existing);
      }
    } else {
      const candidate: PatternCandidate = {
        type,
        content,
        context,
        source,
        timestamp: new Date(),
        successCount: 1,
      };
      this.candidates.set(key, candidate);
      logger.debug('New success recorded', { key });
    }
  }

  /**
   * パターンを抽出（週次バッチ処理用）
   */
  async extractPatterns(): Promise<SuccessPattern[]> {
    logger.info('Starting pattern extraction');

    const newPatterns: SuccessPattern[] = [];

    // 候補からパターンを抽出
    for (const [key, candidate] of this.candidates) {
      if (candidate.successCount >= this.config.minSuccessCount) {
        const pattern = await this.promoteToPattern(candidate);
        if (pattern) {
          newPatterns.push(pattern);
        }
        this.candidates.delete(key);
      }
    }

    // ログから追加のパターンを検出（将来的な拡張）
    const logPatterns = await this.extractFromLogs();
    newPatterns.push(...logPatterns);

    // 結果を保存
    await this.savePatterns();

    // 通知
    if (newPatterns.length > 0 && this.config.notifyOnExtraction) {
      await this.notifyExtraction(newPatterns);
    }

    logger.info('Pattern extraction completed', { newCount: newPatterns.length });

    return newPatterns;
  }

  /**
   * パターンを再利用可能な形式に変換
   */
  async convertPattern(patternId: string): Promise<{
    type: 'script' | 'skill' | 'template' | 'knowledge';
    path: string;
  } | null> {
    const pattern = this.patterns.get(patternId);
    if (!pattern) {
      logger.warn('Pattern not found', { patternId });
      return null;
    }

    // パターンタイプに応じた変換
    let type: 'script' | 'skill' | 'template' | 'knowledge';
    let artifactPath: string;

    switch (pattern.type) {
      case 'query':
        // 検索クエリ → Skillに変換
        type = 'skill';
        artifactPath = await this.convertToSkill(pattern);
        break;

      case 'procedure':
        // 手順 → スクリプトに変換
        type = 'script';
        artifactPath = await this.convertToScript(pattern);
        break;

      case 'solution':
        // 解決策 → ナレッジベースに追加
        type = 'knowledge';
        artifactPath = await this.addToKnowledgeBase(pattern);
        break;

      case 'approach':
        // アプローチ → テンプレートに変換
        type = 'template';
        artifactPath = await this.convertToTemplate(pattern);
        break;

      default:
        return null;
    }

    // パターンを更新
    pattern.reusableAs = type;
    pattern.reusableArtifactPath = artifactPath;
    await this.savePatterns();

    logger.info('Pattern converted', { patternId, type, path: artifactPath });

    return { type, path: artifactPath };
  }

  /**
   * 未変換のパターンを取得
   */
  getUnconvertedPatterns(): SuccessPattern[] {
    return Array.from(this.patterns.values()).filter(
      p => !p.reusableAs
    );
  }

  /**
   * パターンを検索
   */
  findPattern(query: string): SuccessPattern | undefined {
    const lowerQuery = query.toLowerCase();

    for (const pattern of this.patterns.values()) {
      if (
        pattern.title.toLowerCase().includes(lowerQuery) ||
        pattern.description.toLowerCase().includes(lowerQuery) ||
        pattern.context.toLowerCase().includes(lowerQuery)
      ) {
        return pattern;
      }
    }

    return undefined;
  }

  /**
   * パターンをカテゴリ別に取得
   */
  getPatternsByType(type: SuccessPattern['type']): SuccessPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.type === type);
  }

  /**
   * 全パターンを取得
   */
  getAllPatterns(): SuccessPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * パターンの使用を記録
   */
  recordUsage(patternId: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.successCount++;
      pattern.lastUsedAt = new Date();
      this.savePatterns();
    }
  }

  // Private methods

  private generatePatternKey(type: string, content: string): string {
    // コンテンツの正規化されたハッシュを生成
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    const hash = Buffer.from(normalized).toString('base64').slice(0, 20);
    return `${type}-${hash}`;
  }

  private async promoteToPattern(candidate: PatternCandidate): Promise<SuccessPattern | null> {
    const patternId = `pattern-${Date.now()}`;

    const pattern: SuccessPattern = {
      id: patternId,
      type: candidate.type,
      title: this.extractTitle(candidate.content),
      description: candidate.content,
      context: candidate.context,
      steps: this.extractSteps(candidate.content),
      successCount: candidate.successCount,
      lastUsedAt: candidate.timestamp,
      discoveredAt: new Date(),
    };

    this.patterns.set(patternId, pattern);

    logger.info('Pattern promoted', { patternId, title: pattern.title });

    return pattern;
  }

  private extractTitle(content: string): string {
    // 最初の行または最初の50文字をタイトルとして使用
    const firstLine = content.split('\n')[0];
    if (firstLine.length <= 50) {
      return firstLine;
    }
    return firstLine.slice(0, 47) + '...';
  }

  private extractSteps(content: string): string[] {
    // 番号付きリストやダッシュリストを抽出
    const lines = content.split('\n');
    const steps: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(\d+[\.\)]\s*|-\s*|\*\s*)/.test(trimmed)) {
        steps.push(trimmed.replace(/^(\d+[\.\)]\s*|-\s*|\*\s*)/, ''));
      }
    }

    return steps;
  }

  private async extractFromLogs(): Promise<SuccessPattern[]> {
    // 将来的にはログからパターンを抽出
    // 現時点では空を返す
    return [];
  }

  private async convertToSkill(pattern: SuccessPattern): Promise<string> {
    const skillsDir = path.join(WORKSPACE_PATH, 'skills');
    await fs.promises.mkdir(skillsDir, { recursive: true });

    const skillName = pattern.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);

    const skillContent = `# Skill: ${pattern.title}

## Description
${pattern.description}

## Context
${pattern.context}

## Usage
When: ${pattern.context}
How: ${pattern.description}

## Steps
${(pattern.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

---
Generated from pattern: ${pattern.id}
Created: ${new Date().toISOString()}
`;

    const skillPath = path.join(skillsDir, `${skillName}.md`);
    await fs.promises.writeFile(skillPath, skillContent);

    return skillPath;
  }

  private async convertToScript(pattern: SuccessPattern): Promise<string> {
    const scriptsDir = path.join(WORKSPACE_PATH, 'scripts');
    await fs.promises.mkdir(scriptsDir, { recursive: true });

    const scriptName = pattern.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);

    // 手順からスクリプトを生成
    const steps = pattern.steps ?? [];
    const scriptContent = `#!/bin/bash
# ${pattern.title}
# ${pattern.description}
# Context: ${pattern.context}
# Generated from pattern: ${pattern.id}

set -e

echo "Executing: ${pattern.title}"

${steps.map((step, i) => `# Step ${i + 1}: ${step}
echo "Step ${i + 1}: ${step}"
# TODO: Implement step
`).join('\n')}

echo "Completed: ${pattern.title}"
`;

    const scriptPath = path.join(scriptsDir, `${scriptName}.sh`);
    await fs.promises.writeFile(scriptPath, scriptContent);

    return scriptPath;
  }

  private async addToKnowledgeBase(pattern: SuccessPattern): Promise<string> {
    const knowledgeDir = path.join(WORKSPACE_PATH, 'knowledge');
    await fs.promises.mkdir(knowledgeDir, { recursive: true });

    const fileName = pattern.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);

    const content = `# ${pattern.title}

## 問題
${pattern.context}

## 解決策
${pattern.description}

## 手順
${(pattern.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

## メタデータ
- パターンID: ${pattern.id}
- 成功回数: ${pattern.successCount}
- 発見日: ${pattern.discoveredAt.toISOString()}
- 最終使用: ${pattern.lastUsedAt.toISOString()}
`;

    const filePath = path.join(knowledgeDir, `${fileName}.md`);
    await fs.promises.writeFile(filePath, content);

    return filePath;
  }

  private async convertToTemplate(pattern: SuccessPattern): Promise<string> {
    const templatesDir = path.join(WORKSPACE_PATH, 'templates');
    await fs.promises.mkdir(templatesDir, { recursive: true });

    const templateName = pattern.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);

    const templateContent = `# Template: ${pattern.title}

## Description
${pattern.description}

## When to Use
${pattern.context}

## Template

\`\`\`
${pattern.description}
\`\`\`

## Variables
- TODO: Define template variables

## Example
TODO: Add example usage

---
Generated from pattern: ${pattern.id}
`;

    const templatePath = path.join(templatesDir, `${templateName}.md`);
    await fs.promises.writeFile(templatePath, templateContent);

    return templatePath;
  }

  private async loadPatterns(): Promise<void> {
    const patternsFile = path.join(WORKSPACE_PATH, 'patterns.json');
    try {
      const content = await fs.promises.readFile(patternsFile, 'utf-8');
      const data = JSON.parse(content) as SuccessPattern[];

      for (const pattern of data) {
        pattern.lastUsedAt = new Date(pattern.lastUsedAt);
        pattern.discoveredAt = new Date(pattern.discoveredAt);
        this.patterns.set(pattern.id, pattern);
      }

      logger.info('Patterns loaded', { count: this.patterns.size });
    } catch {
      // ファイルがない場合は無視
    }
  }

  private async savePatterns(): Promise<void> {
    const patternsFile = path.join(WORKSPACE_PATH, 'patterns.json');
    const data = Array.from(this.patterns.values());
    await fs.promises.writeFile(patternsFile, JSON.stringify(data, null, 2));
  }

  private async notifyExtraction(patterns: SuccessPattern[]): Promise<void> {
    await this.discord.sendInfo({
      title: '新しい成功パターンを検出',
      description: patterns
        .slice(0, 5)
        .map(p => `• **${p.title}** (${p.type}, 成功${p.successCount}回)`)
        .join('\n'),
      details: {
        totalPatterns: patterns.length,
      },
    });
  }
}

// シングルトンインスタンス
let extractorInstance: PatternExtractor | null = null;

export function getPatternExtractor(
  config?: Partial<ExtractionConfig>
): PatternExtractor {
  if (!extractorInstance) {
    extractorInstance = new PatternExtractor(config);
  }
  return extractorInstance;
}
