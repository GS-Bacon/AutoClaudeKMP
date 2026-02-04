import {
  SkillDefinition,
  SkillInput,
  buildStructuredPrompt,
  parseJsonFromOutput,
  validateRequiredFields,
} from './types.js';

/**
 * アウトライン生成スキルの入力
 */
export interface OutlineInput extends SkillInput {
  /** キーワード */
  keywords: string[];
  /** コンテンツタイプ */
  contentType: 'review' | 'tutorial' | 'comparison' | 'guide' | 'news';
  /** 商品カテゴリ */
  productCategory?: string;
  /** ターゲット読者層（オプション） */
  targetAudience?: string;
}

/**
 * アウトライン生成スキルの出力
 */
export interface OutlineOutput {
  /** 記事タイトル */
  title: string;
  /** 記事セクション */
  sections: {
    heading: string;
    points: string[];
  }[];
  /** 行動喚起文 */
  cta: string;
  /** 想定文字数 */
  estimatedWordCount?: number;
}

/**
 * アウトライン生成スキル定義
 */
export const outlineSkill: SkillDefinition<OutlineInput, OutlineOutput> = {
  name: 'outline-generator',
  description: 'キーワードから記事のアウトラインを生成する',
  fallbackBehavior: 'retry',
  maxRetries: 2,
  timeout: 60000,

  validateInput(input: OutlineInput): string | null {
    if (!input.keywords || input.keywords.length === 0) {
      return 'keywordsは必須です';
    }
    const validTypes = ['review', 'tutorial', 'comparison', 'guide', 'news'];
    if (!validTypes.includes(input.contentType)) {
      return `contentTypeは${validTypes.join(', ')}のいずれかです`;
    }
    return null;
  },

  buildPrompt(input: OutlineInput): string {
    const typeDescriptions: Record<string, string> = {
      review: '商品・サービスのレビュー記事',
      tutorial: 'ハウツー・チュートリアル記事',
      comparison: '比較記事',
      guide: '総合ガイド記事',
      news: 'ニュース・最新情報記事',
    };

    return buildStructuredPrompt({
      taskName: '記事アウトライン生成',
      inputs: {
        キーワード: input.keywords.join(', '),
        コンテンツタイプ: typeDescriptions[input.contentType],
        商品カテゴリ: input.productCategory ?? '一般',
        ターゲット読者: input.targetAudience ?? '一般ユーザー',
      },
      requirements: [
        'SEOに強いタイトルを作成する（32文字以内推奨）',
        '5〜8セクションの構成を作成する',
        '各セクションに2〜4個のポイントを含める',
        'アフィリエイトリンクを自然に挿入できる箇所を考慮する',
        '読者の行動を促すCTA（Call To Action）を含める',
        '想定文字数を3000〜5000文字で設定する',
      ],
      outputSchema: {
        title: '記事タイトル（32文字以内）',
        sections: [
          {
            heading: '見出し',
            points: ['ポイント1', 'ポイント2'],
          },
        ],
        cta: '行動喚起文',
        estimatedWordCount: 4000,
      },
    });
  },

  parseOutput(rawOutput: string): OutlineOutput | undefined {
    const parsed = parseJsonFromOutput<OutlineOutput>(rawOutput);
    if (!parsed) {
      return undefined;
    }

    const error = validateRequiredFields(parsed as unknown as Record<string, unknown>, [
      'title',
      'sections',
      'cta',
    ]);
    if (error) {
      return undefined;
    }

    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
      return undefined;
    }

    return parsed;
  },
};

/**
 * 記事執筆スキルの入力
 */
export interface ArticleWriterInput extends SkillInput {
  /** 記事アウトライン */
  outline: OutlineOutput;
  /** キーワード */
  keywords: string[];
  /** 商品カテゴリ */
  productCategory?: string;
  /** アフィリエイトプログラム */
  affiliatePrograms?: string[];
  /** 追加の執筆指示（オプション） */
  additionalInstructions?: string;
}

/**
 * 記事執筆スキルの出力
 */
export interface ArticleWriterOutput {
  /** 記事タイトル */
  title: string;
  /** Markdown形式の記事本文 */
  content: string;
  /** 使用したキーワード */
  keywords: string[];
  /** アフィリエイトリンク挿入位置 */
  affiliateLinkPositions: string[];
  /** メタディスクリプション */
  metaDescription?: string;
}

/**
 * 記事執筆スキル定義
 * フォールバック: Claude（重要なコンテンツ生成タスク）
 */
export const articleWriterSkill: SkillDefinition<ArticleWriterInput, ArticleWriterOutput> = {
  name: 'article-writer',
  description: 'アウトラインから記事を執筆する',
  fallbackBehavior: 'claude', // 記事執筆は重要なのでClaudeにフォールバック
  maxRetries: 2,
  timeout: 180000, // 3分

  validateInput(input: ArticleWriterInput): string | null {
    if (!input.outline) {
      return 'outlineは必須です';
    }
    if (!input.outline.title || !input.outline.sections) {
      return 'outlineにはtitleとsectionsが必要です';
    }
    if (!input.keywords || input.keywords.length === 0) {
      return 'keywordsは必須です';
    }
    return null;
  },

  buildPrompt(input: ArticleWriterInput): string {
    const outlineText = input.outline.sections
      .map((s) => `## ${s.heading}\n${s.points.map((p) => `- ${p}`).join('\n')}`)
      .join('\n\n');

    return `# タスク: 記事執筆

## 入力
- 記事タイトル: ${input.outline.title}
- キーワード: ${input.keywords.join(', ')}
- 商品カテゴリ: ${input.productCategory ?? '一般'}
- アフィリエイトプログラム: ${input.affiliatePrograms?.join(', ') || '一般的なASP'}
${input.additionalInstructions ? `- 追加指示: ${input.additionalInstructions}` : ''}

## アウトライン
${outlineText}

## CTA
${input.outline.cta}

## 要件
1. SEOを意識した自然な日本語で執筆する
2. 読者にとって価値のある具体的な情報を含める
3. アフィリエイトリンクを挿入する場所を[AFFILIATE_LINK]で示す
4. Markdown形式で出力する
5. 3000〜5000文字程度の記事を作成する
6. 各セクションは読みやすい長さにする
7. メタディスクリプション（120文字以内）を作成する

## 出力形式（必ずこのJSON形式のみを出力）
\`\`\`json
{
  "title": "記事タイトル",
  "content": "# タイトル\\n\\n本文...",
  "keywords": ["使用したキーワード"],
  "affiliateLinkPositions": ["位置の説明1", "位置の説明2"],
  "metaDescription": "メタディスクリプション"
}
\`\`\`

JSONのみを出力してください。説明は不要です。`;
  },

  parseOutput(rawOutput: string): ArticleWriterOutput | undefined {
    const parsed = parseJsonFromOutput<ArticleWriterOutput>(rawOutput);
    if (!parsed) {
      return undefined;
    }

    const error = validateRequiredFields(parsed as unknown as Record<string, unknown>, [
      'title',
      'content',
      'keywords',
    ]);
    if (error) {
      return undefined;
    }

    if (typeof parsed.content !== 'string' || parsed.content.length < 500) {
      return undefined; // 記事が短すぎる
    }

    return parsed;
  },

  validateOutput(output: ArticleWriterOutput): string | null {
    if (output.content.length < 1000) {
      return '記事が短すぎます（1000文字以上必要）';
    }
    return null;
  },
};
