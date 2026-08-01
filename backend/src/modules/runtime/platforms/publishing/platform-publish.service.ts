import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { LocalBrowserEngine } from '../../../local-engine/local-browser-engine.service';
import {
  type ExecutorCapability,
  type ExecutorContext,
  type ExecutorTask,
  type ExecutorEvidence,
  type RuntimeExecutionResult,
  type TaskExecutor,
} from '../../executor.interface';

class DeadlineExceededError extends Error {}

@Injectable()
export class PlatformPublishService implements TaskExecutor {
  readonly id = 'platform-publish' as const;
  private genericPublishDeadlineMs = 90000;
  private genericPublishAbortDelayMs = 1500;

  constructor(private readonly browser: LocalBrowserEngine) {}

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

    try {
      await this.gotoBestEffort(
        page,
        'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page',
        45000,
      );
      await page.waitForTimeout(1800);
      const login = await this.checkDouyinLogin(page);
      if (!login.ok) {
        const evidence = await this.captureEvidence(
          session.key,
          'douyin-publish-login-required',
        );
        return this.blocked(
          'account_not_logged_in',
          login.message,
          `url=${page.url()}`,
          evidence,
          '请在打开的抖音创作者中心完成登录后重试。',
        );
      }

      await this.uploadDouyinVideo(page, videoPath);

      await this.fillDouyinDescription(page, title, tags);
      await this.waitDouyinVideoUploaded(page);
      await this.setDouyinCoverIfNeeded(
        page,
        payload.coverPaths?.['3:4'] || payload.coverPath,
      );
      if (payload.scheduleTime) {
        await this.setDouyinScheduleTime(page, payload.scheduleTime);
      }

      const publishButton = await this.waitDouyinPublishButton(page);
      await publishButton.click({ timeout: 15000 });
      await this.waitDouyinPublishReadback(page);
      const evidence = await this.captureEvidence(
        session.key,
        'douyin-publish-success',
      );
      const currentUrl = page.url();
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

    try {
      await this.gotoBestEffort(
        page,
        'https://channels.weixin.qq.com/platform/post/create',
        45000,
      );
      await page.waitForTimeout(2200);
      const login = await this.checkWechatChannelLogin(page);
      if (!login.ok) {
        const evidence = await this.captureEvidence(
          session.key,
          'wechat-channel-publish-login-required',
        );
        return this.blocked(
          'account_not_logged_in',
          login.message,
          `url=${page.url()}`,
          evidence,
          '请在打开的视频号后台完成登录后重试。',
        );
      }

      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(videoPath, {
          timeout: 45000,
        });
      await this.fillWechatChannelDescription(page, title, tags);
      await this.fillWechatChannelShortTitle(page, title);
      await this.setWechatChannelCoverIfNeeded(
        page,
        payload.coverPaths?.['4:3'] || payload.coverPath,
      );
      if (payload.scheduleTime) {
        await this.setWechatChannelScheduleTime(page, payload.scheduleTime);
      }
      await this.waitWechatChannelVideoUploaded(page);
      const publishButton = await this.waitWechatChannelPublishButton(page);
      await publishButton.click({ force: true, timeout: 15000 });
      await this.handleWechatChannelPostPublishPrompts(page);
      await this.waitWechatChannelPublishReadback(page);
      const evidence = await this.captureEvidence(
        session.key,
        'wechat-channel-publish-success',
      );
      const currentUrl = page.url();
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
    return this.publishGenericImageText(task, payload, {
      platform: 'xiaohongshu',
      platformName: '小红书',
      accountMissingMessage: '小红书图文发布缺少账号，未上传到平台。',
      materialMissingMessage: '小红书图文发布缺少图片素材，未上传到平台。',
      publishUrl:
        'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image',
      uploadSelector:
        "div[class^='upload-content'] input[class='upload-input'], input[type=file]",
      successUrlPattern:
        /creator\.xiaohongshu\.com\/publish\/success|creator\.xiaohongshu\.com\/publish\/publish.*published=true/,
      publishButtonText: '发布',
      evidencePrefix: 'xiaohongshu-image-text',
      beforeUpload: (page) => this.prepareXiaohongshuImageTextPublish(page),
      fill: (page, title, tags) =>
        this.fillXiaohongshuDescription(page, title, tags),
      loginCheck: (page) =>
        this.checkGenericLogin(page, '小红书创作者中心账号未登录，不能发布。'),
      waitReadback: (page) => this.waitXiaohongshuPublishReadback(page),
    });
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
    return this.publishGenericImageText(task, payload, {
      platform: 'wechat-channel',
      platformName: '视频号',
      accountMissingMessage: '视频号图文发布缺少账号，未上传到平台。',
      materialMissingMessage: '视频号图文发布缺少图片素材，未上传到平台。',
      publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
      uploadSelector: 'input[type="file"][accept*="image"], input[type=file]',
      successUrlPattern: /channels\.weixin\.qq\.com\/platform\/post\/list/,
      publishButtonText: '发表',
      evidencePrefix: 'wechat-channel-image-text',
      fill: (page, title, tags) =>
        this.fillWechatChannelDescription(page, title, tags),
      loginCheck: (page) => this.checkWechatChannelLogin(page),
      afterClick: (page) => this.handleWechatChannelPostPublishPrompts(page),
      waitReadback: (page) => this.waitWechatChannelImageTextReadback(page),
    });
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
    return this.publishGenericImageText(task, payload, {
      platform: 'douyin',
      platformName: '抖音',
      accountMissingMessage: '抖音图文发布缺少账号，未上传到平台。',
      materialMissingMessage: '抖音图文发布缺少图片素材，未上传到平台。',
      publishUrl:
        'https://creator.douyin.com/creator-micro/content/post/picture?enter_from=publish_page',
      uploadSelector:
        'input[type="file"][accept*="image"], input[type="file"][accept*=".png"], input[type="file"][accept*=".jpg"], input[type="file"][accept*=".jpeg"], input[type="file"][accept*=".webp"]',
      successUrlPattern: /creator\.douyin\.com\/creator-micro\/content\/manage/,
      publishButtonText: '发布',
      evidencePrefix: 'douyin-image-text',
      beforeUpload: (page) => this.prepareDouyinImageTextPublish(page),
      beforeClick: (page) => this.configureDouyinImageTextBeforePublish(page),
      afterClick: (page) => this.confirmDouyinContentDeclarationIfNeeded(page),
      fill: (page, title, tags) =>
        this.fillDouyinDescription(page, title, tags),
      loginCheck: (page) => this.checkDouyinLogin(page),
      waitReadback: (page) => this.waitDouyinImageTextReadback(page),
    });
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
    return this.publishGenericImageText(task, payload, {
      platform: 'kuaishou',
      platformName: '快手',
      accountMissingMessage: '快手图文发布缺少账号，未上传到平台。',
      materialMissingMessage: '快手图文发布缺少图片素材，未上传到平台。',
      publishUrl: 'https://cp.kuaishou.com/article/publish/picture',
      uploadSelector: 'input[type=file]',
      successUrlPattern: /cp\.kuaishou\.com\/article\/manage/,
      publishButtonText: '发布',
      evidencePrefix: 'kuaishou-image-text',
      fill: (page, title, tags) =>
        this.fillKuaishouDescription(page, title, tags),
      loginCheck: (page) =>
        this.checkGenericLogin(page, '快手创作者后台账号未登录，不能发布。'),
      afterClick: async (page) => {
        const confirmButton = page.getByText('确认发布').last();
        if (
          (await confirmButton.count().catch(() => 0)) > 0 &&
          (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false))
        ) {
          await confirmButton.click({ timeout: 8000 }).catch(() => undefined);
        }
      },
    });
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
    return this.publishGenericVideo(task, payload, {
      platform: 'xiaohongshu',
      platformName: '小红书',
      accountMissingMessage: '小红书视频发布缺少账号，未上传到平台。',
      materialMissingMessage: '小红书视频发布缺少视频素材，未上传到平台。',
      publishUrl:
        'https://creator.xiaohongshu.com/publish/publish?from=homepage&target=video',
      uploadSelector:
        "div[class^='upload-content'] input[class='upload-input'], input[type=file]",
      successUrlPattern: /creator\.xiaohongshu\.com\/publish\/success/,
      publishButtonText: '发布',
      evidencePrefix: 'xiaohongshu',
      fill: (page, title, tags) =>
        this.fillXiaohongshuDescription(page, title, tags),
      waitUploaded: (page) => this.waitGenericVideoUploaded(page),
      loginCheck: (page) =>
        this.checkGenericLogin(page, '小红书创作者中心账号未登录，不能发布。'),
      waitReadback: (page) => this.waitXiaohongshuPublishReadback(page),
    });
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
    return this.publishGenericVideo(task, payload, {
      platform: 'kuaishou',
      platformName: '快手',
      accountMissingMessage: '快手视频发布缺少账号，未上传到平台。',
      materialMissingMessage: '快手视频发布缺少视频素材，未上传到平台。',
      publishUrl: 'https://cp.kuaishou.com/article/publish/video',
      uploadSelector: 'input[type=file]',
      successUrlPattern: /cp\.kuaishou\.com\/article\/manage\/video/,
      publishButtonText: '发布',
      evidencePrefix: 'kuaishou',
      fill: (page, title, tags) =>
        this.fillKuaishouDescription(page, title, tags),
      waitUploaded: (page) => this.waitGenericVideoUploaded(page),
      loginCheck: (page) =>
        this.checkGenericLogin(page, '快手创作者后台账号未登录，不能发布。'),
      afterClick: async (page) => {
        const confirmButton = page.getByText('确认发布').last();
        if (
          (await confirmButton.count().catch(() => 0)) > 0 &&
          (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false))
        ) {
          await confirmButton.click({ timeout: 8000 }).catch(() => undefined);
        }
      },
    });
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
    return this.publishGenericVideo(task, payload, {
      platform: 'bilibili',
      platformName: 'B站',
      accountMissingMessage: 'B站视频发布缺少账号，未上传到平台。',
      materialMissingMessage: 'B站视频发布缺少视频素材，未上传到平台。',
      publishUrl:
        'https://member.bilibili.com/platform/upload/video/frame?page_from=creative_home_top_upload',
      uploadSelector: 'input[type="file"][accept*=".mp4"], input[type=file]',
      successUrlPattern: /member\.bilibili\.com/,
      publishButtonText: '立即投稿',
      evidencePrefix: 'bilibili',
      fill: (page, title, tags) =>
        this.fillBilibiliForm(
          page,
          payload.biliTitle || title,
          tags,
          payload.biliDesc,
        ),
      waitUploaded: (page) => this.waitBilibiliVideoUploaded(page),
      loginCheck: (page) =>
        this.checkGenericLogin(page, 'B站创作中心账号未登录，不能发布。'),
      waitReadback: (page) => this.waitBilibiliPublishReadback(page),
    });
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
      platform: 'xiaohongshu' | 'kuaishou' | 'bilibili';
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
      const publishButton = await this.waitGenericPublishButton(
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
      platform: 'xiaohongshu' | 'wechat-channel' | 'douyin' | 'kuaishou';
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
          const publishButton = await this.waitGenericPublishButton(
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

  private async fillXiaohongshuDescription(
    page: Page,
    title: string,
    tags: string[],
  ) {
    const cleanTags = this.cleanTags(tags, 10);
    await page
      .locator('input[placeholder*="填写标题"], input[placeholder*="标题"]')
      .first()
      .fill(title.slice(0, 20), { timeout: 5000 })
      .catch(() => undefined);
    await this.fillFirstEditable(
      page,
      [title, ...cleanTags.map((tag) => `#${tag}`)].join(' '),
      '[contenteditable="true"], textarea, div[class*="editor"]',
    );
  }

  private async prepareXiaohongshuImageTextPublish(page: Page) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const normalize = (value: unknown) =>
            String(value || '')
              .replace(/\s+/g, ' ')
              .trim();
          const activeImageTab = Array.from(
            document.querySelectorAll<HTMLElement>('.creator-tab.active'),
          ).some((node) => /上传图文/.test(normalize(node.textContent)));
          const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
          ).map((input) => ({
            accept: normalize(input.getAttribute('accept')).toLowerCase(),
            className: normalize(input.getAttribute('class')),
          }));
          const hasImageInput = inputs.some(
            (input) =>
              /image|\.png|\.jpe?g|\.webp/.test(input.accept) ||
              input.className.includes('upload-input'),
          );
          return {
            ready: activeImageTab && hasImageInput,
            activeImageTab,
            hasImageInput,
            sample: normalize(document.body?.innerText || '').slice(0, 600),
          };
        })
        .catch(() => ({
          ready: false,
          activeImageTab: false,
          hasImageInput: false,
          sample: '',
        }));
      if (state.ready) return;

      const tab = page
        .locator('.creator-tab')
        .filter({ hasText: '上传图文' })
        .filter({ hasNotText: '写长文' })
        .last();
      if ((await tab.count().catch(() => 0)) > 0) {
        await tab.click({ force: true, timeout: 5000 }).catch(() => undefined);
      } else {
        await page
          .getByText('上传图文', { exact: true })
          .last()
          .click({ force: true, timeout: 5000 })
          .catch(() => undefined);
      }
      await page.waitForTimeout(1000);
    }

    throw new Error('小红书图文发布页未切换成功，未找到图片上传入口。');
  }

  private async fillKuaishouDescription(
    page: Page,
    title: string,
    tags: string[],
  ) {
    const cleanTags = this.cleanTags(tags, 6);
    await this.fillFirstEditable(
      page,
      [title, ...cleanTags.map((tag) => `#${tag}`)].join(' '),
      '#work-description-edit, [contenteditable="true"], textarea',
    );
  }

  private async fillBilibiliForm(
    page: Page,
    title: string,
    tags: string[],
    desc?: string,
  ) {
    await page
      .locator(
        'input[placeholder="请输入稿件标题"], input[placeholder*="标题"]',
      )
      .first()
      .fill(title.slice(0, 80), { timeout: 30000 });

    const cleanTags = this.cleanTags(tags, 10);
    if (cleanTags.length) {
      const input = page
        .locator(
          'input[placeholder*="按回车键Enter创建标签"], input[placeholder*="标签"]',
        )
        .first();
      if ((await input.count().catch(() => 0)) > 0) {
        await input.click({ force: true, timeout: 5000 });
        await input.fill('');
        for (const tag of cleanTags) {
          await input.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(120);
        }
      }
    }

    if (desc) {
      await page
        .locator(
          '.ql-editor[contenteditable="true"], .ql-editor, [contenteditable="true"][data-placeholder*="简介"]',
        )
        .first()
        .fill(desc.slice(0, 2000), { timeout: 8000 })
        .catch(() => undefined);
    }
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
          return {
            done:
              /上传成功|上传完成|重新上传|更换图片|添加描述|作品描述|作品简介|发布|发表/.test(
                text,
              ) && !/上传中|正在上传|处理中/.test(text),
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

  private async waitBilibiliVideoUploaded(page: Page) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          return {
            done:
              /上传完成|稿件标题|请输入稿件标题|立即投稿/.test(text) &&
              !/上传中|剩余时间|当前速度|正在上传/.test(text),
            failed: /上传失败|上传出错|格式不支持|文件过大/.test(text),
            sample: text.slice(0, 500),
          };
        })
        .catch(() => ({ done: false, failed: false, sample: '' }));
      if (state.failed) throw new Error(`视频上传失败：${state.sample}`);
      if (state.done) return;
      await page.waitForTimeout(2000);
    }
    throw new Error('B站视频上传等待超时。');
  }

  private async waitBilibiliPublishReadback(page: Page) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          const publishButton = Array.from(
            document.querySelectorAll('span,button'),
          ).some((node) => /立即投稿/.test(node.textContent || ''));
          return {
            success:
              /稿件投递成功|投稿成功|已提交/.test(text) || !publishButton,
            failed: /发布失败|投稿失败|上传失败|审核失败/.test(text),
            sample: text.slice(0, 500),
          };
        })
        .catch(() => ({ success: false, failed: false, sample: '' }));
      if (state.failed) throw new Error(`B站投稿失败：${state.sample}`);
      if (state.success) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }

  private async waitXiaohongshuPublishReadback(page: Page) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (
        /creator\.xiaohongshu\.com\/publish\/success/.test(page.url()) ||
        /creator\.xiaohongshu\.com\/publish\/publish.*published=true/.test(
          page.url(),
        ) ||
        /creator\.xiaohongshu\.com\/.*(?:post|note).*manage/.test(page.url())
      ) {
        await page.waitForTimeout(1200);
        return true;
      }

      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          return {
            success: /发布成功|提交成功|已提交发布|已提交审核|审核中/.test(
              text,
            ),
            platformBlocked:
              /违反社区规范|禁止发笔记|账号限制|账号异常|安全验证|验证码|发布权限|暂不支持发布|操作过于频繁|稍后再试/.test(
                text,
              ),
            failed:
              /发布失败|提交失败|上传失败|内容不符合|请检查内容|格式不支持/.test(
                text,
              ),
            sample: text.slice(-1000),
          };
        })
        .catch(() => ({
          success: false,
          platformBlocked: false,
          failed: false,
          sample: '',
        }));
      if (state.success) return true;
      if (state.platformBlocked) {
        throw new PlatformPublishBlockedError(
          `小红书平台拒绝发布：${state.sample}`,
        );
      }
      if (state.failed) {
        throw new Error(`小红书发布未提交成功：${state.sample}`);
      }
      await page.waitForTimeout(1000);
    }

    const sample = await page
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    throw new Error(`小红书发布后未进入成功页：${sample.slice(-1000)}`);
  }

  private isPlatformPublishBlockedError(error: unknown) {
    return error instanceof PlatformPublishBlockedError;
  }

  private async waitDouyinImageTextReadback(page: Page) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (/creator-micro\/content\/manage/.test(page.url())) {
        await page.waitForTimeout(1500);
        return true;
      }
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          return {
            success:
              /发布成功|提交成功|作品已发布|已提交|发布后管理|作品管理/.test(
                text,
              ),
            failed:
              /发布失败|提交失败|账号状态异常|内容不符合|请选择音乐|请添加位置/.test(
                text,
              ),
            sample: text.slice(0, 800),
          };
        })
        .catch(() => ({ success: false, failed: false, sample: '' }));
      if (state.success) return true;
      if (state.failed) {
        throw new Error(`抖音图文发布未提交成功：${state.sample}`);
      }
      await page.waitForTimeout(1000);
    }
    const sample = await page
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    throw new Error(`抖音图文发布后未进入管理页：${sample.slice(0, 800)}`);
  }

  private async prepareDouyinImageTextPublish(page: Page) {
    const pictureTab = page.getByText('发布图文', { exact: true }).first();
    if ((await pictureTab.count().catch(() => 0)) > 0) {
      await pictureTab
        .click({ force: true, timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200);
    }

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const text = String(
            document.body.innerText || document.body.textContent || '',
          );
          const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
          ).map((input) =>
            String(input.getAttribute('accept') || '').toLowerCase(),
          );
          const hasImageInput = inputs.some((accept) =>
            /image|\.png|\.jpe?g|\.webp|\.gif/.test(accept),
          );
          const stillVideoTab =
            /视频大小和格式|上传视频|直接将视频文件拖入此区域/.test(text) &&
            !/上传图片|添加图片|发布图文/.test(text);
          return {
            ready: hasImageInput && !stillVideoTab,
            inputs,
            sample: text.slice(0, 700),
          };
        })
        .catch(() => ({ ready: false, inputs: [] as string[], sample: '' }));
      if (state.ready) return;

      if ((await pictureTab.count().catch(() => 0)) > 0) {
        await pictureTab
          .click({ force: true, timeout: 5000 })
          .catch(() => undefined);
      }
      await page.waitForTimeout(1000);
    }

    throw new Error('抖音图文发布页未切换成功，未找到图片上传入口。');
  }

  private async configureDouyinImageTextBeforePublish(page: Page) {
    await page.waitForTimeout(800);
    await page
      .evaluate(() => {
        const marker = Array.from(
          document.querySelectorAll<HTMLElement>('*'),
        ).find((node) => /自主声明/.test(node.textContent || ''));
        marker?.scrollIntoView({ block: 'center' });
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);
    await this.selectDouyinDeclarationIfNeeded(page);

    const noSync = page.getByText(/不同时发布|不同步发布/).first();
    if ((await noSync.count().catch(() => 0)) > 0) {
      await noSync.scrollIntoViewIfNeeded().catch(() => undefined);
      await noSync.click({ force: true, timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }

    const publicOption = page.getByText('公开', { exact: true }).first();
    if ((await publicOption.count().catch(() => 0)) > 0) {
      await publicOption
        .click({ force: true, timeout: 5000 })
        .catch(() => undefined);
    }

    await page
      .evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      })
      .catch(() => undefined);
    await page.waitForTimeout(1000);
  }

  private async selectDouyinDeclarationIfNeeded(page: Page) {
    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    if (!/自主声明/.test(bodyText) || !/请选择自主声明/.test(bodyText)) {
      return;
    }

    const declarationTrigger = page.getByText(/请选择自主声明|自主声明/).last();
    if ((await declarationTrigger.count().catch(() => 0)) > 0) {
      await declarationTrigger.scrollIntoViewIfNeeded().catch(() => undefined);
      await declarationTrigger
        .click({ force: true, timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(800);
    }
    await page
      .evaluate(() => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('*'));
        const trigger = nodes.find((node) =>
          /请选择自主声明/.test(node.textContent || ''),
        );
        trigger?.click();
      })
      .catch(() => undefined);
    await page.waitForTimeout(500);

    const options = [
      /无须声明|无需声明|不声明|无声明/,
      /自行拍摄|原创|个人原创|非推广|非营销|普通作品|默认/,
      /其他/,
    ];
    for (const option of options) {
      const candidate = page.getByText(option).last();
      if (
        (await candidate.count().catch(() => 0)) > 0 &&
        (await candidate.isVisible({ timeout: 2000 }).catch(() => false))
      ) {
        await candidate
          .click({ force: true, timeout: 8000 })
          .catch(() => undefined);
        await page.waitForTimeout(800);
        const confirm = page
          .getByRole('button', { name: /确认|确定|完成/ })
          .last();
        if ((await confirm.count().catch(() => 0)) > 0) {
          await confirm
            .click({ force: true, timeout: 5000 })
            .catch(() => undefined);
          await page.waitForTimeout(500);
        }
        return;
      }
    }

    await page.keyboard.press('ArrowDown').catch(() => undefined);
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter').catch(() => undefined);
    await page.waitForTimeout(800);
    const confirm = page.getByRole('button', { name: /确认|确定|完成/ }).last();
    if ((await confirm.count().catch(() => 0)) > 0) {
      await confirm
        .click({ force: true, timeout: 5000 })
        .catch(() => undefined);
      await page.waitForTimeout(500);
    }
  }

  private async confirmDouyinContentDeclarationIfNeeded(page: Page) {
    let confirmedDeclaration = false;
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const bodyText = await page
        .locator('body')
        .innerText({ timeout: 2000 })
        .catch(() => '');
      if (/creator-micro\/content\/manage/.test(page.url())) return;
      if (!/作品内容添加声明|请选择声明类型|内容由AI生成/.test(bodyText)) {
        await page.waitForTimeout(500);
        continue;
      }

      const aiOption = page.getByText(/内容由AI生成/).first();
      if ((await aiOption.count().catch(() => 0)) > 0) {
        await aiOption
          .click({ force: true, timeout: 5000 })
          .catch(() => undefined);
        await page.waitForTimeout(500);
      }

      const confirm = page.getByRole('button', { name: /^确定$/ }).last();
      if ((await confirm.count().catch(() => 0)) > 0) {
        await confirm.click({ force: true, timeout: 8000 });
        await page.waitForTimeout(1000);
        confirmedDeclaration = true;
        break;
      }
      throw new Error('抖音作品内容声明弹窗出现，但没有找到“确定”按钮。');
    }

    if (!confirmedDeclaration) return;
    const publishButton = await this.waitGenericPublishButton(page, '发布');
    await publishButton.click({ force: true, timeout: 15000 });
  }

  private async waitWechatChannelImageTextReadback(page: Page) {
    await this.waitWechatChannelPublishReadback(page);
    return true;
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

  private async checkDouyinLogin(
    page: Page,
  ): Promise<{ ok: boolean; message: string }> {
    const url = page.url().toLowerCase();
    const text = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');
    const loggedOut =
      /login|passport|sso/.test(url) ||
      /扫码登录|手机号登录|验证码登录|密码登录|登录后/.test(text);
    return loggedOut
      ? { ok: false, message: '抖音创作者中心账号未登录，不能发布。' }
      : { ok: true, message: '已登录' };
  }

  private async checkWechatChannelLogin(
    page: Page,
  ): Promise<{ ok: boolean; message: string }> {
    const url = page.url().toLowerCase();
    const text = await page
      .locator('body')
      .innerText({ timeout: 5000 })
      .catch(() => '');
    const loggedOut =
      /login|passport/.test(url) ||
      /扫码登录|微信登录|登录后|请使用微信扫码|二维码|微信小店/.test(text);
    return loggedOut
      ? { ok: false, message: '视频号后台账号未登录，不能发布。' }
      : { ok: true, message: '已登录' };
  }

  private async fillDouyinDescription(
    page: Page,
    title: string,
    tags: string[],
  ) {
    await page
      .locator("div[class^='container-'] input[type=text]")
      .first()
      .fill('')
      .catch(() => undefined);
    const editor = page
      .locator('.zone-container, [contenteditable="true"], textarea')
      .first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await editor.click({ force: true });
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await page.keyboard.press('Delete');
    const cleanTags = tags
      .map((tag) =>
        String(tag || '')
          .trim()
          .replace(/^#/, ''),
      )
      .filter(Boolean)
      .slice(0, 8);
    const body = [title, ...cleanTags.map((tag) => `#${tag}`)]
      .filter(Boolean)
      .join(' ');
    await page.keyboard.insertText(body);
  }

  private async uploadDouyinVideo(page: Page, videoPath: string) {
    const input = page
      .locator(
        'input[type="file"][accept*="video"], input[type="file"][accept*=".mp4"], input[type="file"][accept*=".mov"]',
      )
      .first();
    await input.waitFor({ state: 'attached', timeout: 30000 });
    await input.setInputFiles(videoPath, { timeout: 45000 });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const state = await this.readDouyinUploadState(page);
      if (state.failed) {
        throw new Error(`视频上传失败：${state.sample}`);
      }
      if (state.started) {
        return;
      }
    }
    const state = await this.readDouyinUploadState(page);
    throw new Error(`视频上传没有触发：${state.sample}`);
  }

  private async waitDouyinVideoUploaded(page: Page) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = await this.readDouyinUploadState(page);
      if (state.failed) throw new Error(`视频上传失败：${state.sample}`);
      if (state.done) return;
      await page.waitForTimeout(2000);
    }
    throw new Error('视频上传等待超时。');
  }

  private async readDouyinUploadState(page: Page): Promise<{
    started: boolean;
    done: boolean;
    failed: boolean;
    sample: string;
  }> {
    return page
      .evaluate(() => {
        const text = String(
          document.body.innerText || document.body.textContent || '',
        );
        const hasVideoInput = Array.from(
          document.querySelectorAll('input[type="file"]'),
        ).some((input) => {
          const accept = String(
            input.getAttribute('accept') || '',
          ).toLowerCase();
          return (
            accept.includes('video') ||
            accept.includes('.mp4') ||
            accept.includes('.mov')
          );
        });
        const hasUploadPrompt = /点击上传\s*或直接将视频文件拖入此区域/.test(
          text,
        );
        const failed =
          /上传失败|上传出错|视频出错|格式不支持|重新上传新的视频/.test(text);
        const progressText =
          /重新上传(?!新的视频封面)|上传成功|视频上传完毕|更换视频|上传中|正在上传|处理中|转码中|上传进度|视频预览/.test(
            text,
          );
        const done =
          /重新上传(?!新的视频封面)|上传成功|视频上传完毕|更换视频|发布暂存离开/.test(
            text,
          ) && !hasUploadPrompt;
        const started =
          done || progressText || (hasVideoInput && !hasUploadPrompt);
        return {
          started,
          done,
          failed,
          sample: text.slice(0, 700),
        };
      })
      .catch(() => ({
        started: false,
        done: false,
        failed: false,
        sample: '',
      }));
  }

  private async setDouyinCoverIfNeeded(page: Page, coverPath?: string) {
    if (!coverPath) return;
    try {
      const coverCard = page
        .locator('div')
        .filter({ hasText: /竖封面|横封面|封面/ })
        .first();
      await coverCard.click({ timeout: 8000, force: true });
      await page.waitForTimeout(1200);
      await page
        .locator('input[type=file]')
        .last()
        .setInputFiles(coverPath, { timeout: 15000 });
      await page.waitForTimeout(1200);
      await page
        .getByText('完成', { exact: true })
        .last()
        .click({ timeout: 8000 });
      await page.waitForTimeout(800);
    } catch {
      // 封面不是必填；失败不阻断发布，平台可自动抽帧。
    }
  }

  private async setDouyinScheduleTime(page: Page, scheduleTime: string) {
    const parsed = new Date(scheduleTime);
    if (Number.isNaN(parsed.getTime())) return;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    const target = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    await page
      .locator("[class^='radio']:has-text('定时发布')")
      .last()
      .click({ timeout: 12000, force: true });
    const input = page.locator('.semi-input[placeholder="日期和时间"]').last();
    await input.fill(target, { timeout: 12000 });
    await page.keyboard.press('Enter');
  }

  private async waitDouyinPublishButton(page: Page) {
    const publishButton = page
      .getByRole('button', { name: '发布', exact: true })
      .last();
    await publishButton.waitFor({ state: 'visible', timeout: 60000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const enabled = await publishButton.isEnabled().catch(() => false);
      const className =
        (await publishButton.getAttribute('class').catch(() => '')) || '';
      const ariaDisabled = await publishButton
        .getAttribute('aria-disabled')
        .catch(() => null);
      const disabledAttr = await publishButton
        .getAttribute('disabled')
        .catch(() => null);
      if (
        enabled &&
        ariaDisabled !== 'true' &&
        !disabledAttr &&
        !/disabled/i.test(className)
      ) {
        await publishButton.scrollIntoViewIfNeeded().catch(() => undefined);
        return publishButton;
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('发布按钮长时间不可用。');
  }

  private async waitDouyinPublishReadback(page: Page) {
    await page.waitForURL('**/creator-micro/content/manage**', {
      timeout: 120000,
    });
    await page.waitForTimeout(1500);
  }

  private async fillWechatChannelDescription(
    page: Page,
    title: string,
    tags: string[],
  ) {
    const cleanTags = tags
      .map((tag) =>
        String(tag || '')
          .trim()
          .replace(/^#/, ''),
      )
      .filter(Boolean)
      .slice(0, 8);
    const body = [title, ...cleanTags.map((tag) => `#${tag}`)]
      .filter(Boolean)
      .join(' ');
    const filled = await page
      .evaluate((value) => {
        const roots = [document];
        const wujieRoot = document.querySelector('wujie-app')?.shadowRoot;
        if (wujieRoot) roots.push(wujieRoot as unknown as Document);
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 20 &&
            rect.height > 20 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
          );
        };
        const candidates = roots
          .flatMap((root) =>
            Array.from(
              root.querySelectorAll<HTMLElement>(
                [
                  '.post-desc-box .input-editor[contenteditable]',
                  'div.input-editor[data-placeholder*="添加描述"]',
                  '[data-placeholder*="添加描述"]',
                  '[placeholder*="添加描述"]',
                  '[contenteditable]',
                  'textarea',
                ].join(', '),
              ),
            ),
          )
          .filter((element) => {
            if (!isVisible(element)) return false;
            const placeholder = String(
              element.getAttribute('placeholder') ||
                element.getAttribute('data-placeholder') ||
                '',
            );
            const text = String(element.textContent || '');
            return !/商品链接|批量粘贴|最多30个链接|搜索内容|搜索歌曲|搜索小说/.test(
              `${placeholder}${text}`,
            );
          });
        const descriptionCandidate =
          candidates.find((element) => {
            const rect = element.getBoundingClientRect();
            const labels = roots.flatMap((root) =>
              Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
                (node) => /视频描述|添加描述/.test(node.textContent || ''),
              ),
            );
            return labels.some((label) => {
              const labelRect = label.getBoundingClientRect();
              return (
                Math.abs(labelRect.top - rect.top) < 180 &&
                labelRect.left < rect.left
              );
            });
          }) ?? candidates[0];
        if (!descriptionCandidate) return false;
        descriptionCandidate.focus();
        if (
          descriptionCandidate instanceof HTMLTextAreaElement ||
          descriptionCandidate instanceof HTMLInputElement
        ) {
          descriptionCandidate.value = value;
          descriptionCandidate.dispatchEvent(
            new Event('input', { bubbles: true }),
          );
          descriptionCandidate.dispatchEvent(
            new Event('change', { bubbles: true }),
          );
          return true;
        }
        descriptionCandidate.textContent = '';
        descriptionCandidate.appendChild(document.createTextNode(value));
        descriptionCandidate.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: value,
          }),
        );
        return true;
      }, body)
      .catch(() => false);
    if (filled) {
      await page.waitForTimeout(600);
      return;
    }
    const editor = page
      .locator(
        [
          '.post-desc-box .input-editor[contenteditable]:visible',
          'div.input-editor[data-placeholder*="添加描述"]:visible',
          '[data-placeholder*="添加描述"]:visible',
          '[placeholder*="添加描述"]:visible',
          '[contenteditable]:visible',
          'textarea:visible',
        ].join(', '),
      )
      .first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await editor.click({ force: true, timeout: 10000 });
    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(body);
    await page.waitForTimeout(600);
  }

  private async fillWechatChannelShortTitle(page: Page, title: string) {
    const shortTitle = title
      .replace(/[^\p{L}\p{N}《》“”:+?%°]/gu, '')
      .slice(0, 16)
      .padEnd(6, ' ');
    await page
      .locator(
        [
          'input[placeholder*="填写短标题"]',
          'input[placeholder*="概括视频主要内容"]',
          '.post-short-title-wrap input',
        ].join(', '),
      )
      .first()
      .fill(shortTitle, { timeout: 5000 })
      .catch(() => undefined);
  }

  private async setWechatChannelCoverIfNeeded(page: Page, coverPath?: string) {
    if (!coverPath) return;
    try {
      await page
        .locator('input[type="file"][accept*="image"]')
        .last()
        .setInputFiles(coverPath, { timeout: 15000 });
      await page.waitForTimeout(1000);
      await page
        .getByRole('button', { name: /确认|确定/ })
        .last()
        .click({ timeout: 8000 });
      await page.waitForTimeout(800);
    } catch {
      // 视频号封面可由平台自动生成；封面设置失败不阻断发布。
    }
  }

  private async setWechatChannelScheduleTime(page: Page, scheduleTime: string) {
    const parsed = new Date(scheduleTime);
    if (Number.isNaN(parsed.getTime())) return;
    const hh = String(parsed.getHours()).padStart(2, '0');
    const min = String(parsed.getMinutes()).padStart(2, '0');
    await page
      .locator('label')
      .filter({ hasText: '定时' })
      .last()
      .click({ timeout: 12000 });
    await page
      .locator('input[placeholder="请选择时间"]')
      .first()
      .fill(`${hh}:${min}`, { timeout: 12000 });
    await page.keyboard.press('Enter');
  }

  private async waitWechatChannelVideoUploaded(page: Page) {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const root =
            document.querySelector('wujie-app')?.shadowRoot ?? document;
          const body =
            root instanceof ShadowRoot
              ? root.querySelector('body')
              : document.body;
          const text = String(body?.innerText || body?.textContent || '');
          const publishButton = Array.from(
            root.querySelectorAll('button'),
          ).find((button) => /发表/.test(button.textContent || '')) as
            | HTMLButtonElement
            | undefined;
          const className = String(publishButton?.className || '');
          return {
            done: Boolean(
              publishButton &&
              !publishButton.disabled &&
              !/disabled|weui-desktop-btn_disabled/.test(className),
            ),
            failed: /上传失败|上传出错|格式不支持|视频出错/.test(text),
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

  private async waitWechatChannelPublishButton(page: Page) {
    const publishButton = page
      .getByRole('button', { name: '发表', exact: true })
      .first();
    await publishButton.waitFor({ state: 'visible', timeout: 60000 });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const enabled = await publishButton.isEnabled().catch(() => false);
      const className =
        (await publishButton.getAttribute('class').catch(() => '')) || '';
      if (enabled && !/disabled|weui-desktop-btn_disabled/i.test(className)) {
        await publishButton.scrollIntoViewIfNeeded().catch(() => undefined);
        return publishButton;
      }
      await page.waitForTimeout(1000);
    }
    throw new Error('发表按钮长时间不可用。');
  }

  private async waitWechatChannelPublishReadback(page: Page) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await this.handleWechatChannelPostPublishPrompts(page);
      const state = await this.readWechatChannelPublishState(page);
      if (state.failed) {
        throw new Error(`视频号发布被平台阻断：${state.sample}`);
      }
      if (state.done) {
        await page.waitForTimeout(1500);
        return;
      }
      await page.waitForTimeout(1000);
    }
    const state = await this.readWechatChannelPublishState(page);
    throw new Error(`等待视频号作品列表超时：${state.sample}`);
  }

  private async handleWechatChannelPostPublishPrompts(page: Page) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const state = await this.readWechatChannelPublishState(page);
      if (state.done) return;
      if (!state.originalPromptVisible && !state.adminVerificationVisible)
        return;
      if (state.adminVerificationVisible) {
        throw new Error(`视频号需要管理员扫码验证：${state.sample}`);
      }
      const directPublish = page
        .getByRole('button', { name: '直接发表', exact: true })
        .first();
      if ((await directPublish.count().catch(() => 0)) > 0) {
        const visible = await directPublish
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (visible) {
          await directPublish.click({ force: true, timeout: 8000 });
          await page.waitForTimeout(1200);
          continue;
        }
      }
      await page.waitForTimeout(500);
    }
  }

  private async readWechatChannelPublishState(page: Page): Promise<{
    done: boolean;
    failed: boolean;
    originalPromptVisible: boolean;
    adminVerificationVisible: boolean;
    sample: string;
  }> {
    return page
      .evaluate(() => {
        const root =
          document.querySelector('wujie-app')?.shadowRoot ?? document;
        const body =
          root instanceof ShadowRoot
            ? root.querySelector('body')
            : document.body;
        const text = String(body?.innerText || body?.textContent || '');
        const visible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        };
        const visibleDialogs = Array.from(
          root.querySelectorAll<HTMLElement>('.weui-desktop-dialog__wrp'),
        )
          .filter(visible)
          .map((element) =>
            String(element.textContent || '').replace(/\s+/g, ' '),
          );
        const originalPromptVisible = visibleDialogs.some((dialog) =>
          /声明原创的视频有机会获得广告分成|直接发表|声明原创/.test(dialog),
        );
        const adminVerificationVisible = visibleDialogs.some((dialog) =>
          /管理员本人验证|扫码验证|实名信息核验/.test(dialog),
        );
        const failed =
          /你还不能发表视频|当前登录账号不是视频号|发布失败|上传失败|无法继续发表/.test(
            text,
          ) || adminVerificationVisible;
        const done =
          /\/platform\/post\/list/.test(window.location.href) ||
          (/视频管理/.test(text) &&
            /发表视频/.test(text) &&
            /评论管理|修改描述和封面|可见权限/.test(text));
        return {
          done,
          failed,
          originalPromptVisible,
          adminVerificationVisible,
          sample: text.replace(/\n{3,}/g, '\n\n').slice(0, 1200),
        };
      })
      .catch(() => ({
        done: /\/platform\/post\/list/.test(this.safePageUrl(page)),
        failed: false,
        originalPromptVisible: false,
        adminVerificationVisible: false,
        sample: '',
      }));
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

class PlatformPublishBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformPublishBlockedError';
  }
}
