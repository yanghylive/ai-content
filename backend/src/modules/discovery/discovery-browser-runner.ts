// 浏览器会话发现执行器（大王方案 2026-08-16：无平台 API 授权 → 复用浏览器会话）
// 用户登录的 Playwright 会话（auto-upload/local-engine 基建）内辅助采集：
//   keyword 模式：打开平台搜索页读结果；target-account 模式：打开账号主页读作品。
// 合规边界（铁律不破）：
//   - 只用用户自己登录的浏览器会话，不绕过验证码/风控（遇验证码/风控 → 转人工原因码）
//   - 结果人工确认后进线索池（draft-only → confirm-first），不包装成稳定 API 承诺
import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import {
  DouyinBehavior,
  KuaishouBehavior,
  XhsBehavior,
  type PlatformBehavior,
} from './platform-behaviors';
import {
  LocalBrowserEngine,
  type EngineSession,
} from '../local-engine/local-browser-engine.service';
import {
  AcquisitionQuotaExceededError,
  AcquisitionQuotaService,
} from './acquisition-quota.service';
import type { DiscoveryItem } from './discovery.types';

// 复核 #5：错误类型与 id 生成抽到 discovery-shared（行为类共用，instanceof 一致）
import {
  BrowserDiscoverError,
  createId,
  type BrowserDiscoverReasonCode,
} from './discovery-shared';
export { BrowserDiscoverError, createId, type BrowserDiscoverReasonCode };

export interface BrowserSearchInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  keyword: string;
  limit?: number;
  /** 发起发现的真实用户 ID（配额按用户计，不能拿 accountId 当用户） */
  userId?: string;
}

export interface BrowserAccountInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  /** 目标账号标识（抖音 sec_uid / 小红书 user_id） */
  targetId: string;
  limit?: number;
  /** 发起发现的真实用户 ID（配额按用户计，不能拿 accountId 当用户） */
  userId?: string;
}

export interface BrowserCommentsInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  /** 内容页 URL（打开评论区，如视频/笔记详情页） */
  contentUrl: string;
  /** 来源搜索关键词（小红书详情页需从搜索页真实点击进入，直开 404） */
  keyword?: string;
  limit?: number;
  /** 发起发现的真实用户 ID（配额按用户计，不能拿 accountId 当用户） */
  userId?: string;
}

/** 评论回复输入（触达动作，人工确认式） */
export interface BrowserReplyInput {
  platform: 'douyin' | 'xiaohongshu' | 'kuaishou';
  accountId: string | number;
  /** 内容页 URL（评论区所在详情页） */
  contentUrl: string;
  /** 来源搜索关键词（小红书详情页需从搜索页真实点击进入） */
  keyword?: string;
  /** 目标评论文本（定位要回复的评论，模糊包含匹配） */
  targetText: string;
  /** 回复话术 */
  replyText: string;
  /** dryRun：填框后不点发送（人工确认式验证，不打扰真实用户） */
  dryRun?: boolean;
  userId?: string;
}

/** 各平台搜索页 URL 模板（{keyword} 需 encodeURIComponent） */
/**
 * 各平台评论区节点选择器（尽力匹配；全部匹配不到 → parse_failed，不伪装空结果）。
 * 平台改版后需实测更新（D 阶段真实账号验收时校准）。
 */
const COMMENT_SELECTORS: Record<string, string[]> = {
  douyin: ['[data-e2e="comment-item"]', '.comment-item', '.comment-info'],
  xiaohongshu: ['.comment-item', '.note-comment', '#comments .parent-comment'],
  kuaishou: ['.comment-list .comment-item', '.comment-item', '.comment'],
};

@Injectable()
export class DiscoveryBrowserRunner {
  private readonly logger = new Logger(DiscoveryBrowserRunner.name);

  /** 平台行为（复核 #5：三平台行为独立封装，runner 仅通用原语 + 委托） */
  private readonly behaviors: Record<string, PlatformBehavior>;

  constructor(
    private readonly browser: LocalBrowserEngine,
    private readonly quota?: AcquisitionQuotaService,
  ) {
    this.behaviors = {
      douyin: new DouyinBehavior(this),
      kuaishou: new KuaishouBehavior(this),
      xiaohongshu: new XhsBehavior(this),
    };
  }

  private behavior(platform: string): PlatformBehavior | undefined {
    return this.behaviors[platform];
  }

  /** 浏览器会话是否就绪（决定 capabilities 是否可用） */
  async isReady(
    platform: string,
    accountId: string | number,
  ): Promise<boolean> {
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
      if (
        error instanceof Error &&
        error.name === 'AcquisitionQuotaExceededError'
      ) {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
      throw error;
    }
  }

