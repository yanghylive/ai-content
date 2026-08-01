import type { Page } from 'playwright';
import type {
  GenericVideoPublishAdapter,
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  PlatformCapability,
  PlatformPublishAdapter,
  VideoPublishExtras,
  VideoPublishPlan,
} from '../../../platform-registry/platform-adapter.interface';

/**
 * 微博发布 adapter —— 通过 weibo.com 浏览器自动化实现图文+视频发布。
 *
 * 选择器来源：2026 年微博网页版实测 + weibo-publish skill 文档。
 * 微博 API 对个人开发者不友好，浏览器方案更实用。
 */
export class WeiboPublishAdapter
  implements PlatformPublishAdapter, GenericVideoPublishAdapter, ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'weibo',
    displayName: '微博',
    contentKinds: ['article', 'video'],
    executionModes: ['cdp'],
    supportsSchedule: false,
    supportsDraft: false,
    supportsCover: false,
    supportsReadback: false,
    supportsAccountDetection: true,
    riskLevel: 'high',
    adapterVersion: '1.0.0',
  };

  buildVideoPublishPlan(
    _extras: VideoPublishExtras,
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): VideoPublishPlan {
    return {
      platform: 'bilibili', // weibo reuses generic video runner with bilibili-style config shape
      platformName: '微博',
      accountMissingMessage: '微博发布缺少账号，未上传到平台。',
      materialMissingMessage: '微博视频发布缺少视频素材，未上传到平台。',
      publishUrl: 'https://weibo.com',
      uploadSelector: 'input[type="file"][accept*="video"], input[type=file]',
      successUrlPattern: /weibo\.com/,
      publishButtonText: '发布',
      evidencePrefix: 'weibo',
      fill: (page, title, tags) => this.fillWeiboForm(page, title, tags),
      waitUploaded: (page) => this.waitWeiboVideoUploaded(page),
      loginCheck,
    };
  }

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
      platform: 'weibo',
      platformName: '微博',
      accountMissingMessage: '微博发布缺少账号，未提交到平台。',
      materialMissingMessage: '微博图文发布缺少图片素材，未提交到平台。',
      publishUrl: 'https://weibo.com',
      uploadSelector: 'input[type="file"][accept*="image"], input[type=file]',
      successUrlPattern: /weibo\.com/,
      publishButtonText: '发布',
      evidencePrefix: 'weibo',
      fill: (page, title, _tags) => this.fillWeiboForm(page, title, []),
      loginCheck,
      afterClick: (page) => this.waitWeiboPublishReadback(page),
    };
  }

  private async fillWeiboForm(page: Page, title: string, _tags: string[]): Promise<void> {
    const textSelector = 'textarea.W_input, [node-type="textEl"], textarea[placeholder*="有什么新鲜事"]';
    await page.click(textSelector).catch(() => undefined);
    await page.keyboard.type(title, { delay: 30 });
  }

  private async waitWeiboVideoUploaded(page: Page): Promise<void> {
    await page.waitForSelector('.upload-success, .W_loading[style*="hidden"], .pic_stock', {
      timeout: 120_000,
    }).catch(() => undefined);
  }

  private async waitWeiboPublishReadback(page: Page): Promise<void> {
    await page.waitForTimeout(2000);
  }
}
