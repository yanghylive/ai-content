import type { Page } from 'playwright';
import type {
  GenericVideoPublishAdapter,
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  PlatformCapability,
  VideoPublishExtras,
  VideoPublishPlan,
} from '../../../platform-registry/platform-adapter.interface';
import { PlatformPublishBlockedError } from './platform-publish-blocked.error';

export interface XiaohongshuPublishDeps {
  cleanTags: (tags: string[], max: number) => string[];
  fillFirstEditable: (
    page: Page,
    text: string,
    selector: string,
  ) => Promise<void>;
  waitGenericVideoUploaded: (page: Page) => Promise<void>;
}

/**
 * 小红书发布 adapter —— 由 platform-publish.service.ts 的小红书视频/图文 config 与
 * fillXiaohongshuDescription/prepareXiaohongshuImageTextPublish/
 * waitXiaohongshuPublishReadback 原样抽取而来（含选择器），对外零行为漂移。
 * 仅做页面操作，不接触 HTTP/账号/凭证/PublishRecord。
 */
export class XiaohongshuPublishAdapter
  implements GenericVideoPublishAdapter, ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'xiaohongshu',
    displayName: '小红书',
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

  constructor(private readonly deps: XiaohongshuPublishDeps) {}

  buildVideoPublishPlan(
    _extras: VideoPublishExtras,
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): VideoPublishPlan {
    return {
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
      waitUploaded: (page) => this.deps.waitGenericVideoUploaded(page),
      loginCheck,
      waitReadback: (page) => this.waitXiaohongshuPublishReadback(page),
    };
  }

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
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
      loginCheck,
      waitReadback: (page) => this.waitXiaohongshuPublishReadback(page),
    };
  }

  private async fillXiaohongshuDescription(
    page: Page,
    title: string,
    tags: string[],
  ) {
    const cleanTags = this.deps.cleanTags(tags, 10);
    await page
      .locator('input[placeholder*="填写标题"], input[placeholder*="标题"]')
      .first()
      .fill(title.slice(0, 20), { timeout: 5000 })
      .catch(() => undefined);
    await this.deps.fillFirstEditable(
      page,
      [title, ...cleanTags.map((tag) => `#${tag}`)].join(' '),
      '[contenteditable="true"], textarea, div[class*="editor"]',
    );
    // 发布前勾选原创声明（AI 内容合规；有则勾、无则跳过、失败忽略，不阻断发布）
    await this.setXiaohongshuOriginalDeclaration(page);
  }

  /**
   * 勾选小红书"声明原创"（移植自 social-auto-upload xiaohongshu_uploader 的可选增强）：
   * 找到含"声明原创/原创声明"的 label/div 下的 checkbox/radio 并勾选。
   * 安全设计：任何失败/找不到都静默跳过，不影响发布主流程。
   */
  private async setXiaohongshuOriginalDeclaration(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('label, div'),
        );
        const target = nodes.find(
          (node) =>
            /声明原创|原创声明/.test(node.textContent || '') &&
            node.querySelector(
              'input[type="checkbox"], input[type="radio"]',
            ),
        );
        const input = target?.querySelector<HTMLInputElement>(
          'input[type="checkbox"], input[type="radio"]',
        );
        if (input && !input.checked) {
          input.click();
        }
      })
      .catch(() => undefined);
  }

  private async prepareXiaohongshuImageTextPublish(page: Page) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const normalize = (value: string | null) =>
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
}
