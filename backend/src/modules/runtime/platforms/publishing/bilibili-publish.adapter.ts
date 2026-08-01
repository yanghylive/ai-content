import type { Page } from 'playwright';
import type {
  GenericVideoPublishAdapter,
  PlatformCapability,
  VideoPublishExtras,
  VideoPublishPlan,
} from '../../../platform-registry/platform-adapter.interface';

/**
 * B站视频发布 adapter —— 由 platform-publish.service.ts 的 B站 config 与
 * 3 个 B站专属页面操作方法原样抽取而来（含选择器），对外零行为漂移。
 * 仅做页面操作，不接触 HTTP/账号/凭证/PublishRecord。
 */
export class BilibiliPublishAdapter implements GenericVideoPublishAdapter {
  readonly capability: PlatformCapability = {
    platform: 'bilibili',
    displayName: 'B站',
    contentKinds: ['video'],
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
    extras: VideoPublishExtras,
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): VideoPublishPlan {
    return {
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
          extras.biliTitle || title,
          tags,
          extras.biliDesc,
        ),
      waitUploaded: (page) => this.waitBilibiliVideoUploaded(page),
      loginCheck,
      waitReadback: (page) => this.waitBilibiliPublishReadback(page),
    };
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
}
