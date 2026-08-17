// 浏览器会话发现执行器（大王方案 2026-08-16：无平台 API 授权 → 复用浏览器会话）
// 用户登录的 Playwright 会话（auto-upload/local-engine 基建）内辅助采集：
//   keyword 模式：打开平台搜索页读结果；target-account 模式：打开账号主页读作品。
// 合规边界（铁律不破）：
//   - 只用用户自己登录的浏览器会话，不绕过验证码/风控（遇验证码/风控 → 转人工原因码）
//   - 结果人工确认后进线索池（draft-only → confirm-first），不包装成稳定 API 承诺
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { LocalBrowserEngine, type EngineSession } from '../local-engine/local-browser-engine.service';
import { AcquisitionQuotaService } from './acquisition-quota.service';
import type {
  DiscoveryItem,
} from './discovery.types';

export type BrowserDiscoverReasonCode =
  | 'ok'
  | 'quota_exceeded'
  | 'not_logged_in'
  | 'captcha_required'
  | 'risk_control'
  | 'no_browser_session'
  | 'parse_failed'
  | 'network_error';

export class BrowserDiscoverError extends Error {
  constructor(
    public readonly reasonCode: BrowserDiscoverReasonCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserDiscoverError';
  }
}

export interface BrowserSearchInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  keyword: string;
  limit?: number;
}

export interface BrowserAccountInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  /** 目标账号标识（抖音 sec_uid / 小红书 user_id） */
  targetId: string;
  limit?: number;
}

/** 各平台搜索页 URL 模板（{keyword} 需 encodeURIComponent） */
const SEARCH_URLS: Record<string, string> = {
  douyin: 'https://www.douyin.com/search/{keyword}?type=video',
  xiaohongshu: 'https://www.xiaohongshu.com/search_result?keyword={keyword}&type=51',
  kuaishou: 'https://www.kuaishou.com/search/video?searchKey={keyword}',
};

const ACCOUNT_URLS: Record<string, string> = {
  douyin: 'https://www.douyin.com/user/{targetId}',
  xiaohongshu: 'https://www.xiaohongshu.com/user/profile/{targetId}',
  kuaishou: 'https://www.kuaishou.com/profile/{targetId}',
};

@Injectable()
export class DiscoveryBrowserRunner {
  private readonly logger = new Logger(DiscoveryBrowserRunner.name);

  constructor(
    private readonly browser: LocalBrowserEngine,
    private readonly quota?: AcquisitionQuotaService,
  ) {}

  /** 浏览器会话是否就绪（决定 capabilities 是否可用） */
  async isReady(platform: string, accountId: string | number): Promise<boolean> {
    try {
      const session = await this.browser.getOrCreateSession({
        platform: platform as never,
        accountId,
        probe: true,
      });
      return Boolean(session?.page);
    } catch {
      return false;
    }
  }

  /** 采集配额检查（超限 → quota_exceeded 原因码，不静默降级） */
  private async assertQuota(userId: string): Promise<void> {
    if (!this.quota) return;
    try {
      await this.quota.assertCanDiscover(userId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AcquisitionQuotaExceededError') {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
      throw error;
    }
  }

  /** 关键词搜索 → 发现候选（draft-only：人工确认后才进线索池） */
  async searchByKeyword(input: BrowserSearchInput): Promise<DiscoveryItem[]> {
    await this.assertQuota(String(input.accountId));
    const urlTemplate = SEARCH_URLS[input.platform];
    if (!urlTemplate) {
      throw new BrowserDiscoverError('parse_failed', `平台 ${input.platform} 暂不支持浏览器搜索`);
    }
    const url = urlTemplate.replace('{keyword}', encodeURIComponent(input.keyword));
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    const state = await this.checkPageState(page, input.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state, `浏览器会话检查失败：${state}`);
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
    } catch (error) {
      throw new BrowserDiscoverError('network_error', `打开搜索页失败：${(error as Error).message}`);
    }
    // 打开后可能触发验证码/风控（搜索页更常见）
    const afterState = await this.checkPageState(page, input.platform);
    if (afterState !== 'ok') {
      throw new BrowserDiscoverError(afterState, `搜索页被拦截：${afterState}`);
    }

    const items = await this.extractSearchResults(page, input.platform);
    if (items.length === 0) {
      throw new BrowserDiscoverError('parse_failed', '搜索页未解析到结果（页面结构变化或未加载）');
    }
    return items.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  /** 目标账号主页 → 作品列表 */
  async listAccountWorks(input: BrowserAccountInput): Promise<DiscoveryItem[]> {
    await this.assertQuota(String(input.accountId));
    const urlTemplate = ACCOUNT_URLS[input.platform];
    if (!urlTemplate) {
      throw new BrowserDiscoverError('parse_failed', `平台 ${input.platform} 暂不支持账号主页浏览`);
    }
    const url = urlTemplate.replace('{targetId}', encodeURIComponent(input.targetId));
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    const state = await this.checkPageState(page, input.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state, `浏览器会话检查失败：${state}`);
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500);
    } catch (error) {
      throw new BrowserDiscoverError('network_error', `打开账号主页失败：${(error as Error).message}`);
    }
    const afterState = await this.checkPageState(page, input.platform);
    if (afterState !== 'ok') {
      throw new BrowserDiscoverError(afterState, `账号主页被拦截：${afterState}`);
    }

