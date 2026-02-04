/**
 * Skillジェネレーター
 *
 * 成功パターンからClaude Code用のカスタムSkillを生成
 */

import {
  getLogger,
  SuccessPattern,
  SkillDefinition,
  SkillParameter,
} from '@auto-claude/core';
import { getClaudeCLI } from '@auto-claude/ai-router';
import { getDiscordNotifier } from '@auto-claude/notification';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('SkillGenerator');

const WORKSPACE_PATH = '/home/bacon/AutoClaudeKMP/workspace';

export interface GeneratedSkill {
  definition: SkillDefinition;
  filePath: string;
  generatedAt: Date;
}

export interface SkillGeneratorConfig {
  skillsDirectory: string;
  generateTests: boolean;
  validateBeforeSave: boolean;
}

const DEFAULT_CONFIG: SkillGeneratorConfig = {
  skillsDirectory: path.join(WORKSPACE_PATH, 'skills'),
  generateTests: true,
  validateBeforeSave: true,
};

export class SkillGenerator {
  private readonly claudeCLI = getClaudeCLI();
  private readonly discord = getDiscordNotifier();
  private readonly config: SkillGeneratorConfig;
  private readonly generatedSkills: Map<string, GeneratedSkill> = new Map();

  constructor(config: Partial<SkillGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureDirectories();
  }

  /**
   * パターンからSkillを生成
   */
  async generateSkill(pattern: SuccessPattern): Promise<GeneratedSkill> {
    logger.info('Generating skill from pattern', { patternId: pattern.id });

    // Skill名を生成
    const skillName = this.generateSkillName(pattern.title);

    // パラメータを抽出
    const parameters = this.extractParameters(pattern);

    // プロンプトテンプレートを生成
    const promptTemplate = await this.generatePromptTemplate(pattern, parameters);

    // Skill定義を作成
    const definition: SkillDefinition = {
      name: skillName,
      description: pattern.description,
      promptTemplate,
      parameters,
      createdFrom: pattern.id,
      createdAt: new Date(),
    };

    // 検証
    if (this.config.validateBeforeSave) {
      const validation = this.validateSkill(definition);
      if (!validation.valid) {
        throw new Error(`Skill validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // ファイルに保存
    const filePath = await this.saveSkill(definition);

    // テスト生成
    if (this.config.generateTests) {
      await this.generateSkillTest(definition);
    }

    const skill: GeneratedSkill = {
      definition,
      filePath,
      generatedAt: new Date(),
    };

    this.generatedSkills.set(skillName, skill);

    logger.info('Skill generated', { skillName, filePath });

    return skill;
  }

  /**
   * 複数のパターンからSkillを一括生成
   */
  async generateSkillsFromPatterns(
    patterns: SuccessPattern[]
  ): Promise<{ success: GeneratedSkill[]; failed: { pattern: SuccessPattern; error: string }[] }> {
    const success: GeneratedSkill[] = [];
    const failed: { pattern: SuccessPattern; error: string }[] = [];

    for (const pattern of patterns) {
      try {
        const skill = await this.generateSkill(pattern);
        success.push(skill);
      } catch (error) {
        failed.push({
          pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success, failed };
  }

  /**
   * Skillを更新
   */
  async updateSkill(
    skillName: string,
    updates: Partial<SkillDefinition>
  ): Promise<GeneratedSkill> {
    const existing = this.generatedSkills.get(skillName);
    if (!existing) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    const updated: SkillDefinition = {
      ...existing.definition,
      ...updates,
    };

    // 検証
    if (this.config.validateBeforeSave) {
      const validation = this.validateSkill(updated);
      if (!validation.valid) {
        throw new Error(`Skill validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // ファイルを更新
    const filePath = await this.saveSkill(updated);

    const skill: GeneratedSkill = {
      definition: updated,
      filePath,
      generatedAt: new Date(),
    };

    this.generatedSkills.set(skillName, skill);

    return skill;
  }

  /**
   * Skillを削除
   */
  async deleteSkill(skillName: string): Promise<void> {
    const skill = this.generatedSkills.get(skillName);
    if (!skill) {
      return;
    }

    try {
      await fs.promises.unlink(skill.filePath);
    } catch {
      // ファイルがない場合は無視
    }

    this.generatedSkills.delete(skillName);
    logger.info('Skill deleted', { skillName });
  }

  /**
   * 全Skillを取得
   */
  getAllSkills(): GeneratedSkill[] {
    return Array.from(this.generatedSkills.values());
  }

  /**
   * Skillを検索
   */
  findSkill(query: string): GeneratedSkill | undefined {
    const lowerQuery = query.toLowerCase();

    for (const skill of this.generatedSkills.values()) {
      if (
        skill.definition.name.toLowerCase().includes(lowerQuery) ||
        skill.definition.description.toLowerCase().includes(lowerQuery)
      ) {
        return skill;
      }
    }

    return undefined;
  }

  // Private methods

  private generateSkillName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30);
  }

  private extractParameters(pattern: SuccessPattern): SkillParameter[] {
    const parameters: SkillParameter[] = [];

    // 説明文から変数を抽出（{{variable}}形式を探す）
    const variablePattern = /\{\{(\w+)\}\}/g;
    const description = pattern.description + ' ' + (pattern.steps?.join(' ') ?? '');

    let match;
    const found = new Set<string>();

    while ((match = variablePattern.exec(description)) !== null) {
      const name = match[1];
      if (!found.has(name)) {
        found.add(name);
        parameters.push({
          name,
          type: 'string',
          description: `Parameter: ${name}`,
          required: true,
        });
      }
    }

    // デフォルトパラメータ
    if (parameters.length === 0) {
      parameters.push({
        name: 'target',
        type: 'string',
        description: '対象となる項目や内容',
        required: false,
      });
    }

    return parameters;
  }

  private async generatePromptTemplate(
    pattern: SuccessPattern,
    parameters: SkillParameter[]
  ): Promise<string> {
    // 基本テンプレート
    let template = `# ${pattern.title}

## Context
${pattern.context}

## Task
${pattern.description}

`;

    // 手順がある場合は追加
    if (pattern.steps && pattern.steps.length > 0) {
      template += `## Steps
${pattern.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

`;
    }

    // パラメータセクション
    if (parameters.length > 0) {
      template += `## Parameters
${parameters.map(p => `- {{${p.name}}}: ${p.description}`).join('\n')}
`;
    }

    return template;
  }

  private validateSkill(definition: SkillDefinition): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!definition.name || definition.name.length === 0) {
      errors.push('Skill name is required');
    }

