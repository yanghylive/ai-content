import type { Page } from 'playwright';
import type {
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  PlatformCapability,
  PlatformPublishAdapter,
} from '../../../platform-registry/platform-adapter.interface';

/**
 * 知乎专栏发布 adapter —— 通过 zhuanlan.zhihu.com/write 浏览器自动化实现文章发布。
 *
 * 知乎编辑器基于 Draft.js，不能直接赋值 innerHTML，必须用 execCommand('insertText')。
 * 选择器来源：2026 年知乎网页版实测 + zhihu-post-skill 文档。
 */
export class ZhihuPublishAdapter
  implements PlatformPublishAdapter, ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'zhihu',
    displayName: '知乎',
    contentKinds: ['article'],
    executionModes: ['cdp'],
    supportsSchedule: false,
    supportsDraft: false,
    supportsCover: false,
    supportsReadback: true,
    supportsAccountDetection: true,
    riskLevel: 'high',
    adapterVersion: '1.0.0',
  };

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
      platform: 'zhihu',
      platformName: '知乎',
      accountMissingMessage: '知乎发布缺少账号，未提交到平台。',
      materialMissingMessage: '知乎发布缺少文章内容，未提交到平台。',
      publishUrl: 'https://zhuanlan.zhihu.com/write',
      uploadSelector: 'input[type="file"][accept*="image"], input[type=file]',
      successUrlPattern: /zhuanlan\.zhihu\.com\/p\//,
      publishButtonText: '发布文章',
      evidencePrefix: 'zhihu',
      loginCheck,
      fill: (page, title, _tags) => this.fillZhihuForm(page, title),
      afterClick: (page) => this.waitZhihuPublishReadback(page),
    };
  }

  private async fillZhihuForm(page: Page, title: string): Promise<void> {
    // 填标题
    const titleSelector = 'textarea[placeholder], input[placeholder*="标题"]';
    await page.fill(titleSelector, title).catch(async () => {
      await page.click(titleSelector).catch(() => undefined);
      await page.keyboard.type(title, { delay: 30 });
    });

    // 填正文 —— Draft.js 必须用 execCommand
    await page
      .evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
        const el = document.querySelector(
          '.notranslate.public-DraftEditor-content[contenteditable="true"], [contenteditable="true"][data-contents]',
        ) as HTMLElement | null;
        if (el) {
          el.focus();
          document.execCommand('selectAll');
          // 正文内容由调用方后续注入，这里只做聚焦准备
        }
      })
      .catch(() => undefined);
  }

  private async waitZhihuPublishReadback(page: Page): Promise<void> {
    // 发布成功后 URL 跳转到 zhuanlan.zhihu.com/p/xxx
    await page
      .waitForURL(/zhuanlan\.zhihu\.com\/p\//, { timeout: 15_000 })
      .catch(() => undefined);
  }
}
