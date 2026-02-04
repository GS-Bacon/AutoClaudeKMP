import {
  SkillDefinition,
  SkillInput,
  buildStructuredPrompt,
  parseJsonFromOutput,
  validateRequiredFields,
} from './types.js';

/**
 * キーワードリサーチスキルの入力
 */
export interface KeywordResearchInput extends SkillInput {
  /** ベースとなるキーワード（1〜5個） */
  baseKeywords: string[];
  /** 商品カテゴリ（オプション） */
  productCategory?: string;
  /** ターゲット言語（デフォルト: 日本語） */
  language?: string;
  /** 希望する関連キーワード数（デフォルト: 10） */
  keywordCount?: number;
}

/**
 * キーワードリサーチスキルの出力
 */
export interface KeywordResearchOutput {
  /** メインキーワード（検索ボリュームが高い） */
  mainKeywords: string[];
  /** 関連キーワード */
  relatedKeywords: string[];
  /** ロングテールキーワード（3語以上の複合キーワード） */
  longTailKeywords: string[];
  /** 各キーワードの検索意図 */
  searchIntents?: {
    keyword: string;
    intent: 'informational' | 'navigational' | 'transactional' | 'commercial';
  }[];
}

/**
 * キーワードリサーチスキル定義
 */
export const keywordResearchSkill: SkillDefinition<KeywordResearchInput, KeywordResearchOutput> = {
  name: 'keyword-research',
  description: 'ベースキーワードから関連キーワードを調査・提案する',
  fallbackBehavior: 'retry',
  maxRetries: 2,
  timeout: 60000, // 1分

  validateInput(input: KeywordResearchInput): string | null {
    if (!input.baseKeywords || input.baseKeywords.length === 0) {
      return 'baseKeywordsは必須です（1〜5個）';
    }
    if (input.baseKeywords.length > 5) {
      return 'baseKeywordsは5個以下にしてください';
    }
    return null;
  },

  buildPrompt(input: KeywordResearchInput): string {
    const keywordCount = input.keywordCount ?? 10;
    const language = input.language ?? '日本語';

    return buildStructuredPrompt({
      taskName: 'キーワードリサーチ',
      inputs: {
        ベースキーワード: input.baseKeywords.join(', '),
        商品カテゴリ: input.productCategory ?? '一般',
        言語: language,
        希望キーワード数: keywordCount,
      },
      requirements: [
        `メインキーワードを2〜3個提案する（検索ボリュームが高いもの）`,
        `関連キーワードを${Math.floor(keywordCount / 2)}個提案する`,
        `ロングテールキーワード（3語以上の複合）を${Math.ceil(keywordCount / 2)}個提案する`,
        `すべて${language}で出力する`,
        'SEOとアフィリエイトに効果的なキーワードを選ぶ',
        '検索意図（informational/navigational/transactional/commercial）を分析する',
      ],
      outputSchema: {
        mainKeywords: ['メインキーワード1', 'メインキーワード2'],
        relatedKeywords: ['関連1', '関連2', '...'],
        longTailKeywords: ['ロングテール1', 'ロングテール2', '...'],
        searchIntents: [
          { keyword: 'キーワード', intent: 'transactional' },
        ],
      },
    });
  },

  parseOutput(rawOutput: string): KeywordResearchOutput | undefined {
    const parsed = parseJsonFromOutput<KeywordResearchOutput>(rawOutput);
    if (!parsed) {
      return undefined;
    }

    // 必須フィールドの検証
    const error = validateRequiredFields(parsed as unknown as Record<string, unknown>, [
      'mainKeywords',
      'relatedKeywords',
      'longTailKeywords',
    ]);
    if (error) {
      return undefined;
    }

    // 配列の検証
    if (!Array.isArray(parsed.mainKeywords) || parsed.mainKeywords.length === 0) {
      return undefined;
    }
    if (!Array.isArray(parsed.relatedKeywords)) {
      return undefined;
    }
    if (!Array.isArray(parsed.longTailKeywords)) {
      return undefined;
    }

    return parsed;
  },

  validateOutput(output: KeywordResearchOutput): string | null {
    if (output.mainKeywords.length < 1) {
      return 'メインキーワードが不足しています';
    }
    if (output.relatedKeywords.length + output.longTailKeywords.length < 3) {
      return 'キーワード数が少なすぎます';
    }
    return null;
  },
};
