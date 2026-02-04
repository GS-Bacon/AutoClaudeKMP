// スキル型定義とヘルパー
export * from './types.js';

// 個別スキル定義
export * from './keyword-research.js';
export * from './article-writer.js';
export * from './plan-generator.js';

// デフォルトスキルセット（TaskRouterに一括登録用）
import { SkillDefinition } from './types.js';
import { keywordResearchSkill } from './keyword-research.js';
import { outlineSkill, articleWriterSkill } from './article-writer.js';
import { planGeneratorSkill } from './plan-generator.js';

/**
 * すべてのデフォルトスキル定義
 */
export const defaultSkills: SkillDefinition[] = [
  keywordResearchSkill,
  outlineSkill,
  articleWriterSkill,
  planGeneratorSkill,
];

/**
 * TaskRouterにデフォルトスキルを登録するヘルパー
 */
export function registerDefaultSkills(router: {
  registerSkills: (skills: SkillDefinition[]) => void;
}): void {
  router.registerSkills(defaultSkills);
}
