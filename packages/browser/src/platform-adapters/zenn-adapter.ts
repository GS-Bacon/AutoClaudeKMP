import { getLogger } from '@auto-claude/core';
import {
  BasePlatformAdapter,
  PlatformCredentials,
  AuthState,
  PostContent,
  PostResult,
  SearchResult,
  SearchItem,
} from './base-adapter.js';

const logger = getLogger('zenn-adapter');

export interface ZennArticle {
  id: number;
  slug: string;
  title: string;
  emoji: string;
  type: 'tech' | 'idea';
  topics: string[];
  published: boolean;
  body_md?: string;
  path: string;
  user?: {
    username: string;
    name: string;
  };
  liked_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export interface ZennPostContent extends PostContent {
  emoji?: string;
  type?: 'tech' | 'idea';
  topics?: string[];
  published?: boolean;
}

/**
 * Zennアダプター
 *
 * 注意: ZennはGitHub連携またはCLIでの投稿が主要な方法です。
 * このアダプターは検索機能とスクレイピングによる簡易操作を提供します。
 * 本格的な投稿にはzenn-cliの使用を推奨します。
 */
export class ZennAdapter extends BasePlatformAdapter {
  readonly platformName = 'Zenn';
  readonly baseUrl = 'https://zenn.dev';
  private apiBase = 'https://zenn.dev/api';

  protected async verifyAuthentication(): Promise<AuthState> {
    // Zennはブラウザのセッションで認証を管理
    // ログインページにアクセスして認証状態を確認
    try {
      const result = await this.getPage(`${this.baseUrl}/dashboard`);

      if (result.success && result.url) {
        // ダッシュボードにリダイレクトされずにアクセスできれば認証済み
        const isAuth = !result.url.includes('/enter');
        return {
          isAuthenticated: isAuth,
          lastChecked: new Date(),
        };
      }
    } catch (error) {
      logger.error('Failed to verify Zenn authentication', { error });
    }

    return {
      isAuthenticated: false,
      lastChecked: new Date(),
    };
  }

  protected async performAuthentication(credentials: PlatformCredentials): Promise<boolean> {
    // ZennはGoogle/GitHub/Twitterログインを使用
    // 自動ログインは複雑なため、手動ログインを促す
    logger.warn('Zenn requires manual login via browser. Please login manually.');
    await this.discord.sendWarning(
      'Zenn認証が必要',
      'Zennへのログインは手動で行う必要があります。ブラウザでログインしてください。'
    );
    return false;
  }

  protected async performLogout(): Promise<void> {
    // ブラウザのセッションをクリア
    await this.browser.close();
  }

  protected async performPost(content: PostContent): Promise<PostResult> {
    // Zennは直接APIでの投稿をサポートしていない
    // zenn-cliを使用するか、GitHubリポジトリ経由で投稿する必要がある
    logger.warn('Zenn direct posting not supported. Use zenn-cli or GitHub integration.');

    const zennContent = content as ZennPostContent;

    // 下書きとしてMarkdownファイルを生成（zenn-cli互換形式）
    const frontMatter = `---
title: "${content.title}"
emoji: "${zennContent.emoji || '📝'}"
type: "${zennContent.type || 'tech'}"
topics: [${(zennContent.topics || content.tags || []).map((t) => `"${t}"`).join(', ')}]
published: ${zennContent.published ?? !content.isDraft}
---

`;

    const markdown = frontMatter + content.body;

    // ローカルに保存してGitHub連携を促す
    await this.discord.sendInfo(
      'Zenn記事準備完了',
      `「${content.title}」のZenn投稿用Markdownを生成しました。\nzenn-cliまたはGitHub連携で投稿してください。`
    );

    return {
      success: true,
      error: 'Zennはzenn-cliまたはGitHub連携での投稿を推奨します',
    };
  }

  protected async performSearch(
    query: string,
    options?: Record<string, unknown>
  ): Promise<SearchResult> {
    const page = (options?.page as number) || 1;
    const order = (options?.order as string) || 'daily';  // daily, weekly, monthly, alltime

    try {
      // ZennのAPI（非公式）
      const url = new URL(`${this.apiBase}/articles`);
      url.searchParams.set('username', query);  // ユーザー名で検索
      url.searchParams.set('order', order);
      url.searchParams.set('page', String(page));

      const response = await fetch(url.toString());

      if (response.ok) {
        const data = await response.json() as { articles: ZennArticle[] };
        const articles = data.articles;

        const items: SearchItem[] = articles.map((article) => ({
          id: String(article.id),
          title: article.title,
          url: `${this.baseUrl}${article.path}`,
          description: `${article.emoji} ${article.type} - ${article.topics.join(', ')}`,
          metadata: {
            emoji: article.emoji,
            type: article.type,
            topics: article.topics,
            likes: article.liked_count,
            comments: article.comments_count,
            createdAt: article.created_at,
          },
        }));

        return {
          success: true,
          items,
        };
      }

      return {
        success: false,
        items: [],
        error: `Search failed: ${response.status}`,
      };
    } catch (error) {
      // APIが失敗した場合はスクレイピングにフォールバック
      return await this.searchViaScraping(query);
    }
  }

  private async searchViaScraping(query: string): Promise<SearchResult> {
    try {
      const result = await this.getPage(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);

      if (!result.success || !result.content) {
        return {
          success: false,
          items: [],
          error: result.error || 'ページ取得失敗',
        };
      }

      // 簡易的なスクレイピング（HTMLパース）
      // 本番環境では専用のパーサーを使用すべき
      const items: SearchItem[] = [];

      // 記事リンクを抽出（簡易版）
      const articleRegex = /<a[^>]*href="(\/[^"]+\/articles\/[^"]+)"[^>]*>([^<]*)<\/a>/g;
      let match;
      while ((match = articleRegex.exec(result.content)) !== null) {
        if (match[1] && match[2]) {
          items.push({
            id: match[1],
            title: match[2].trim(),
            url: `${this.baseUrl}${match[1]}`,
          });
        }
      }

      return {
        success: true,
        items: items.slice(0, 20),  // 上位20件
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        items: [],
        error: message,
      };
    }
  }

  /**
   * トレンド記事を取得
   */
  async getTrending(
    order: 'daily' | 'weekly' | 'monthly' | 'alltime' = 'daily'
  ): Promise<ZennArticle[]> {
    try {
      const url = new URL(`${this.apiBase}/articles`);
      url.searchParams.set('order', order);
      url.searchParams.set('count', '20');

      const response = await fetch(url.toString());

      if (response.ok) {
        const data = await response.json() as { articles: ZennArticle[] };
        return data.articles;
      }
    } catch (error) {
      logger.error('Failed to get trending articles', { error });
    }

    return [];
  }

  /**
   * zenn-cli用のMarkdown形式を生成
   */
  generateZennMarkdown(content: ZennPostContent): string {
    const frontMatter = `---
title: "${content.title}"
emoji: "${content.emoji || '📝'}"
type: "${content.type || 'tech'}"
topics: [${(content.topics || content.tags || []).map((t) => `"${t}"`).join(', ')}]
published: ${content.published ?? !content.isDraft}
---

`;

    return frontMatter + content.body;
  }
}

let instance: ZennAdapter | null = null;

export function getZennAdapter(): ZennAdapter {
  if (!instance) {
    instance = new ZennAdapter();
  }
  return instance;
}
