import { getLogger } from '@auto-claude/core';
import { getDiscordNotifier } from '@auto-claude/notification';
import { getBrowserManager, PageResult } from '../browser-manager.js';

const logger = getLogger('platform-adapter');

export interface PlatformCredentials {
  username?: string;
  email?: string;
  password?: string;
  apiKey?: string;
  accessToken?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  username?: string;
  expiresAt?: Date;
  lastChecked: Date;
}

export interface PostContent {
  title: string;
  body: string;
  tags?: string[];
  isDraft?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PostResult {
  success: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

export interface SearchResult {
  success: boolean;
  items: SearchItem[];
  totalCount?: number;
  error?: string;
}

export interface SearchItem {
  id: string;
  title: string;
  url: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export abstract class BasePlatformAdapter {
  protected browser = getBrowserManager();
  protected discord = getDiscordNotifier();
  protected logger = logger;
  protected authState: AuthState = {
    isAuthenticated: false,
    lastChecked: new Date(0),
  };

  abstract readonly platformName: string;
  abstract readonly baseUrl: string;

  /**
   * 認証状態を確認
   */
  async checkAuth(): Promise<AuthState> {
    const cacheValid =
      Date.now() - this.authState.lastChecked.getTime() < 5 * 60 * 1000; // 5分キャッシュ

    if (cacheValid && this.authState.isAuthenticated) {
      return this.authState;
    }

    this.authState = await this.verifyAuthentication();
    this.authState.lastChecked = new Date();

    return this.authState;
  }

  /**
   * 認証を実行
   */
  async authenticate(credentials: PlatformCredentials): Promise<boolean> {
    this.logger.info('Authenticating', { platform: this.platformName });

    const result = await this.performAuthentication(credentials);

    if (result) {
      await this.browser.saveAuthState();
      this.authState = {
        isAuthenticated: true,
        lastChecked: new Date(),
      };
      this.logger.info('Authentication successful', { platform: this.platformName });
    } else {
      this.logger.warn('Authentication failed', { platform: this.platformName });
    }

    return result;
  }

  /**
   * ログアウト
   */
  async logout(): Promise<void> {
    await this.performLogout();
    this.authState = {
      isAuthenticated: false,
      lastChecked: new Date(),
    };
  }

  /**
   * コンテンツを投稿
   */
  async post(content: PostContent): Promise<PostResult> {
    // 認証チェック
    const auth = await this.checkAuth();
    if (!auth.isAuthenticated) {
      await this.discord.sendWarning(
        '投稿失敗',
        `${this.platformName}へのログインが必要です`
      );
      return {
        success: false,
        error: '認証が必要です',
      };
    }

    this.logger.info('Posting content', {
      platform: this.platformName,
      title: content.title,
      isDraft: content.isDraft,
    });

    return await this.performPost(content);
  }

  /**
   * コンテンツを検索
   */
  async search(query: string, options?: Record<string, unknown>): Promise<SearchResult> {
    this.logger.info('Searching', {
      platform: this.platformName,
      query,
    });

    return await this.performSearch(query, options);
  }

  /**
   * ページを取得
   */
  protected async getPage(url: string): Promise<PageResult> {
    return await this.browser.navigateTo(url);
  }

  // サブクラスで実装する抽象メソッド
  protected abstract verifyAuthentication(): Promise<AuthState>;
  protected abstract performAuthentication(credentials: PlatformCredentials): Promise<boolean>;
  protected abstract performLogout(): Promise<void>;
  protected abstract performPost(content: PostContent): Promise<PostResult>;
  protected abstract performSearch(query: string, options?: Record<string, unknown>): Promise<SearchResult>;
}
