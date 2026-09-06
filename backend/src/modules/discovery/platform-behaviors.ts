// 平台行为独立实现（复核 #5：三平台 Driver 行为真正隔离）。
//
// 每个平台的搜索/读评论/账号主页编排逻辑封装为独立类，不再集中在共享
// DiscoveryBrowserRunner 中。runner 只保留通用浏览器原语（会话获取/状态检查/
// 配额/通用提取），平台差异集中在本文件，各平台行为可独立修改与独立验收。
//
// 结构依赖（避免循环导入）：本文件依赖 runner 的公开原语接口（BehaviorHost），
// runner 结构满足该接口（TS 结构类型），由 runner 实例化行为类并委托。
import type { Page } from 'playwright';
import { BrowserDiscoverError, createId } from './discovery-shared';
import type { DiscoveryItem } from './discovery.types';

/** 行为类依赖的 runner 公开原语（结构类型，runner 隐式满足） */
export interface BehaviorHost {
  checkPageState(page: Page, platform: string): Promise<string>;
  behaviorSearch(platform: string, page: Page, keyword: string): Promise<void>;
  scrollComments(page: Page, rounds?: number): Promise<void>;
  extractDouyinJingxuanResults(page: Page): Promise<DiscoveryItem[]>;
  extractDouyinAccountWorks(page: Page): Promise<DiscoveryItem[]>;
  extractDouyinUserSearchResults(page: Page): Promise<DiscoveryItem[]>;
  extractXhsNoteResults(page: Page): Promise<DiscoveryItem[]>;
  extractXhsComments(page: Page): Promise<DiscoveryItem[]>;
  extractKuaishouRecoResults(page: Page): Promise<DiscoveryItem[]>;
  extractKuaishouComments(page: Page): Promise<DiscoveryItem[]>;
  openXhsNoteViaSearchClick(
    page: Page,
    contentUrl: string,
    keyword?: string,
  ): Promise<void>;
}

/** 平台行为契约（每个平台实现，行为相互独立） */
export interface PlatformBehavior {
  readonly platform: string;
  /** 关键词/推荐流发现 → 内容候选 */
  discover(
    page: Page,
    keyword: string,
    mode: 'keyword' | 'recommended',
  ): Promise<{ items: DiscoveryItem[]; recommendedFallback: boolean }>;
  /** 内容详情页 → 评论者候选 */
  readComments(
    page: Page,
    contentUrl: string,
    keyword?: string,
  ): Promise<DiscoveryItem[]>;
  /** 账号主页 → 作品候选 */
  listAccountWorks(page: Page, targetId: string): Promise<DiscoveryItem[]>;
  /** 行为式搜索 → 账号候选（抖音：搜索页切用户tab；其他平台可选实现） */
  searchAccounts?(page: Page, keyword: string): Promise<DiscoveryItem[]>;
}

/** 抖音行为：行为式搜索 + jingxuan 卡片解析 + 主页作品解析 */
export class DouyinBehavior implements PlatformBehavior {
  readonly platform = 'douyin';
  constructor(private readonly host: BehaviorHost) {}

