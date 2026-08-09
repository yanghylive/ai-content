import type { Page } from 'playwright';
import type {
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  IndependentVideoPublishAdapter,
  PlatformCapability,
} from '../../../platform-registry/platform-adapter.interface';

export interface DouyinVideoPublishInput {
  title: string;
  tags: string[];
  videoPath: string;
  coverPath?: string;
  scheduleTime?: string;
}

export interface DouyinPublishDeps {
  gotoBestEffort: (page: Page, url: string, timeout: number) => Promise<void>;
  waitGenericPublishButton: (
    page: Page,
    text: string,
  ) => Promise<{ click: (options?: object) => Promise<void> }>;
}

/**
 * 抖音视频发布的编排步骤（不含 blocked/captureEvidence，由 service 负责）。
 * 顺序与原 publishDouyinVideo 的 try 块逐行一致，对外零行为漂移。
 */
export interface DouyinVideoPublishSteps {
  publishUrl: string;
  loginRequiredEvidence: string;
  successEvidence: string;
  run: (
    page: Page,
    input: DouyinVideoPublishInput,
  ) => Promise<{ currentUrl: string }>;
}

/**
 * 抖音发布 adapter —— 由 platform-publish.service.ts 的抖音视频独立流程与
 * 图文 config 及 12 个抖音专属页面方法原样抽取而来（含选择器），对外零行为漂移。
 * 仅做页面操作，不接触 HTTP/账号/凭证/PublishRecord。
 */
export class DouyinPublishAdapter
  implements
    IndependentVideoPublishAdapter<DouyinVideoPublishInput>,
    ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'douyin',
    displayName: '抖音',
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

  constructor(private readonly deps: DouyinPublishDeps) {}

  /**
   * 平台视频发布子接口别名（IndependentVideoPublishAdapter.checkLogin）。
   * 保留 checkDouyinLogin 原方法供外部按名访问；service 视频入口用 checkLogin。
   */
  checkLogin(page: Page): Promise<{ ok: boolean; message: string }> {
    return this.checkDouyinLogin(page);
  }

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
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
      loginCheck,
      waitReadback: (page) => this.waitDouyinImageTextReadback(page),
    };
  }

  buildVideoPublishSteps(): DouyinVideoPublishSteps {
    return {
      publishUrl:
        'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page',
      loginRequiredEvidence: 'douyin-publish-login-required',
      successEvidence: 'douyin-publish-success',
      run: async (page, input) => {
        await this.uploadDouyinVideo(page, input.videoPath);
        await this.fillDouyinDescription(page, input.title, input.tags);
        await this.waitDouyinVideoUploaded(page);
        await this.setDouyinCoverIfNeeded(page, input.coverPath);
        if (input.scheduleTime) {
          await this.setDouyinScheduleTime(page, input.scheduleTime);
        }
        const publishButton = await this.waitDouyinPublishButton(page);
        await publishButton.click({ timeout: 15000 });
        await this.waitDouyinPublishReadback(page);
        return { currentUrl: page.url() };
      },
    };
  }

  checkDouyinLogin(page: Page): Promise<{ ok: boolean; message: string }> {
    return this.checkDouyinLoginImpl(page);
  }

  private async checkDouyinLoginImpl(
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
    const publishButton = await this.deps.waitGenericPublishButton(
      page,
      '发布',
    );
    await publishButton.click({ force: true, timeout: 15000 });
  }
}