    const items = await this.extractAccountWorks(page, input.platform);
    if (items.length === 0) {
      throw new BrowserDiscoverError('parse_failed', '账号主页未解析到作品（页面结构变化或未加载）');
    }
    await this.quota?.recordDiscover(String(input.accountId)).catch(() => {});
    return items.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  // —— 内部 ——

  private async openSession(platform: string, accountId: string | number): Promise<EngineSession> {
    try {
      return await this.browser.getOrCreateSession({
        platform: platform as never,
        accountId,
      });
    } catch (error) {
      throw new BrowserDiscoverError('no_browser_session', `无法获取浏览器会话：${(error as Error).message}`);
    }
  }

  /**
   * 页面状态检查（合规边界核心）：
   * 检测登录/验证码/风控 → 返回原因码；遇验证码/风控直接转人工，绝不绕过。
   */
  private async checkPageState(
    page: Page,
    platform: string,
  ): Promise<'ok' | 'not_logged_in' | 'captcha_required' | 'risk_control'> {
    try {
      const url = page.url().toLowerCase();
      const text = await this.pageText(page, 1200);

      // 验证码（不绕过 → 转人工）
      if (/验证码|安全验证|请完成验证|captcha|滑动验证|人机验证/.test(text)) {
        return 'captcha_required';
      }
      // 风控（不绕过 → 转人工）
      if (/操作频繁|访问过于频繁|被限制|风险提示|异常访问|请求太频繁/.test(text)) {
        return 'risk_control';
      }
      // 未登录
      if (
        /扫码登录|登录\/注册|登录或注册|请先登录|未登录|二维码/.test(text) ||
        /login|signin|passport/.test(url)
      ) {
        return 'not_logged_in';
      }
      void platform;
      return 'ok';
    } catch {
      return 'ok'; // 页面读取失败不误报拦截，交给解析步骤
    }
  }

  private async pageText(page: Page, maxChars: number): Promise<string> {
    try {
      const text = await page.evaluate(() => document.body?.innerText ?? '');
      return (typeof text === 'string' ? text : '').slice(0, maxChars);
    } catch {
      return '';
    }
  }

  /** 抖音搜索结果解析：视频卡片 a[href*="/video/"] + 标题 + 作者 */
  private async extractSearchResults(
    page: Page,
    platform: string,
  ): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      const cards = await page.evaluate(() => {
        const out: Array<{ href: string; title: string; author: string }> = [];
        const links = document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/video/"], a[href*="/item/"], a[href*="/note/"]',
        );
        links.forEach((a) => {
          const href = a.getAttribute('href') || '';
          const title = (a.getAttribute('title') || a.textContent || '').trim().slice(0, 120);
          if (href && title) {
            out.push({ href, title, author: '' });
          }
        });
        return out;
      });
      for (const c of cards) {
        const fullUrl = c.href.startsWith('http')
          ? c.href
          : `https://www.${platform}.com${c.href.startsWith('/') ? '' : '/'}${c.href}`;
        items.push({
          platform,
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: c.href.split('/').filter(Boolean).pop() ?? createId(fullUrl),
            url: fullUrl,
            contentType: 'video',
            title: c.title,
            rawHash: createId(`${platform}:${fullUrl}:${c.title}`),
          },
          identityHint: c.author ? { nickname: c.author } : undefined,
        });
      }
    } catch {
      // 解析失败返回空，由调用方抛 parse_failed
    }
    return items;
  }

  /** 账号主页作品解析（抖音：作品卡片链接） */
  private async extractAccountWorks(
    page: Page,
    platform: string,
  ): Promise<DiscoveryItem[]> {
    return this.extractSearchResults(page, platform);
  }
}

function createId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 24);
}
