import type { Page } from 'playwright';
import type {
  ImageTextPublishAdapter,
  ImageTextPublishPlan,
  IndependentVideoPublishAdapter,
  PlatformCapability,
} from '../../../platform-registry/platform-adapter.interface';

export interface WechatChannelVideoInput {
  title: string;
  tags: string[];
  videoPath: string;
  coverPath?: string;
  scheduleTime?: string;
}

export interface WechatChannelVideoSteps {
  publishUrl: string;
  loginRequiredEvidence: string;
  successEvidence: string;
  run: (
    page: Page,
    input: WechatChannelVideoInput,
  ) => Promise<{ currentUrl: string }>;
}

/**
 * 视频号发布 adapter —— 由 platform-publish.service.ts 的视频号视频独立流程与
 * 图文 config 及 11 个视频号专属页面方法（含 Shadow DOM wujie-app 操作）
 * 原样抽取而来，对外零行为漂移。
 * 仅做页面操作，不接触 HTTP/账号/凭证/PublishRecord。
 */
export class WechatChannelPublishAdapter
  implements
    IndependentVideoPublishAdapter<WechatChannelVideoInput>,
    ImageTextPublishAdapter
{
  readonly capability: PlatformCapability = {
    platform: 'wechat-channel',
    displayName: '视频号',
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

  /**
   * 平台视频发布子接口别名（IndependentVideoPublishAdapter.checkLogin）。
   * 保留 checkWechatChannelLogin 原方法供外部按名访问；service 视频入口用 checkLogin。
   */
  checkLogin(page: Page): Promise<{ ok: boolean; message: string }> {
    return this.checkWechatChannelLogin(page);
  }

  buildImageTextPublishPlan(
    loginCheck: (page: Page) => Promise<{ ok: boolean; message: string }>,
  ): ImageTextPublishPlan {
    return {
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
      loginCheck,
      afterClick: (page) => this.handleWechatChannelPostPublishPrompts(page),
      waitReadback: async (page) => {
        await this.waitWechatChannelPublishReadback(page);
        return true;
      },
    };
  }

  buildVideoPublishSteps(): WechatChannelVideoSteps {
    return {
      publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
      loginRequiredEvidence: 'wechat-channel-publish-login-required',
      successEvidence: 'wechat-channel-publish-success',
      run: async (page, input) => {
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles(input.videoPath, {
            timeout: 45000,
          });
        await this.fillWechatChannelDescription(page, input.title, input.tags);
        await this.fillWechatChannelShortTitle(page, input.title);
        await this.setWechatChannelCoverIfNeeded(page, input.coverPath);
        if (input.scheduleTime) {
          await this.setWechatChannelScheduleTime(page, input.scheduleTime);
        }
        await this.waitWechatChannelVideoUploaded(page, input.videoPath);
        const publishButton = await this.waitWechatChannelPublishButton(page);
        await publishButton.click({ force: true, timeout: 15000 });
        await this.handleWechatChannelPostPublishPrompts(page);
        await this.waitWechatChannelPublishReadback(page);
        return { currentUrl: page.url() };
      },
    };
  }

  checkWechatChannelLogin(
    page: Page,
  ): Promise<{ ok: boolean; message: string }> {
    return this.checkWechatChannelLoginImpl(page);
  }

  private async checkWechatChannelLoginImpl(
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

  private async waitWechatChannelVideoUploaded(
    page: Page,
    videoPath?: string,
  ) {
    const deadline = Date.now() + 20 * 60 * 1000;
    let retried = false;
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
          ).find((button) => /发表/.test(button.textContent || ''));
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
      if (state.failed) {
        // 上传失败受控重传（≤1 次，重传后仍失败走原 throw；不无限循环）
        if (videoPath && !retried) {
          retried = true;
          console.warn(
            '[WechatChannelPublishAdapter] 视频号上传失败，重传 1 次',
          );
          await page
            .locator('input[type="file"]')
            .first()
            .setInputFiles(videoPath, { timeout: 45000 })
            .catch(() => undefined);
          await page.waitForTimeout(1500);
          continue;
        }
        throw new Error(`视频上传失败：${state.sample}`);
      }
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
        done: false,
        failed: false,
        originalPromptVisible: false,
        adminVerificationVisible: false,
        sample: '',
      }));
  }
}
