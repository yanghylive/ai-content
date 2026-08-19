import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { LocalBrowserEngine } from '../../../local-engine/local-browser-engine.service';
import { PlatformAdapterRegistry } from '../../../platform-registry/platform-adapter.registry';
import type {
  GenericVideoPublishAdapter,
  ImageTextPublishAdapter,
  IndependentVideoPublishAdapter,
  PlatformPublishAdapter,
} from '../../../platform-registry/platform-adapter.interface';
import { PlatformPublishBlockedError } from './platform-publish-blocked.error';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorTask,
  type ExecutorEvidence,
  type RuntimeExecutionResult,
  type TaskExecutor,
} from '../../executor.interface';

class DeadlineExceededError extends Error {}

// 发布适配器依赖回调（注入到 adapter 的共享方法）
interface PublishAdapterDeps {
  [key: string]: unknown;
  gotoBestEffort?: (page: Page, url: string, timeout: number) => Promise<void>;
  waitGenericPublishButton?: (page: Page, text: string) => Promise<unknown>;
  cleanTags?: (tags: string[], max: number) => string[];
  fillFirstEditable?: (
    page: Page,
    text: string,
    selector: string,
  ) => Promise<void>;
  waitGenericVideoUploaded?: (page: Page) => Promise<void>;
  fill?: (page: Page, title: string, tags: string[]) => Promise<void>;
  waitUploaded?: (page: Page) => Promise<void>;
  loginCheck?: (page: Page) => Promise<{ ok: boolean; message: string }>;
}

@Injectable()
export class PlatformPublishService implements TaskExecutor {
  readonly id = 'platform-publish' as const;
  private genericPublishDeadlineMs = 180000;
  private genericPublishAbortDelayMs = 1500;

  constructor(
    private readonly browser: LocalBrowserEngine,
    private readonly registry: PlatformAdapterRegistry,
  ) {}

  /**
   * 按 platform 取 publish adapter（来自 PlatformAdapterRegistry 的 factory）。
   * deps 由 service 端注入共享方法（cleanTags/fillFirstEditable/
   * waitGenericVideoUploaded/gotoBestEffort/waitGenericPublishButton），
   * 保留原 9 个入口的注入语义。
   */
  private newPublishAdapter(
    platform: string,
    deps: PublishAdapterDeps,
  ): PlatformPublishAdapter {
    return this.registry.getPublishAdapterFactory(platform)(deps);
  }

  private requireGenericVideoAdapter(
    adapter: PlatformPublishAdapter,
  ): GenericVideoPublishAdapter {
    if (
      !('buildVideoPublishPlan' in adapter) ||
      typeof adapter.buildVideoPublishPlan !== 'function'
    ) {
      throw new Error(
        `publish adapter 能力不匹配（缺少通用视频计划）: ${adapter.capability.platform}`,
      );
    }
    return adapter as GenericVideoPublishAdapter;
  }

  private requireImageTextAdapter(
    adapter: PlatformPublishAdapter,
  ): ImageTextPublishAdapter {
    if (
      !('buildImageTextPublishPlan' in adapter) ||
      typeof adapter.buildImageTextPublishPlan !== 'function'
    ) {
      throw new Error(
        `publish adapter 能力不匹配（缺少图文计划）: ${adapter.capability.platform}`,
      );
    }
    return adapter as ImageTextPublishAdapter;
  }

  private requireIndependentVideoAdapter<Input>(
    adapter: PlatformPublishAdapter,
  ): IndependentVideoPublishAdapter<Input> {
    if (
      !('buildVideoPublishSteps' in adapter) ||
      typeof adapter.buildVideoPublishSteps !== 'function' ||
      !('checkLogin' in adapter) ||
      typeof adapter.checkLogin !== 'function'
    ) {
      throw new Error(
        `publish adapter 能力不匹配（缺少独立视频步骤）: ${adapter.capability.platform}`,
      );
    }
    return adapter as IndependentVideoPublishAdapter<Input>;
  }

  canHandle(task: ExecutorTask): ExecutorCapability {
    if (
      task.type === 'platform-publish-image-text' ||
      task.type === 'platform-publish-video'
    ) {
      return {
        ok: true,
        priority: 65,
        reason: '3011 Runtime 发布执行器入口',
      };
    }
    return {
      ok: false,
      priority: 0,
      reason: `platform-publish 不处理 ${task.type}`,
    };
  }

