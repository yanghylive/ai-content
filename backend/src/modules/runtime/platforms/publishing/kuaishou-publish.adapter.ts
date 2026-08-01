import type { Page } from 'playwright';
import type {
  GenericVideoPublishAdapter,
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  PlatformCapability,
  VideoPublishExtras,
  VideoPublishPlan,
} from '../../../platform-registry/platform-adapter.interface';

/**
 * 快手发布 adapter —— 由 platform-publish.service.ts 的快手视频/图文 config 与
 * fillKuaishouDescription 原样抽取而来（含选择器），对外零行为漂移。
 * 仅做页面操作，不接触 HTTP/账号/凭证/PublishRecord。
 */
export class KuaishouPublishAdapter
  implements GenericVideoPublishAdapter, ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'kuaishou',
    displayName: '快手',
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
      loginCheck,
      afterClick: (page) => this.confirmPublishIfNeeded(page),
    };
  }

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
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
      loginCheck,
      afterClick: (page) => this.confirmPublishIfNeeded(page),
    };
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

  private async confirmPublishIfNeeded(page: Page) {
    const confirmButton = page.getByText('确认发布').last();
    if (
      (await confirmButton.count().catch(() => 0)) > 0 &&
      (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false))
    ) {
      await confirmButton.click({ timeout: 8000 }).catch(() => undefined);
    }
  }
}
