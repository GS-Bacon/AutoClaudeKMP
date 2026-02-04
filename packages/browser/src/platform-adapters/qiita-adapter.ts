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

const logger = getLogger('qiita-adapter');

export interface QiitaPostContent extends Omit<PostContent, 'tags'> {
  tags: Array<{ name: string; versions?: string[] }>;
  private?: boolean;
  coediting?: boolean;
  gist?: boolean;
  tweet?: boolean;
}

export interface QiitaArticle {
  id: string;
  title: string;
  url: string;
  body: string;
  tags: Array<{ name: string; versions: string[] }>;
  private: boolean;
  created_at: string;
  updated_at: string;
  likes_count: number;
  stocks_count: number;
  page_views_count?: number;
}

export class QiitaAdapter extends BasePlatformAdapter {
  readonly platformName = 'Qiita';
  readonly baseUrl = 'https://qiita.com';
  private apiBase = 'https://qiita.com/api/v2';
  private accessToken?: string;

  constructor(accessToken?: string) {
    super();
    this.accessToken = accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  protected async verifyAuthentication(): Promise<AuthState> {
    if (!this.accessToken) {
      return {
        isAuthenticated: false,
        lastChecked: new Date(),
      };
    }

    try {
      const response = await fetch(`${this.apiBase}/authenticated_user`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.ok) {
        const user = await response.json() as { id: string };
        return {
          isAuthenticated: true,
          username: user.id,
          lastChecked: new Date(),
        };
      }
    } catch (error) {
      logger.error('Failed to verify Qiita authentication', { error });
    }

    return {
      isAuthenticated: false,
      lastChecked: new Date(),
    };
  }

  protected async performAuthentication(credentials: PlatformCredentials): Promise<boolean> {
    // QiitaはOAuthまたはアクセストークンを使用
    if (credentials.accessToken) {
      this.accessToken = credentials.accessToken;
      const auth = await this.verifyAuthentication();
      return auth.isAuthenticated;
    }

    // ブラウザログインは現時点では未サポート
    // OAuth2フローを実装する場合はここに追加
    logger.warn('Qiita browser login not implemented, please use access token');
    return false;
  }

  protected async performLogout(): Promise<void> {
    this.accessToken = undefined;
  }

  protected async performPost(content: PostContent): Promise<PostResult> {
    if (!this.accessToken) {
      return { success: false, error: 'アクセストークンが設定されていません' };
    }

    const qiitaContent = content as unknown as QiitaPostContent;

    // タグの形式を変換
    const tags = qiitaContent.tags?.map((tag) => {
      if (typeof tag === 'string') {
        return { name: tag, versions: [] };
      }
      return tag;
    }) || [];

    const body = {
      title: content.title,
      body: content.body,
      tags,
      private: qiitaContent.private ?? content.isDraft ?? false,
      coediting: qiitaContent.coediting ?? false,
      gist: qiitaContent.gist ?? false,
      tweet: qiitaContent.tweet ?? false,
    };

    try {
      const response = await fetch(`${this.apiBase}/items`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const article = (await response.json()) as QiitaArticle;
        logger.info('Article posted to Qiita', {
          id: article.id,
          title: article.title,
          url: article.url,
        });

        return {
          success: true,
          postId: article.id,
          url: article.url,
        };
      }

      const error = await response.text();
      logger.error('Failed to post to Qiita', { status: response.status, error });

      return {
        success: false,
        error: `Qiita API error: ${response.status} - ${error}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Qiita post error', { error: message });

      return {
        success: false,
        error: message,
      };
    }
  }

  protected async performSearch(
    query: string,
    options?: Record<string, unknown>
  ): Promise<SearchResult> {
    const page = (options?.page as number) || 1;
    const perPage = (options?.perPage as number) || 20;

    try {
      const url = new URL(`${this.apiBase}/items`);
      url.searchParams.set('query', query);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));

      const headers: Record<string, string> = {};
      if (this.accessToken) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      }

      const response = await fetch(url.toString(), { headers });

      if (response.ok) {
        const articles = (await response.json()) as QiitaArticle[];
        const totalCount = parseInt(response.headers.get('Total-Count') || '0', 10);

        const items: SearchItem[] = articles.map((article) => ({
          id: article.id,
          title: article.title,
          url: article.url,
          description: article.body.slice(0, 200),
          metadata: {
            tags: article.tags.map((t) => t.name),
            likes: article.likes_count,
            stocks: article.stocks_count,
            createdAt: article.created_at,
          },
        }));

        return {
          success: true,
          items,
          totalCount,
        };
      }

      return {
        success: false,
        items: [],
        error: `Search failed: ${response.status}`,
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
   * 自分の記事一覧を取得
   */
  async getMyArticles(page = 1, perPage = 20): Promise<QiitaArticle[]> {
    if (!this.accessToken) {
      return [];
    }

    try {
      const url = new URL(`${this.apiBase}/authenticated_user/items`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(perPage));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.ok) {
        return (await response.json()) as QiitaArticle[];
      }
    } catch (error) {
      logger.error('Failed to get my articles', { error });
    }

    return [];
  }

  /**
   * 記事を更新
   */
  async updateArticle(articleId: string, content: Partial<PostContent>): Promise<PostResult> {
    if (!this.accessToken) {
      return { success: false, error: 'アクセストークンが設定されていません' };
    }

    const qiitaContent = content as Partial<QiitaPostContent>;

    const body: Record<string, unknown> = {};
    if (content.title) body.title = content.title;
    if (content.body) body.body = content.body;
    if (qiitaContent.tags) {
      body.tags = qiitaContent.tags.map((tag) => {
        if (typeof tag === 'string') {
          return { name: tag, versions: [] };
        }
        return tag;
      });
    }
    if (qiitaContent.private !== undefined) body.private = qiitaContent.private;

    try {
      const response = await fetch(`${this.apiBase}/items/${articleId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const article = (await response.json()) as QiitaArticle;
        return {
          success: true,
          postId: article.id,
          url: article.url,
        };
      }

      const error = await response.text();
      return {
        success: false,
        error: `Update failed: ${response.status} - ${error}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * 記事を削除
   */
  async deleteArticle(articleId: string): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }

    try {
      const response = await fetch(`${this.apiBase}/items/${articleId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      return response.status === 204;
    } catch (error) {
      logger.error('Failed to delete article', { articleId, error });
      return false;
    }
  }
}

let instance: QiitaAdapter | null = null;

export function getQiitaAdapter(accessToken?: string): QiitaAdapter {
  if (!instance) {
    instance = new QiitaAdapter(accessToken);
  } else if (accessToken) {
    instance.setAccessToken(accessToken);
  }
  return instance;
}