  async execute(
    task: ExecutorTask,
    _ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult> {
    const payload = task.payload as {
      platform?: string;
      platformType?: number;
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    };
    const platform =
      payload.platform || `平台 ${payload.platformType ?? ''}`.trim();
    const title = payload.title || '未命名内容';
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'douyin' &&
      payload.platformType === 3
    ) {
      return this.publishDouyinVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'wechat-channel' &&
      payload.platformType === 2
    ) {
      return this.publishWechatChannelVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'xiaohongshu' &&
      payload.platformType === 1
    ) {
      return this.publishXiaohongshuVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'kuaishou' &&
      payload.platformType === 4
    ) {
      return this.publishKuaishouVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'bilibili' &&
      payload.platformType === 5
    ) {
      return this.publishBilibiliVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-video' &&
      task.platform === 'weibo' &&
      payload.platformType === 6
    ) {
      return this.publishWeiboVideo(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'xiaohongshu' &&
      payload.platformType === 1
    ) {
      return this.publishXiaohongshuImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'wechat-channel' &&
      payload.platformType === 2
    ) {
      return this.publishWechatChannelImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'weibo' &&
      payload.platformType === 6
    ) {
      return this.publishWeiboImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'zhihu' &&
      payload.platformType === 7
    ) {
      return this.publishZhihuImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'toutiao' &&
      payload.platformType === 8
    ) {
      return this.publishToutiaoImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'douyin' &&
      payload.platformType === 3
    ) {
      return this.publishDouyinImageText(task, payload);
    }
    if (
      task.type === 'platform-publish-image-text' &&
      task.platform === 'kuaishou' &&
      payload.platformType === 4
    ) {
      return this.publishKuaishouImageText(task, payload);
    }
    return {
      ok: false,
      status: 'blocked',
      reasonCode: 'not_integrated',
      userMessage: `${platform}「${title}」真实发布执行器尚未迁入 3011 Runtime，未上传到平台。`,
      technicalMessage:
        '旧 5409 Python uploader 已从运行链路下线；需要把对应平台 uploader 迁入 Runtime 后再开放真实发布。',
      runtime: {
        mode: 'local-runtime',
        executor: 'platform-publish',
        engineUrl: 'internal://runtime/platform-publish',
      },
      evidence: [
        {
          type: 'text',
          label: 'publish-not-integrated',
          value: JSON.stringify({
            platform,
            platformType: payload.platformType,
            accountId: payload.accountId ?? task.accountId,
            materialCount: payload.materialFiles?.length ?? 0,
          }),
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- 实现 TaskExecutor 接口要求 async 签名
  async isHealthy() {
    return {
      ok: true,
      details:
        '3011 Runtime 发布执行器已接管发布入口；抖音/视频号/小红书/快手图文与视频、B站视频支持真实执行；其它未迁入能力返回 not_integrated。',
    };
  }

  private async publishDouyinVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const accountId = payload.accountId ?? task.accountId;
    if (accountId == null || accountId === '') {
      return this.blocked(
        'account_not_logged_in',
        '抖音视频发布缺少账号，未上传到平台。',
        'platform-publish-video/douyin 缺 accountId',
      );
    }
    const videoPath = payload.materialFiles?.[0];
    if (!videoPath) {
      return this.blocked(
        'target_not_found',
        '抖音视频发布缺少视频素材，未上传到平台。',
        `payload=${JSON.stringify(payload)}`,
      );
    }

    const session = await this.browser.getOrCreateSession({
      platform: 'douyin',
      accountId,
    });
    const page = session.page;
    const title = (payload.title || '未命名内容').trim();
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const adapter = this.requireIndependentVideoAdapter(
      this.newPublishAdapter('douyin', {
        gotoBestEffort: (p, url, timeout) =>
          this.gotoBestEffort(p, url, timeout),
        waitGenericPublishButton: (p, text) =>
          this.waitGenericPublishButton(p, text),
      }),
    );
    const steps = adapter.buildVideoPublishSteps();

    try {
      await this.gotoBestEffort(page, steps.publishUrl, 45000);
      await page.waitForTimeout(1800);
      const login = await adapter.checkLogin(page);
      if (!login.ok) {
        const evidence = await this.captureEvidence(
          session.key,
          steps.loginRequiredEvidence,
        );
        return this.blocked(
          'account_not_logged_in',
          login.message,
          `url=${page.url()}`,
          evidence,
          '请在打开的抖音创作者中心完成登录后重试。',
        );
      }

      const { currentUrl } = await steps.run(page, {
        title,
        tags,
        videoPath,
        coverPath: payload.coverPaths?.['3:4'] || payload.coverPath,
        scheduleTime: payload.scheduleTime,
      });
      const evidence = await this.captureEvidence(
        session.key,
        steps.successEvidence,
      );
      return {
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: `抖音「${title}」已提交发布，并进入发布后管理页。`,
        technicalMessage: `url=${currentUrl}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'platform-publish',
          engineUrl: 'internal://runtime/platform-publish',
        },
        evidence: [
          ...evidence,
          {
            type: 'text',
            label: 'publish-readback',
            value: JSON.stringify({
              platform: 'douyin',
              accountId,
              title,
              currentUrl,
              material: videoPath,
            }),
            createdAt: new Date().toISOString(),
          },
        ],
        readback: {
          expectedText: title,
          actualText: currentUrl,
          matched: true,
        },
      };
    } catch (error) {
      const evidence = await this.captureEvidence(
        session.key,
        'douyin-publish-failed',
      );
      const message = error instanceof Error ? error.message : String(error);
      return this.blocked(
        'send_failed',
        `抖音「${title}」发布失败：${message}`,
        `url=${page.url()}`,
        evidence,
        '检查视频素材、账号登录态、平台弹窗/验证码和页面结构后重试。',
      );
    }
  }

  private async publishWechatChannelVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const accountId = payload.accountId ?? task.accountId;
    if (accountId == null || accountId === '') {
      return this.blocked(
        'account_not_logged_in',
        '视频号视频发布缺少账号，未上传到平台。',
        'platform-publish-video/wechat-channel 缺 accountId',
      );
    }
    const videoPath = payload.materialFiles?.[0];
    if (!videoPath) {
      return this.blocked(
        'target_not_found',
        '视频号视频发布缺少视频素材，未上传到平台。',
        `payload=${JSON.stringify(payload)}`,
      );
    }

    const session = await this.browser.getOrCreateSession({
      platform: 'wechat-channel',
      accountId,
    });
    const page = session.page;
    const title = (payload.title || '未命名内容').trim();
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    const adapter = this.requireIndependentVideoAdapter(
      this.newPublishAdapter('wechat-channel', {}),
    );
    const steps = adapter.buildVideoPublishSteps();

    try {
      await this.gotoBestEffort(page, steps.publishUrl, 45000);
      await page.waitForTimeout(2200);
      const login = await adapter.checkLogin(page);
      if (!login.ok) {
        const evidence = await this.captureEvidence(
          session.key,
          steps.loginRequiredEvidence,
        );
        return this.blocked(
          'account_not_logged_in',
          login.message,
          `url=${page.url()}`,
          evidence,
          '请在打开的视频号后台完成登录后重试。',
        );
      }

      const { currentUrl } = await steps.run(page, {
        title,
        tags,
        videoPath,
        coverPath: payload.coverPaths?.['4:3'] || payload.coverPath,
        scheduleTime: payload.scheduleTime,
      });
      const evidence = await this.captureEvidence(
        session.key,
        steps.successEvidence,
      );
      return {
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: `视频号「${title}」已提交发布，并进入作品列表。`,
        technicalMessage: `url=${currentUrl}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'platform-publish',
          engineUrl: 'internal://runtime/platform-publish',
        },
        evidence: [
          ...evidence,
          {
            type: 'text',
            label: 'publish-readback',
            value: JSON.stringify({
              platform: 'wechat-channel',
              accountId,
              title,
              currentUrl,
              material: videoPath,
            }),
            createdAt: new Date().toISOString(),
          },
        ],
        readback: {
          expectedText: title,
          actualText: currentUrl,
          matched: true,
        },
      };
    } catch (error) {
      const evidence = await this.captureEvidence(
        session.key,
        'wechat-channel-publish-failed',
      );
      const message = error instanceof Error ? error.message : String(error);
      return this.blocked(
        'send_failed',
        `视频号「${title}」发布失败：${message}`,
        `url=${page.url()}`,
        evidence,
        '检查视频素材、账号登录态、平台弹窗/验证码和页面结构后重试。',
      );
    }
  }

  private async gotoBestEffort(page: Page, url: string, timeout: number) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
      const currentUrl = page.url();
      if (currentUrl && currentUrl !== 'about:blank') return;
      throw error;
    }
  }

  private async publishXiaohongshuImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('xiaohongshu', {
        cleanTags: (tags, max) => this.cleanTags(tags, max),
        fillFirstEditable: (page, text, selector) =>
          this.fillFirstEditable(page, text, selector),
        waitGenericVideoUploaded: (page) => this.waitGenericVideoUploaded(page),
      }),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.checkGenericLogin(page, '小红书创作者中心账号未登录，不能发布。'),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishWechatChannelImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('wechat-channel', {}),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.requireIndependentVideoAdapter(adapter).checkLogin(page),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishDouyinImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('douyin', {
        gotoBestEffort: (p, url, timeout) =>
          this.gotoBestEffort(p, url, timeout),
        waitGenericPublishButton: (p, text) =>
          this.waitGenericPublishButton(p, text),
      }),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.requireIndependentVideoAdapter(adapter).checkLogin(page),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishKuaishouImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('kuaishou', {}),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.checkGenericLogin(page, '快手创作者后台账号未登录，不能发布。'),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishWeiboImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('weibo', {}),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.checkGenericLogin(page, '微博账号未登录，不能发布。'),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishZhihuImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('zhihu', {}),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.checkGenericLogin(page, '知乎账号未登录，不能发布。'),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishToutiaoImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireImageTextAdapter(
      this.newPublishAdapter('toutiao', {}),
    );
    const plan = adapter.buildImageTextPublishPlan((page) =>
      this.checkGenericLogin(page, '头条账号未登录，不能发布。'),
    );
    return this.publishGenericImageText(task, payload, plan);
  }

