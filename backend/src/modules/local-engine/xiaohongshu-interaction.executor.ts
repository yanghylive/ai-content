import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { LocalBrowserEngine } from '../local-engine/local-browser-engine.service';

/**
 * XiaohongshuInteractionExecutor —— 小红书互动执行器（评论获客）
 *
 * 页面链路借鉴 xpzouying/xiaohongshu-mcp（Apache-2.0，思路重写，不搬代码）：
 * - 读评论：xiaohongshu.com/notification（通知中心，含"别人评论我的"）
 * - 回复评论：通知条目内点回复按钮 → 输入框 → 发送
 *
 * 复用 LocalBrowserEngine 的 CDP 会话（账号登录态隔离），与抖音/视频号互动执行器同机制。
 */

export interface XhsNotificationComment {
  commentId?: string;
  nickname?: string;
  content: string;
  feedTitle?: string;
  /** 通知条目的 DOM 序号（回复时定位用） */
  index: number;
}

export interface XhsReadResult {
  accountId: number | string;
  accountName: string;
  title?: string;
  comments: XhsNotificationComment[];
  url: string;
  readAt: string;
}

const XHS_NOTIFICATION_URL = 'https://www.xiaohongshu.com/notification';

@Injectable()
export class XiaohongshuInteractionExecutor {
  private readonly logger = new Logger(XiaohongshuInteractionExecutor.name);

  constructor(private readonly browser: LocalBrowserEngine) {}

  /** 读取通知中心评论（别人评论/回复我的） */
  async readComments(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<XhsReadResult> {
    const session = await this.browser.getOrCreateSession({
      platform: 'xiaohongshu',
      accountId: input.accountId,
    });
    let page = session.page;

    // 确保在通知页
    if (!page.url().includes('notification')) {
      await this.gotoBestEffort(page, XHS_NOTIFICATION_URL, 30000);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(2500);

    const limit = input.limit ?? 30;
    const comments = await this.scrapeNotifications(page, limit);

    return {
      accountId: input.accountId,
      accountName: session.key,
      comments,
      url: page.url(),
      readAt: new Date().toISOString(),
    };
  }

  /** 回复指定评论（按通知条目序号定位） */
  async replyComment(input: {
    accountId: number | string;
    commentIndex: number;
    content: string;
  }): Promise<{ status: 'sent' | 'failed'; message: string }> {
    const session = await this.browser.getOrCreateSession({
      platform: 'xiaohongshu',
      accountId: input.accountId,
    });
    let page = session.page;

    if (!page.url().includes('notification')) {
      await this.gotoBestEffort(page, XHS_NOTIFICATION_URL, 30000);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(2500);

    try {
      const ok = await page.evaluate(
        async ({ index, content }) => {
          const items = Array.from(
            document.querySelectorAll('.tabs-content-container > .container'),
          );
          const item = items[index];
          if (!item) return { ok: false, message: `通知条目 ${index} 不存在` };

          const replyBtn = item.querySelector<HTMLElement>('.action-reply');
          if (!replyBtn) {
            return { ok: false, message: '该通知没有回复入口（评论可能已删除）' };
          }
          replyBtn.click();

          // 点击后输入框异步渲染：浏览器内轮询等待（最多 3s）
          const waitForInput = (): Promise<HTMLElement | null> =>
            new Promise((resolve) => {
              const deadline = Date.now() + 3000;
              const poll = () => {
                const el = item.querySelector<HTMLElement>(
                  'textarea, .content-edit span, [contenteditable="true"]',
                );
                if (el || Date.now() > deadline) {
                  resolve(el);
                } else {
                  setTimeout(poll, 150);
                }
              };
              poll();
            });

          const input = await waitForInput();
          if (!input) {
            return { ok: false, message: '未找到回复输入框' };
          }
          if (input instanceof HTMLTextAreaElement) {
            input.value = content;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.textContent = content;
          }

          // 点击发送
          const sendBtn = item.querySelector<HTMLElement>(
            '.submit, .send, [class*="submit"]',
          );
          if (sendBtn) {
            sendBtn.click();
          } else {
            return { ok: false, message: '未找到发送按钮' };
          }
          return { ok: true, message: 'sent' };
        },
        { index: input.commentIndex, content: input.content },
      );

      await page.waitForTimeout(1500);
      return ok.ok
        ? { status: 'sent', message: ok.message }
        : { status: 'failed', message: ok.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`小红书回复失败: ${message}`);
      return { status: 'failed', message };
    }
  }

  // ------------------------------------------------------------------
  // 私有
  // ------------------------------------------------------------------

  private async scrapeNotifications(
    page: Page,
    limit: number,
  ): Promise<XhsNotificationComment[]> {
    return page
      .evaluate((max) => {
        const items = Array.from(
          document.querySelectorAll('.tabs-content-container > .container'),
        );
        const result: XhsNotificationComment[] = [];
        for (let i = 0; i < items.length && result.length < max; i += 1) {
          const item = items[i] as HTMLElement;
          const text = String(item.textContent || '').trim();
          if (!text) continue;
          // 只保留"评论/回复"类通知（含回复按钮的）；点赞/关注/收藏等无回复入口，过滤掉
          const hasReply = item.querySelector('.action-reply') !== null;
          if (!hasReply) continue;
          const nicknameEl = item.querySelector('.user-name, [class*="nickname"]');
          const commentIdEl = item.querySelector('[data-comment-id], [class*="comment-id"]');
          result.push({
            commentId: commentIdEl?.getAttribute('data-comment-id') || undefined,
            nickname: nicknameEl?.textContent?.trim() || undefined,
            content: text.slice(0, 200),
            index: i,
          });
        }
        return result;
      }, limit)
      .catch(() => []);
  }

  private async gotoBestEffort(
    page: Page,
    url: string,
    timeout: number,
  ): Promise<void> {
    try {
      await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
    } catch (error) {
      this.logger.warn(
        `导航 ${url} 超时（继续尝试）: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