  async discover(
    page: Page,
    keyword: string,
    _mode: 'keyword' | 'recommended',
  ): Promise<{ items: DiscoveryItem[]; recommendedFallback: boolean }> {
    // 抖音：行为式搜索（首页输入+回车，绕 /search/ 验证码）
    await this.host.behaviorSearch(this.platform, page, keyword);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, `搜索页被拦截：${state}`);
    }
    const items = await this.host.extractDouyinJingxuanResults(page);
    return { items, recommendedFallback: false };
  }

  async readComments(page: Page, contentUrl: string): Promise<DiscoveryItem[]> {
    await page.goto(contentUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, `内容页被拦截：${state}`);
    }
    await this.host.scrollComments(page);
    // 抖音评论区：[data-e2e=comment-item] / .comment-item / .comment-info
    return this.extractCommentsWithSelectors(page, [
      '[data-e2e="comment-item"]',
      '.comment-item',
      '.comment-info',
    ]);
  }

  async listAccountWorks(
    page: Page,
    targetId: string,
  ): Promise<DiscoveryItem[]> {
    const url = `https://www.douyin.com/user/${encodeURIComponent(targetId)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(
        state as never,
        `账号主页被拦截：${state}`,
      );
    }
    return this.host.extractDouyinAccountWorks(page);
  }

  async searchAccounts(page: Page, keyword: string): Promise<DiscoveryItem[]> {
    // 行为式搜索（首页输入+回车，绕 /search/ 验证码）→ 切「用户」tab → 解析账号
    await this.host.behaviorSearch(this.platform, page, keyword);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, '搜索页被拦截：' + state);
    }
    // 切到「用户」tab（账号列表）。tab 文本定位，容错：点击失败不中断（解析仍可兜底）
    await page
      .getByText('用户', { exact: true })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
    await page.waitForTimeout(2000).catch(() => undefined);
    return this.host.extractDouyinUserSearchResults(page);
  }

  /** 通用评论区解析（给定选择器列表） */
  private async extractCommentsWithSelectors(
    page: Page,
    selectors: string[],
  ): Promise<DiscoveryItem[]> {
    try {
      await this.host.scrollComments(page);
      const parsed = await page.evaluate((selList) => {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const sel of selList) {
          const nodes = document.querySelectorAll<HTMLElement>(sel);
          for (const node of nodes) {
            const text = (node.innerText || node.textContent || '')
              .trim()
              .replace(/\s+/g, ' ');
            if (text.length < 2 || text.length > 500) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            out.push(text);
          }
          if (out.length >= 60) break;
        }
        return { comments: out, title: document.title || '' };
      }, selectors);
      const url = page.url();
      const contentId = url.split('/').filter(Boolean).pop() ?? createId(url);
      return parsed.comments.map((text) => ({
        platform: this.platform,
        accountId: 'browser-session',
        sourceContent: {
          externalContentId: contentId,
          url,
          contentType: 'video',
          title: parsed.title.slice(0, 120) || '内容详情页',
          rawHash: createId(`${this.platform}:${url}`),
        },
        interactionEvents: [
          {
            // P1-6 复核：通用选择器解析无真实评论 ID → externalEventId 不合成
            // （弱内容锚点不当事实唯一键，交由调用方标注 missingFields/人工补录）
            externalEventId: undefined,
            type: 'comment',
            text,
            sourceUrl: url,
            occurredAt: new Date().toISOString(),
          },
        ],
      }));
    } catch {
      return [];
    }
  }
}

/** 小红书行为：固定搜索 URL + note-item 解析 + 详情真实点击进入 + 评论解析 */
export class XhsBehavior implements PlatformBehavior {
  readonly platform = 'xiaohongshu';
  constructor(private readonly host: BehaviorHost) {}

  async discover(
    page: Page,
    keyword: string,
    _mode: 'keyword' | 'recommended',
  ): Promise<{ items: DiscoveryItem[]; recommendedFallback: boolean }> {
    // P1-8 复核：真实用户路径——首页搜索框输入 + 回车（对齐抖音/快手），
    // 不再直接 goto 固定搜索 URL（反爬环境下稳定性与 isTrusted 行为不达标）。
    await this.host.behaviorSearch(this.platform, page, keyword);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, `搜索页被拦截：${state}`);
    }
    const items = await this.host.extractXhsNoteResults(page);
    return { items, recommendedFallback: false };
  }

  async readComments(
    page: Page,
    contentUrl: string,
    keyword?: string,
  ): Promise<DiscoveryItem[]> {
    // 详情页直开 404（xsec_token 需会话内点击生成）→ 从搜索页真实点击进入
    await this.host.openXhsNoteViaSearchClick(page, contentUrl, keyword);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, `内容页被拦截：${state}`);
    }
    return this.host.extractXhsComments(page);
  }

  listAccountWorks(): Promise<DiscoveryItem[]> {
    return Promise.reject(
      new BrowserDiscoverError('parse_failed', '小红书账号主页浏览暂未实现'),
    );
  }
}

/** 快手行为：真实搜索（降级推荐流标注）+ new-reco 解析 + 评论解析 */
export class KuaishouBehavior implements PlatformBehavior {
  readonly platform = 'kuaishou';
  constructor(private readonly host: BehaviorHost) {}

  async discover(
    page: Page,
    keyword: string,
    mode: 'keyword' | 'recommended',
  ): Promise<{ items: DiscoveryItem[]; recommendedFallback: boolean }> {
    // mode=recommended：直接走 new-reco 推荐流
    if (mode === 'recommended') {
      await page.goto('https://www.kuaishou.com/new-reco', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
      await page
        .waitForSelector('video', { timeout: 20000 })
        .catch(() => undefined);
      const state = await this.host.checkPageState(page, this.platform);
      if (state !== 'ok') {
        throw new BrowserDiscoverError(
          state as never,
          `推荐流被拦截：${state}`,
        );
      }
      const items = await this.host.extractKuaishouRecoResults(page);
      return { items, recommendedFallback: false };
    }

    // mode=keyword：先尝试真实搜索，不渲染则降级推荐流并标注
    await this.host.behaviorSearch(this.platform, page, keyword);
    const searchState = await this.host.checkPageState(page, this.platform);
    if (searchState !== 'ok') {
      throw new BrowserDiscoverError(
        searchState as never,
        `搜索页被拦截：${searchState}`,
      );
    }
    await page.waitForTimeout(3000);
    const searchRendered = await page
      .evaluate(() => {
        const url = location.href;
        const inSearch =
          /\/search(\/|\?|$)/.test(url) || /searchKey=/.test(url);
        const hasVideo = Array.from(document.querySelectorAll('video')).some(
          (v) => /\d{15,}/.test(v.src || ''),
        );
        return inSearch && hasVideo;
      })
      .catch(() => false);
    if (searchRendered) {
      const items = await this.host.extractKuaishouRecoResults(page);
      return { items, recommendedFallback: false };
    }
    // 降级推荐流
    await page.goto('https://www.kuaishou.com/new-reco', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await page
      .waitForSelector('video', { timeout: 20000 })
      .catch(() => undefined);
    const items = await this.host.extractKuaishouRecoResults(page);
    return { items, recommendedFallback: true };
  }

  async readComments(page: Page, contentUrl: string): Promise<DiscoveryItem[]> {
    await page.goto(contentUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2500);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(state as never, `内容页被拦截：${state}`);
    }
    return this.host.extractKuaishouComments(page);
  }

  async listAccountWorks(
    page: Page,
    targetId: string,
  ): Promise<DiscoveryItem[]> {
    const url = `https://www.kuaishou.com/profile/${encodeURIComponent(targetId)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const state = await this.host.checkPageState(page, this.platform);
    if (state !== 'ok') {
      throw new BrowserDiscoverError(
        state as never,
        `账号主页被拦截：${state}`,
      );
    }
    return this.host.extractKuaishouRecoResults(page);
  }
}