  private async publishXiaohongshuVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireGenericVideoAdapter(
      this.newPublishAdapter('xiaohongshu', {
        cleanTags: (tags, max) => this.cleanTags(tags, max),
        fillFirstEditable: (page, text, selector) =>
          this.fillFirstEditable(page, text, selector),
        waitGenericVideoUploaded: (page) => this.waitGenericVideoUploaded(page),
      }),
    );
    const plan = adapter.buildVideoPublishPlan({}, (page) =>
      this.checkGenericLogin(page, '小红书创作者中心账号未登录，不能发布。'),
    );
    return this.publishGenericVideo(task, payload, plan);
  }

  private async publishKuaishouVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireGenericVideoAdapter(
      this.newPublishAdapter('kuaishou', {}),
    );
    const plan = adapter.buildVideoPublishPlan({}, (page) =>
      this.checkGenericLogin(page, '快手创作者后台账号未登录，不能发布。'),
    );
    return this.publishGenericVideo(task, payload, plan);
  }

  private async publishBilibiliVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
      biliDesc?: string;
      biliTitle?: string;
      biliType?: string;
      biliPartition?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireGenericVideoAdapter(
      this.newPublishAdapter('bilibili', {}),
    );
    const plan = adapter.buildVideoPublishPlan(payload, (page) =>
      this.checkGenericLogin(page, 'B站创作中心账号未登录，不能发布。'),
    );
    return this.publishGenericVideo(task, payload, plan);
  }

  private async publishWeiboVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
  ): Promise<RuntimeExecutionResult> {
    const adapter = this.requireGenericVideoAdapter(
      this.newPublishAdapter('weibo', {}),
    );
    const plan = adapter.buildVideoPublishPlan(payload, (page) =>
      this.checkGenericLogin(page, '微博账号未登录，不能发布。'),
    );
    return this.publishGenericVideo(task, payload, plan);
  }

  private async publishGenericVideo(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
      coverPath?: string;
      coverPaths?: Record<string, string>;
      scheduleTime?: string;
    },
    config: {
      platform: 'xiaohongshu' | 'kuaishou' | 'bilibili' | 'weibo';
      platformName: string;
      accountMissingMessage: string;
      materialMissingMessage: string;
      publishUrl: string;
      uploadSelector: string;
      successUrlPattern: RegExp;
      publishButtonText: string;
      evidencePrefix: string;
      fill: (page: Page, title: string, tags: string[]) => Promise<void>;
      waitUploaded: (page: Page) => Promise<void>;
      loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>;
      afterClick?: (page: Page) => Promise<void>;
      waitReadback?: (page: Page) => Promise<boolean>;
      /** §6b 平台专属发布按钮评分定位（如小红书红底评分），优先于通用文本查找 */
      locatePublishButton?: (
        page: Page,
        text: string,
      ) => Promise<{ click: (options?: object) => Promise<void> }>;
    },
  ): Promise<RuntimeExecutionResult> {
    const accountId = payload.accountId ?? task.accountId;
    if (accountId == null || accountId === '') {
      return this.blocked(
        'account_not_logged_in',
        config.accountMissingMessage,
        `platform-publish-video/${config.platform} 缺 accountId`,
      );
    }
    const videoPath = payload.materialFiles?.[0];
    if (!videoPath) {
      return this.blocked(
        'target_not_found',
        config.materialMissingMessage,
        `payload=${JSON.stringify(payload)}`,
      );
    }

    const session = await this.browser.getOrCreateSession({
      platform: config.platform,
      accountId,
    });
    const page = session.page;
    const title = (payload.title || '未命名内容').trim();
    const tags = Array.isArray(payload.tags) ? payload.tags : [];

    try {
      await this.gotoBestEffort(page, config.publishUrl, 60000);
      await page.waitForTimeout(1600);
      const login = await config.loginCheck(page);
      if (!login.ok) {
        const evidence = await this.captureEvidence(
          session.key,
          `${config.evidencePrefix}-publish-login-required`,
        );
        return this.blocked(
          'account_not_logged_in',
          login.message,
          `url=${page.url()}`,
          evidence,
          `请在打开的${config.platformName}后台完成登录后重试。`,
        );
      }

      await page
        .locator(config.uploadSelector)
        .first()
        .setInputFiles(videoPath, {
          timeout: 60000,
        });
      await config.waitUploaded(page);
      await config.fill(page, title, tags);
      const publishButton = config.locatePublishButton
        ? await config.locatePublishButton(page, config.publishButtonText)
        : await this.waitGenericPublishButton(page, config.publishButtonText);
      await publishButton.click({ force: true, timeout: 15000 });
      await config.afterClick?.(page);
      let readbackMatched = false;
      if (config.waitReadback) {
        const ok = await config.waitReadback(page);
        if (!ok) throw new Error('点击发布后未确认平台提交成功。');
        readbackMatched = true;
      } else {
        await page.waitForURL(
          (url) => config.successUrlPattern.test(url.href),
          {
            timeout: 120000,
          },
        );
        readbackMatched = config.successUrlPattern.test(page.url());
      }
      await page.waitForTimeout(1200);
      const evidence = await this.captureEvidence(
        session.key,
        `${config.evidencePrefix}-publish-success`,
      );
      const currentUrl = page.url();
      return {
        ok: true,
        status: 'success',
        reasonCode: 'success',
        userMessage: `${config.platformName}「${title}」已提交发布，并进入发布成功/管理页。`,
        technicalMessage: `url=${currentUrl}`,
        runtime: {
          mode: 'local-runtime',
          executor: 'platform-publish',
          engineUrl: 'internal://runtime/platform-publish',
        },
        evidence: [
          ...evidence,
          {
            type: 'text',
            label: 'publish-readback',
            value: JSON.stringify({
              platform: config.platform,
              accountId,
              title,
              currentUrl,
              material: videoPath,
            }),
            createdAt: new Date().toISOString(),
          },
        ],
        readback: {
          expectedText: title,
          actualText: currentUrl,
          matched: readbackMatched,
        },
      };
    } catch (error) {
      const evidence = await this.captureEvidence(
        session.key,
        `${config.evidencePrefix}-publish-failed`,
      );
      const message = error instanceof Error ? error.message : String(error);
      if (this.isPlatformPublishBlockedError(error)) {
        return this.blocked(
          'permission_missing',
          `${config.platformName}「${title}」被平台拒绝发布：${message}`,
          `url=${page.url()}`,
          evidence,
          '请处理平台账号权限、社区规范风控或验证码后重试。',
        );
      }
      return this.blocked(
        'send_failed',
        `${config.platformName}「${title}」发布失败：${message}`,
        `url=${page.url()}`,
        evidence,
        '检查视频素材、账号登录态、平台弹窗/验证码和页面结构后重试。',
      );
    }
  }

  private async publishGenericImageText(
    task: ExecutorTask,
    payload: {
      title?: string;
      accountId?: string;
      materialFiles?: string[];
      tags?: string[];
    },
    config: {
      platform:
        | 'xiaohongshu'
        | 'wechat-channel'
        | 'wechat-official'
        | 'douyin'
        | 'kuaishou'
        | 'weibo'
        | 'zhihu'
        | 'toutiao';
      platformName: string;
      accountMissingMessage: string;
      materialMissingMessage: string;
      publishUrl: string;
      uploadSelector: string;
      successUrlPattern: RegExp;
      publishButtonText: string;
      evidencePrefix: string;
      beforeUpload?: (page: Page) => Promise<void>;
      beforeClick?: (page: Page) => Promise<void>;
      fill: (page: Page, title: string, tags: string[]) => Promise<void>;
      loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>;
      afterClick?: (page: Page) => Promise<void>;
      waitReadback?: (page: Page) => Promise<boolean>;
      /** §6b 平台专属发布按钮评分定位（如小红书红底评分），优先于通用文本查找 */
      locatePublishButton?: (
        page: Page,
        text: string,
      ) => Promise<{ click: (options?: object) => Promise<void> }>;
    },
  ): Promise<RuntimeExecutionResult> {
    const accountId = payload.accountId ?? task.accountId;
    if (accountId == null || accountId === '') {
      return this.blocked(
        'account_not_logged_in',
        config.accountMissingMessage,
        `platform-publish-image-text/${config.platform} 缺 accountId`,
      );
    }
    const imagePaths = (payload.materialFiles ?? []).filter(Boolean);
    if (!imagePaths.length) {
      return this.blocked(
        'target_not_found',
        config.materialMissingMessage,
        `payload=${JSON.stringify(payload)}`,
      );
    }

    const session = await this.browser.getOrCreateSession({
      platform: config.platform,
      accountId,
    });
    const page = session.page;
    const title = (payload.title || '未命名内容').trim();
    const tags = Array.isArray(payload.tags) ? payload.tags : [];

    try {
      return await this.withDeadline(
        (async () => {
          await this.gotoBestEffort(page, config.publishUrl, 60000);
          await page.waitForTimeout(1600);
          const login = await config.loginCheck(page);
          if (!login.ok) {
            const evidence = await this.captureEvidence(
              session.key,
              `${config.evidencePrefix}-publish-login-required`,
            );
            return this.blocked(
              'account_not_logged_in',
              login.message,
              `url=${page.url()}`,
              evidence,
              `请在打开的${config.platformName}后台完成登录后重试。`,
            );
          }

          await config.beforeUpload?.(page);
          await page
            .locator(config.uploadSelector)
            .first()
            .setInputFiles(imagePaths, {
              timeout: 60000,
            });
          await this.waitGenericImagesReady(page);
          await config.fill(page, title, tags);
          await config.beforeClick?.(page);
          const publishButton = config.locatePublishButton
            ? await config.locatePublishButton(page, config.publishButtonText)
            : await this.waitGenericPublishButton(
                page,
                config.publishButtonText,
              );
          await publishButton.click({ force: true, timeout: 15000 });
          await config.afterClick?.(page);
          let readbackMatched = false;
          if (config.waitReadback) {
            const ok = await config.waitReadback(page);
            if (!ok) throw new Error('点击发布后未确认平台提交成功。');
            readbackMatched = true;
          } else {
            await page.waitForURL(
              (url) => config.successUrlPattern.test(url.href),
              {
                timeout: 120000,
              },
            );
            readbackMatched = config.successUrlPattern.test(page.url());
          }
          await page.waitForTimeout(1200);
          const evidence = await this.captureEvidence(
            session.key,
            `${config.evidencePrefix}-publish-success`,
          );
          const currentUrl = page.url();
          return {
            ok: true,
            status: 'success',
            reasonCode: 'success',
            userMessage: `${config.platformName}「${title}」已提交图文发布，并完成页面回读。`,
            technicalMessage: `url=${currentUrl}`,
            runtime: {
              mode: 'local-runtime',
              executor: 'platform-publish',
              engineUrl: 'internal://runtime/platform-publish',
            },
            evidence: [
              ...evidence,
              {
                type: 'text',
                label: 'publish-readback',
                value: JSON.stringify({
                  platform: config.platform,
                  accountId,
                  title,
                  currentUrl,
                  materials: imagePaths,
                }),
                createdAt: new Date().toISOString(),
              },
            ],
            readback: {
              expectedText: title,
              actualText: currentUrl,
              matched: readbackMatched,
            },
          };
        })(),
        this.genericPublishDeadlineMs,
        `${config.platformName}「${title}」图文发布超过 ${Math.ceil(this.genericPublishDeadlineMs / 1000)} 秒未返回平台回执。`,
        () => this.browser.closeSession(session.key),
        this.genericPublishAbortDelayMs,
      );
    } catch (error) {
      const evidence = await this.captureEvidence(
        session.key,
        `${config.evidencePrefix}-publish-failed`,
      );
      const deadlineEvidence =
        error instanceof DeadlineExceededError
          ? [
              {
                type: 'text' as const,
                label: 'publish-deadline-aborted',
                value: JSON.stringify({
                  sessionKey: session.key,
                  platform: config.platform,
                  accountId,
                  title,
                  deadlineMs: this.genericPublishDeadlineMs,
                  currentUrl: this.safePageUrl(page),
                }),
                createdAt: new Date().toISOString(),
              },
            ]
          : [];
      const message = error instanceof Error ? error.message : String(error);
      if (this.isPlatformPublishBlockedError(error)) {
        return this.blocked(
          'permission_missing',
          `${config.platformName}「${title}」被平台拒绝发布：${message}`,
          `url=${page.url()}`,
          [...evidence, ...deadlineEvidence],
          '请处理平台账号权限、社区规范风控或验证码后重试。',
        );
      }
      return this.blocked(
        'send_failed',
        `${config.platformName}「${title}」图文发布失败：${message}`,
        `url=${page.url()}`,
        [...evidence, ...deadlineEvidence],
        '检查图片素材、账号登录态、平台弹窗/验证码和页面结构后重试。',
      );
    }
  }

  private async checkGenericLogin(
    page: Page,
    message: string,
  ): Promise<{ ok: boolean; message: string }> {
    const url = page.url().toLowerCase();
    const text = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');
    const loggedOut =
      /login|signin|passport|sso/.test(url) ||
      /扫码登录|手机号登录|验证码登录|密码登录|账号登录|登录后|请登录|立即登录/.test(
        text,
      );
    return loggedOut ? { ok: false, message } : { ok: true, message: '已登录' };
  }

  private cleanTags(tags: string[], max: number) {
    return tags
      .map((tag) =>
        String(tag || '')
          .trim()
          .replace(/^#/, ''),
      )
      .filter(Boolean)
      .slice(0, max);
  }

  private async fillFirstEditable(page: Page, text: string, selector: string) {
    const editor = page.locator(selector).first();
    await editor.waitFor({ state: 'visible', timeout: 30000 });
    await editor.click({ force: true, timeout: 10000 });
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(text);
    await page.waitForTimeout(500);
  }

  private async waitGenericVideoUploaded(page: Page) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          return {
            done:
              /上传成功|上传完成|重新上传|更换视频|视频发布|作品描述|作品简介|发布/.test(
                text,
              ) && !/上传中|剩余时间|正在上传|处理中/.test(text),
            failed: /上传失败|上传出错|视频出错|格式不支持|文件过大/.test(text),
            sample: text.slice(0, 500),
          };
        })
        .catch(() => ({ done: false, failed: false, sample: '' }));
      if (state.failed) throw new Error(`视频上传失败：${state.sample}`);
      if (state.done) return;
      await page.waitForTimeout(2000);
    }
    throw new Error('视频上传等待超时。');
  }

  private async waitGenericImagesReady(page: Page) {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          const pendingCountMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*取消上传/);
          const hasPendingCount = pendingCountMatch
            ? Number(pendingCountMatch[1]) < Number(pendingCountMatch[2])
            : false;
          const hasPendingPercent = Array.from(
            text.matchAll(/(?:^|\s)(\d{1,3})%(?:\s|$)/g),
          ).some((match) => Number(match[1]) < 100);
          const uploading =
            hasPendingCount ||
            hasPendingPercent ||
            /上传中|正在上传|处理中|取消上传/.test(text);
          return {
            done:
              /上传成功|上传完成|重新上传|更换图片|添加描述|作品描述|作品简介|发布|发表/.test(
                text,
              ) && !uploading,
            failed: /上传失败|上传出错|格式不支持|文件过大|图片出错/.test(text),
            sample: text.slice(0, 500),
          };
        })
        .catch(() => ({ done: false, failed: false, sample: '' }));
      if (state.failed) throw new Error(`图片上传失败：${state.sample}`);
      if (state.done) return;
      await page.waitForTimeout(1500);
    }
    throw new Error('图片上传等待超时。');
  }

  private isPlatformPublishBlockedError(error: unknown) {
    return error instanceof PlatformPublishBlockedError;
  }

  private async waitGenericPublishButton(page: Page, text: string) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await page
        .evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        })
        .catch(() => undefined);
      await page.waitForTimeout(500);

      const customPublishControl = page
        .locator(
          `xhs-publish-btn[submit-text="${text}"][submit-disabled="false"]`,
        )
        .last();
      if ((await customPublishControl.count().catch(() => 0)) > 0) {
        const visible = await customPublishControl
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (visible) {
          await customPublishControl
            .scrollIntoViewIfNeeded()
            .catch(() => undefined);
          const box = await customPublishControl
            .boundingBox()
            .catch(() => null);
          if (box) {
            return {
              click: async () => {
                await page.mouse.click(
                  box.x + box.width * 0.62,
                  box.y + box.height * 0.55,
                );
              },
            };
          }
        }
      }

      const candidates = [
        page.getByRole('button', { name: new RegExp(`^${text}$`) }).last(),
        page.locator(`button:has-text("${text}")`).last(),
        page.locator(`[role="button"]:has-text("${text}")`).last(),
      ];
      for (const candidate of candidates) {
        if ((await candidate.count().catch(() => 0)) === 0) continue;
        const label = (
          await candidate.innerText({ timeout: 1000 }).catch(() => '')
        ).trim();
        if (label && label !== text) continue;
        const enabled = await candidate.isEnabled().catch(() => false);
        const className =
          (await candidate.getAttribute('class').catch(() => '')) || '';
        const ariaDisabled = await candidate
          .getAttribute('aria-disabled')
          .catch(() => null);
        const disabledAttr = await candidate
          .getAttribute('disabled')
          .catch(() => null);
        if (
          enabled &&
          ariaDisabled !== 'true' &&
          !disabledAttr &&
          !/disabled|disable/i.test(className)
        ) {
          await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
          return candidate;
        }
      }
      await page.waitForTimeout(1000);
    }

    const sample = await page
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    throw new Error(`${text}按钮长时间不可用。当前页面：${sample.slice(-800)}`);
  }

  private async captureEvidence(
    sessionKey: string,
    label: string,
  ): Promise<ExecutorEvidence[]> {
    try {
      const result = await this.withDeadline(
        this.browser.captureEvidence({ sessionKey, label }),
        8000,
        `截图证据采集超时：${label}`,
      );
      return [
        {
          type: 'screenshot',
          label,
          path: result.path,
          value: result.url,
          createdAt: new Date().toISOString(),
        },
      ];
    } catch {
      return [];
    }
  }

  private async withDeadline<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
    onTimeout?: () => Promise<unknown>,
    onTimeoutDelayMs = 0,
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new DeadlineExceededError(message));
        if (onTimeout) {
          setTimeout(() => {
            void onTimeout().catch(() => undefined);
          }, onTimeoutDelayMs);
        }
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private safePageUrl(page: Page) {
    try {
      return page.url();
    } catch {
      return '';
    }
  }

  private blocked(
    reasonCode: RuntimeExecutionResult['reasonCode'],
    userMessage: string,
    technicalMessage?: string,
    evidence: ExecutorEvidence[] = [],
    nextAction?: string,
  ): RuntimeExecutionResult {
    return {
      ok: false,
      status: 'blocked',
      reasonCode,
      userMessage,
      technicalMessage: [
        technicalMessage,
        nextAction ? `nextAction=${nextAction}` : '',
      ]
        .filter(Boolean)
        .join(' | '),
      runtime: {
        mode: 'local-runtime',
        executor: 'platform-publish',
        engineUrl: 'internal://runtime/platform-publish',
      },
      evidence,
    };
  }
}