    if (!definition.description || definition.description.length < 10) {
      errors.push('Skill description must be at least 10 characters');
    }

    if (!definition.promptTemplate || definition.promptTemplate.length < 20) {
      errors.push('Prompt template must be at least 20 characters');
    }

    // パラメータの検証
    for (const param of definition.parameters) {
      if (!param.name || !/^[a-z_][a-z0-9_]*$/i.test(param.name)) {
        errors.push(`Invalid parameter name: ${param.name}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private async saveSkill(definition: SkillDefinition): Promise<string> {
    await fs.promises.mkdir(this.config.skillsDirectory, { recursive: true });

    // JSON形式で保存
    const jsonPath = path.join(this.config.skillsDirectory, `${definition.name}.json`);
    await fs.promises.writeFile(
      jsonPath,
      JSON.stringify(definition, null, 2)
    );

    // Markdown形式でも保存（人間が読みやすい形式）
    const mdPath = path.join(this.config.skillsDirectory, `${definition.name}.md`);
    const mdContent = this.formatSkillAsMarkdown(definition);
    await fs.promises.writeFile(mdPath, mdContent);

    return jsonPath;
  }

  private formatSkillAsMarkdown(definition: SkillDefinition): string {
    return `# Skill: ${definition.name}

## Description
${definition.description}

## Parameters
${definition.parameters.map(p =>
  `- **${p.name}** (${p.type}${p.required ? ', required' : ''}): ${p.description}`
).join('\n')}

## Prompt Template
\`\`\`
${definition.promptTemplate}
\`\`\`

## Metadata
- Created from: ${definition.createdFrom}
- Created at: ${definition.createdAt.toISOString()}
`;
  }

  private async generateSkillTest(definition: SkillDefinition): Promise<void> {
    const testsDir = path.join(this.config.skillsDirectory, 'tests');
    await fs.promises.mkdir(testsDir, { recursive: true });

    const testContent = `// Test for skill: ${definition.name}
// Auto-generated from pattern: ${definition.createdFrom}

describe('${definition.name} skill', () => {
  it('should have required fields', () => {
    const skill = require('../${definition.name}.json');

    expect(skill.name).toBe('${definition.name}');
    expect(skill.description).toBeDefined();
    expect(skill.promptTemplate).toBeDefined();
    expect(Array.isArray(skill.parameters)).toBe(true);
  });

  it('should have valid parameters', () => {
    const skill = require('../${definition.name}.json');

    for (const param of skill.parameters) {
      expect(param.name).toBeDefined();
      expect(['string', 'number', 'boolean']).toContain(param.type);
    }
  });
});
`;

    const testPath = path.join(testsDir, `${definition.name}.test.ts`);
    await fs.promises.writeFile(testPath, testContent);
  }

  private async ensureDirectories(): Promise<void> {
    await fs.promises.mkdir(this.config.skillsDirectory, { recursive: true });
  }

  /**
   * 保存されたSkillを読み込む
   */
  async loadSkills(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.config.skillsDirectory);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.config.skillsDirectory, file),
            'utf-8'
          );
          const definition = JSON.parse(content) as SkillDefinition;
          definition.createdAt = new Date(definition.createdAt);

          this.generatedSkills.set(definition.name, {
            definition,
            filePath: path.join(this.config.skillsDirectory, file),
            generatedAt: definition.createdAt,
          });
        } catch {
          // 無効なファイルは無視
        }
      }

      logger.info('Skills loaded', { count: this.generatedSkills.size });
    } catch {
      // ディレクトリがない場合は無視
    }
  }
}

// シングルトンインスタンス
let generatorInstance: SkillGenerator | null = null;

export function getSkillGenerator(
  config?: Partial<SkillGeneratorConfig>
): SkillGenerator {
  if (!generatorInstance) {
    generatorInstance = new SkillGenerator(config);
  }
  return generatorInstance;
}