  /** 关键词搜索 → 发现候选（draft-only：人工确认后才进线索池） */
  async searchByKeyword(input: BrowserSearchInput): Promise<DiscoveryItem[]> {
    const quotaUser = input.userId ?? String(input.accountId);
    await this.assertQuota(quotaUser);
    const behavior = this.behavior(input.platform);
    if (!behavior) {
      throw new BrowserDiscoverError(
        'parse_failed',
        `平台 ${input.platform} 无浏览器发现行为实现`,
      );
    }
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    void page;

    // 复核 #5：平台搜索编排委托行为类（平台差异不在 runner 分支）
    let result: { items: DiscoveryItem[]; recommendedFallback: boolean };
    try {
      result = await behavior.discover(page, input.keyword, 'keyword');
    } catch (error) {
      if (error instanceof BrowserDiscoverError) throw error;
      throw new BrowserDiscoverError(
        'network_error',
        `搜索执行失败：${(error as Error).message}`,
      );
    }
    const items = result.items;
    if (items.length === 0) {
      throw new BrowserDiscoverError(
        'parse_failed',
        result.recommendedFallback
          ? '搜索与推荐流均未解析到结果（页面结构变化或未加载）'
          : '搜索页未解析到结果（页面结构变化或未加载）',
      );
    }
    // 降级推荐流时如实标注（不冒充关键词搜索结果）
    if (result.recommendedFallback) {
      for (const item of items) {
        item.recommendedFallback = true;
      }
    }
    await this.quota?.recordDiscover(quotaUser).catch((error) => {
      if (error instanceof AcquisitionQuotaExceededError) {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
    });
    return items.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  /**
   * 行为式搜索（D 阶段实测适配：抖音/快手）：
   * 打开平台首页 → 搜索框输入关键词 → 回车 → 等待结果区。
   * 抖音绕 /search/ 直开验证码；快手旧搜索 URL 已失效（/search/{kw} 需从首页发起）。
   * 失败抛 network_error 由调用方转人工。
   */
  async behaviorSearch(
    platform: string,
    page: Page,
    keyword: string,
  ): Promise<void> {
    try {
      const homeUrl =
        platform === 'kuaishou'
          ? 'https://www.kuaishou.com/'
          : platform === 'xiaohongshu'
            ? 'https://www.xiaohongshu.com/'
            : 'https://www.douyin.com/';
      await page.goto(homeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2500);
      const box = page
        .locator(
          'input[placeholder*="搜索"], input[type="search"], .search-input input, header input, .input',
        )
        .first();
      await box.fill(keyword);
      await box.press('Enter');
      const resultSelector =
        platform === 'kuaishou'
          ? '.search-view'
          : platform === 'xiaohongshu'
            ? 'section.note-item, a[href*="/explore/"]'
            : '#search-content-area';
      await page
        .waitForSelector(resultSelector, { timeout: 20000 })
        .catch(() => undefined);
      await page.waitForTimeout(4000);
    } catch (error) {
      throw new BrowserDiscoverError(
        'network_error',
        `${platform} 行为式搜索失败：${(error as Error).message}`,
      );
    }
  }

  /** 目标账号主页 → 作品列表 */
  async listAccountWorks(input: BrowserAccountInput): Promise<DiscoveryItem[]> {
    const quotaUser = input.userId ?? String(input.accountId);
    await this.assertQuota(quotaUser);
    const behavior = this.behavior(input.platform);
    if (!behavior) {
      throw new BrowserDiscoverError(
        'parse_failed',
        `平台 ${input.platform} 无账号主页行为实现`,
      );
    }
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    void page;

    // 复核 #5：账号主页编排委托行为类
    let items: DiscoveryItem[];
    try {
      items = await behavior.listAccountWorks(page, input.targetId);
    } catch (error) {
      if (error instanceof BrowserDiscoverError) throw error;
      throw new BrowserDiscoverError(
        'network_error',
        `打开账号主页失败：${(error as Error).message}`,
      );
    }
    if (items.length === 0) {
      throw new BrowserDiscoverError(
        'parse_failed',
        '账号主页未解析到作品（页面结构变化或未加载）',
      );
    }
    await this.quota?.recordDiscover(quotaUser).catch((error) => {
      if (error instanceof AcquisitionQuotaExceededError) {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
    });
    return items.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  /**
   * 内容页评论区 → 评论者候选（只读，C 阶段）。
   * 打开内容详情页 → 滚动加载评论区 → 解析评论（作者昵称 + 评论文本 + 来源内容）。
   * 每条评论产出一个 DiscoveryItem：sourceContent=被评内容，identityHint=评论者，
   * interactionEvents=[该评论]（对齐 InteractionEvent 契约，供评论获客）。
   * 只读采集不触发平台写操作；解析失败 → parse_failed（不伪装空结果）。
   */
  async readComments(input: BrowserCommentsInput): Promise<DiscoveryItem[]> {
    const quotaUser = input.userId ?? String(input.accountId);
    await this.assertQuota(quotaUser);
    if (!input.contentUrl) {
      throw new BrowserDiscoverError('parse_failed', '缺少内容页 URL');
    }
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    // 同上：不在 openSession 后检查遗留 tab，goto 目标 URL 后权威判定
    void page;

    // 复核 #5：内容详情页 + 评论区解析委托行为类（平台差异不在 runner 分支）
    const behavior = this.behavior(input.platform);
    let comments: DiscoveryItem[];
    if (behavior) {
      try {
        comments = await behavior.readComments(
          page,
          input.contentUrl,
          input.keyword,
        );
      } catch (error) {
        if (error instanceof BrowserDiscoverError) throw error;
        throw new BrowserDiscoverError(
          'network_error',
          `打开内容页失败：${(error as Error).message}`,
        );
      }
    } else {
      // 无行为实现的平台：回退通用编排（goto + 通用评论区解析）
      try {
        await page.goto(input.contentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(2500);
      } catch (error) {
        throw new BrowserDiscoverError(
          'network_error',
          `打开内容页失败：${(error as Error).message}`,
        );
      }
      const afterState = await this.checkPageState(page, input.platform);
      if (afterState !== 'ok') {
        throw new BrowserDiscoverError(
          afterState,
          `内容页被拦截：${afterState}`,
        );
      }
      comments = await this.extractComments(page, input.platform);
    }
    if (comments.length === 0) {
      throw new BrowserDiscoverError(
        'parse_failed',
        '评论区未解析到评论（页面结构变化、评论区未加载或无评论）',
      );
    }
    await this.quota?.recordDiscover(quotaUser).catch((error) => {
      if (error instanceof AcquisitionQuotaExceededError) {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
    });
    return comments.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  /**
   * 评论回复（触达动作，人工确认式；dryRun 只填框不发送）。
   * 打开详情页评论区 → 定位含 targetText 的评论 → hover 显示回复入口 →
   * 填回复框（contenteditable/textarea）→ dryRun=false 时点发送 → 截图证据。
   * 发送是真实平台操作：调用方必须经过人工确认（本方法默认不自动发送）。
   */
  async replyComment(
    input: BrowserReplyInput,
  ): Promise<{ ok: boolean; sent: boolean; message: string; evidenceUrl?: string }> {
    if (!input.targetText || !input.replyText) {
      throw new BrowserDiscoverError('parse_failed', '缺少目标评论或回复话术');
    }
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    void page;

    if (input.platform === 'xiaohongshu') {
      await this.openXhsNoteViaSearchClick(
        page,
        input.contentUrl,
        input.keyword,
      );
    } else {
      try {
        await page.goto(input.contentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(2500);
      } catch (error) {
        throw new BrowserDiscoverError(
          'network_error',
          `打开内容页失败：${(error as Error).message}`,
        );
      }
    }
    const afterState = await this.checkPageState(page, input.platform);
    if (afterState !== 'ok') {
      throw new BrowserDiscoverError(afterState, `内容页被拦截：${afterState}`);
    }

    try {
      // 滚到评论区
      await this.scrollComments(page, 5);
      // 定位目标评论（按文本模糊匹配）
      const commentSelector =
        input.platform === 'kuaishou' ? '.comment-item' : '.comment-item';
      const target = page
        .locator(
          `${commentSelector}:has-text("${this.escapeCss(input.targetText)}")`,
        )
        .first();
      const box = await target.boundingBox();
      if (!box) {
        throw new BrowserDiscoverError(
          'parse_failed',
          '未找到目标评论（评论区未加载或评论不存在）',
        );
      }
      // hover 目标评论（回复入口 hover 显示）
      await page.mouse.move(box.x + box.width / 2, box.y + 30);
      await page.waitForTimeout(1200);
      // 点回复入口（hover 后出现的"回复"）
      const replyEntry = page
        .locator(
          `[class*="reply"]:has-text("回复"), button:has-text("回复"), span:has-text("回复")`,
        )
        .first();
      const replyBox = await replyEntry.boundingBox().catch(() => null);
      if (!replyBox) {
        // P0-3 复核：未找到平台回复入口 → 禁止 fallback 到评论区底部输入框发新评论。
        // 那不是「回复目标评论」，而是公开发表新评论——外部误发、无法审计「回复了谁」。
        throw new BrowserDiscoverError(
          'parse_failed',
          '未找到平台回复入口（无真实回复按钮），已阻断；禁止发新评论代替回复，需人工核对目标评论',
        );
      }
      await page.mouse.click(
        replyBox.x + replyBox.width / 2,
        replyBox.y + replyBox.height / 2,
      );
      await page.waitForTimeout(1500);
      // 填回复框（contenteditable / textarea；优先可见的，点回复后可能展开在评论下方）
      const editor = page
        .locator(
          '[contenteditable="true"]:visible, textarea:visible, .content-input:visible, .pl-textarea:visible, .comment-input [contenteditable="true"]',
        )
        .last();
      await editor.scrollIntoViewIfNeeded().catch(() => undefined);
      await editor.click({ timeout: 8000 }).catch(async () => {
        await editor
          .evaluate((el: HTMLElement) => el.focus())
          .catch(() => undefined);
      });
      await page.waitForTimeout(500);
      await editor.fill(input.replyText).catch(() => undefined);
      await page.waitForTimeout(800);
      // P1 复核（全面审查）：发送前校验回复框真实内容 === replyText——
      // fill 失败（编辑器结构变化）时禁止点发送（防空/错内容真实外发）
      const filledText = await editor
        .evaluate((el: HTMLElement) => {
          const t = el as HTMLElement & { value?: string; textContent?: string };
          return (
            t.value ??
            t.textContent ??
            (el as HTMLElement & { innerText?: string }).innerText ??
            ''
          );
        })
        .catch(() => '');
      if (filledText.trim() !== input.replyText.trim()) {
        throw new BrowserDiscoverError(
          'parse_failed',
          '回复框内容校验失败（编辑器未正确填入回复话术），已中止发送防错发',
        );
      }
      // dryRun：不点发送（人工确认式，避免打扰真实用户）；仍截图留证（填框状态）
      if (input.dryRun) {
        const shot = await this.captureReplyEvidence(
          `${input.platform}-${input.accountId}`,
          'reply-dryrun',
        );
        return {
          ok: true,
          sent: false,
          message: '回复话术已填入，dry-run 未发送（等待人工确认）',
          evidenceUrl: shot,
        };
      }
      const sendBtn = page
        .locator('button:has-text("发送"), [class*="send"]:has-text("发送")')
        .first();
      const sendBox = await sendBtn.boundingBox().catch(() => null);
      if (!sendBox) {
        throw new BrowserDiscoverError(
          'parse_failed',
          '回复框已填但未找到发送按钮',
        );
      }
      await page.mouse.click(
        sendBox.x + sendBox.width / 2,
        sendBox.y + sendBox.height / 2,
      );
      await page.waitForTimeout(2000);
      // P0 复核（全面审查）：发送成功后截图 = 真实回读证据（审计可复验），
      // 否则 finalize 证据门禁必降级 reconcile_required → sent 永远 false
      const shot = await this.captureReplyEvidence(
        `${input.platform}-${input.accountId}`,
        'reply-comment',
      );
      return { ok: true, sent: true, message: '评论回复已发送', evidenceUrl: shot };
    } catch (error) {
      if (error instanceof BrowserDiscoverError) throw error;
      throw new BrowserDiscoverError(
        'network_error',
        `评论回复失败：${(error as Error).message}`,
      );
    }
  }

  /** CSS 选择器转义（targetText 可能含引号/特殊字符） */
  private escapeCss(value: string): string {
    return value.replace(/["\\]/g, '\\$&').slice(0, 60);
  }

  // —— 内部 ——

  /**
   * 回复证据截图（P0 复核：finalize 证据门禁需要真实回读证据）。
   * 截图失败不阻断回复结果（证据尽力而为，步骤记录仍在），返回 undefined。
   */
  private async captureReplyEvidence(
    sessionKey: string,
    label: string,
  ): Promise<string | undefined> {
    try {
      const shot = await this.browser.captureEvidence({ sessionKey, label });
      return shot?.url;
    } catch {
      return undefined;
    }
  }

  async openSession(
    platform: string,
    accountId: string | number,
  ): Promise<EngineSession> {    try {
      return await this.browser.getOrCreateSession({
        platform: platform as never,
        accountId,
      });
    } catch (error) {
      throw new BrowserDiscoverError(
        'no_browser_session',
        `无法获取浏览器会话：${(error as Error).message}`,
      );
    }
  }

  /**
   * 真实获取/复用引擎会话（复核 #1：RPA 会话与真实浏览器引擎会话绑定）。
   * 返回引擎会话 key（{platform}-{accountId}）；engine 不可用时抛错。
   */
  async acquireEngineSession(
    platform: string,
    accountId: string | number,
  ): Promise<string> {
    try {
      await this.browser.getOrCreateSession({
        platform: platform as never,
        accountId,
      });
      return `${platform}-${accountId}`;
    } catch (error) {
      throw new BrowserDiscoverError(
        'no_browser_session',
        `无法获取浏览器引擎会话：${(error as Error).message}`,
      );
    }
  }

  /**
   * 推荐流发现（Sprint 5 独立动作 discover-recommended）：打开 new-reco，
   * 从 video src 解析视频 id（与关键词搜索解耦，结果不带 recommendedFallback 降级标记）。
   */
  async searchRecommended(input: BrowserSearchInput): Promise<DiscoveryItem[]> {
    const quotaUser = input.userId ?? String(input.accountId);
    // P1 复核（全面审查）：推荐流发现补配额门禁——对齐 searchByKeyword/
    // listAccountWorks/readComments（原实现绕过配额，可无限发现）
    await this.assertQuota(quotaUser);
    const session = await this.openSession(input.platform, input.accountId);
    const page = session.page;
    try {
      await page.goto('https://www.kuaishou.com/new-reco', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
      await page
        .waitForSelector('video', { timeout: 20000 })
        .catch(() => undefined);
    } catch (error) {
      throw new BrowserDiscoverError(
        'network_error',
        `打开推荐流失败：${(error as Error).message}`,
      );
    }
    const afterState = await this.checkPageState(page, input.platform);
    if (afterState !== 'ok') {
      throw new BrowserDiscoverError(afterState, `推荐流被拦截：${afterState}`);
    }
    const items = await this.extractKuaishouRecoResults(page);
    if (!items.length) {
      throw new BrowserDiscoverError(
        'parse_failed',
        '推荐流未解析到结果（页面结构变化或未加载）',
      );
    }
    // P1 复核（全面审查）：成功发现记录配额消耗（与 searchByKeyword 一致）
    await this.quota?.recordDiscover(quotaUser).catch((error) => {
      if (error instanceof AcquisitionQuotaExceededError) {
        throw new BrowserDiscoverError('quota_exceeded', error.message);
      }
    });
    return items.slice(0, Math.max(1, Math.min(input.limit ?? 20, 50)));
  }

  /**
   * 关闭指定平台的浏览器会话（P0-2 真实会话生命周期）：
   * 暂停/取消/人工接管时调用，真实关闭页面与浏览器进程，防止后台继续自动操作。
   * 关闭失败向上抛出（close_failed），由调用方记录，不静默吞掉。
   */
  async closeSession(
    platform: string,
    accountId: string | number,
  ): Promise<void> {
    const key = `${platform}-${accountId}`;
    try {
      // P0-7 复核：引擎返回 false（context/进程关闭失败）→ 抛 close_failed，
      // 不能静默当成功（否则「任务已暂停/取消但浏览器仍在跑」无法被发现）。
      const closed = await this.browser.closeSession(key);
      if (closed === false) {
        throw new BrowserDiscoverError(
          'close_failed',
          `关闭 ${platform} 浏览器会话失败：context/进程未确认退出（需人工检查浏览器窗口）`,
        );
      }
    } catch (error) {
      throw new BrowserDiscoverError(
        'close_failed',
        `关闭 ${platform} 浏览器会话失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 账号级 preflight（P1-1）：probe 档（headless 不弹窗）探测账号登录态/验证码/风控。
   * 返回结构化结果，替代"仅会话就绪"的假能力判断。
   */
  async probeAccount(
    platform: string,
    accountId: string | number,
  ): Promise<{
    browserReady: boolean;
    loggedIn: boolean;
    pageInteractive: boolean;
    captchaRequired: boolean;
    riskControl: boolean;
    reasonCode: string | null;
  }> {
    try {
      const session = await this.browser.getOrCreateSession({
        platform: platform as never,
        accountId,
        probe: true,
      });
      const state = await this.checkPageState(session.page, platform);
      return {
        browserReady: true,
        loggedIn: state === 'ok',
        pageInteractive: state === 'ok',
        captchaRequired: state === 'captcha_required',
        riskControl: state === 'risk_control',
        reasonCode: state === 'ok' ? null : state,
      };
    } catch (error) {
      return {
        browserReady: false,
        loggedIn: false,
        pageInteractive: false,
        captchaRequired: false,
        riskControl: false,
        reasonCode:
          error instanceof BrowserDiscoverError
            ? error.reasonCode
            : 'no_browser_session',
      };
    }
  }

  /**
   * 页面状态检查（合规边界核心）：
   * 检测登录/验证码/风控 → 返回原因码；遇验证码/风控直接转人工，绝不绕过。
   */
  async checkPageState(
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
      if (
        /操作频繁|访问过于频繁|被限制|风险提示|异常访问|请求太频繁/.test(text)
      ) {
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

  /** 搜索结果解析（抖音 jingxuan / 小红书 note-item / 快手 new-reco / 其余平台 a[href] 老结构） */
  private async extractSearchResults(
    page: Page,
    platform: string,
  ): Promise<DiscoveryItem[]> {
    if (platform === 'douyin') {
      return this.extractDouyinJingxuanResults(page);
    }
    if (platform === 'xiaohongshu') {
      return this.extractXhsNoteResults(page);
    }
    if (platform === 'kuaishou') {
      return this.extractKuaishouRecoResults(page);
    }
    const items: DiscoveryItem[] = [];
    try {
      const cards = await page.evaluate(() => {
        const out: Array<{ href: string; title: string; author: string }> = [];
        const links = document.querySelectorAll<HTMLAnchorElement>(
          'a[href*="/video/"], a[href*="/item/"], a[href*="/note/"]',
        );
        links.forEach((a) => {
          const href = a.getAttribute('href') || '';
          const title = (a.getAttribute('title') || a.textContent || '')
            .trim()
            .slice(0, 120);
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
            externalContentId:
              c.href.split('/').filter(Boolean).pop() ?? createId(fullUrl),
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

  /**
   * 小红书搜索卡片解析（D 阶段实测适配）。
   * 搜索页 URL /search_result?keyword=xxx&type=51 有效；结果卡片 = section.note-item
   * （标题+作者+时间文本）+ a[href*="/explore/"]（笔记链接）+ 封面 img。
   */
  async extractXhsNoteResults(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      const parsed = await page.evaluate(() => {
        const out: Array<{ title: string; url: string; img: string }> = [];
        const seen = new Set<string>();
        const cards = Array.from(
          document.querySelectorAll('section.note-item, a[href*="/explore/"]'),
        );
        for (const card of cards.slice(0, 30)) {
          const link =
            card.tagName === 'A'
              ? (card as HTMLAnchorElement)
              : card.querySelector<HTMLAnchorElement>('a[href*="/explore/"]');
          const href = link?.getAttribute('href') || '';
          if (!href.includes('/explore/')) continue;
          const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || seen.has(text)) continue;
          seen.add(text);
          const title = text.split(/\s{2,}/)[0] || text.slice(0, 60);
          const img = card.querySelector('img')?.src || '';
          out.push({
            title: (title || text).slice(0, 120),
            url: `https://www.xiaohongshu.com${href.startsWith('/') ? '' : '/'}${href}`,
            img,
          });
        }
        return out;
      });
      for (const c of parsed) {
        items.push({
          platform: 'xiaohongshu',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId:
              c.url.split('/').filter(Boolean).pop() ?? createId(c.url),
            url: c.url,
            contentType: 'note',
            title: c.title,
            rawHash: createId(`xiaohongshu:${c.url}:${c.title}`),
          },
        });
      }
    } catch {
      return []; // 解析失败返回空，由调用方抛 parse_failed
    }
    return items;
  }

  /**
   * 快手推荐流解析（D 阶段实测适配）：
   * 搜索页结果区在自动化下不渲染（反爬），但 new-reco 推荐流可读（video src 提取视频 id + 卡片文本）。
   * 快手没有独立搜索入口，推荐流即其"精选"（对齐抖音 jingxuan 语义）。
   */
  async extractKuaishouRecoResults(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      // 自动播放流：video 元素先出现、src 异步赋值（可能为空/blob）
      // 轮询等 src 含 19 位视频 id（最多 20s）
      for (let i = 0; i < 10; i += 1) {
        const ready = await page.evaluate(() =>
          Array.from(document.querySelectorAll('video')).some((v) =>
            /\d{15,}/.test(v.src || ''),
          ),
        );
        if (ready) break;
        await page.waitForTimeout(2000);
      }
      const parsed = await page.evaluate(() => {
        const out: Array<{ id: string; title: string; text: string }> = [];
        const seen = new Set<string>();
        const videos = Array.from(document.querySelectorAll('video'));
        for (const v of videos.slice(0, 20)) {
          const src = v.src || '';
          // 视频 id：src 里的长数字段（19 位，如 .../photo-video-mz/5244160495401767809_c574...）
          const m = src.match(/(\d{15,})/);
          const id = m ? m[1] : '';
          if (!id || seen.has(id)) continue;
          seen.add(id);
          let container: HTMLElement | null = v.closest('.video-container');
          if (!container) {
            let cur: HTMLElement | null = v.parentElement;
            while (cur && cur !== document.body) {
              if ((cur.textContent || '').length > 5) {
                container = cur;
                break;
              }
              cur = cur.parentElement;
            }
          }
          const text = (container?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^即将播放下一条视频\s*/, '');
          out.push({
            id,
            title: text.slice(0, 120),
            text: text.slice(0, 200),
          });
        }
        return out;
      });
      for (const c of parsed) {
        items.push({
          platform: 'kuaishou',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: c.id,
            url: `https://www.kuaishou.com/short-video/${c.id}`,
            contentType: 'video',
            title: c.title,
            rawHash: createId(`kuaishou:${c.id}:${c.title}`),
          },
        });
      }
    } catch {
      return [];
    }
    return items;
  }

  /**
   * 抖音 jingxuan 搜索卡片解析（D 阶段实测适配）。
   * 新版网页版卡片无 a[href*="/video/"] 链接：卡片容器含 douyinpic 封面 img +
   * 时长文本（如 "02:22"）+ 播放量 + 标题。URL 用封面图（无稳定视频 URL，诚实标注）。
   */
  async extractDouyinJingxuanResults(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      const parsed = await page.evaluate(() => {
        const out: Array<{ title: string; img: string }> = [];
        const area = document.querySelector('#search-content-area');
        if (!area) return out;
        const seen = new Set<string>();
        const cards = Array.from(area.querySelectorAll('div')).filter((d) => {
          const img = d.querySelector('img');
          return (
            img &&
            img.src.includes('douyinpic') &&
            /^\s*\d{1,2}:\d{2}/.test(d.innerText || '')
          );
        });
        for (const card of cards.slice(0, 30)) {
          const img = card.querySelector('img');
          const title = (card.innerText || '').replace(/\s+/g, ' ').trim();
          const src = img?.src || '';
          if (!title || seen.has(title)) continue;
          seen.add(title);
          out.push({ title: title.slice(0, 120), img: src });
        }
        return out;
      });
      for (const c of parsed) {
        items.push({
          platform: 'douyin',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: createId(c.img || c.title),
            url: c.img || '',
            contentType: 'video',
            title: c.title,
            rawHash: createId(`douyin:${c.img}:${c.title}`),
          },
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
    if (platform === 'douyin') {
      // 抖音用户主页作品：a[href*='/video/']（实测真实渲染，jingxuan 卡片选择器不匹配主页）
      return this.extractDouyinAccountWorks(page);
    }
    return this.extractSearchResults(page, platform);
  }

  /** 抖音用户主页作品解析（target-account 模式）：/video/{id} 链接 + 容器文本标题 */
  async extractDouyinAccountWorks(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      const parsed = await page.evaluate(() => {
        const out: Array<{
          videoId: string;
          title: string;
        }> = [];
        const seen = new Set<string>();
        const links = Array.from(
          document.querySelectorAll('a[href*="/video/"]'),
        );
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const m = href.match(/\/video\/(\d+)/);
          if (!m) continue;
          const videoId = m[1];
          if (seen.has(videoId)) continue;
          seen.add(videoId);
          const container =
            link.closest('li, [class*="card"], [class*="item"]') ||
            link.parentElement;
          const title = ((container as HTMLElement | null)?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
          out.push({ videoId, title });
          if (out.length >= 50) break;
        }
        return out;
      });
      for (const video of parsed) {
        const url = `https://www.douyin.com/video/${video.videoId}`;
        items.push({
          platform: 'douyin',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: video.videoId,
            url,
            contentType: 'video',
            title: video.title.slice(0, 120) || '用户主页作品',
            rawHash: createId(`douyin:${url}`),
          },
          interactionEvents: [],
        });
      }
    } catch {
      // 解析失败返回空，由调用方抛 parse_failed
    }
    return items;
  }

  /** 滚动评论区加载更多（模拟用户行为，最多 3 轮） */
  async scrollComments(page: Page, rounds = 3): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      await page.mouse.wheel(0, 2400).catch(() => undefined);
      await page.waitForTimeout(800);
    }
  }

  /**
   * 评论区解析：滚动加载后按平台选择器抓评论节点。
   * 小红书走 .comments-container（昵称+内容分离）；其余平台按整段文本。
   */
  async extractComments(
    page: Page,
    platform: string,
  ): Promise<DiscoveryItem[]> {
    if (platform === 'xiaohongshu') {
      return this.extractXhsComments(page);
    }
    if (platform === 'kuaishou') {
      return this.extractKuaishouComments(page);
    }
    const selectors = COMMENT_SELECTORS[platform] ?? [];
    if (!selectors.length) return [];
    try {
      await this.scrollComments(page);
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
        platform,
        accountId: 'browser-session',
        sourceContent: {
          externalContentId: contentId,
          url,
          contentType: 'video',
          title: parsed.title.slice(0, 120) || '内容详情页',
          rawHash: createId(`${platform}:${url}`),
        },
        interactionEvents: [
          {
            externalEventId: createId(`${platform}:${url}:${text}`),
            type: 'comment',
            text,
            sourceUrl: url,
            occurredAt: new Date().toISOString(),
          },
        ],
      }));
    } catch {
      return []; // 解析失败返回空，由调用方抛 parse_failed
    }
  }

  /**
   * 小红书评论区解析（D 阶段实测适配）：
   * 详情页 .comments-container 结构（.parent-comment/.comment-item），
   * 每条评论 = "昵称 内容 时间·地区 赞 N"。昵称取首段，内容取剩余。
   */
  async extractXhsComments(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      // 评论区异步加载：等容器出现（最多 15s），再真实滚轮触发加载
      await page
        .waitForSelector('.comments-container', { timeout: 15000 })
        .catch(() => undefined);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 1400).catch(() => undefined);
        await page.waitForTimeout(1500);
      }
      const parsed = await page.evaluate(() => {
        // P1 复核：评论身份三要素（nickname/externalUserId/profileUrl/commentId）一并提取，
        // 不再只有昵称——归因/去重/CRM 依赖真实身份，拿不到真实值就不伪造。
        const out: Array<{
          nick: string;
          text: string;
          profileUrl: string;
          externalUserId: string;
          commentId: string;
        }> = [];
        const container = document.querySelector('.comments-container');
        const root = container || document.body;
        const seen = new Set<string>();
        // 只取单条评论 .comment-item（.parent-comment 是整组容器，会重复）
        const nodes = root.querySelectorAll('.comment-item');
        for (const node of nodes) {
          // 作者/商家/客服回复不作为客户线索（对齐抖音过滤逻辑）
          if (
            node.querySelector(
              '.tag, [class*="author-tag"], [class*="merchant"]',
            )
          ) {
            continue;
          }
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length < 2 || seen.has(text)) continue;
          seen.add(text);
          // 精确分离（实测 DOM）：.author-wrapper a.name 昵称 + .content 内容
          const authorLink = node.querySelector(
            '.author-wrapper a.name, .author-wrapper .author a.name',
          );
          const nick = (
            authorLink?.textContent ||
            node.querySelector('.author-wrapper')?.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const content = (
            node.querySelector('.content, .note-text')?.textContent || ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          // 作者主页链接（a.name 是 <a>，href 指向 /user/profile/<id>）→ profileUrl + externalUserId
          const authorHref = authorLink?.getAttribute('href') || '';
          const profileUrl = authorHref
            ? authorHref.startsWith('http')
              ? authorHref
              : `${window.location.origin}${authorHref.startsWith('/') ? '' : '/'}${authorHref}`
            : '';
          const externalUserId = profileUrl
            ? (profileUrl.split('/').filter(Boolean).pop()?.split('?')[0] ?? '')
            : '';
          // 评论锚点：优先平台真实 data 属性，退化为 DOM id（都不存在则不伪造）
          const commentId =
            node.getAttribute('data-comment-id') ||
            node.getAttribute('data-id') ||
            node.id ||
            '';
          out.push({
            nick: nick.slice(0, 30),
            text: (content || text).slice(0, 120),
            profileUrl: profileUrl.slice(0, 300),
            externalUserId: externalUserId.slice(0, 64),
            commentId: commentId.slice(0, 64),
          });
        }
        return { comments: out, title: document.title || '' };
      });
      const url = page.url();
      const contentId =
        url.split('/').filter(Boolean).pop()?.split('?')[0] ?? createId(url);
      for (const c of parsed.comments) {
        items.push({
          platform: 'xiaohongshu',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: contentId,
            url,
            contentType: 'note',
            title: parsed.title.slice(0, 120) || '笔记详情页',
            rawHash: createId(`xiaohongshu:${url}`),
          },
          identityHint: {
            nickname: c.nick || undefined,
            externalUserId: c.externalUserId || undefined,
            profileUrl: c.profileUrl || undefined,
          },
          interactionEvents: [
            {
              // P1-6 复核：无平台真实评论 ID 时不合成内容锚点当事件 ID——
              // externalEventId=null + missingFields 标注，交由人工补录（弱键不当事实唯一键）
              externalEventId: c.commentId || undefined,
              type: 'comment',
              text: c.text,
              sourceUrl: url,
              authorExternalId: c.externalUserId || undefined,
              occurredAt: new Date().toISOString(),
            },
          ],
        });
      }
    } catch {
      return []; // 解析失败返回空，由调用方抛 parse_failed
    }
    return items;
  }

  /**
   * 快手评论区解析（D 阶段实测适配）：
   * 详情页 /short-video/<id> 可直开；评论区 .comment-item 结构
   * （.comment-item-author 昵称 + .comment-item-content 内容 + .comment-item-time）。
   */
  async extractKuaishouComments(page: Page): Promise<DiscoveryItem[]> {
    const items: DiscoveryItem[] = [];
    try {
      // 评论区异步加载：等 .comment-item 出现再滚动
      await page
        .waitForSelector('.comment-item', { timeout: 15000 })
        .catch(() => undefined);
      await this.scrollComments(page, 5);
      const parsed = await page.evaluate(() => {
        // P1 复核：评论身份三要素（nickname/externalUserId/profileUrl/commentId）一并提取。
        const out: Array<{
          nick: string;
          text: string;
          profileUrl: string;
          externalUserId: string;
          commentId: string;
        }> = [];
        const seen = new Set<string>();
        const nodes = document.querySelectorAll('.comment-item');
        for (const node of nodes) {
          const authorLink = node.querySelector(
            '.comment-item-author a, .author-name a',
          );
          const nick = (
            node.querySelector('.author-name')?.textContent ||
            authorLink?.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const content = (
            node.querySelector('.comment-item-content')?.textContent || ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const text =
            content || (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length < 2 || seen.has(text)) continue;
          seen.add(text);
          // 作者主页链接（快手个人页 /profile/<id>）→ profileUrl + externalUserId
          const authorHref =
            authorLink?.getAttribute('href') ||
            node.querySelector('a[href*="/profile/"]')?.getAttribute('href') ||
            '';
          const profileUrl = authorHref
            ? authorHref.startsWith('http')
              ? authorHref
              : `${window.location.origin}${authorHref.startsWith('/') ? '' : '/'}${authorHref}`
            : '';
          const externalUserId = profileUrl
            ? (profileUrl.split('/').filter(Boolean).pop()?.split('?')[0] ?? '')
            : '';
          // 评论锚点：优先平台真实 data 属性，退化为 DOM id（都不存在则不伪造）
          const commentId =
            node.getAttribute('data-comment-id') ||
            node.getAttribute('data-id') ||
            node.id ||
            '';
          out.push({
            nick: nick.slice(0, 30),
            text: text.slice(0, 120),
            profileUrl: profileUrl.slice(0, 300),
            externalUserId: externalUserId.slice(0, 64),
            commentId: commentId.slice(0, 64),
          });
        }
        return { comments: out, title: document.title || '' };
      });
      const url = page.url();
      const contentId =
        url.split('/').filter(Boolean).pop()?.split('?')[0] ?? createId(url);
      for (const c of parsed.comments) {
        items.push({
          platform: 'kuaishou',
          accountId: 'browser-session',
          sourceContent: {
            externalContentId: contentId,
            url,
            contentType: 'video',
            title: parsed.title.slice(0, 120) || '视频详情页',
            rawHash: createId(`kuaishou:${url}`),
          },
          identityHint: {
            nickname: c.nick || undefined,
            externalUserId: c.externalUserId || undefined,
            profileUrl: c.profileUrl || undefined,
          },
          interactionEvents: [
            {
              // P1-6 复核：无平台真实评论 ID 时不合成内容锚点当事件 ID
              externalEventId: c.commentId || undefined,
              type: 'comment',
              text: c.text,
              sourceUrl: url,
              authorExternalId: c.externalUserId || undefined,
              occurredAt: new Date().toISOString(),
            },
          ],
        });
      }
    } catch {
      return [];
    }
    return items;
  }

  /**
   * 小红书：从搜索页真实鼠标点击进入笔记详情（xsec_token 会话内生成）。
   * 直开详情 URL 404（平台反爬）；真实点击（isTrusted=true）可进。
   */
  async openXhsNoteViaSearchClick(
    page: Page,
    contentUrl: string,
    keyword?: string,
  ): Promise<void> {
    const noteId = (contentUrl.split('/').filter(Boolean).pop() || '').split(
      '?',
    )[0];
    // P1-7 复核：不再默认搜索「小红书」——keyword 缺失时明确失败，
    // 禁止用无关关键词定位（否则会把其他笔记的评论归因到用户指定 URL）。
    const searchKeyword = keyword?.trim();
    if (!searchKeyword) {
      throw new BrowserDiscoverError(
        'parse_failed',
        '读小红书评论需提供来源关键词（会话内目标定位用）；请在创建任务时填写关键词或视频链接',
      );
    }
    try {
      await page.goto(
        `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(searchKeyword)}&type=51`,
        { waitUntil: 'domcontentloaded', timeout: 30000 },
      );
      await page.waitForTimeout(4000);
      await page
        .waitForSelector('section.note-item, a[href*="/explore/"]', {
          timeout: 15000,
        })
        .catch(() => undefined);
      // 先滚回顶部：会话复用时可能残留滚动位置（卡片在视口外 → waitFor visible 超时）
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
      await page.waitForTimeout(600);
      // P1-7 复核：目标笔记卡片必须按 noteId 精确匹配——
      // 匹配失败即 page_not_found 失败，禁止回退第一张卡（会把另一篇笔记
      // 的评论归因到用户指定 URL）。
      if (!noteId) {
        throw new BrowserDiscoverError(
          'page_not_found',
          '内容 URL 无法提取笔记 ID，禁止回退其他内容',
        );
      }
      const target = page
        .locator(`a[href*="${noteId}"], section.note-item a[href*="${noteId}"]`)
        .first();
      try {
        await target.waitFor({ state: 'attached', timeout: 5000 });
      } catch {
        throw new BrowserDiscoverError(
          'page_not_found',
          `目标笔记 ${noteId} 不在搜索结果中（关键词「${searchKeyword}」未命中），已中止读取——禁止将其他笔记的评论归因到指定 URL`,
        );
      }
      let card = target;
      try {
        await card.waitFor({ state: 'visible', timeout: 8000 });
      } catch {
        // 视口外：滚动到卡片再试
        await card.scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(800);
      }
      let box = await card.boundingBox().catch(() => null);
      if (!box) {
        // SPA 重渲染后 locator 可能指向旧节点：重新取一次
        await page
          .waitForSelector('section.note-item, a[href*="/explore/"]', {
            timeout: 10000,
          })
          .catch(() => undefined);
        card = page.locator('section.note-item').first();
        box = await card.boundingBox().catch(() => null);
      }
      if (!box) throw new Error('未找到笔记卡片（不可见）');
      // 真实鼠标点击（CDP Input 域，isTrusted=true）
      await page.mouse.click(
        box.x + box.width / 2,
        box.y + Math.min(box.height / 2, 120),
      );
      await page
        .waitForURL(/\/explore\/.*xsec_token/, { timeout: 20000 })
        .catch(() => undefined);
      await page.waitForTimeout(4000);
    } catch (error) {
      // P1-7 复核：结构化错误（page_not_found/parse_failed 等）直接透传，
      // 不吞成 network_error（否则「目标不在结果集」会伪装成网络问题）
      if (error instanceof BrowserDiscoverError) throw error;
      throw new BrowserDiscoverError(
        'network_error',
        `小红书笔记详情打开失败：${(error as Error).message}`,
      );
    }
  }
}
