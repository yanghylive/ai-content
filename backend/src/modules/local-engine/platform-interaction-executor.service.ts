/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PlatformInteractionExecutor - 4 个 platform service 共用的真实浏览器执行器
 *
 * 替代 5409 main.py 12 /interaction/star/send|draft HTTP endpoints.
 * 走 PlaywrightMcpService (microsoft/playwright-mcp) 调 browser_* MCP 工具.
 *
 * 架构:
 *   platform service -> PlatformInteractionExecutor.dispatch()
 *     -> PlaywrightMcpService.rpcCall('browser_navigate', {url})
 *        -> 本地 @playwright/mcp 子进程 -> Chrome
 *     -> browser_snapshot() 拿 a11y tree
 *     -> browser_fill_form / browser_type / browser_click (按需)
 *     -> browser_take_screenshot() 拿证据
 *
 * 价值:
 * - 走 MCP 标准: 同样调用可以给 Claude/Cursor/Agent-S 用
 * - browser_snapshot 给 Agent 可读的 a11y tree, 比 CSS selector 稳
 * - 一处实现, 多处复用 (4 个 platform service 共用 + 外部 MCP 客户端)
 *
 * 设计:
 * 1. 每个 platform service 调 dispatch(input) 即可
 * 2. 真实失败返 clear error + screenshot 证据
 * 3. 商用保护: DISPATCH_MOCK=true 只能硬失败，不能伪造 sent/draft_filled 成功
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Frame, Page } from 'playwright';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { LocalBrowserEngine } from './local-browser-engine.service';
import { safeText } from '../../common/text.utils';

/** 浏览器 window 上挂载的抖音 IM 抓包缓存（页面注入脚本写入） */
type DouyinImWindowCapture = {
  kind: unknown;
  url: unknown;
  status: unknown;
  body: unknown;
  errorText: unknown;
  capturedAt: unknown;
};

/** 视频号 contentFrame.evaluate 交互结果（松散状态对象） */
type FrameActionResult = {
  status: string;
  message?: string;
  editorRect?: Record<string, number>;
  editorKey?: string;
  readbackText?: string;
  replyVisible?: boolean;
  nextAction?: string;
  sent?: boolean;
  editorTag?: string;
  sendButtonText?: string;
  sendButtonRect?: Record<string, number>;
  sendButtonClickKey?: string;
  retryButtonRect?: Record<string, number>;
  retryButtonClickKey?: string;
};

export type PlatformDispatchInput = {
  platform: 'douyin' | 'wechat-channel';
  taskType: 'comment-reply' | 'direct-message-reply';
  action: 'send' | 'draft';
  accountId: number | string;
  targetName?: string;
  targetText: string;
  sourceText?: string;
  sourceUrl?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  commentMode?: 'reply' | 'video-comment';
  replyText: string;
};

export type PlatformDispatchResult = {
  status:
    | 'sent'
    | 'draft_filled'
    | 'failed'
    | 'account_not_logged_in'
    | 'comment_missing'
    | 'message_missing'
    | 'editor_missing'
    | 'send_failed';
  message: string;
  evidencePath?: string;
  evidenceUrl?: string;
  nextAction?: string;
  readbackText?: string;
  replyVisible?: boolean;
  profileKey?: string;
  profileDir?: string;
  visibleWindow?: boolean;
  runtimeMode?: 'persistent-cdp-browser';
};

export type PlatformReadInput = {
  platform: 'douyin' | 'wechat-channel';
  taskType: 'comment-reply' | 'direct-message-reply';
  accountId: number | string;
  limit?: number;
  targetName?: string;
  parsingRules?: unknown;
};

type DouyinImTraceEvent = Record<string, any> & {
  kind?: string;
  url?: string;
  messageCandidates?: Array<Record<string, any>>;
};

type DouyinImRouteCapture = {
  patterns: string[];
  handler: Parameters<import('playwright').BrowserContext['route']>[1];
  captures: DouyinImTraceEvent[];
};

const PLATFORM_URLS: Record<
  PlatformDispatchInput['platform'],
  Record<PlatformDispatchInput['taskType'], string>
> = {
  douyin: {
    'comment-reply':
      'https://creator.douyin.com/creator-micro/interactive/comment',
    'direct-message-reply':
      'https://creator.douyin.com/creator-micro/data/following/chat',
  },
  'wechat-channel': {
    'comment-reply':
      'https://channels.weixin.qq.com/platform/interaction/comment',
    'direct-message-reply':
      'https://channels.weixin.qq.com/platform/private_msg',
  },
};

@Injectable()
export class PlatformInteractionExecutor {
  private readonly logger = new Logger(PlatformInteractionExecutor.name);
  private readonly mockMode = process.env.DISPATCH_MOCK === 'true';

  constructor(
    private readonly mcp: PlaywrightMcpService,
    private readonly browser: LocalBrowserEngine,
  ) {}

  listSessions() {
    return this.browser.listSessions();
  }

  async getStatus() {
    const [status, mcpStatus] = await Promise.all([
      this.browser.getStatus(),
      this.mcp.getAutomationStatus(),
    ]);
    const online = status.online && mcpStatus.readyForAutomation === true;
    return {
      ...status,
      online,
      status: online
        ? 'ok'
        : !status.online
          ? 'browser-down'
          : mcpStatus.readyForAutomation !== true
            ? 'mcp-down'
            : 'isolated-browser',
      service: 'platform-interaction-executor',
      message: online
        ? `真实互动执行器已就绪：${status.message}; ${mcpStatus.message}`
        : !status.online
          ? status.message
          : mcpStatus.readyForAutomation !== true
            ? mcpStatus.message
            : 'playwright-mcp 使用 isolated 模式，不能复用持久登录态。',
      profileKey: undefined,
      profileDir: undefined,
      isolated: mcpStatus.isolated,
      mcpOnline: mcpStatus.online,
      mcpChildProcessRunning: mcpStatus.childProcessRunning,
      mcpEndpoint: mcpStatus.endpoint,
      mcpToolCount: mcpStatus.toolCount ?? 0,
      mcpMissingRequiredTools: mcpStatus.missingRequiredTools ?? [],
    };
  }

  async openAccount(input: {
    platform: PlatformDispatchInput['platform'];
    accountId: number | string;
    url?: string;
    storagePath?: string | null;
  }): Promise<{
    sessionKey: string;
    currentUrl: string;
    profileDir: string;
    visibleWindow: boolean;
    cdpPort?: number;
    browser?: string;
    browserReused?: boolean;
    runtimeMode: 'persistent-cdp-browser';
    loadedCookieCount?: number;
  }> {
    const session = await this.browser.getOrCreateSession({
      platform: input.platform,
      accountId: input.accountId,
    });
    const loadedCookieCount = await this.browser.loadStorageStateCookies({
      sessionKey: session.key,
      storagePath: input.storagePath,
    });
    const url =
      input.url ||
      PLATFORM_URLS[input.platform]['comment-reply'] ||
      'about:blank';
    await this.gotoBestEffort(session.page, url, 30000);
    await session.page.bringToFront().catch(() => undefined);
    session.lastActivityAt = new Date().toISOString();
    return {
      sessionKey: session.key,
      currentUrl: session.page.url(),
      profileDir: session.profileDir,
      visibleWindow: session.visibleWindow,
      cdpPort: session.debuggingPort,
      browser: session.browser,
      browserReused: session.browserReused,
      runtimeMode: 'persistent-cdp-browser',
      loadedCookieCount,
    };
  }

  async dispatch(
    input: PlatformDispatchInput,
  ): Promise<PlatformDispatchResult> {
    if (this.mockMode) {
      this.logger.error(
        'DISPATCH_MOCK=true - blocked fake interaction success',
      );
      return {
        status: 'failed',
        message:
          'DISPATCH_MOCK=true：已阻断客户互动执行，不能跳过真实浏览器操作后返回成功。',
        nextAction:
          '关闭 DISPATCH_MOCK，并通过 Playwright MCP 执行真实读取、填入、发送和回读。',
      };
    }

    return this.dispatchWithLocalBrowser(input);
  }

  private async dispatchWithLocalBrowser(
    input: PlatformDispatchInput,
  ): Promise<PlatformDispatchResult> {
    const targetUrl =
      input.platform === 'douyin' && input.taskType === 'comment-reply'
        ? this.resolveDouyinPublicVideoUrl(input) ||
          PLATFORM_URLS[input.platform][input.taskType]
        : PLATFORM_URLS[input.platform][input.taskType];
    const session = await this.browser.getOrCreateSession({
      platform: input.platform,
      accountId: input.accountId,
    });
    let page = session.page;
    this.logger.log(
      `local-browser dispatch ${input.platform}/${input.taskType} account=${input.accountId} action=${input.action} url=${targetUrl}`,
    );

    try {
      const preserveCurrentPage =
        await this.shouldPreserveCurrentDouyinTargetPage(page, input);
      if (preserveCurrentPage) {
        await page.bringToFront().catch(() => undefined);
        await this.dismissDouyinOverlays(page).catch(() => undefined);
        await page.waitForTimeout(800).catch(() => undefined);
        this.logger.log(
          `local-browser preserved current douyin target page account=${input.accountId} task=${input.taskType}`,
        );
      } else {
        await this.gotoBestEffort(page, targetUrl, 30000);
        await page.waitForTimeout(
          input.platform === 'wechat-channel' ? 2500 : 1800,
        );
        await this.clickWechatChannelEntryIfNeeded(page, input);
        await this.waitForPlatformInteractionSettled(
          page,
          input.platform,
          input.taskType,
        );
      }
      const loginState = await this.checkLoginState(page, input.platform);
      if (!loginState.ok) {
        const screenshot = await this.captureSessionScreenshot(
          session.key,
          `${input.platform}-not-logged-in`,
        );
        return {
          status: 'account_not_logged_in',
          message: loginState.message,
          ...screenshot,
          profileDir: session.profileDir,
          visibleWindow: session.visibleWindow,
          runtimeMode: 'persistent-cdp-browser',
          nextAction: '请在打开的浏览器里完成平台登录，然后重试。',
        };
      }
      const recoveredPage = await this.ensureWechatChannelEntryReadyOrRecover(
        page,
        input,
      );
      if (recoveredPage) page = recoveredPage;

      const actionResult = await this.performDomInteraction(page, input);
      if (actionResult.status === 'sent') {
        const hasVisualFailure = await this.detectSendFailureMarker(page);
        if (hasVisualFailure) {
          actionResult.status = 'send_failed';
          actionResult.message =
            '已点击发送，但页面显示发送异常标记，未确认真实发出。';
          actionResult.nextAction =
            '请检查平台是否弹出验证、账号是否限制发送或当前消息类型是否不支持网页回复。';
        }
      }
      const screenshot = await this.captureSessionScreenshot(
        session.key,
        `${input.platform}-${input.taskType}-${input.action}`,
      );
      return {
        status: actionResult.status,
        message: actionResult.message,
        ...screenshot,
        readbackText: actionResult.readbackText,
        replyVisible: actionResult.replyVisible,
        profileDir: session.profileDir,
        visibleWindow: session.visibleWindow,
        runtimeMode: 'persistent-cdp-browser',
        nextAction: actionResult.nextAction,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const screenshot = await this.captureSessionScreenshot(
        session.key,
        `${input.platform}-${input.taskType}-failed`,
      );
      return {
        status: 'failed',
        message: `${input.platform} ${input.taskType} 执行失败：${message}`,
        ...screenshot,
        profileDir: session.profileDir,
        visibleWindow: session.visibleWindow,
        runtimeMode: 'persistent-cdp-browser',
        nextAction:
          '检查平台页面是否加载完成、账号是否登录、目标对象是否仍可见。',
      };
    }
  }

  private async shouldPreserveCurrentDouyinTargetPage(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<boolean> {
    if (input.platform !== 'douyin') return false;
    if (
      !this.normalizeInteractionText(input.targetText) &&
      !this.normalizeInteractionText(input.targetName || '')
    ) {
      return false;
    }
    const url = page.url();
    if (!/creator\.douyin\.com|douyin\.com/.test(url)) return false;
    if (
      !(await this.pageContainsInteractionTarget(
        page,
        input.targetText,
        input.targetName,
      ))
    ) {
      return false;
    }
    if (input.taskType === 'comment-reply') {
      return this.isDouyinCommentPageReady(page);
    }
    if (input.taskType === 'direct-message-reply') {
      return /following\/chat|im|message|chat/i.test(url);
    }
    return false;
  }

  private async dispatchViaMcp(
    input: PlatformDispatchInput,
  ): Promise<PlatformDispatchResult> {
    const targetUrl = PLATFORM_URLS[input.platform][input.taskType];
    this.logger.log(
      `MCP dispatch ${input.platform}/${input.taskType} account=${input.accountId} action=${input.action} url=${targetUrl}`,
    );

    try {
      const runtimeStatus = await this.mcp.ensureProfile({
        platform: input.platform,
        accountId: input.accountId,
      });
      if (
        !runtimeStatus.online ||
        !runtimeStatus.visibleWindow ||
        runtimeStatus.isolated
      ) {
        return {
          status: 'failed',
          message: `客户互动浏览器未满足商用要求：online=${runtimeStatus.online}, visible=${runtimeStatus.visibleWindow}, isolated=${runtimeStatus.isolated}`,
          profileKey: runtimeStatus.profileKey,
          profileDir: runtimeStatus.profileDir,
          visibleWindow: runtimeStatus.visibleWindow,
          nextAction:
            '请确认 3011 Runtime 已启动可见持久浏览器，且未使用 headless/isolated 模式。',
        };
      }

      // 1. Navigate to platform page
      const navResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_navigate',
          arguments: { url: targetUrl },
        },
      });
      this.logger.log(
        `browser_navigate done: ${JSON.stringify(navResult?.result)?.slice(0, 120)}`,
      );

      // Check login state from page snapshot/URL
      const snapshotResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_snapshot',
          arguments: {},
        },
      });
      const snapshotText = JSON.stringify(snapshotResult?.result ?? {});
      this.logger.debug(
        `browser_snapshot for ${input.platform}: len=${snapshotText.length}, first200=${snapshotText.slice(0, 200).replace(/\n/g, ' ')}`,
      );
      if (/login|signin|登录|扫码|未登录|please log in/i.test(snapshotText)) {
        const screenshot = await this.captureScreenshot(
          `${input.platform}-not-logged-in`,
        );
        return {
          status: 'failed',
          message: `${input.platform} 账号未登录 (页面包含 login 关键字)`,
          ...screenshot,
          profileKey: runtimeStatus.profileKey,
          profileDir: runtimeStatus.profileDir,
          visibleWindow: runtimeStatus.visibleWindow,
          nextAction: '请在浏览器中完成登录，cookies 自动持久化到 profile',
        };
      }

      // 2. 用 browser_snapshot 拿 a11y tree 找评论框 / 私信输入框 ref
      // 2026-06-04: 走 MCP 真实 click/fill (从 a11y tree 解析 ref)
      // 抖音评论页：ref 通常是 "[contenteditable]" 或 "textarea[placeholder*='回复']"
      // 视频号评论页：ref 通常是 "textarea[placeholder*='回复']"
      const editorSelectors: Record<string, string> = {
        'douyin-comment-reply':
          'textarea[placeholder*="回复"], [contenteditable="true"]',
        'douyin-direct-message-reply': 'textarea, [contenteditable="true"]',
        'wechat-channel-comment-reply':
          'textarea[placeholder*="回复"], [contenteditable="true"]',
        'wechat-channel-direct-message-reply':
          'textarea, [contenteditable="true"]',
      };
      const editorSelector = editorSelectors[input.taskType] || 'textarea';
      const submitSelector = 'button:has-text("发送"), button:has-text("回复")';

      // 2026-06-04: MCP tools/call 不抛 isError=true, 需自己检查 result.isError
      const fillResult = await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextId(),
        method: 'tools/call',
        params: {
          name: 'browser_fill_form',
          arguments: {
            fields: [
              {
                name: 'reply',
                type: 'textbox',
                value: input.replyText,
                target: editorSelector,
              },
            ],
          },
        },
      });
      const fillOk = !fillResult?.isError;
      if (!fillOk) {
        const errText = (fillResult?.content?.[0]?.text ?? '').slice(0, 120);
        this.logger.warn(`browser_fill_form 失败: ${errText}`);
      }

      let clickOk = true;
      if (fillOk && input.action === 'send') {
        const clickResult = await this.mcp.rpcCall({
          jsonrpc: '2.0',
          id: this.nextId(),
          method: 'tools/call',
          params: {
            name: 'browser_click',
            arguments: { element: '发送按钮', target: submitSelector },
          },
        });
        clickOk = !clickResult?.isError;
        if (!clickOk) {
          this.logger.warn(
            `browser_click submit 失败: ${(clickResult?.content?.[0]?.text ?? '').slice(0, 120)}`,
          );
        }
      }

      let readbackText: string | undefined;
      let replyVisible = false;
      if (fillOk && clickOk && input.action === 'send') {
        const readbackResult = await this.mcp.rpcCall({
          jsonrpc: '2.0',
          id: this.nextId(),
          method: 'tools/call',
          params: {
            name: 'browser_snapshot',
            arguments: {},
          },
        });
        readbackText = JSON.stringify(readbackResult?.result ?? {});
        replyVisible = this.snapshotContainsReply(
          readbackText,
          input.replyText,
        );
        if (!replyVisible) {
          this.logger.warn(
            `readback failed: ${input.platform}/${input.taskType} reply not visible after send`,
          );
        }
      }

      // 3. 截图
      const screenshot = await this.captureScreenshot(
        `${input.platform}-${input.action}`,
      );

      const sendReadbackOk = input.action !== 'send' || replyVisible;
      const finalStatus =
        fillOk && clickOk && sendReadbackOk
          ? input.action === 'send'
            ? 'sent'
            : 'draft_filled'
          : 'failed';
      const finalMessage =
        fillOk && clickOk && sendReadbackOk
          ? `通过 playwright-mcp 已 fill 编辑器${input.action === 'send' ? ' + click 发送' : ''}（${input.platform} ${input.taskType}）`
          : input.action === 'send' && fillOk && clickOk
            ? `MCP 已点击发送，但页面回读未确认回复内容`
            : `MCP fill/click 失败: 编辑器未找到 (账号可能未登录或页面结构变了)`;
      this.logger.warn(
        `dispatch final: ${input.platform}/${input.taskType} fillOk=${fillOk} clickOk=${clickOk} replyVisible=${replyVisible} status=${finalStatus}`,
      );
      return {
        status: finalStatus,
        message: finalMessage,
        ...screenshot,
        readbackText: readbackText?.slice(0, 5000),
        replyVisible,
        profileKey: runtimeStatus.profileKey,
        profileDir: runtimeStatus.profileDir,
        visibleWindow: runtimeStatus.visibleWindow,
        nextAction:
          fillOk && clickOk
            ? input.action === 'send'
              ? replyVisible
                ? '已通过 MCP 真实发送，并在页面回读到回复内容'
                : '已点击发送，但未在页面回读到回复内容，请检查平台页面结构和回读选择器'
              : '草稿已填入'
            : '检查 playwright-mcp 状态 + 平台账号登录态',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`MCP dispatch failed: ${message}`);
      return {
        status: 'failed',
        message: `MCP dispatch 失败: ${message}`,
        nextAction: '检查 playwright-mcp sidecar 状态 (/api/mcp/status)',
      };
    }
  }

  async read(input: PlatformReadInput): Promise<Record<string, any>> {
    return this.readWithLocalBrowser(input);
  }

  private async readWithLocalBrowser(
    input: PlatformReadInput,
  ): Promise<Record<string, any>> {
    const targetUrl = PLATFORM_URLS[input.platform][input.taskType];
    let session = await this.browser.getOrCreateSession({
      platform: input.platform,
      accountId: input.accountId,
    });
    let page = session.page;
    if (input.platform === 'douyin' && input.taskType === 'comment-reply') {
      return this.readDouyinCommentsWithLocalBrowser(page, session, input);
    }
    if (
      input.platform === 'douyin' &&
      input.taskType === 'direct-message-reply'
    ) {
      return this.readDouyinMessagesWithLocalBrowser(page, session, input);
    }
    if (input.platform === 'wechat-channel') {
      return this.readWechatChannelWithLocalBrowser(page, session, input);
    }
    await this.gotoBestEffort(page, targetUrl, 30000);
    await page.waitForTimeout(1800);
    await this.clickWechatChannelEntryIfNeeded(page, {
      platform: input.platform,
      taskType: input.taskType,
    });
    const settleState = await this.waitForPlatformInteractionSettled(
      page,
      input.platform,
      input.taskType,
    );
    const loginState = await this.checkLoginState(page, input.platform);
    if (!loginState.ok) {
      const recoveredPage = null;
      if (recoveredPage) {
        page = recoveredPage;
        session = await this.browser.getOrCreateSession({
          platform: input.platform,
          accountId: input.accountId,
        });
      } else {
        const evidence = await this.captureSessionScreenshot(
          session.key,
          `${input.platform}-${input.taskType}-read-not-logged-in`,
        );
        const suffix = [
          `当前地址：${page.url()}`,
          evidence.evidencePath ? `evidence=${evidence.evidencePath}` : '',
        ]
          .filter(Boolean)
          .join(' | ');
        throw new Error(`${loginState.message}${suffix ? ` (${suffix})` : ''}`);
      }
    }
    const recoveredPage = await this.ensureWechatChannelEntryReadyOrRecover(
      page,
      input,
    );
    if (recoveredPage) {
      page = recoveredPage;
      session = await this.browser.getOrCreateSession({
        platform: input.platform,
        accountId: input.accountId,
      });
    }

    const items = await this.extractCandidateTexts(page, input);
    const douyinMessageTabState =
      input.platform === 'douyin' && input.taskType === 'direct-message-reply'
        ? await this.getDouyinMessageTabState(page)
        : null;
    const effectiveItems =
      douyinMessageTabState?.activeTab === '群消息' ? [] : items;
    const evidence = await this.captureSessionScreenshot(
      session.key,
      `${input.platform}-${input.taskType}-read`,
    );
    const isMessage = input.taskType === 'direct-message-reply';
    const itemKey = isMessage ? 'messages' : 'comments';
    const platformName = input.platform === 'douyin' ? '抖音' : '视频号';
    return {
      accountId: Number(input.accountId) || input.accountId,
      platformName,
      platformType: input.platform === 'douyin' ? 3 : 2,
      url: page.url(),
      title: await page.title().catch(() => ''),
      [itemKey]: effectiveItems,
      pageTextSample: await this.pageText(page, 1200),
      evidence: evidence.evidencePath
        ? {
            type: 'screenshot',
            label: `${platformName}${isMessage ? '私信' : '评论'}读取截图`,
            path: evidence.evidencePath,
            value: evidence.evidencePath,
          }
        : null,
      summary: {
        totalCandidates: effectiveItems.length,
        usableCount: effectiveItems.length,
        emptyReason: effectiveItems.length
          ? null
          : douyinMessageTabState?.activeTab === '群消息'
            ? '当前停留在群消息；群消息不作为抖音私信闭环目标。'
            : settleState?.loadBlocked
              ? settleState.reason || '平台页面仍在加载，未进入可读取状态。'
              : '当前页面未解析到可回复对象',
        loadBlocked: Boolean(settleState?.loadBlocked),
      },
      readAt: new Date().toISOString(),
      runtimeMode: 'persistent-cdp-browser',
      profileDir: session.profileDir,
      cdpPort: session.debuggingPort ?? null,
      browser: session.browser ?? null,
      browserReused: session.browserReused ?? null,
      currentUrl: page.url(),
    };
  }

  private async getDouyinMessageTabState(
    page: Page,
  ): Promise<{ activeTab?: string } | null> {
    try {
      return await page.evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const labels = ['朋友私信', '陌生人私信', '群消息'];
        const tabs = Array.from(
          document.querySelectorAll('button, [role="tab"], div, span'),
        )
          .filter((node) => visible(node))
          .map((node) => {
            const text = normalize(node.innerText || node.textContent);
            if (!labels.includes(text)) return null;
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const className = String(node.className || '');
            const selected =
              node.getAttribute('aria-selected') === 'true' ||
              /active|selected|checked|current/i.test(className) ||
              style.color.includes('255, 44') ||
              style.color.includes('254, 44') ||
              style.borderBottomColor.includes('255, 44') ||
              style.borderBottomColor.includes('254, 44');
            return { text, x: rect.x, y: rect.y, selected };
          })
          .filter(Boolean) as Array<{
          text: string;
          x: number;
          y: number;
          selected: boolean;
        }>;
        const selected = tabs.find((tab) => tab.selected);
        if (selected) return { activeTab: selected.text };
        return {};
      });
    } catch {
      return null;
    }
  }

  private async gotoBestEffort(
    page: Page,
    url: string,
    timeout: number,
  ): Promise<void> {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (error) {
      const currentUrl = page.url();
      const message = error instanceof Error ? error.message : String(error);
      if (currentUrl && currentUrl !== 'about:blank') {
        this.logger.warn(
          `页面导航超时但已进入页面，继续执行: target=${url}, current=${currentUrl}, error=${message}`,
        );
        await page.evaluate(() => window.stop()).catch(() => undefined);
        return;
      }
      throw error;
    }
  }

  private async evaluateWithTimeout<T>(
    page: Page,
    label: string,
    action: Promise<T>,
    timeoutMs: number,
    fallback: T,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutResult = new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      });
      const result = await Promise.race([action, timeoutResult]);
      if (
        typeof result === 'object' &&
        result !== null &&
        'timedOut' in result
      ) {
        this.logger.warn(`页面脚本执行超时，跳过当前步骤: ${label}`);
        void page.evaluate(() => window.stop()).catch(() => undefined);
        return fallback;
      }
      return result as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `页面脚本执行失败，跳过当前步骤: ${label}, error=${message}`,
      );
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async waitForPlatformInteractionSettled(
    page: Page,
    platform: PlatformDispatchInput['platform'],
    taskType: PlatformDispatchInput['taskType'],
  ): Promise<{ loadBlocked?: boolean; reason?: string } | undefined> {
    if (platform === 'douyin' && taskType === 'direct-message-reply') {
      await this.clickDouyinMessageTab(page, '全部');
      let state = await this.waitForDouyinMessagePageSettled(page, 18000);
      if (state.loadBlocked) {
        await page
          .reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
          .catch(() => undefined);
        await page.waitForTimeout(1800).catch(() => undefined);
        await this.clickDouyinMessageTab(page, '全部');
        state = await this.waitForDouyinMessagePageSettled(page, 18000);
      }
      if (state.loadBlocked) {
        this.logger.warn(
          `Douyin message page not settled: ${state.reason || 'loading'}`,
        );
      }
      return state;
    }
    if (platform === 'douyin' && taskType === 'comment-reply') {
      const state = await this.waitForDouyinCommentPageSettled(page, 18000);
      if (state.loadBlocked) {
        this.logger.warn(
          `Douyin comment page not settled: ${state.reason || 'loading'}`,
        );
      }
      return state;
    }
    await page.waitForTimeout(platform === 'wechat-channel' ? 1500 : 1000);
    return undefined;
  }

  private async clickDouyinMessageTab(
    page: Page,
    label: string,
  ): Promise<boolean> {
    return page
      .evaluate((tabLabel) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0
          );
        };
        const candidates = Array.from(
          document.querySelectorAll('button, [role="tab"], div, span'),
        )
          .filter((node) => {
            if (!visible(node)) return false;
            if (normalize(node.innerText || node.textContent) !== tabLabel)
              return false;
            const rect = node.getBoundingClientRect();
            return rect.x > 220 && rect.y > 70 && rect.y < 280;
          })
          .sort(
            (a, b) =>
              (a as HTMLElement).getBoundingClientRect().x -
              (b as HTMLElement).getBoundingClientRect().x,
          );
        const node = candidates[0] as HTMLElement | undefined;
        if (!node) return false;
        node.click();
        return true;
      }, label)
      .catch(() => false);
  }

  private async waitForDouyinMessagePageSettled(
    page: Page,
    timeoutMs: number,
  ): Promise<{
    loadBlocked?: boolean;
    reason?: string;
    visibleLoaders?: number;
  }> {
    const deadline = Date.now() + timeoutMs;
    let lastState: Record<string, any> = {};
    for (let attempt = 0; attempt < 40 && Date.now() < deadline; attempt += 1) {
      lastState = await page
        .evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const text = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const contentText = text
            .replace(
              /高清发布|首页|内容管理|作品管理|合集管理|共创中心|原创保护中心|互动管理|数据中心|变现中心|创作中心|通知|网址|抖音/g,
              '',
            )
            .replace(/全部|朋友私信|陌生人私信|群消息/g, '')
            .trim();
          const visibleLoaders = Array.from(
            document.querySelectorAll(
              '[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, .semi-spin-wrapper, svg',
            ),
          ).filter((node) => {
            if (!visible(node)) return false;
            const rect = node.getBoundingClientRect();
            return (
              rect.x > 250 &&
              rect.y > 120 &&
              rect.width <= 180 &&
              rect.height <= 180
            );
          }).length;
          return {
            hasEmptyState:
              /暂无|没有|空空如也|还没有|未收到私信|没有收到私信/.test(text),
            hasConversationHint:
              /未读|分钟前|小时前|昨天|今天|\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|回复|发送/.test(
                text,
              ),
            contentLength: contentText.length,
            visibleLoaders,
            textSample: text.slice(0, 260),
          };
        })
        .catch(() => ({}));
      if (lastState.hasEmptyState) return {};
      if (
        lastState.hasConversationHint &&
        Number(lastState.contentLength || 0) > 20
      )
        return {};
      if (
        Number(lastState.visibleLoaders || 0) === 0 &&
        Number(lastState.contentLength || 0) > 16
      )
        return {};
      await page.waitForTimeout(900).catch(() => undefined);
    }
    return {
      loadBlocked: true,
      reason: String(
        lastState.textSample ||
          '抖音私信页会话列表持续加载，未进入可读取状态。',
      ),
    };
  }

  private async waitForDouyinCommentPageSettled(
    page: Page,
    timeoutMs: number,
  ): Promise<{ loadBlocked?: boolean; reason?: string }> {
    const deadline = Date.now() + timeoutMs;
    let lastState: Record<string, any> = {};
    while (Date.now() < deadline) {
      lastState = await page
        .evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const text = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const visibleLoaders = Array.from(
            document.querySelectorAll(
              '[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, .semi-spin-wrapper, [aria-busy="true"]',
            ),
          ).filter((node) => {
            if (!visible(node)) return false;
            const rect = node.getBoundingClientRect();
            const text = normalize(node.innerText || node.textContent || '');
            const cls = String(node.className || '');
            const aria = String(
              node.getAttribute('aria-label') ||
                node.getAttribute('role') ||
                '',
            );
            if (
              !/loading|spin|加载|progress|status/i.test(
                `${text} ${cls} ${aria}`,
              )
            ) {
              return false;
            }
            return (
              rect.x > 250 &&
              rect.y > 260 &&
              rect.width <= 180 &&
              rect.height <= 180
            );
          }).length;
          const commentAreaText = Array.from(
            document.querySelectorAll(
              'main, section, [class*="comment"], [class*="Comment"], div',
            ),
          )
            .filter((node) => visible(node))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.x > 220 &&
                rect.y > 250 &&
                rect.width > 260 &&
                rect.height > 40
              );
            })
            .map((node) => normalize(node.textContent))
            .join(' ')
            .slice(0, 1200);
          const hasEmptyState =
            /暂无评论|没有评论|暂无数据|暂无互动|还没有评论/.test(text);
          const hasCommentSignal =
            /回复|点赞|评论|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
              commentAreaText,
            ) && !/^最新发布?$/.test(commentAreaText);
          return {
            hasEmptyState,
            hasCommentSignal,
            visibleLoaders,
            textSample: text.slice(0, 260),
            commentAreaText: commentAreaText.slice(0, 260),
          };
        })
        .catch(() => ({}));
      if (lastState.hasEmptyState) return {};
      if (lastState.hasCommentSignal) return {};
      if (
        Number(lastState.visibleLoaders || 0) === 0 &&
        String(lastState.commentAreaText || '').length > 20
      ) {
        return {};
      }
      await page.waitForTimeout(900).catch(() => undefined);
    }
    return {
      loadBlocked: true,
      reason: String(
        lastState.commentAreaText ||
          lastState.textSample ||
          '抖音评论页持续加载，未进入可读取状态。',
      ),
    };
  }

  private async detectSendFailureMarker(page: Page): Promise<boolean> {
    try {
      const text = await this.pageText(page, 1200);
      if (/评论成功|发送成功|回复成功|已发布/.test(text)) return false;
      if (
        !/发送失败|发送异常|重新发送|网络异常|稍后再试|未发送|消息发送失败|只有群主和管理员可以发消息|没有发言权限|不能发送消息|无权发送|无法发送/.test(
          text,
        )
      ) {
        return false;
      }

      const png = await page.screenshot({ type: 'png' });
      const sharp = (await import('sharp')).default;
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const startX = Math.floor(info.width * 0.55);
      const endX = Math.floor(info.width * 0.98);
      const startY = Math.floor(info.height * 0.45);
      const endY = Math.floor(info.height * 0.85);
      const maskWidth = endX - startX;
      const maskHeight = endY - startY;
      const redMask = new Uint8Array(maskWidth * maskHeight);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          const idx = (info.width * y + x) * info.channels;
          const red = data[idx];
          const green = data[idx + 1];
          const blue = data[idx + 2];
          const alpha = data[idx + 3];
          if (alpha < 180) continue;
          if (red > 210 && green >= 35 && green <= 145 && blue < 100) {
            redMask[(y - startY) * maskWidth + (x - startX)] = 1;
          }
        }
      }

      const visited = new Uint8Array(redMask.length);
      const queue: number[] = [];
      for (let offset = 0; offset < redMask.length; offset += 1) {
        if (!redMask[offset] || visited[offset]) continue;
        visited[offset] = 1;
        queue.length = 0;
        queue.push(offset);
        let pixels = 0;
        let minLocalX = maskWidth;
        let minLocalY = maskHeight;
        let maxLocalX = 0;
        let maxLocalY = 0;
        for (let head = 0; head < queue.length; head += 1) {
          const current = queue[head];
          const localX = current % maskWidth;
          const localY = Math.floor(current / maskWidth);
          pixels += 1;
          minLocalX = Math.min(minLocalX, localX);
          minLocalY = Math.min(minLocalY, localY);
          maxLocalX = Math.max(maxLocalX, localX);
          maxLocalY = Math.max(maxLocalY, localY);
          const neighbors = [
            localX > 0 ? current - 1 : -1,
            localX < maskWidth - 1 ? current + 1 : -1,
            localY > 0 ? current - maskWidth : -1,
            localY < maskHeight - 1 ? current + maskWidth : -1,
          ];
          for (const next of neighbors) {
            if (next < 0 || visited[next] || !redMask[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }
        const width = maxLocalX - minLocalX + 1;
        const height = maxLocalY - minLocalY + 1;
        const absoluteY = startY + minLocalY;
        const inReplyArea = absoluteY >= Math.floor(info.height * 0.55);
        if (
          inReplyArea &&
          pixels >= 18 &&
          pixels <= 900 &&
          width <= 60 &&
          height <= 60
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.warn(
        `发送异常视觉检测失败，跳过该检测：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private nextId(): number {
    return Math.floor(Math.random() * 1e9) + 1;
  }

  private async clickWechatChannelEntryIfNeeded(
    page: Page,
    input: Pick<PlatformDispatchInput, 'platform' | 'taskType'>,
  ): Promise<void> {
    if (input.platform !== 'wechat-channel') return;
    if (await this.isWechatChannelTargetEntryReady(page, input.taskType))
      return;
    const labels =
      input.taskType === 'comment-reply'
        ? ['评论管理', '互动管理', '评论', '留言管理']
        : ['私信管理', '消息管理', '互动管理', '私信', '用户消息'];
    for (const label of labels) {
      try {
        await page
          .getByText(label, { exact: true })
          .first()
          .click({ timeout: 1200 });
        await page.waitForTimeout(1400);
        if (await this.isWechatChannelTargetEntryReady(page, input.taskType))
          return;
      } catch {
        // 平台 URL 可能已经在目标页，忽略点击失败。
      }
    }
    try {
      const clickTarget = await page.evaluate((_taskType) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const clickableAncestor = (node: HTMLElement) => {
          let current: HTMLElement | null = node;
          for (let depth = 0; current && depth < 6; depth += 1) {
            const rect = current.getBoundingClientRect();
            const role = current.getAttribute('role') || '';
            const tag = current.tagName.toLowerCase();
            const cursor = window.getComputedStyle(current).cursor;
            const clickable =
              tag === 'a' ||
              tag === 'button' ||
              role === 'button' ||
              current.tabIndex >= 0 ||
              cursor === 'pointer';
            const looksLikeCard =
              rect.width >= 120 &&
              rect.width <= Math.max(760, window.innerWidth * 0.55) &&
              rect.height >= 42 &&
              rect.height <= Math.max(280, window.innerHeight * 0.45);
            if ((clickable || looksLikeCard) && visible(current))
              return current;
            current = current.parentElement;
          }
          return node;
        };
        const getClickPoint = (node: HTMLElement) => {
          const target = clickableAncestor(node);
          const rect = target.getBoundingClientRect();
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          return {
            x,
            y,
            width: rect.width,
            height: rect.height,
            text: normalize(target.innerText || target.textContent).slice(
              0,
              160,
            ),
          };
        };
        // 视频号助手首页第一跳只能进「互动管理」。不要把「消息通知」里的“消息”
        // 当成私信入口，否则会停在首页公告卡片，后续读取会误判。
        const targetWords = ['互动管理'];
        const preferredWords = ['互动管理'];
        const nodes = Array.from(
          document.querySelectorAll('div, section, article, a, button'),
        );
        const candidates = nodes
          .filter((node) => visible(node))
          .map((node) => {
            const text = normalize(node.innerText || node.textContent);
            const rect = node.getBoundingClientRect();
            const clickable =
              node.closest('a, button, [role="button"], [tabindex]') || node;
            const area = rect.width * rect.height;
            const pageArea = window.innerWidth * window.innerHeight;
            const firstLine = text.split(' ')[0] || text;
            return {
              node: clickable as HTMLElement,
              text,
              firstLine,
              rect,
              area,
              pageArea,
              score: targetWords.filter((word) => text.includes(word)).length,
              preferredScore: preferredWords.filter((word) =>
                text.includes(word),
              ).length,
              titleScore: preferredWords.some(
                (word) => firstLine === word || firstLine.includes(word),
              )
                ? 4
                : 0,
            };
          })
          .filter(
            (item) =>
              item.score > 0 && item.rect.width >= 80 && item.rect.height >= 30,
          )
          .filter((item) => {
            const cardLike =
              item.rect.width >= 120 &&
              item.rect.width <= Math.min(900, window.innerWidth * 0.72) &&
              item.rect.height >= 40 &&
              item.rect.height <= Math.min(320, window.innerHeight * 0.5) &&
              item.area <= item.pageArea * 0.28;
            const preciseSmallTarget =
              item.rect.width <= 220 &&
              item.rect.height <= 80 &&
              item.titleScore > 0;
            return cardLike || preciseSmallTarget;
          })
          .filter((item) => {
            const lowerNoise =
              /退出登录|系统设置|帮助中心|服务协议|隐私政策/.test(item.text);
            return !lowerNoise;
          })
          .sort(
            (a, b) =>
              b.titleScore - a.titleScore ||
              b.preferredScore - a.preferredScore ||
              b.score - a.score ||
              a.rect.y - b.rect.y ||
              a.rect.width * a.rect.height - b.rect.width * b.rect.height,
          );
        const picked = candidates[0]?.node;
        if (!picked) return null;
        return getClickPoint(picked);
      }, input.taskType);
      if (clickTarget) {
        this.logger.log(
          `wechat-channel entry click ${input.taskType}: "${clickTarget.text}" @ ${Math.round(
            clickTarget.x,
          )},${Math.round(clickTarget.y)} ${Math.round(clickTarget.width)}x${Math.round(
            clickTarget.height,
          )}`,
        );
        await page.mouse.click(clickTarget.x, clickTarget.y);
        await page.waitForTimeout(2600);
        if (await this.isWechatChannelTargetEntryReady(page, input.taskType))
          return;
      }
    } catch {
      // 入口页结构变化时，继续交给后续登录态和读取诊断。
    }

    const secondaryLabels =
      input.taskType === 'comment-reply'
        ? ['评论管理', '评论', '全部评论', '评论列表']
        : ['私信管理', '私信', '全部私信', '用户消息'];
    for (const label of secondaryLabels) {
      try {
        const clickTarget = await page.evaluate((targetLabel) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          };
          const nodes = Array.from(
            document.querySelectorAll(
              'a, button, [role="button"], [role="tab"], div, span',
            ),
          );
          const picked = nodes
            .filter((node) => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText || node.textContent);
              return { node: node, text, rect };
            })
            .filter(
              (item) =>
                item.text === targetLabel || item.text.startsWith(targetLabel),
            )
            .filter(
              (item) =>
                item.rect.width >= 30 &&
                item.rect.width <= 300 &&
                item.rect.height >= 18 &&
                item.rect.height <= 120,
            )
            .sort(
              (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x,
            )[0]?.node;
          if (!picked) return false;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
          const clickable = picked.closest(
            'a, button, [role="button"], [role="tab"], [tabindex]',
          ) as HTMLElement | null;
          const target = clickable || picked;
          const rect = target.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            text: normalize(target.innerText || target.textContent).slice(
              0,
              120,
            ),
          };
        }, label);
        if (!clickTarget) continue;
        this.logger.log(
          `wechat-channel secondary entry click ${input.taskType}/${label}: "${
            clickTarget.text
          }" @ ${Math.round(clickTarget.x)},${Math.round(clickTarget.y)} ${Math.round(
            clickTarget.width,
          )}x${Math.round(clickTarget.height)}`,
        );
        await page.mouse.click(clickTarget.x, clickTarget.y);
        await page.waitForTimeout(1800);
        if (await this.isWechatChannelTargetEntryReady(page, input.taskType))
          return;
      } catch {
        // 继续尝试其他二级入口。
      }
    }
  }

  private async isWechatChannelTargetEntryReady(
    page: Page,
    taskType: PlatformDispatchInput['taskType'],
  ): Promise<boolean> {
    const expectedFrames =
      taskType === 'comment-reply'
        ? ['micro/interaction/comment', 'platform/post/comment']
        : ['micro/interaction/private_msg', 'platform/private_msg'];
    if (
      page
        .frames()
        .some((frame) =>
          expectedFrames.some((fragment) => frame.url().includes(fragment)),
        )
    ) {
      return true;
    }
    const url = page.url();
    if (
      taskType === 'comment-reply' &&
      (url.includes('/platform/interaction/comment') ||
        url.includes('/platform/post/comment')) &&
      !url.includes('/login')
    ) {
      return true;
    }
    if (
      taskType === 'direct-message-reply' &&
      (url.includes('/platform/private_msg') || url.includes('/private_msg')) &&
      !url.includes('/login')
    ) {
      return true;
    }
    const text = await this.pageText(page, 1200);
    if (taskType === 'comment-reply') {
      return (
        /视频号助手\s*·\s*评论|评论管理/.test(text) &&
        /回复|删除|筛选|导出|评论/.test(text)
      );
    }
    return (
      /视频号助手\s*·\s*私信|私信管理|打招呼消息|全部私信/.test(text) &&
      /私信|消息/.test(text)
    );
  }

  private async ensureWechatChannelEntryReadyOrThrow(
    page: Page,
    input: Pick<PlatformDispatchInput, 'platform' | 'taskType'>,
  ): Promise<void> {
    if (input.platform !== 'wechat-channel') return;
    if (await this.isWechatChannelTargetEntryReady(page, input.taskType))
      return;

    const text = await this.pageText(page, 1200);
    const label = input.taskType === 'comment-reply' ? '评论' : '私信';
    const onAssistantHome =
      /视频号助手/.test(text) &&
      /多人运营|内容管理|互动管理|数据中心|变现功能|认证管理/.test(text) &&
      !/视频号助手\s*·\s*(?:评论|私信)|评论管理|私信管理|打招呼消息|全部私信/.test(
        text,
      );
    const currentUrl = page.url();
    const reason = onAssistantHome
      ? `当前停留在视频号助手首页，不能把首页卡片文案当${label}读取。`
      : `当前页面未出现视频号${label}业务区。`;
    throw new Error(
      `视频号${label}入口未打开：${reason} 当前地址：${currentUrl}`,
    );
  }

  private async ensureWechatChannelEntryReadyOrRecover(
    page: Page,
    input: Pick<PlatformDispatchInput, 'platform' | 'taskType' | 'accountId'>,
  ): Promise<Page | null> {
    if (input.platform !== 'wechat-channel') return null;
    try {
      await this.ensureWechatChannelEntryReadyOrThrow(page, input);
      return null;
    } catch (firstError) {
      const firstMessage =
        firstError instanceof Error ? firstError.message : String(firstError);
      if (
        !/入口未打开|视频号(?:评论|私信)业务区|视频号助手首页/.test(
          firstMessage,
        )
      ) {
        throw firstError;
      }
      this.logger.warn(
        `视频号入口未进入业务区，恢复 5409 legacy profile 后重试一次：${firstMessage}`,
      );
    }

    const recovered =
      await this.browser.recoverWechatChannelSessionFromLegacyProfile({
        accountId: input.accountId,
        taskType: input.taskType,
      });
    if (!recovered) {
      await this.ensureWechatChannelEntryReadyOrThrow(page, input);
      return null;
    }
    await recovered.page.waitForTimeout(2500);
    await this.clickWechatChannelEntryIfNeeded(recovered.page, input);
    await this.waitForPlatformInteractionSettled(
      recovered.page,
      input.platform,
      input.taskType,
    );
    await this.ensureWechatChannelEntryReadyOrThrow(recovered.page, input);
    return recovered.page;
  }

  private async checkLoginState(
    page: Page,
    platform: PlatformDispatchInput['platform'],
  ): Promise<{ ok: boolean; message: string }> {
    const url = page.url().toLowerCase();
    const text = await this.pageText(page, 1000);
    const loginPrompt =
      /扫码登录|验证码登录|密码登录|登录\/注册|登录或注册|请先登录|未登录|二维码/.test(
        text,
      );
    const wechatChannelLoggedInHome =
      platform === 'wechat-channel' &&
      /视频号助手/.test(text) &&
      /多人运营|内容管理|互动管理|数据中心|认证管理/.test(text) &&
      !loginPrompt;
    if (wechatChannelLoggedInHome) return { ok: true, message: '已登录' };
    const wechatChannelPublicHome =
      platform === 'wechat-channel' &&
      /一站式服务/.test(text) &&
      /让创作更简单|多人运营|内容管理|互动管理/.test(text);
    const loggedOut =
      /login|signin|passport/.test(url) ||
      loginPrompt ||
      wechatChannelPublicHome;
    if (!loggedOut) return { ok: true, message: '已登录' };
    return {
      ok: false,
      message:
        platform === 'douyin'
          ? '抖音账号未登录，不能读取或回复。'
          : '视频号账号未登录，不能读取或回复。',
    };
  }

  private async performDomInteraction(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const targetFrame = await this.resolveTargetFrame(page, input);
    if (
      input.platform === 'wechat-channel' &&
      input.taskType === 'direct-message-reply'
    ) {
      return this.performWechatChannelInteraction(page, input);
    }
    if (
      input.platform === 'wechat-channel' &&
      input.taskType === 'comment-reply'
    ) {
      return this.performWechatChannelInteraction(page, input);
    }
    if (
      input.platform === 'douyin' &&
      input.taskType === 'direct-message-reply'
    ) {
      return this.performDouyinMessageInteraction(page, input);
    }
    if (input.platform === 'douyin' && input.taskType === 'comment-reply') {
      return this.performDouyinCommentInteraction(page, input);
    }

    const action = await targetFrame.evaluate(
      ({ targetText, replyText, shouldSend, missingStatus, isMessage }) => {
        const delay = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.pointerEvents !== 'none' &&
            Number(style.opacity) !== 0
          );
        };
        const readValue = (node: Element) =>
          normalize(
            'value' in node
              ? (node as HTMLInputElement).value
              : node.textContent,
          );
        const setEditorValue = (editor: Element, value: string) => {
          (editor as HTMLElement).focus();
          editor.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
          editor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          if ('value' in editor) {
            const descriptor = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(editor),
              'value',
            );
            if (descriptor?.set) descriptor.set.call(editor, value);
            else (editor as HTMLInputElement).value = value;
            editor.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: value,
              }),
            );
            editor.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            editor.textContent = value;
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
            editor.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: value,
              }),
            );
          }
          editor.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              key: value.slice(-1) || 'a',
            }),
          );
          editor.dispatchEvent(
            new KeyboardEvent('keyup', {
              bubbles: true,
              key: value.slice(-1) || 'a',
            }),
          );
        };
        const textMatches = (text: string, target: string) => {
          const normalizedText = normalize(text);
          const normalizedTarget = normalize(target);
          if (!normalizedTarget) return false;
          return (
            normalizedText.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedText)
          );
        };
        const rowSelector =
          'li, tr, section, article, [role="row"], [role="listitem"], [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="chat"], [class*="Chat"], [class*="session"], [class*="Session"], [class*="conversation"], [class*="Conversation"], [class*="item"], [class*="Item"], div';
        const candidateRows = Array.from(document.querySelectorAll(rowSelector))
          .filter(
            (node) =>
              visible(node) && textMatches(node.textContent || '', targetText),
          )
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.textContent || '');
            const className = String((node as HTMLElement).className || '');
            const replySignal =
              /回复|发送|删除|未读|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
                text,
              );
            const classSignal =
              /comment|message|chat|session|conversation|item/i.test(className);
            const score =
              (replySignal ? 60 : 0) +
              (classSignal ? 40 : 0) +
              (rect.x > 120 ? 10 : 0) +
              (rect.width > 120 ? 10 : 0) -
              Math.min(text.length, 900) / 12 -
              (rect.height > 360 ? 80 : 0);
            return { node, rect, text, score };
          })
          .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

        const targetRow = candidateRows[0]?.node || null;
        if (!targetRow) {
          return {
            status: missingStatus,
            message: '未在当前页面找到目标对象，未操作。',
          };
        }
        try {
          targetRow.scrollIntoView({ block: 'center', inline: 'nearest' });
          targetRow.dispatchEvent(
            new MouseEvent('mouseover', { bubbles: true }),
          );
          targetRow.dispatchEvent(
            new MouseEvent('mousedown', { bubbles: true }),
          );
          targetRow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          (targetRow as HTMLElement).click();
        } catch {
          /* 容错：非关键路径失败忽略 */
        }

        return delay(isMessage ? 2400 : 900).then(async () => {
          const root =
            targetRow.closest(
              '[class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="chat"], [class*="Chat"], [class*="session"], [class*="Session"], li, tr, section, article',
            ) || document.body;
          const replyTriggers = Array.from(
            root.querySelectorAll('button, [role="button"], span, div, a'),
          )
            .filter(
              (node) => visible(node) && normalize(node.textContent) === '回复',
            )
            .sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return ar.width * ar.height - br.width * br.height;
            });
          if (replyTriggers[0]) {
            try {
              replyTriggers[0].dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true }),
              );
              replyTriggers[0].dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
              );
              (replyTriggers[0] as HTMLElement).click();
              replyTriggers[0].dispatchEvent(
                new MouseEvent('mouseup', { bubbles: true }),
              );
            } catch {
              /* 容错：非关键路径失败忽略 */
            }
            await delay(900);
          }

          const editors = Array.from(
            document.querySelectorAll(
              'textarea.edit_area, textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter(visible)
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const value = readValue(node);
              const placeholder = normalize(node.getAttribute('placeholder'));
              const insideRoot = root.contains(node);
              return { node, rect, value, placeholder, insideRoot };
            })
            .sort((a, b) => {
              const aReply = /^回复/.test(a.placeholder) ? 0 : 1;
              const bReply = /^回复/.test(b.placeholder) ? 0 : 1;
              return (
                Number(!a.insideRoot) - Number(!b.insideRoot) ||
                aReply - bReply ||
                b.rect.y - a.rect.y
              );
            });
          const editor = editors[0]?.node;
          if (!editor) {
            return {
              status: 'editor_missing',
              message: '已找到目标对象，但没有找到可编辑回复框。',
            };
          }
          setEditorValue(editor, replyText);
          await delay(600);

          if (!shouldSend) {
            return {
              status: 'draft_filled',
              message: '回复草稿已填入，未点击发送。',
              replyVisible: true,
              readbackText: replyText,
            };
          }

          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const editorRect = editor.getBoundingClientRect();
          const disabled = (node: Element) => {
            const aria = String(
              node.getAttribute('aria-disabled') || '',
            ).toLowerCase();
            return (
              Boolean((node as HTMLButtonElement).disabled) ||
              aria === 'true' ||
              /disabled/.test(
                String((node as HTMLElement).className || '').toLowerCase(),
              )
            );
          };
          const findButtons = () =>
            Array.from(
              document.querySelectorAll(
                'button, [role="button"], span, div, a',
              ),
            )
              .filter((node) => {
                if (!visible(node) || disabled(node)) return false;
                const text = normalize(node.textContent);
                if (!/^(发送|回复|提交|评论)$/.test(text)) return false;
                const rect = node.getBoundingClientRect();
                const isButton =
                  node.tagName === 'BUTTON' ||
                  node.getAttribute('role') === 'button';
                if (!isButton && (rect.width > 180 || rect.height > 64))
                  return false;
                return (
                  Math.abs(rect.y - editorRect.y) <= 280 ||
                  rect.y > editorRect.y - 80
                );
              })
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const priority =
                  node.tagName === 'BUTTON'
                    ? 0
                    : node.getAttribute('role') === 'button'
                      ? 1
                      : 2;
                const distance =
                  Math.abs(rect.y - editorRect.y) +
                  Math.abs(rect.x - editorRect.x);
                return {
                  node,
                  rect,
                  priority,
                  distance,
                  text: normalize(node.textContent),
                };
              })
              .sort(
                (a, b) => a.priority - b.priority || a.distance - b.distance,
              );
          let buttons = findButtons();
          for (
            let attempt = 0;
            buttons.length === 0 && attempt < 5;
            attempt += 1
          ) {
            editor.focus();
            editor.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: replyText,
              }),
            );
            await delay(500);
            buttons = findButtons();
          }
          const button = buttons[0]?.node;
          if (!button) {
            return {
              status: 'send_failed',
              message: '回复已写入，但没有识别到发送按钮。',
              replyVisible: false,
              readbackText: readValue(editor),
            };
          }
          try {
            (button as HTMLElement).click();
          } catch {
            const rect = button.getBoundingClientRect();
            document
              .elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              )
              ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
          await delay(2600);
          const bodyText = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          const editorsAfter = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter(visible)
            .map(readValue);
          const replyStillInEditor = editorsAfter.some((value) =>
            value.includes(replyPrefix),
          );
          const bodyHasReply = bodyText.includes(replyPrefix);
          const hasSendFailureText =
            /发送失败|发送异常|重新发送|网络异常|稍后再试|未发送|消息发送失败|只有群主和管理员可以发消息|没有发言权限|不能发送消息|无权发送|无法发送/.test(
              bodyText,
            );
          const hasReplyErrorMarker = Array.from(
            document.querySelectorAll('svg, i, span, div'),
          )
            .filter(visible)
            .some((node) => {
              const rect = node.getBoundingClientRect();
              const style = window.getComputedStyle(node);
              const text = normalize(node.textContent);
              const color =
                `${style.color} ${style.backgroundColor} ${style.borderColor}`.toLowerCase();
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
              const replyNode = Array.from(
                document.querySelectorAll('div, span, p'),
              )
                .filter(visible)
                .find((candidate) =>
                  normalize(candidate.textContent).includes(replyPrefix),
                ) as HTMLElement | undefined;
              const replyRect = replyNode?.getBoundingClientRect();
              const nearReply = Boolean(
                bodyHasReply &&
                rect.width <= 40 &&
                rect.height <= 40 &&
                ((replyRect &&
                  Math.abs(rect.x + rect.width / 2 - replyRect.x) <= 120 &&
                  Math.abs(
                    rect.y +
                      rect.height / 2 -
                      (replyRect.y + replyRect.height / 2),
                  ) <= 80) ||
                  (!replyRect &&
                    rect.x > window.innerWidth * 0.55 &&
                    rect.y > window.innerHeight * 0.45)),
              );
              const redLike =
                color.includes('255, 77') ||
                color.includes('255, 59') ||
                color.includes('254, 44') ||
                color.includes('239, 68') ||
                color.includes('220, 38') ||
                color.includes('rgb(255') ||
                color.includes('red');
              return nearReply && (redLike || text === '!' || text === '！');
            });
          const sent =
            bodyHasReply &&
            !replyStillInEditor &&
            !hasSendFailureText &&
            !hasReplyErrorMarker;
          return {
            status: sent ? 'sent' : 'send_failed',
            message: sent
              ? '回复已点击发送，并在页面回读到回复内容。'
              : hasReplyErrorMarker || hasSendFailureText
                ? '已点击发送，但页面显示发送异常标记，未确认真实发出。'
                : '已点击发送，但页面未确认回复发出。',
            replyVisible: bodyHasReply,
            readbackText: bodyHasReply
              ? replyText
              : editorsAfter.find((value) => value.includes(replyPrefix)) || '',
            nextAction: sent
              ? undefined
              : '请检查平台是否弹出验证、发送按钮是否失效、账号是否限制发送或页面结构是否变化。',
          };
        });
      },
      {
        targetText: input.targetText,
        replyText: input.replyText,
        shouldSend: input.action === 'send',
        missingStatus:
          input.taskType === 'comment-reply'
            ? 'comment_missing'
            : 'message_missing',
        isMessage: input.taskType === 'direct-message-reply',
      },
    );
    return action as {
      status: PlatformDispatchResult['status'];
      message: string;
      readbackText?: string;
      replyVisible?: boolean;
      nextAction?: string;
    };
  }

  private async performDouyinMessageInteraction(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const trace: DouyinImTraceEvent[] = [];
    const routeCapture = await this.installDouyinImRouteCapture(
      page.context(),
      trace,
    );
    await this.installDouyinImWindowCapture(page);
    try {
      const hasTargetOnCurrentMessagePage =
        await this.pageContainsInteractionTarget(
          page,
          input.targetText,
          input.targetName,
        );
      const canUseCurrentMessagePage =
        /following\/chat|im|message|chat/i.test(page.url()) &&
        hasTargetOnCurrentMessagePage;
      if (canUseCurrentMessagePage) {
        await this.dismissDouyinOverlays(page).catch(() => undefined);
        await this.waitForDouyinMessagePageSettled(page, 5000).catch(
          () => undefined,
        );
      } else {
        await this.openDouyinMessagePage(page);
      }
      const scanResult = await this.scanDouyinMessageTabs(
        page,
        10,
        input.targetText,
        input.targetName || '',
      );
      await this.collectDouyinImWindowCapture(page, trace, 10);
      const loadBlocked = this.douyinMessageLoadBlockedSummary(scanResult);
      if (loadBlocked && !(scanResult.messages || []).length) {
        return {
          status: 'message_missing',
          message: String(
            loadBlocked.emptyReason ||
              '抖音私信页会话列表持续加载，未进入可回复状态。',
          ),
          nextAction: String(
            loadBlocked.nextAction ||
              '请确认抖音创作者后台私信页能正常显示后重试。',
          ),
        };
      }
      const targetState = await page.evaluate(
        async ({ targetText, targetName }) => {
          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none' &&
              Number(style.opacity) !== 0
            );
          };
          const textMatchesTarget = (text: string) => {
            const normalized = normalize(text);
            const target = normalize(targetText);
            if (!target) return false;
            return normalized.includes(target) || target.includes(normalized);
          };
          const nameMatchesTarget = (text: string) => {
            const normalized = normalize(text);
            const name = normalize(targetName);
            return Boolean(name && normalized.includes(name));
          };
          const rowSelectors =
            '[role="gridcell"], [role="row"], [role="listitem"], li, tr, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="session"], [class*="Session"], [class*="item"], [class*="Item"]';
          const rowLooksUnreplyable = (text: string) =>
            /你收到一条新类型消息|请打开抖音\s*app\s*查看|分享\[视频\]|\[视频\]|\[图片\]|该消息类型暂不支持|当前版本暂不支持/.test(
              text,
            );
          const rowLooksTooBroad = (text: string) =>
            /全部|朋友私信|陌生人私信|群消息|全选/.test(text) &&
            text.length > 260;
          const rectPayload = (node: Element) => {
            const rect = node.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          };
          const scoreClickTarget = (node: Element, sourceNode: Element) => {
            const rect = (node as HTMLElement).getBoundingClientRect();
            const text = normalize(
              (node as HTMLElement).innerText || node.textContent,
            );
            const className = String((node as HTMLElement).className || '');
            let score = 0;
            if (node === sourceNode) score += 4;
            if ((node as HTMLElement).matches(rowSelectors)) score += 20;
            if (
              /(chat|message|conversation|session|item|list)/i.test(className)
            )
              score += 14;
            if (rect.width >= 260 && rect.width <= 1400) score += 34;
            if (rect.height >= 44 && rect.height <= 150) score += 42;
            if (rect.x >= 220 && rect.y >= 100) score += 10;
            if (nameMatchesTarget(text)) score += 28;
            if (
              /刚刚|今天|昨天|星期[一二三四五六日天]|\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|\d+分钟前|\d+小时前/.test(
                text,
              )
            )
              score += 8;
            if (text.length > 260) score -= 26;
            if (text.length > 420) score -= 80;
            if (rect.width > 1500) score -= 120;
            if (rect.height > 260) score -= 38;
            if (rect.height > 180) score -= 100;
            if (rect.x < 220 || rect.x > 900) score -= 50;
            if (rowLooksTooBroad(text)) score -= 60;
            return score;
          };
          const allNodes = Array.from(
            document.querySelectorAll(`${rowSelectors}, div, span, p, td`),
          );
          const nodeMatchesTarget = (text: string) =>
            textMatchesTarget(text) || nameMatchesTarget(text);
          const targetNodes = allNodes.filter(
            (node) =>
              visible(node) &&
              nodeMatchesTarget(node.innerText || node.textContent || ''),
          );
          const scoredTargets: Array<{
            node: Element;
            text: string;
            score: number;
            rect: { x: number; y: number; width: number; height: number };
          }> = [];
          const seenTargets = new Set<string>();
          for (const sourceNode of targetNodes) {
            let node: Element | null = sourceNode;
            for (
              let depth = 0;
              node && node !== document.body && depth < 9;
              depth += 1, node = node.parentElement
            ) {
              if (!visible(node)) continue;
              const text = normalize(node.innerText || node.textContent);
              if (!nodeMatchesTarget(text)) continue;
              const rect = node.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;
              if (
                rect.x < 180 ||
                rect.y < 120 ||
                rect.width < 180 ||
                rect.width > 1500 ||
                rect.height < 32 ||
                rect.height > 180 ||
                text.length > 420
              )
                continue;
              const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${text.slice(0, 40)}`;
              if (seenTargets.has(key)) continue;
              seenTargets.add(key);
              scoredTargets.push({
                node,
                text,
                score: scoreClickTarget(node, sourceNode),
                rect: rectPayload(node),
              });
            }
          }
          scoredTargets.sort(
            (a, b) =>
              b.score - a.score ||
              Math.abs(a.rect.height - 72) - Math.abs(b.rect.height - 72) ||
              a.rect.y - b.rect.y,
          );
          const bestTarget = scoredTargets[0];
          const messageNode = bestTarget?.node;
          if (!messageNode) {
            return {
              status: 'message_missing',
              message: '未在当前私信页找到目标私信，未发送。',
            };
          }
          const rowText =
            bestTarget.text ||
            normalize(
              (messageNode as HTMLElement).innerText || messageNode.textContent,
            );
          if (
            rowLooksUnreplyable(rowText) &&
            (!normalize(targetText) ||
              rowLooksUnreplyable(normalize(targetText)))
          ) {
            return {
              status: 'message_missing',
              message: '目标私信是抖音当前网页不可回复的消息类型，未发送。',
              selected: {
                text: targetText || targetName,
                context: rowText.slice(0, 180),
              },
            };
          }
          try {
            (messageNode as HTMLElement).scrollIntoView({
              block: 'center',
              inline: 'nearest',
            });
            await delay(350);
          } catch {
            /* 容错：非关键路径失败忽略 */
          }
          const rect = (messageNode as HTMLElement).getBoundingClientRect();
          return {
            status: 'target_ready',
            message: '已找到目标私信，准备真实点击会话。',
            selected: {
              text: targetText || targetName,
              context: rowText.slice(0, 180),
            },
            targetClickRect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          };
        },
        { targetText: input.targetText, targetName: input.targetName || '' },
      );

      if (
        targetState.status !== 'target_ready' ||
        !targetState.targetClickRect
      ) {
        return {
          status:
            targetState.status === 'message_missing'
              ? 'message_missing'
              : 'failed',
          message:
            targetState.message || '未在当前私信页找到目标私信，未发送。',
          nextAction: '请检查抖音私信列表是否仍包含目标对象。',
        };
      }

      const targetRect = targetState.targetClickRect;
      const targetX =
        targetRect.x + Math.min(Math.max(targetRect.width / 2, 40), 220);
      const targetY = targetRect.y + Math.max(targetRect.height / 2, 1);
      await page.mouse.click(targetX, targetY);
      await page.waitForTimeout(1200);
      await this.waitForDouyinMessageEditorOrSettled(page, 12000);

      const editorState = await page.evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0 &&
            style.pointerEvents !== 'none'
          );
        };
        const nodes = Array.from(
          document.querySelectorAll(
            'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
          ),
        )
          .filter(visible)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const value = normalize(
              'value' in node
                ? (node as HTMLInputElement).value
                : node.innerText || node.textContent,
            );
            return {
              tag: node.tagName,
              value,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            };
          })
          .sort((a, b) => b.rect.y - a.rect.y);
        const editor = nodes[0];
        if (!editor) {
          return {
            status: 'editor_missing',
            message: '真实点击目标会话后仍未打开抖音私信输入框。',
            pageTextSample: normalize(document.body.innerText).slice(0, 500),
          };
        }
        return {
          status: 'editor_ready',
          message: '真实点击目标会话后已打开抖音私信输入框。',
          editorTag: editor.tag,
          editorRect: editor.rect,
        };
      });

      if (editorState.status !== 'editor_ready' || !editorState.editorRect) {
        const selectedText = targetState.selected?.context
          ? ` selected=${targetState.selected.context}`
          : '';
        const selectedRect = targetState.targetClickRect
          ? ` rect=${JSON.stringify(targetState.targetClickRect)}`
          : '';
        return {
          status: 'editor_missing',
          message:
            `${editorState.message || '已找到目标对象，但没有找到可编辑回复框。'}${selectedText}${selectedRect}`.slice(
              0,
              900,
            ),
          nextAction:
            '抖音网页没有打开会话详情；需要重新校准私信列表点击区域或确认该消息类型是否支持网页回复。',
        };
      }

      const editorRect = editorState.editorRect;
      const editorX =
        editorRect.x + Math.min(Math.max(editorRect.width / 2, 2), 160);
      const editorY = editorRect.y + Math.max(editorRect.height / 2, 1);
      await page.mouse.click(editorX, editorY);
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(input.replyText);
      await page.waitForTimeout(900);

      if (input.action !== 'send') {
        return {
          status: 'draft_filled',
          message: '私信回复草稿已填入，未点击发送。',
          readbackText: input.replyText,
          replyVisible: true,
        };
      }

      const sendButton = await page.evaluate(
        ({ replyText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0 &&
              style.pointerEvents !== 'none'
            );
          };
          const editorValue = (editor: Element) =>
            normalize(
              'value' in editor
                ? (editor as HTMLInputElement).value
                : (editor as HTMLElement).innerText || editor.textContent,
            );
          const isDisabled = (node: Element) => {
            const aria = String(
              node.getAttribute('aria-disabled') || '',
            ).toLowerCase();
            return (
              Boolean((node as HTMLButtonElement).disabled) ||
              aria === 'true' ||
              /disabled/.test(
                String((node as HTMLElement).className || '').toLowerCase(),
              )
            );
          };
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const editors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter(visible)
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const value = editorValue(node);
              return { node, rect, value };
            })
            .sort((a, b) => {
              const aHasReply = a.value.includes(replyPrefix) ? 0 : 1;
              const bHasReply = b.value.includes(replyPrefix) ? 0 : 1;
              return aHasReply - bHasReply || b.rect.y - a.rect.y;
            });
          const editor = editors[0];
          if (!editor || !editor.value.includes(replyPrefix)) {
            return {
              status: 'editor_input_failed',
              message: '回复没有真实进入抖音私信输入框，未发送。',
              editorValue: editor?.value || '',
            };
          }
          const candidates = Array.from(
            document.querySelectorAll('button, [role="button"], span, div'),
          )
            .filter((node) => {
              if (!visible(node) || isDisabled(node)) return false;
              const text = normalize(node.innerText || node.textContent);
              if (!/^(发送|回复|提交)$/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              const tag = String(node.tagName || '').toUpperCase();
              const role = String(
                node.getAttribute('role') || '',
              ).toLowerCase();
              const isRealButton = tag === 'BUTTON' || role === 'button';
              if (!isRealButton && (rect.width > 180 || rect.height > 64))
                return false;
              return (
                Math.abs(rect.y - editor.rect.y) <= 260 ||
                rect.y > editor.rect.y - 80
              );
            })
            .map((node) => {
              const rect = (node as HTMLElement).getBoundingClientRect();
              const text = normalize(
                (node as HTMLElement).innerText || node.textContent,
              );
              const tag = String(node.tagName || '').toUpperCase();
              const role = String(
                node.getAttribute('role') || '',
              ).toLowerCase();
              const priority =
                tag === 'BUTTON'
                  ? 0
                  : role === 'button'
                    ? 1
                    : tag === 'SPAN'
                      ? 2
                      : 3;
              const distance =
                Math.abs(rect.y - editor.rect.y) +
                Math.abs(rect.x - editor.rect.x);
              return {
                text,
                priority,
                distance,
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              };
            })
            .sort((a, b) => a.priority - b.priority || a.distance - b.distance);
          const button = candidates[0];
          if (!button) {
            return {
              status: 'send_button_missing',
              message: '回复已输入，但没有找到抖音私信发送按钮。',
              editorValue: editor.value,
            };
          }
          return {
            status: 'ready_to_click_send',
            message: '回复已通过键盘输入，发送按钮可点击。',
            sendButtonText: button.text,
            sendButtonRect: button.rect,
            editorValue: editor.value,
          };
        },
        { replyText: input.replyText },
      );

      if (
        sendButton.status !== 'ready_to_click_send' ||
        !sendButton.sendButtonRect
      ) {
        return {
          status:
            sendButton.status === 'editor_input_failed'
              ? 'editor_missing'
              : 'send_failed',
          message: sendButton.message || '回复已写入，但没有识别到发送按钮。',
          readbackText: sendButton.editorValue || '',
          replyVisible: Boolean(sendButton.editorValue),
          nextAction: '请检查抖音私信发送按钮是否因平台限制或验证而不可用。',
        };
      }

      const buttonRect = sendButton.sendButtonRect;
      await page.mouse.click(
        buttonRect.x + Math.max(buttonRect.width / 2, 1),
        buttonRect.y + Math.max(buttonRect.height / 2, 1),
      );
      const verify = await page.evaluate(
        async ({ replyText }) => {
          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const readState = () => {
            const editors = Array.from(
              document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            )
              .filter(visible)
              .map((node) =>
                normalize(
                  'value' in node
                    ? (node as HTMLInputElement).value
                    : node.innerText || node.textContent,
                ),
              );
            const replyStillInEditor = editors.some((value) =>
              value.includes(replyPrefix),
            );
            const bodyText = normalize(document.body.innerText);
            const hasSendFailureText =
              /发送失败|发送异常|重新发送|网络异常|稍后再试|未发送|消息发送失败|没有发言权限|不能发送消息|无权发送|无法发送/.test(
                bodyText,
              );
            return {
              replyStillInEditor,
              bodyHasReply: bodyText.includes(replyPrefix),
              readbackText: bodyText.includes(replyPrefix) ? replyText : '',
              hasSendFailureText,
            };
          };
          let state = readState();
          for (let i = 0; i < 8; i += 1) {
            if (!state.replyStillInEditor && state.bodyHasReply) return state;
            await delay(750);
            state = readState();
          }
          return state;
        },
        { replyText: input.replyText },
      );
      const sent =
        !verify.replyStillInEditor &&
        Boolean(verify.bodyHasReply) &&
        !verify.hasSendFailureText;
      return {
        status: sent ? 'sent' : 'send_failed',
        message: sent
          ? '私信回复已点击发送，并已在抖音页面看到回复内容。'
          : verify.hasSendFailureText
            ? '已点击发送，但页面显示发送异常标记，未确认真实发出。'
            : '已点击发送按钮，但抖音页面未看到回复内容，未确认真实发出。',
        readbackText: sent ? input.replyText : verify.readbackText || '',
        replyVisible: Boolean(verify.bodyHasReply),
        nextAction: sent
          ? undefined
          : '请检查平台是否弹出验证、账号是否限制发送或当前消息类型是否支持网页回复。',
      };
    } finally {
      await this.detachDouyinImRouteCapture(page.context(), routeCapture);
    }
  }

  private async readDouyinMessagesWithLocalBrowser(
    page: Page,
    session: {
      key: string;
      profileDir: string;
      debuggingPort?: number;
      browser?: string;
      browserReused?: boolean;
    },
    input: PlatformReadInput,
  ): Promise<Record<string, any>> {
    const trace: DouyinImTraceEvent[] = [];
    const routeCapture = await this.installDouyinImRouteCapture(
      page.context(),
      trace,
    );
    await this.installDouyinImWindowCapture(page);
    try {
      await this.openDouyinMessagePage(page);
      const limit = Math.max(1, Math.min(Number(input.limit || 10), 20));
      let scan = await this.scanDouyinMessageTabs(page, limit);
      if (!Array.isArray(scan.messages) || scan.messages.length === 0) {
        await page.waitForTimeout(1800).catch(() => undefined);
        const retryScan = await this.scanDouyinMessageTabs(page, limit);
        const retryMessages = Array.isArray(retryScan.messages)
          ? retryScan.messages
          : [];
        if (
          retryMessages.length > 0 ||
          Number(retryScan.totalCandidates || 0) >
            Number(scan.totalCandidates || 0)
        ) {
          scan = {
            ...retryScan,
            retriedAfterEmptyScan: true,
            firstScan: {
              selectedTab: scan.selectedTab,
              totalCandidates: scan.totalCandidates || 0,
              usableCount: Array.isArray(scan.messages)
                ? scan.messages.length
                : 0,
              pageTextSample: scan.pageTextSample || '',
            },
          };
        }
      } else {
        await page.waitForTimeout(1200).catch(() => undefined);
      }
      const windowCapture = await this.collectDouyinImWindowCapture(
        page,
        trace,
        limit,
      );
      const evidence = await this.captureSessionScreenshot(
        session.key,
        `douyin-messages-read-${input.accountId}`,
      );
      const domMessages = Array.isArray(scan.messages) ? scan.messages : [];
      const textFallbackMessages = domMessages.length
        ? []
        : this.extractDouyinMessageCandidatesFromPageText(
            scan.pageTextSample || (await this.pageText(page, 1600)),
            limit,
          );
      const messages =
        scan.selectedTab === '群消息' ? [] : domMessages.slice(0, limit);
      const networkOnlyMessages = this.mergeDouyinMessageCandidates(
        [],
        trace,
        limit,
      );
      const totalCandidates = Math.max(
        Number(scan.totalCandidates || 0),
        domMessages.length,
      );
      const loadBlockedSummary = this.douyinMessageLoadBlockedSummary(scan);
      return {
        accountId: Number(input.accountId) || input.accountId,
        platformName: '抖音',
        platformType: 3,
        url: scan.url || page.url(),
        title: scan.title || (await page.title().catch(() => '')),
        messages,
        summary:
          loadBlockedSummary ||
          this.interactionReadSummary(totalCandidates, messages, '私信'),
        loadBlocked: Boolean(scan.loadBlocked),
        loadBlockedReason: scan.loadBlockedReason,
        selectedTab: scan.selectedTab,
        scannedTabs: scan.scannedTabs || [],
        pageLoadState: scan.pageLoadState,
        pageTextSample: scan.pageTextSample || '',
        imCapture: {
          routeEvents: routeCapture.captures.length,
          windowEvents: windowCapture.status || 0,
          messageCandidates: windowCapture.messageCandidates || [],
          networkOnlyMessageCandidates: networkOnlyMessages,
          textFallbackCount: textFallbackMessages.length,
          textFallbackMessageCandidates: textFallbackMessages,
        },
        evidence: evidence.evidencePath
          ? {
              type: 'screenshot',
              label: '私信读取截图',
              path: evidence.evidencePath,
              value: evidence.evidencePath,
            }
          : null,
        readAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        profileDir: session.profileDir,
        cdpPort: session.debuggingPort ?? null,
        browser: session.browser ?? null,
        browserReused: session.browserReused ?? null,
        networkTrace: trace.slice(-30),
      };
    } finally {
      await this.detachDouyinImRouteCapture(page.context(), routeCapture);
    }
  }

  private async openDouyinMessagePage(page: Page): Promise<void> {
    await this.gotoBestEffort(
      page,
      'https://creator.douyin.com/creator-micro/data/following/chat',
      30000,
    );
    await page
      .waitForLoadState('networkidle', { timeout: 12000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500).catch(() => undefined);
    if (!page.url().includes('following/chat')) {
      for (const label of [
        '互动管理',
        '私信管理',
        '私信',
        '用户私信',
        '消息',
      ]) {
        try {
          await page
            .getByText(label, { exact: true })
            .first()
            .click({ timeout: 2500 });
          await page.waitForTimeout(1200);
        } catch {
          // 继续尝试其他入口。
        }
      }
    } else {
      await this.clickDouyinMessageTab(page, '全部').catch(() => false);
    }
    await this.dismissDouyinOverlays(page);
    await this.waitForDouyinMessagePageSettled(page, 14000);
  }

  private async scanDouyinMessageTabs(
    page: Page,
    limit = 10,
    targetText = '',
    targetName = '',
  ): Promise<Record<string, any> & { messages?: Array<Record<string, any>> }> {
    const tabs = ['全部', '朋友私信', '陌生人私信'];
    const scannedTabs: Array<Record<string, any>> = [];
    let bestScan:
      | (Record<string, any> & { messages?: Array<Record<string, any>> })
      | null = null;
    const target = this.normalizeInteractionText(targetText);
    const targetContact = this.normalizeInteractionText(targetName);
    const emptyScan = async (
      reason: string,
    ): Promise<
      Record<string, any> & { messages: Array<Record<string, any>> }
    > => ({
      url: page.url(),
      title: await page.title().catch(() => ''),
      totalCandidates: 0,
      messages: [],
      pageTextSample: await this.pageText(page, 800),
      loadBlocked: true,
      loadBlockedReason: reason,
    });
    const evaluateScan = async (
      reason: string,
    ): Promise<
      Record<string, any> & { messages: Array<Record<string, any>> }
    > => {
      const scan = (await page
        .evaluate(
          ({ script, scanLimit }) => {
            const fn = (0, eval)(script);
            if (typeof fn !== 'function') {
              throw new Error('抖音私信扫描脚本未返回可执行函数。');
            }
            return fn(scanLimit);
          },
          { script: this.douyinMessageScanScript(), scanLimit: limit },
        )
        .catch((error) =>
          emptyScan(
            `${reason}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )) as Record<string, any> | null | undefined;
      if (!scan || typeof scan !== 'object') {
        return emptyScan(reason);
      }
      return {
        ...scan,
        url: scan.url || page.url(),
        title: scan.title || (await page.title().catch(() => '')),
        totalCandidates: Number(scan.totalCandidates || 0),
        messages: Array.isArray(scan.messages) ? scan.messages : [],
        pageTextSample: String(
          scan.pageTextSample || (await this.pageText(page, 800)),
        ),
      };
    };

    for (let index = 0; index < tabs.length; index += 1) {
      const label = tabs[index];
      let clicked = false;
      if (index > 0 || target) {
        clicked = await this.clickDouyinMessageTab(page, label);
        if (clicked) {
          await page.waitForTimeout(1200).catch(() => undefined);
        }
      }
      const settled = await this.waitForDouyinMessagePageSettled(
        page,
        index === 0 ? 9000 : 5000,
      );
      const scan = await evaluateScan('抖音私信页扫描未返回可用结果');
      scan.selectedTab = label;
      scan.tabClicked = Boolean(clicked);
      scan.pageLoadState = settled;
      const messages = scan.messages || [];
      scannedTabs.push({
        label,
        clicked: Boolean(clicked),
        totalCandidates: scan.totalCandidates,
        usableCount: messages.length,
        pageTextSample: scan.pageTextSample || '',
        loading: settled?.visibleLoaders || 0,
      });
      if (
        (target || targetContact) &&
        this.douyinMessageScanHasTarget(scan, target, targetContact)
      ) {
        scan.scannedTabs = scannedTabs;
        return scan;
      }
      if (messages.length && !target && !targetContact) {
        scan.scannedTabs = scannedTabs;
        return scan;
      }
      if (
        !bestScan ||
        Number(scan.totalCandidates || 0) >
          Number(bestScan.totalCandidates || 0)
      ) {
        bestScan = scan;
      }
      if (index === 0 && !target) {
        const pageText = this.normalizeInteractionText(
          String(scan.pageTextSample || ''),
        );
        const emptyMatch = pageText.match(
          /还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/,
        );
        if (emptyMatch) {
          scan.emptyState = true;
          scan.emptyReason = emptyMatch[0];
          scan.scannedTabs = scannedTabs;
          return scan;
        }
      }
    }

    const fallback =
      bestScan || (await evaluateScan('抖音私信页最终扫描未返回可用结果'));
    fallback.scannedTabs = scannedTabs;
    const stillLoading = scannedTabs.some(
      (tab) => Number(tab.loading || 0) > 0,
    );
    const hasUsableText = scannedTabs.some(
      (tab) => Number(tab.totalCandidates || 0) > 0,
    );
    const pageText = this.normalizeInteractionText(
      String(fallback.pageTextSample || ''),
    );
    const emptyMatch = pageText.match(
      /还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/,
    );
    if (emptyMatch && !hasUsableText) {
      fallback.emptyState = true;
      fallback.emptyReason = emptyMatch[0];
      delete fallback.loadBlocked;
      delete fallback.loadBlockedReason;
    } else if (stillLoading && !hasUsableText) {
      fallback.loadBlocked = true;
      fallback.loadBlockedReason =
        '抖音私信页会话列表持续加载，未进入可读取状态。';
    }
    return fallback;
  }

  private douyinMessageScanHasTarget(
    scan: { messages?: Array<Record<string, any>> } | null | undefined,
    targetText: string,
    targetName = '',
  ): boolean {
    const target = this.normalizeInteractionText(targetText);
    const contactTarget = this.normalizeInteractionText(targetName);
    if (!target && !contactTarget) return Boolean(scan?.messages?.length);
    return Boolean(
      scan?.messages?.some((item) => {
        const source = String(item.source || '').toLowerCase();
        if (source === 'text-node') return false;
        const text = this.normalizeInteractionText(String(item.text || ''));
        const contactName = this.normalizeInteractionText(
          String(item.contactName || ''),
        );
        const textMatched =
          Boolean(target) &&
          Boolean(text) &&
          (text === target || text.includes(target) || target.includes(text));
        const contactMatched =
          Boolean(contactTarget) &&
          Boolean(contactName) &&
          (contactName === contactTarget ||
            contactName.includes(contactTarget) ||
            contactTarget.includes(contactName));
        return textMatched || contactMatched;
      }),
    );
  }

  private douyinMessageLoadBlockedSummary(
    scan: Record<string, any> | null | undefined,
  ) {
    if (!scan?.loadBlocked) return null;
    return {
      totalCandidates: scan.totalCandidates || 0,
      usableCount: 0,
      emptyReason:
        scan.loadBlockedReason ||
        '抖音私信页会话列表持续加载，未进入可读取状态。',
      blocked: true,
      blockedReason: 'message_list_loading',
      nextAction:
        '请打开抖音创作者后台私信页确认会话列表能正常显示，再回到系统重试；如果页面一直转圈，先刷新或重新登录抖音账号。',
    };
  }

  private interactionReadSummary(
    totalCandidates: unknown,
    items: Array<Record<string, any>>,
    label: string,
  ) {
    return {
      totalCandidates: Number(totalCandidates || items.length),
      usableCount: items.length,
      emptyReason: items.length ? null : `当前页面未解析到可回复${label}`,
    };
  }

  private extractDouyinMessageCandidatesFromPageText(
    pageText: string,
    limit = 10,
  ): Array<Record<string, any>> {
    let text = this.normalizeInteractionText(pageText);
    if (!text) return [];

    const tabIndex = text.search(/全部\s+朋友私信\s+陌生人私信\s+群消息/);
    if (tabIndex >= 0) {
      text = text.slice(tabIndex);
    }
    text = text
      .replace(/^全部\s+朋友私信\s+陌生人私信\s+群消息\s+全选\s*/, '')
      .replace(/^全部\s+朋友私信\s+陌生人私信\s+群消息\s*/, '');

    const timePattern =
      '(?:刚刚|今天|昨天|星期[一二三四五六日天]|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d+分钟前|\\d+小时前)';
    const rowPattern = new RegExp(
      `(?:^|\\s)(?:\\d+\\s+)?(.{2,60}?)\\s+(${timePattern})\\s+(.{2,180}?)(?=\\s+(?:\\d+\\s+)?[^\\s]{2,60}\\s+${timePattern}\\s+|$)`,
      'g',
    );
    const unreplyable =
      /你收到一条新类型消息|请打开抖音\s*app\s*查看|请打开抖音APP查看|分享\[视频\]|\[视频\]|\[图片\]|该消息类型暂不支持|当前版本暂不支持/;
    const rows: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const add = (candidateText: string, contactName = '', context = '') => {
      const normalized = this.cleanDouyinMessagePreviewText(candidateText)
        .replace(/^[:：]\s*/, '')
        .replace(/\s+$/, '');
      if (!this.looksLikeDouyinCustomerMessage(normalized)) return;
      if (unreplyable.test(normalized)) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        text: normalized,
        original: normalized,
        source: 'page-text-fallback',
        score:
          48 +
          (/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/.test(
            normalized,
          )
            ? 18
            : 0),
        context: this.normalizeInteractionText(context).slice(0, 260),
        contactName: this.normalizeInteractionText(contactName),
      });
    };

    let match: RegExpExecArray | null;
    while ((match = rowPattern.exec(text)) && rows.length < limit) {
      const [, rawContact, rawTime, rawMessage] = match;
      const message = this.normalizeInteractionText(rawMessage);
      const context = [rawContact, rawTime, rawMessage]
        .filter(Boolean)
        .join(' ');
      add(message, rawContact, context);
    }

    if (!rows.length) {
      const questionPattern =
        /(?:^|\s)([^。\n\r]{2,120}(?:[？?]|价格|多少|怎么|哪里|联系|电话|微信|私信|预约|在吗|吗|呢)[^。\n\r]{0,80})/g;
      while ((match = questionPattern.exec(text)) && rows.length < limit) {
        add(match[1], '', match[0]);
      }
    }

    return rows.slice(0, Math.max(1, Math.min(limit, 20)));
  }

  private cleanDouyinMessagePreviewText(value: string): string {
    let text = this.normalizeInteractionText(value);
    if (!text) return '';
    const timePattern =
      '(?:刚刚|今天|昨天|星期[一二三四五六日天]|\\d{1,2}:\\d{2}|\\d{2}-\\d{2}|\\d+分钟前|\\d+小时前)';
    text = text.replace(/^(?:全选\s+)?\d+\s+/, '');
    text = text.replace(
      new RegExp(`^陌生人消息\\s+${timePattern}\\s*`, 'i'),
      '',
    );
    text = text.replace(new RegExp(`^.{1,80}?\\s+${timePattern}\\s+`, 'i'), '');
    text = text.replace(/^[^:：]{1,80}[:：]\s*/, '');
    return this.normalizeInteractionText(text);
  }

  private douyinMessageScanScript(): string {
    return `(limit) => {
      const normalize = (value) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value) ?? ""
        .replace(/\\s+/g, ' ')
        .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
        .trim();
      const visible = (node) => {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none'
          && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
      };
      const hasReadableChar = (text) => /[\\u4e00-\\u9fa5a-zA-Z0-9]/.test(text) || /[\\u{1F300}-\\u{1FAFF}]/u.test(text);
      const exactNoise = new Set([
        '发布作品', '作品管理', '数据中心', '创作者服务中心',
        '首页', '活动管理', '内容管理', '互动管理', '变现中心',
        '创作中心', '通知', '网址', '抖音', '发送', '搜索',
        '全部', '加载中', '暂无', '高清发布', '发布视频', '发布图文',
        '站内信', '星图', '客服', '平台', '下线通知',
        '关注管理', '粉丝管理', '评论管理', '弹幕管理', '私信管理',
        '我知道了', '稍后再看', '关闭', '加载中，请稍候...', '加载中',
        '抖音社区自律公约', '账号授权协议', '用户服务协议', '隐私政策',
        '账号找回', '联系我们', '中国互联网举报中心',
      ]);
      const containsNoise = [
        '你收到一条新类型消息',
        '请打开抖音app查看',
        '请打开抖音 app 查看',
        '请打开抖音APP查看',
        '分享[视频]',
        '[视频]',
        '[图片]',
        '新增「共创中心」模块',
        '管理你的共创作品',
        '创作者您好',
        '感谢您的理解与支持',
        '如有疑问',
        '星图平台',
        '集中发布与展示',
        '本通知发布',
        '平台通知',
        '系统通知',
        '功能介绍',
        '该消息类型暂不支持',
        '抖音社区自律公约',
        '账号授权协议',
        '用户服务协议',
        '隐私政策',
        '账号找回',
        '北京抖音科技有限公司',
        '京ICP',
        '京B2',
        '举报',
        '网络文化经营许可证',
      ];
      const statPattern = /^\\d+$|^\\d{1,2}:\\d{2}$|^\\d{1,2}-\\d{1,2}$|^\\d+分钟前$|^\\d+小时前$|^\\d+天前$|^刚刚$|^今天$|^昨天$/;
      const isNoise = (text) => {
        if (!text || text.length < 2 || text.length > 180) return true;
        if (!hasReadableChar(text)) return true;
        if (exactNoise.has(text)) return true;
        if (containsNoise.some((item) => text.includes(item))) return true;
        if (/^[\\u4e00-\\u9fa5A-Za-z0-9_·-]{1,24}(?:📷|✅|✔|V)?$/.test(text)
          && !/[？?吗呢吧呀哦啊]|你好|您好|嗨|哈喽|在吗|不行|可以|想|了解|预约|价格|多少|怎么|哪里|联系|电话|微信|私信|在哪|要|买|发|帮|看|觉得/.test(text)) {
          return true;
        }
        if (statPattern.test(text)) return true;
        return false;
      };
      const candidates = [];
      const rowSelectors = '[role="gridcell"], li, tr, [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="item"], [class*="Item"]';
	      const rowLooksUnreplyable = (text) =>
	        /你收到一条新类型消息|请打开抖音\\s*app\\s*查看|分享\\[视频\\]|\\[视频\\]|\\[图片\\]|该消息类型暂不支持|当前版本暂不支持/.test(text);
	      const rowLooksLikeGroupConversation = (text) =>
	        /群消息|粉丝群|群聊|官方群|交流群|客户群|社群/.test(text) ||
	        /群\\s*(?:\\d{1,2}:\\d{2}|刚刚|今天|昨天|\\d{1,2}-\\d{1,2}|\\d+分钟前|\\d+小时前)/.test(text);
      const rowLooksLikeSessionList = (text) =>
        /全部|朋友私信|陌生人私信|群消息|全选/.test(text) &&
        /你收到一条新类型消息|请打开抖音\\s*app\\s*查看|分享\\[视频\\]|昨天|\\d{1,2}:\\d{2}|\\d{1,2}-\\d{1,2}/.test(text) &&
        text.length > 260;
      const messageTimePattern = '(?:刚刚|今天|昨天|星期[一二三四五六日天]|\\\\d{1,2}:\\\\d{2}|\\\\d{2}-\\\\d{2}|\\\\d+分钟前|\\\\d+小时前)';
      const stripRowPrefix = (value) => {
        let text = normalize(value);
        text = text.replace(/^(?:全选\\s+)?\\d+\\s+/, '');
        text = text.replace(new RegExp('^陌生人消息\\\\s+' + messageTimePattern + '\\\\s*', 'i'), '');
        text = text.replace(new RegExp('^.{1,80}?\\\\s+' + messageTimePattern + '\\\\s+', 'i'), '');
        text = text.replace(/^[^:：]{1,80}[:：]\\s*/, '');
        return normalize(text);
      };
      const contactFromRow = (value) => {
        const text = normalize(value).replace(/^(?:全选\\s+)?\\d+\\s+/, '');
        if (text.startsWith('陌生人消息')) {
          const match = text.match(new RegExp('^陌生人消息\\\\s+' + messageTimePattern + '\\\\s*([^:：]{1,80})[:：]'));
          return normalize(match?.[1] || '陌生人消息');
        }
        const match = text.match(new RegExp('^(.{1,60}?)\\\\s+' + messageTimePattern + '\\\\s+'));
        return normalize(match?.[1] || '');
      };
	      const leafMessageFromRow = (row) => {
	        const textNodes = [];
	        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || !visible(parent)) continue;
          const text = normalize(node.nodeValue);
          if (!text || isNoise(text)) continue;
          const rect = parent.getBoundingClientRect();
          textNodes.push({ text, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        const contact = contactFromRow(row.innerText || row.textContent || '');
        return textNodes
          .filter((item) => item.text !== contact)
	          .filter((item) => !/^全选$/.test(item.text))
	          .sort((a, b) => (b.y - a.y) || (b.x - a.x))[0]?.text || '';
	      };
	      const previewMessageFromRow = (row) => {
	        const previewNodes = Array.from(
	          row.querySelectorAll('[class*="item-content"], [class*="text-"], [class*="content"], [class*="Content"]'),
	        )
	          .filter((node) => visible(node))
	          .map((node) => {
	            const text = normalize(node.innerText || node.textContent || '');
	            const rect = node.getBoundingClientRect();
	            return { text, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	          })
	          .filter((item) => item.text && !isNoise(item.text))
	          .filter((item) => !rowLooksUnreplyable(item.text));
	        previewNodes.sort((a, b) => (b.y - a.y) || (a.x - b.x));
	        const directPreview = previewNodes.find((item) => item.text.length <= 160);
	        if (directPreview) {
	          const rowText = normalize(row.innerText || row.textContent || '');
	          const contact = contactFromRow(rowText);
	          let text = directPreview.text;
	          if (contact && text.startsWith(contact)) {
	            text = normalize(text.slice(contact.length));
	          }
	          text = text.replace(new RegExp('^' + messageTimePattern + '\\\\s*', 'i'), '');
	          text = text.replace(/^[^:：]{1,80}[:：]\\s*/, '');
	          text = text.replace(/^[:：]\\s*/, '');
	          return text || directPreview.text;
	        }
	        const rowText = normalize(row.innerText || row.textContent || '');
	        const contact = contactFromRow(rowText);
	        for (const item of previewNodes) {
	          let text = item.text;
	          if (contact && text.startsWith(contact)) {
	            text = normalize(text.slice(contact.length));
	          }
	          text = text.replace(new RegExp('^' + messageTimePattern + '\\\\s*', 'i'), '');
	          text = text.replace(/^[^:：]{1,80}[:：]\\s*/, '');
	          text = text.replace(/^[:：]\\s*/, '');
	          if (text && !isNoise(text) && !rowLooksUnreplyable(text)) {
	            return text;
	          }
	        }
	        return '';
	      };
	      const pushCandidate = (text, node, source, baseScore = 0) => {
        text = normalize(text);
        if (isNoise(text)) return;
        const rect = node.getBoundingClientRect();
        if (rect.x < 170 || rect.y < 110) return;
	        const row = node.closest(rowSelectors) || node.parentElement || node;
	        const rowText = normalize(row.innerText || row.textContent || '');
	        if (rowLooksLikeSessionList(rowText) && source !== 'message-row') return;
	        if (rowLooksLikeGroupConversation(rowText)) return;
	        const previewMessage = previewMessageFromRow(row);
	        const leafMessage = leafMessageFromRow(row);
	        const messageText =
	          (source === 'message-row' || source === 'message-preview') && previewMessage
	            ? previewMessage
	            : source === 'message-row' && leafMessage
	              ? leafMessage
	              : stripRowPrefix(text);
        if (rowLooksUnreplyable(rowText) && rowLooksUnreplyable(messageText)) return;
        if (messageText && messageText !== text && !isNoise(messageText)) {
          text = messageText;
        }
        const context = rowText.slice(0, 260);
        let score = baseScore;
        if (/私信|消息|回复|分钟前|小时前|刚刚|今天|昨天|\\d{1,2}:\\d{2}|\\d{1,2}-\\d{1,2}|未读/.test(context)) score += 20;
        if (/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/.test(text)) score += 18;
        if (/[\\u{1F300}-\\u{1FAFF}]/u.test(text)) score += 8;
        candidates.push({
          text,
          looksLikeMessage: true,
          source,
          score,
          context,
          contactName: contactFromRow(rowText),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      };

      for (const row of Array.from(document.querySelectorAll(rowSelectors)).filter(visible)) {
        const rect = row.getBoundingClientRect();
        if (rect.x < 170 || rect.y < 110 || rect.width < 180 || rect.height < 28) continue;
	        const rowText = normalize(row.innerText || row.textContent);
	        if (!rowText) continue;
	        if (rowLooksLikeGroupConversation(rowText)) continue;
	        const previewMessage = previewMessageFromRow(row);
	        if (previewMessage && !isNoise(previewMessage) && !rowLooksUnreplyable(previewMessage)) {
	          pushCandidate(previewMessage, row, 'message-preview', 45);
	          continue;
	        }
	        const leafMessage = leafMessageFromRow(row);
        const messageText =
          leafMessage && !isNoise(leafMessage) ? leafMessage : stripRowPrefix(rowText);
        if (rowLooksUnreplyable(rowText) && rowLooksUnreplyable(messageText)) continue;
        if (messageText && !isNoise(messageText) && !rowLooksUnreplyable(messageText)) {
          pushCandidate(messageText, row, 'message-row', 35);
        }
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || !visible(parent)) continue;
        const row = parent.closest(rowSelectors) || parent.parentElement || parent;
        const rowText = normalize(row.innerText || row.textContent || '');
        if (rowLooksLikeSessionList(rowText)) continue;
        pushCandidate(node.nodeValue, parent, 'text-node', 10);
      }

      const seen = new Set();
      const messages = [];
      for (const item of candidates.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x))) {
        if (seen.has(item.text)) continue;
        seen.add(item.text);
        messages.push(item);
        if (messages.length >= limit) break;
      }
      const bodyText = normalize(document.body.innerText);
      return {
        url: location.href,
        title: document.title,
        totalCandidates: candidates.length,
        messages,
        emptyState: /还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/.test(bodyText),
        emptyReason: (bodyText.match(/还没有收到私信|暂无私信|暂无消息|没有收到私信|没有私信|暂无会话/) || [])[0],
        pageTextSample: bodyText.slice(0, 800),
      };
    }`;
  }

  private async installDouyinImRouteCapture(
    context: import('playwright').BrowserContext,
    trace: DouyinImTraceEvent[],
    maxEvents = 80,
  ): Promise<DouyinImRouteCapture> {
    const captures: DouyinImTraceEvent[] = [];
    const patterns = [
      '**/v2/message/**',
      '**/*message/get_by_user_init*',
      '**/*conversation*',
    ];
    const appendCapture = (event: DouyinImTraceEvent) => {
      const compact = Object.fromEntries(
        Object.entries(event).filter(([, value]) => {
          if (value == null || value === '') return false;
          if (Array.isArray(value) && value.length === 0) return false;
          return true;
        }),
      );
      captures.push(compact);
      captures.splice(0, Math.max(0, captures.length - maxEvents));
      trace.push(compact);
      trace.splice(0, Math.max(0, trace.length - maxEvents));
    };
    const handler: DouyinImRouteCapture['handler'] = async (route) => {
      const request = route.request();
      const url = request.url() || '';
      const lowerUrl = url.toLowerCase();
      const shouldCapture =
        lowerUrl.includes('imapi.snssdk.com') ||
        lowerUrl.includes('message/get_by_user_init') ||
        lowerUrl.includes('conversation') ||
        lowerUrl.includes('chat');
      if (!shouldCapture) {
        await route.continue();
        return;
      }
      try {
        const response = await route.fetch();
        const bodyBuffer = await response.body();
        const text = bodyBuffer.toString('utf8');
        const candidates = this.extractDouyinImMessageCandidatesFromPayload(
          text,
          20,
        );
        appendCapture({
          kind: 'routeCapture',
          url: url.slice(0, 500),
          method: request.method(),
          status: response.status(),
          resourceType: request.resourceType(),
          messageCandidates: candidates,
          bodyPreview: candidates.length ? text.slice(0, 800) : '',
          timestamp: new Date().toISOString(),
        });
        await route.fulfill({ response });
      } catch (error) {
        appendCapture({
          kind: 'routeCaptureFailed',
          url: url.slice(0, 500),
          method: request.method(),
          resourceType: request.resourceType(),
          errorText:
            error instanceof Error
              ? error.message.slice(0, 240)
              : String(error).slice(0, 240),
          timestamp: new Date().toISOString(),
        });
        await route.continue().catch(() => undefined);
      }
    };
    for (const pattern of patterns) {
      await context.unroute(pattern).catch(() => undefined);
      await context.route(pattern, handler).catch((error) => {
        appendCapture({
          kind: 'routeCaptureInstallFailed',
          url: pattern,
          errorText:
            error instanceof Error
              ? error.message.slice(0, 240)
              : String(error).slice(0, 240),
          timestamp: new Date().toISOString(),
        });
      });
    }
    return { patterns, handler, captures };
  }

  private async detachDouyinImRouteCapture(
    context: import('playwright').BrowserContext,
    routeCapture: DouyinImRouteCapture | null | undefined,
  ): Promise<void> {
    if (!routeCapture) return;
    for (const pattern of routeCapture.patterns) {
      await context
        .unroute(pattern, routeCapture.handler)
        .catch(() => undefined);
    }
  }

  private async installDouyinImWindowCapture(page: Page): Promise<void> {
    const script = this.douyinImWindowCaptureScript();
    await page.addInitScript(script).catch(() => undefined);
    await page.evaluate(script).catch(() => undefined);
  }

  private async collectDouyinImWindowCapture(
    page: Page,
    trace: DouyinImTraceEvent[],
    limit = 20,
  ): Promise<DouyinImTraceEvent> {
    const captures = await page
      .evaluate(() =>
        (
          (
            window as unknown as {
              __kaypalDouyinImResponses?: DouyinImWindowCapture[];
            }
          ).__kaypalDouyinImResponses || []
        )
          .slice(-30)
          .map((item: DouyinImWindowCapture) => ({
            kind: item.kind,
            url: item.url,
            status: item.status,
            body: item.body,
            errorText: item.errorText,
            capturedAt: item.capturedAt,
          })),
      )
      .catch(() => [] as Array<Record<string, any>>);
    const candidates: Array<Record<string, any>> = [];
    for (const item of captures || []) {
      const body = typeof item.body === 'string' ? item.body : '';
      for (const candidate of this.extractDouyinImMessageCandidatesFromPayload(
        body,
        limit,
      )) {
        candidates.push({
          ...candidate,
          source: `window-${item.kind || 'capture'}:${candidate.source || 'response'}`,
        });
        if (candidates.length >= limit) break;
      }
      if (candidates.length >= limit) break;
    }
    const event: DouyinImTraceEvent = {
      kind: 'windowCapture',
      url: 'window.__kaypalDouyinImResponses',
      status: (captures || []).length,
      messageCandidates: candidates.slice(0, limit),
      captures: (captures || [])
        .slice(-10)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          kind: item.kind,
          url: item.url,
          status: item.status,
          capturedAt: item.capturedAt,
          bodyLength: String(item.body || '').length,
          errorText: item.errorText,
        })),
      timestamp: new Date().toISOString(),
    };
    trace.push(event);
    trace.splice(0, Math.max(0, trace.length - 80));
    return event;
  }

  private douyinImWindowCaptureScript(): string {
    return `(() => {
      const root = window;
      if (!Array.isArray(root.__kaypalDouyinImResponses)) {
        root.__kaypalDouyinImResponses = [];
      }
      const normalizeUrl = (input) => {
        try {
          if (typeof input === 'string') return input;
          if (input && typeof input.url === 'string') return input.url;
        } catch { /* 容错：非关键路径失败忽略 */ }
        return '';
      };
      const shouldCapture = (url) => {
        const value = (typeof url === "string" ? url : url == null ? "" : JSON.stringify(url) ?? "").toLowerCase();
        return value.includes('imapi.snssdk.com') ||
          value.includes('message/get_by_user_init') ||
          value.includes('conversation') ||
          value.includes('/message/');
      };
      const pushCapture = (entry) => {
        try {
          const list = root.__kaypalDouyinImResponses || [];
          list.push({
            kind: entry.kind,
            url: String(entry.url || '').slice(0, 500),
            status: entry.status,
            body: String(entry.body || '').slice(0, 200000),
            errorText: entry.errorText ? String(entry.errorText).slice(0, 240) : undefined,
            capturedAt: new Date().toISOString(),
          });
          root.__kaypalDouyinImResponses = list.slice(-50);
        } catch { /* 容错：非关键路径失败忽略 */ }
      };
      if (!root.__kaypalDouyinImFetchPatched && typeof root.fetch === 'function') {
        const originalFetch = root.fetch;
        root.fetch = async function(input, init) {
          const url = normalizeUrl(input);
          const response = await originalFetch.apply(this, arguments);
          if (shouldCapture(url || response.url)) {
            try {
              response.clone().text()
                .then((body) => pushCapture({ kind: 'fetch', url: url || response.url, status: response.status, body }))
                .catch((error) => pushCapture({ kind: 'fetchFailed', url: url || response.url, status: response.status, errorText: error && error.message }));
            } catch (error) {
              pushCapture({ kind: 'fetchFailed', url: url || response.url, status: response.status, errorText: error && error.message });
            }
          }
          return response;
        };
        root.__kaypalDouyinImFetchPatched = true;
      }
      if (!root.__kaypalDouyinImXhrPatched && root.XMLHttpRequest) {
        const xhrProto = root.XMLHttpRequest.prototype;
        const originalOpen = xhrProto.open;
        const originalSend = xhrProto.send;
        xhrProto.open = function(method, url) {
          this.__kaypalCaptureUrl = normalizeUrl(url);
          this.__kaypalCaptureMethod = method;
          return originalOpen.apply(this, arguments);
        };
        xhrProto.send = function() {
          if (shouldCapture(this.__kaypalCaptureUrl)) {
            this.addEventListener('loadend', () => {
              try {
                pushCapture({
                  kind: 'xhr',
                  url: this.__kaypalCaptureUrl,
                  status: this.status,
                  body: this.responseType && this.responseType !== 'text' && this.responseType !== '' ? '' : this.responseText,
                });
              } catch (error) {
                pushCapture({ kind: 'xhrFailed', url: this.__kaypalCaptureUrl, status: this.status, errorText: error && error.message });
              }
            });
          }
          return originalSend.apply(this, arguments);
        };
        root.__kaypalDouyinImXhrPatched = true;
      }
    })();`;
  }

  private extractDouyinImMessageCandidatesFromPayload(
    payloadText: string,
    limit = 20,
  ): Array<Record<string, any>> {
    const parsed = this.tryParseJsonText(payloadText);
    const candidates: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const messageKeys = new Set([
      'text',
      'content',
      'message',
      'msg',
      'msg_content',
      'last_message',
      'lastMessage',
      'preview',
      'abstract',
      'push_content',
      'conversation_name',
      'nickname',
      'nick_name',
      'name',
    ]);
    const addCandidate = (text: unknown, source: string, context?: unknown) => {
      const normalized = this.normalizeInteractionText(safeText(text));
      if (!this.looksLikeDouyinCustomerMessage(normalized)) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        text: normalized,
        looksLikeMessage: true,
        source,
        context: this.normalizeInteractionText(safeText(context)).slice(0, 260),
        score:
          source.includes('content') || source.includes('message') ? 80 : 55,
      });
    };
    const walk = (
      value: unknown,
      path = '',
      parent?: Record<string, unknown>,
    ) => {
      if (candidates.length >= limit) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const compactContext = [
          'nickname',
          'nick_name',
          'conversation_name',
          'text',
          'content',
          'msg_content',
        ]
          .map((key) => obj[key])
          .filter((item) => ['string', 'number'].includes(typeof item))
          .map((item) => this.normalizeInteractionText(String(item)))
          .filter(Boolean)
          .join(' ');
        for (const [key, child] of Object.entries(obj)) {
          const childPath = path ? `${path}.${key}` : key;
          const lowerKey = key.toLowerCase();
          if (typeof child === 'string') {
            const nested = this.tryParseJsonText(child);
            if (nested != null) walk(nested, childPath, obj);
            if (
              messageKeys.has(key) ||
              ['text', 'content', 'message', 'msg'].some((token) =>
                lowerKey.includes(token),
              )
            ) {
              addCandidate(child, childPath, compactContext);
            }
          } else {
            walk(child, childPath, obj);
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`, parent));
      }
    };
    if (parsed != null) walk(parsed);
    if (!candidates.length) {
      const regex =
        /"(?:text|content|msg_content|message|preview|abstract)"\s*:\s*"([^"]{2,240})"/gi;
      let match: RegExpExecArray | null;
      while (
        (match = regex.exec(payloadText || '')) &&
        candidates.length < limit
      ) {
        addCandidate(this.decodeJsonStringLiteral(match[1]), 'response-regex');
      }
    }
    return candidates.slice(0, limit);
  }

  private mergeDouyinMessageCandidates(
    domMessages: Array<Record<string, any>>,
    trace: DouyinImTraceEvent[],
    limit: number,
  ): Array<Record<string, any>> {
    const merged: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const add = (item: Record<string, any>, fallbackSource: string) => {
      const text = this.normalizeInteractionText(String(item.text || ''));
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({
        ...item,
        text,
        looksLikeMessage: true,
        source: item.source || fallbackSource,
        context: item.context || '',
        score: item.score || 70,
      });
    };
    for (const item of domMessages || []) {
      add(item, 'dom');
      if (merged.length >= limit) return merged;
    }
    for (const event of trace || []) {
      for (const item of event.messageCandidates || []) {
        add(item, 'network-response');
        if (merged.length >= limit) return merged;
      }
    }
    return merged;
  }

  private looksLikeDouyinCustomerMessage(text: string): boolean {
    const normalized = this.normalizeInteractionText(text);
    if (!normalized || normalized.length < 2 || normalized.length > 240)
      return false;
    if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(normalized)) return false;
    const noiseFragments = [
      '抖音社区自律公约',
      '账号授权协议',
      '用户服务协议',
      '隐私政策',
      '北京抖音科技有限公司',
      '京ICP',
      '网络文化经营许可证',
      '请打开抖音 app 查看',
      '请打开抖音app查看',
      '请打开抖音APP查看',
      '你收到一条新类型消息',
      '该消息类型暂不支持',
      '当前版本暂不支持',
      '平台通知',
      '系统通知',
      '服务通知',
      '加载中',
      '私信管理',
      '评论管理',
      '创作者中心',
      '高清发布',
      '分享[视频]',
      '[视频]',
      '[图片]',
    ];
    if (
      noiseFragments.some((fragment) =>
        normalized.toLowerCase().includes(fragment.toLowerCase()),
      )
    ) {
      return false;
    }
    if (
      [
        '全部',
        '朋友私信',
        '陌生人私信',
        '群消息',
        '发送',
        '搜索',
        '抖音',
        '首页',
      ].includes(normalized)
    ) {
      return false;
    }
    if (/^\d+$/.test(normalized)) return false;
    return true;
  }

  private tryParseJsonText(value: unknown): unknown {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || !['[', '{'].includes(text[0])) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private decodeJsonStringLiteral(value: string): string {
    try {
      return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
    } catch {
      return value;
    }
  }

  private async waitForDouyinMessageEditorOrSettled(
    page: Page,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await page
        .evaluate(() => {
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const editors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          ).filter(visible);
          if (editors.length > 0) return { ready: true };
          const bodyText = String(document.body?.innerText || '');
          const stillLoading = Array.from(
            document.querySelectorAll(
              '[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, svg',
            ),
          ).some((node) => {
            if (!visible(node)) return false;
            const rect = node.getBoundingClientRect();
            return (
              rect.x > window.innerWidth * 0.35 &&
              rect.y > 140 &&
              rect.width <= 180 &&
              rect.height <= 180
            );
          });
          const detailHint = /发送|请输入|回复|表情|聊天|消息/.test(bodyText);
          return { ready: false, stillLoading, detailHint };
        })
        .catch(() => ({
          ready: false,
          stillLoading: false,
          detailHint: false,
        }));
      if (state.ready) return;
      if (!state.stillLoading && state.detailHint) return;
      await page.waitForTimeout(500);
    }
  }

  private async readDouyinCommentsWithLocalBrowser(
    page: Page,
    session: {
      key: string;
      profileDir: string;
      debuggingPort?: number;
      browser?: string;
      browserReused?: boolean;
    },
    input: PlatformReadInput,
  ): Promise<Record<string, any>> {
    await this.openDouyinCommentPage(page);
    if (!(await this.isDouyinCommentPageReady(page))) {
      const evidence = await this.captureSessionScreenshot(
        session.key,
        `douyin-comments-read-page-not-ready-${input.accountId}`,
      );
      return {
        accountId: Number(input.accountId) || input.accountId,
        platformName: '抖音',
        platformType: 3,
        url: page.url(),
        title: await page.title().catch(() => ''),
        comments: [],
        status: 'comment_page_not_ready',
        message:
          '抖音自动评论页未成功打开，已停止读取，避免把作品管理页误判为评论。',
        summary: {
          totalCandidates: 0,
          usableCount: 0,
          emptyReason: 'comment_page_not_ready',
        },
        pageTextSample: await this.pageText(page, 1200),
        evidence: evidence.evidencePath
          ? {
              type: 'screenshot',
              label: '评论页未打开截图',
              path: evidence.evidencePath,
              value: evidence.evidencePath,
            }
          : null,
        readAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        profileDir: session.profileDir,
        cdpPort: session.debuggingPort ?? null,
        browser: session.browser ?? null,
        browserReused: session.browserReused ?? null,
      };
    }

    const limit = Math.max(1, Math.min(Number(input.limit || 10), 20));
    const scan = await this.chooseDouyinCommentWorkWithCandidates(
      page,
      limit,
      8,
      '',
      input.targetName || '',
      input.parsingRules,
    );
    const evidence = await this.captureSessionScreenshot(
      session.key,
      `douyin-comments-read-${input.accountId}`,
    );
    const domComments = Array.isArray(scan.comments) ? scan.comments : [];
    const textFallbackComments = domComments.length
      ? []
      : this.extractDouyinCommentCandidatesFromPageText(
          scan.pageTextSample || (await this.pageText(page, 1800)),
          limit,
        );
    const comments = domComments.length ? domComments : textFallbackComments;
    const totalCandidates = Math.max(
      Number(scan.totalCandidates || 0),
      comments.length,
    );
    return {
      accountId: Number(input.accountId) || input.accountId,
      platformName: '抖音',
      platformType: 3,
      url: scan.url || page.url(),
      title: scan.title || (await page.title().catch(() => '')),
      comments,
      selectedWorkTitle: scan.selectedWorkTitle,
      selectedWorkIndex: scan.selectedWorkIndex,
      workSwitchAttempted: scan.workSwitchAttempted,
      summary: {
        totalCandidates,
        usableCount: comments.length,
        emptyReason: comments.length ? null : '当前页面未解析到可回复评论',
        textFallbackCount: textFallbackComments.length,
      },
      pageTextSample: scan.pageTextSample || '',
      evidence: evidence.evidencePath
        ? {
            type: 'screenshot',
            label: '评论读取截图',
            path: evidence.evidencePath,
            value: evidence.evidencePath,
          }
        : null,
      readAt: new Date().toISOString(),
      runtimeMode: 'persistent-cdp-browser',
      profileDir: session.profileDir,
      cdpPort: session.debuggingPort ?? null,
      browser: session.browser ?? null,
      browserReused: session.browserReused ?? null,
    };
  }

  private extractDouyinCommentCandidatesFromPageText(
    pageText: string,
    limit: number,
  ): Array<Record<string, any>> {
    const normalize = (value: unknown) =>
      (typeof value === 'string'
        ? value
        : value == null
          ? ''
          : (JSON.stringify(value) ?? '')
      )
        .replace(/\s+/g, ' ')
        .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
        .trim();
    const text = normalize(pageText);
    if (!text) return [];
    const windowText = text.includes('评论管理')
      ? text.slice(text.indexOf('评论管理'))
      : text;
    const stopAt = windowText.search(
      /作品列表|共\d+个视频|发布作品|互动管理|数据中心/,
    );
    const scope = stopAt > 80 ? windowText.slice(0, stopAt) : windowText;
    const noise = new Set([
      '评论管理',
      '全部评论',
      '全部人群',
      '最新发布',
      '回复',
      '删除',
      '举报',
      '查看1条回复',
      '有爱评论，说点儿好听的～',
      '选择作品',
    ]);
    const looksLikeComment = (value: string) => {
      const item = normalize(value);
      if (!item || item.length < 2 || item.length > 180) return false;
      if (noise.has(item)) return false;
      if (/^#/.test(item)) return false;
      if (/^(刚刚|今天|昨天|\d+分钟前|\d+小时前|\d+天前)$/.test(item))
        return false;
      if (/^\d{4}年\d{2}月\d{2}日\s+\d{1,2}:\d{2}$/.test(item)) return false;
      if (/^(\d+|[-\d]+)$/.test(item)) return false;
      if (/发布于20\d{2}年/.test(item)) return false;
      if (/^(播放|点赞|评论|分享)/.test(item)) return false;
      return /[\u4e00-\u9fffA-Za-z0-9]/.test(item);
    };
    const candidates: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const add = (value: string, source: string, context = '') => {
      const item = normalize(value);
      if (!looksLikeComment(item)) return;
      const key = item.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        text: item,
        looksLikeComment: true,
        source,
        context: normalize(context).slice(0, 260),
        score:
          70 +
          (/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/.test(
            item,
          )
            ? 20
            : 0),
      });
    };

    const commentTimePattern =
      '刚刚|今天|昨天|\\d+分钟前|\\d+小时前|\\d+天前|\\d{1,2}月\\d{1,2}日\\s+\\d{1,2}:\\d{2}|\\d{4}年\\d{2}月\\d{2}日\\s+\\d{1,2}:\\d{2}';
    const commentPattern = new RegExp(
      `([^\\s]{1,40})\\s+(${commentTimePattern})\\s+(.{2,180}?)(?=\\s+(?:回复|删除|举报|查看\\d+条回复|[^\\s]{1,40}\\s+(?:${commentTimePattern})|$))`,
      'g',
    );
    let match: RegExpExecArray | null;
    while ((match = commentPattern.exec(scope)) && candidates.length < limit) {
      const body = normalize(match[3]).replace(
        /\s*(回复|删除|举报|查看\d+条回复).*$/,
        '',
      );
      add(body, 'page-text-comment-row', match[0]);
    }
    if (!candidates.length) {
      const loosePattern =
        /有爱评论，说点儿好听的～\s+(.{2,180}?)(?=\s+(?:回复|删除|举报|查看\d+条回复|作品列表|$))/g;
      while ((match = loosePattern.exec(scope)) && candidates.length < limit) {
        add(match[1], 'page-text-comment-loose', match[0]);
      }
    }
    return candidates.slice(0, limit);
  }

  private async performDouyinCommentInteraction(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const publicVideoUrl = this.resolveDouyinPublicVideoUrl(input);
    if (publicVideoUrl) {
      await this.openDouyinPublicVideoCommentPage(page, publicVideoUrl);
      if (input.commentMode === 'video-comment') {
        return this.fillAndSendDouyinVideoCommentOnPage(page, input);
      }
      const targetVisible = await this.scrollDouyinPublicCommentsForTarget(
        page,
        input.targetText,
        input.targetName,
        8,
      );
      if (!targetVisible) {
        return {
          status: 'comment_missing',
          message: '已打开抖音公开视频评论区，但未找到目标评论，未操作。',
          nextAction:
            '请确认目标评论仍在该视频评论区可见；公开评论区只会回复已定位到的目标评论，不会改发普通评论。',
        };
      }
      return this.fillAndSendDouyinCommentReplyOnPage(page, input);
    }

    const canUseCurrentCommentPage =
      (await this.isDouyinCommentPageReady(page)) &&
      (await this.pageContainsInteractionTarget(
        page,
        input.targetText,
        input.targetName,
      ));
    if (canUseCurrentCommentPage) {
      await this.dismissDouyinOverlays(page).catch(() => undefined);
    } else {
      await this.openDouyinCommentPage(page);
    }
    if (!(await this.isDouyinCommentPageReady(page))) {
      return {
        status: 'failed',
        message: '抖音自动评论页未成功打开，未执行自动评论。',
        nextAction: '请确认抖音账号登录态有效，并能进入评论管理页。',
      };
    }
    if (canUseCurrentCommentPage) {
      return this.fillAndSendDouyinCommentReplyOnPage(page, input);
    }
    const scan = await this.chooseDouyinCommentWorkWithCandidates(
      page,
      15,
      12,
      input.targetText,
      input.targetName,
    );
    if (
      !this.douyinCommentScanHasTarget(scan, input.targetText, input.targetName)
    ) {
      return {
        status: 'comment_missing',
        message: '已扫描可见作品评论，但未找到目标评论，未操作。',
        nextAction: '请刷新评论列表，确认目标评论仍存在且当前作品可见。',
      };
    }
    return this.fillAndSendDouyinCommentReplyOnPage(page, input);
  }

  private resolveDouyinPublicVideoUrl(
    input: PlatformDispatchInput,
  ): string | undefined {
    for (const value of [input.sourceUrl, input.videoUrl]) {
      const text = safeText(value).trim();
      const match = text.match(/^https:\/\/www\.douyin\.com\/video\/\d+/i);
      if (match) return match[0];
    }
    return undefined;
  }

  private async openDouyinPublicVideoCommentPage(
    page: Page,
    videoUrl: string,
  ): Promise<void> {
    await this.gotoBestEffort(page, videoUrl, 30000);
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => undefined);
    await page.waitForTimeout(2200).catch(() => undefined);
    await this.dismissDouyinOverlays(page);
    await this.evaluateWithTimeout(
      page,
      'douyin-public-video-open-comments',
      page.evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const clickByText = (labels: string[]) => {
          const node = Array.from(
            document.querySelectorAll('button, [role="button"], div, span, a'),
          )
            .filter((item) => visible(item))
            .map((item) => ({
              node: item,
              text: normalize(item.innerText || item.textContent),
              rect: item.getBoundingClientRect(),
            }))
            .filter((item) => labels.includes(item.text))
            .filter((item) => item.rect.width <= 180 && item.rect.height <= 90)
            .sort(
              (a, b) => b.rect.x - a.rect.x || a.rect.y - b.rect.y,
            )[0]?.node;
          if (!node) return false;
          node.click();
          return true;
        };
        const bodyText = normalize(
          document.body.innerText || document.body.textContent || '',
        );
        const hasCommentArea =
          /全部评论|留下你的精彩评论吧|有爱评论|说点儿好听的/.test(bodyText);
        if (!hasCommentArea) {
          clickByText(['评论']);
        }
        const commentEntry = Array.from(
          document.querySelectorAll('button, [role="button"], div, span, p'),
        )
          .filter((node): node is HTMLElement => visible(node))
          .map((node) => ({
            node,
            text: normalize(node.innerText || node.textContent),
            rect: node.getBoundingClientRect(),
          }))
          .filter((item) =>
            /^(全部评论|留下你的精彩评论吧|有爱评论，说点儿好听的～?)$/.test(
              item.text,
            ),
          )
          .sort(
            (a, b) =>
              Math.abs(a.rect.x - window.innerWidth * 0.5) -
              Math.abs(b.rect.x - window.innerWidth * 0.5),
          )[0]?.node;
        if (commentEntry) {
          commentEntry.scrollIntoView({ block: 'center', inline: 'nearest' });
        } else {
          window.scrollBy({ top: 240, behavior: 'instant' as ScrollBehavior });
        }
        return true;
      }),
      5000,
      false,
    );
    await page.waitForTimeout(1000).catch(() => undefined);
  }

  private async scrollDouyinPublicCommentsForTarget(
    page: Page,
    targetText: string,
    targetName: string | undefined,
    attempts: number,
  ): Promise<boolean> {
    const target = this.normalizeInteractionText(targetText);
    const nameTarget = this.normalizeInteractionText(targetName || '');
    if (!target) return false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const state = await this.evaluateWithTimeout(
        page,
        `douyin-public-comment-scroll-${attempt + 1}`,
        page.evaluate(
          ({ expectedText, expectedName }) => {
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .trim();
            const visible = (node: Element | null): node is HTMLElement => {
              if (!node || !(node as HTMLElement).getBoundingClientRect)
                return false;
              const rect = (node as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.top < window.innerHeight &&
                rect.right > 0 &&
                rect.left < window.innerWidth &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) !== 0
              );
            };
            const textMatches = (text: string, targetValue: string) => {
              const normalizedText = normalize(text);
              const normalizedTarget = normalize(targetValue);
              return (
                normalizedTarget &&
                (normalizedText.includes(normalizedTarget) ||
                  normalizedTarget.includes(normalizedText))
              );
            };
            const rowCandidates = Array.from(
              document.querySelectorAll(
                'li, section, article, [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"], div',
              ),
            )
              .filter((node): node is HTMLElement => visible(node))
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const text = normalize(node.innerText || node.textContent);
                const className = String(node.className || '');
                const commentSignal =
                  /回复|分钟前|小时前|\d+天前|\d+周前|\d+月前|\d+年前|昨天|今天|刚刚|展开\d+条回复/.test(
                    text,
                  ) || /comment|Comment|cmt/i.test(className);
                const targetSignal = textMatches(text, expectedText);
                const nameSignal =
                  !expectedName || textMatches(text, expectedName);
                const plausibleRow =
                  rect.width >= 180 &&
                  rect.height >= 24 &&
                  rect.height <= Math.max(520, window.innerHeight * 0.75);
                return {
                  node,
                  rect,
                  text,
                  targetSignal,
                  nameSignal,
                  commentSignal,
                  plausibleRow,
                  score:
                    (targetSignal ? 200 : 0) +
                    (nameSignal ? 120 : -180) +
                    (commentSignal ? 80 : 0) +
                    (plausibleRow ? 160 : -260) +
                    (/comment|Comment|cmt/i.test(className) ? 40 : 0) -
                    Math.min(text.length, 1200) / 20 -
                    (rect.height > 260 ? 40 : 0),
                };
              })
              .filter(
                (item) =>
                  item.targetSignal &&
                  item.nameSignal &&
                  item.commentSignal &&
                  item.plausibleRow,
              )
              .filter((item) => item.score > 180)
              .sort(
                (a, b) => b.score - a.score || a.text.length - b.text.length,
              );
            const targetRow = rowCandidates[0]?.node;
            if (targetRow) {
              try {
                document
                  .querySelectorAll('[data-kaypal-target-comment="1"]')
                  .forEach((node) =>
                    node.removeAttribute('data-kaypal-target-comment'),
                  );
                targetRow.setAttribute('data-kaypal-target-comment', '1');
                targetRow.scrollIntoView({
                  block: 'center',
                  inline: 'nearest',
                });
                targetRow.dispatchEvent(
                  new MouseEvent('mouseover', { bubbles: true }),
                );
              } catch {
                /* 容错：非关键路径失败忽略 */
              }
              return { found: true, scrolled: false };
            }

            const containers = Array.from(
              document.querySelectorAll(
                '[class*="comment"], [class*="Comment"], main, aside, section, div',
              ),
            )
              .filter((node): node is HTMLElement => visible(node))
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const text = normalize(node.innerText || node.textContent);
                const scrollable = node.scrollHeight > node.clientHeight + 80;
                const commentSignal =
                  /全部评论|留下你的精彩评论吧|回复|展开\d+条回复|评论/.test(
                    text,
                  );
                return {
                  node,
                  rect,
                  scrollable,
                  commentSignal,
                  score:
                    (scrollable ? 120 : 0) +
                    (commentSignal ? 100 : 0) +
                    (rect.x > window.innerWidth * 0.42 ? 30 : 0) +
                    (rect.height > 220 ? 30 : 0) -
                    Math.abs(rect.height - window.innerHeight * 0.72) / 20 -
                    Math.min(text.length, 5000) / 100,
                };
              })
              .filter((item) => item.score > 120)
              .sort((a, b) => b.score - a.score);
            const container = containers[0]?.node;
            if (container) {
              container.scrollBy({
                top: Math.max(360, Math.floor(container.clientHeight * 0.72)),
                behavior: 'instant' as ScrollBehavior,
              });
              return { found: false, scrolled: true };
            }
            window.scrollBy({
              top: 520,
              behavior: 'instant' as ScrollBehavior,
            });
            return { found: false, scrolled: true };
          },
          { expectedText: target, expectedName: nameTarget },
        ),
        5000,
        { found: false, scrolled: false },
      );
      if (state.found) return true;
      if (!state.scrolled) {
        await page.mouse.wheel(0, 520).catch(() => undefined);
      }
      await page.waitForTimeout(900).catch(() => undefined);
    }
    return false;
  }

  private async openDouyinCommentPage(page: Page): Promise<void> {
    await this.gotoBestEffort(
      page,
      'https://creator.douyin.com/creator-micro/interactive/comment',
      30000,
    );
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => undefined);
    await page.waitForTimeout(2000).catch(() => undefined);
    if (!(await this.isDouyinCommentPageReady(page))) {
      await this.gotoBestEffort(
        page,
        'https://creator.douyin.com/creator-micro/content/manage',
        30000,
      );
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200).catch(() => undefined);
      await this.clickDouyinNavItem(page, '互动管理');
      await page.waitForTimeout(800).catch(() => undefined);
      await this.clickDouyinNavItem(page, '评论管理');
      if (!(await this.isDouyinCommentPageReady(page))) {
        await this.clickDouyinNavItem(page, '评论');
      }
      await page.waitForTimeout(2500).catch(() => undefined);
      if (!(await this.isDouyinCommentPageReady(page))) {
        await this.openDouyinCommentEntryFromContentManage(page);
      }
    }
    await this.dismissDouyinOverlays(page);
  }

  private async isDouyinCommentPageReady(page: Page): Promise<boolean> {
    return page
      .evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const text = normalize(document.body.innerText || '');
        const route = `${location.pathname}${location.hash}${location.search}`;
        const onCreator = /creator\.douyin\.com/.test(location.hostname);
        const onCommentRoute =
          /interactive\/comment|interaction\/comment|comment/i.test(route);
        const loginPrompt =
          /扫码登录|验证码登录|密码登录|登录\/注册|登录或注册|请先登录|未登录|二维码/.test(
            text,
          );
        const hasCommentManager =
          /评论管理|评论列表|评论互动|互动评论/.test(text) &&
          /选择作品|全部评论|最新发布|暂无评论|评论/.test(text);
        const hasCommentDetail =
          /全部评论|最新发布|有爱评论，说点儿好听的|回复|删除|举报/.test(text);
        const isWorkManagerOnly =
          /作品管理|全部作品|编辑作品|设置权限|删除作品/.test(text) &&
          !/评论管理|全部评论|评论列表|有爱评论|选择作品/.test(text);
        return (
          onCreator &&
          !loginPrompt &&
          !isWorkManagerOnly &&
          ((onCommentRoute && (hasCommentManager || hasCommentDetail)) ||
            (hasCommentManager && hasCommentDetail))
        );
      })
      .catch(() => false);
  }

  private async openDouyinCommentEntryFromContentManage(
    page: Page,
  ): Promise<boolean> {
    const clicked = await page
      .evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const scoreCandidate = (node: HTMLElement) => {
          const text = normalize(node.innerText || node.textContent);
          const rect = node.getBoundingClientRect();
          if (
            rect.x < 220 ||
            rect.y < 160 ||
            rect.width < 20 ||
            rect.height < 18
          )
            return -1;
          if (!/评论\s*\d+|\d+\s*(?:评论)?/.test(text)) return -1;
          if (
            /作品管理|全部作品|编辑作品|设置权限|删除作品/.test(text) &&
            text.length > 80
          )
            return -1;
          const parentText = normalize(node.parentElement?.innerText || '');
          let score = 0;
          if (/评论\s*\d+/.test(text)) score += 90;
          if (/^\d+$/.test(text) && /评论/.test(parentText)) score += 70;
          if (Number((text.match(/\d+/) || [0])[0]) > 0) score += 40;
          if (/播放|点赞|分享/.test(parentText)) score += 15;
          score -= Math.min(text.length, 100);
          return score;
        };
        const candidates = Array.from(
          document.querySelectorAll('a, button, [role="button"], div, span'),
        )
          .filter((node): node is HTMLElement => visible(node))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              node,
              score: scoreCandidate(node),
              x: rect.x,
              y: rect.y,
            };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
        const target = candidates[0]?.node;
        if (!target) return false;
        target.scrollIntoView({ block: 'center', inline: 'center' });
        target.click();
        return true;
      })
      .catch(() => false);
    if (!clicked) return false;
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500).catch(() => undefined);
    return true;
  }

  private async clickDouyinNavItem(
    page: Page,
    label: string,
  ): Promise<boolean> {
    return page
      .evaluate((targetLabel) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const node = Array.from(
          document.querySelectorAll('a, button, [role="button"], div, span'),
        )
          .filter(
            (item) =>
              visible(item) &&
              (() => {
                const text = normalize(item.innerText || item.textContent);
                const rect = item.getBoundingClientRect();
                const exact = text === targetLabel;
                const compact = text.replace(/\s+/g, '');
                const target = String(targetLabel).replace(/\s+/g, '');
                const contains =
                  compact.includes(target) &&
                  compact.length <= target.length + 8;
                return (
                  (exact || contains) && rect.width <= 260 && rect.height <= 96
                );
              })(),
          )
          .sort(
            (a, b) =>
              (a as HTMLElement).getBoundingClientRect().x -
              (b as HTMLElement).getBoundingClientRect().x,
          )[0] as HTMLElement | undefined;
        if (!node) return false;
        node.click();
        return true;
      }, label)
      .catch(() => false);
  }

  private async dismissDouyinOverlays(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const labels = ['我知道了', '稍后再看', '不再显示', '关闭', '取消'];
        for (const node of Array.from(
          document.querySelectorAll('button, [role="button"], span, div'),
        )) {
          if (!visible(node)) continue;
          const text = normalize(node.innerText || node.textContent);
          if (!labels.includes(text)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width > 180 || rect.height > 80) continue;
          node.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
  }

  private douyinCommentScanHasTarget(
    scan:
      | ({
          comments?: Array<Record<string, any>>;
          pageTextSample?: string;
          selectedWorkTitle?: string;
          scannedWorks?: Array<Record<string, any>>;
        } & Record<string, any>)
      | null
      | undefined,
    targetText: string,
    targetName = '',
  ): boolean {
    const target = this.normalizeInteractionText(targetText);
    const targetContact = this.normalizeInteractionText(targetName);
    if (!target && !targetContact) return Boolean(scan?.comments?.length);
    const matched = (value: unknown) => {
      const text = this.normalizeInteractionText(safeText(value));
      const compact = text.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '');
      const targetCompact = target.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '');
      const targetContactCompact = targetContact.replace(
        /[^0-9A-Za-z\u4e00-\u9fff]+/g,
        '',
      );
      return (
        text &&
        [target, targetContact, targetCompact, targetContactCompact].some(
          (candidate) =>
            Boolean(candidate) &&
            (text === candidate ||
              text.includes(candidate) ||
              candidate.includes(text) ||
              compact.includes(candidate) ||
              candidate.includes(compact)),
        )
      );
    };
    if (scan?.comments?.some((item) => matched(item.text))) {
      return true;
    }
    if (matched(scan?.pageTextSample) || matched(scan?.selectedWorkTitle)) {
      return true;
    }
    return Boolean(
      scan?.scannedWorks?.some((work) => {
        return (
          matched(work?.pageTextSample) ||
          matched(work?.selectedWorkTitle) ||
          (Array.isArray(work?.comments) &&
            work.comments.some((item: Record<string, any>) =>
              matched(item.text),
            ))
        );
      }),
    );
  }

  private normalizeInteractionText(value: string): string {
    return safeText(value)
      .replace(/\s+/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .trim();
  }

  private selectAllShortcut(): string {
    return process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  }

  private async pageContainsInteractionTarget(
    page: Page,
    ...targetTexts: Array<string | undefined>
  ): Promise<boolean> {
    const targets = Array.from(
      new Set(
        targetTexts
          .map((value) => this.normalizeInteractionText(value || ''))
          .filter(Boolean),
      ),
    );
    if (!targets.length) return false;
    const text = this.normalizeInteractionText(
      await this.pageText(page, 12000).catch(() => ''),
    );
    if (!text) return false;
    const compact = text.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '');
    return targets.some((target) => {
      const targetCompact = target.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '');
      return Boolean(
        text.includes(target) ||
        target.includes(text) ||
        compact.includes(targetCompact) ||
        targetCompact.includes(compact),
      );
    });
  }

  private async chooseDouyinCommentWorkWithCandidates(
    page: Page,
    scanLimit: number,
    maxWorks: number,
    targetText = '',
    targetName = '',
    parsingRules?: unknown,
  ): Promise<Record<string, any> & { comments?: Array<Record<string, any>> }> {
    const target = this.normalizeInteractionText(targetText);
    const targetContact = this.normalizeInteractionText(targetName);
    const rules =
      parsingRules && typeof parsingRules === 'object'
        ? (parsingRules as Record<string, unknown>)
        : {};
    const scanCurrent = async (
      selectedWorkTitle?: string,
      selectedWorkIndex?: number,
    ): Promise<
      Record<string, any> & { comments?: Array<Record<string, any>> }
    > => {
      const scan = await page.evaluate(
        ({ script, params }) => {
          const fn = (0, eval)(script);
          if (typeof fn !== 'function') {
            throw new Error('抖音评论扫描脚本未返回可执行函数。');
          }
          return fn(params);
        },
        {
          script: this.douyinCommentScanScript(),
          params: {
            limit: scanLimit,
            rules,
          },
        },
      );
      return {
        ...(scan as Record<string, any>),
        selectedWorkTitle,
        selectedWorkIndex,
        parsingRulesApplied: this.summarizeDouyinCommentParsingRules(rules),
      };
    };

    const initial = await scanCurrent();
    if (
      (initial.comments || []).length &&
      ((!target && !targetContact) ||
        this.douyinCommentScanHasTarget(initial, target, targetContact))
    ) {
      return initial;
    }

    const canSwitch = await page
      .evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const nodes = Array.from(
          document.querySelectorAll('button, [role="button"], div, span'),
        )
          .filter(
            (node) =>
              visible(node) &&
              normalize(node.innerText || node.textContent) === '选择作品',
          )
          .sort(
            (a, b) =>
              (b as HTMLElement).getBoundingClientRect().x -
              (a as HTMLElement).getBoundingClientRect().x,
          );
        const node = nodes[0] as HTMLElement | undefined;
        if (!node) return false;
        node.click();
        return true;
      })
      .catch(() => false);
    if (!canSwitch) {
      return { ...initial, workSwitchAttempted: false };
    }

    await page.waitForTimeout(1500).catch(() => undefined);
    const workItems = await page
      .evaluate((max) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 40 &&
            rect.height > 30 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const parseCommentCount = (text: string) => {
          const lines = text.split(/\n+/).map(normalize).filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i -= 1) {
            if (/^\d+$/.test(lines[i])) return Number(lines[i]);
          }
          const match = text.match(/发布于[\s\S]*?\s(\d+)\s*$/);
          return match ? Number(match[1]) : 0;
        };
        const candidates = Array.from(
          document.querySelectorAll('div, li, tr, section'),
        )
          .filter((node) => visible(node))
          .map((node, index) => {
            const text = normalize(node.innerText || node.textContent);
            const rect = node.getBoundingClientRect();
            const hasCover = node.querySelector(
              'img, video, canvas, [class*="cover"], [class*="Cover"]',
            );
            const hasPublishTime = /发布于|202\d年|\d{1,2}:\d{2}/.test(text);
            const inDrawer = rect.x > window.innerWidth * 0.55;
            const commentCount = parseCommentCount(
              node.innerText || node.textContent || '',
            );
            const tooGeneric =
              /^(选择作品|全部作品|公开视频|图文|搜索|取消|确定|暂无作品)$/.test(
                text,
              );
            return {
              index,
              text,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              hasCover: Boolean(hasCover),
              hasPublishTime,
              commentCount,
              inDrawer,
              tooGeneric,
            };
          })
          .filter(
            (item) =>
              item.inDrawer &&
              !item.tooGeneric &&
              item.hasCover &&
              item.hasPublishTime &&
              item.width >= 240 &&
              item.height >= 60 &&
              item.height <= 180 &&
              item.text.length >= 2 &&
              item.text.length <= 260,
          )
          .sort(
            (a, b) => b.commentCount - a.commentCount || a.y - b.y || a.x - b.x,
          );
        const seen = new Set<string>();
        return candidates
          .filter((item) => {
            const key = `${Math.round(item.y / 10)}:${item.text.slice(0, 80)}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, max);
      }, maxWorks)
      .catch(() => [] as Array<Record<string, any>>);

    const scanned = [initial];
    let bestScanWithComments: Record<string, any> | null = (
      initial.comments || []
    ).length
      ? initial
      : null;
    for (let index = 0; index < workItems.length; index += 1) {
      const item = workItems[index];
      try {
        const clicked = await page.evaluate(
          ({ text, index: itemIndex }) => {
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .trim();
            const visible = (node: Element | null): node is HTMLElement => {
              if (!node || !(node as HTMLElement).getBoundingClientRect)
                return false;
              const rect = (node as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 40 &&
                rect.height > 30 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
              );
            };
            const nodes = Array.from(
              document.querySelectorAll('div, li, tr, section'),
            )
              .filter((node) => {
                const rect = (node as HTMLElement).getBoundingClientRect();
                return (
                  visible(node) &&
                  rect.x > window.innerWidth * 0.55 &&
                  normalize(node.innerText || node.textContent).includes(
                    String(text).slice(0, Math.min(String(text).length, 80)),
                  )
                );
              })
              .sort((a, b) => {
                const ar = (a as HTMLElement).getBoundingClientRect();
                const br = (b as HTMLElement).getBoundingClientRect();
                return ar.height - br.height || ar.width - br.width;
              });
            const fallback = Array.from(
              document.querySelectorAll('div, li, tr, section'),
            ).filter((node) => {
              const rect = (node as HTMLElement).getBoundingClientRect();
              return (
                visible(node) &&
                rect.x > window.innerWidth * 0.55 &&
                node.querySelector('img') &&
                /发布于/.test(normalize(node.innerText || node.textContent))
              );
            })[itemIndex] as HTMLElement | undefined;
            const node = (nodes[0] || fallback) as HTMLElement | undefined;
            if (!node) return false;
            node.scrollIntoView({ block: 'center', inline: 'nearest' });
            node.click();
            return true;
          },
          { text: String(item.text || ''), index },
        );
        if (!clicked) continue;
        await page.waitForTimeout(2200).catch(() => undefined);
        await this.dismissDouyinOverlays(page);
        const scan = await scanCurrent(String(item.text || ''), index);
        scanned.push(scan);
        if ((scan.comments || []).length) {
          bestScanWithComments = bestScanWithComments || scan;
          if (
            (!target && !targetContact) ||
            this.douyinCommentScanHasTarget(scan, target, targetContact)
          ) {
            return {
              ...scan,
              workSwitchAttempted: true,
              workCandidates: workItems,
              scannedWorks: scanned.slice(-8),
            };
          }
        }
        await this.reopenDouyinWorkSelector(page);
      } catch (error) {
        this.logger.warn(
          `choose douyin comment work failed index=${index}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(500).catch(() => undefined);
      }
    }

    const fallback = bestScanWithComments || initial;
    return {
      ...fallback,
      workSwitchAttempted: true,
      workCandidates: workItems,
      scannedWorks: scanned.slice(-8),
      targetText: target || undefined,
      targetMatched: target
        ? this.douyinCommentScanHasTarget(fallback, target, targetContact)
        : undefined,
    };
  }

  private async reopenDouyinWorkSelector(page: Page): Promise<void> {
    await page
      .evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const nodes = Array.from(
          document.querySelectorAll('button, [role="button"], div, span'),
        )
          .filter(
            (node) =>
              visible(node) &&
              normalize(node.innerText || node.textContent) === '选择作品',
          )
          .sort(
            (a, b) =>
              (b as HTMLElement).getBoundingClientRect().x -
              (a as HTMLElement).getBoundingClientRect().x,
          );
        (nodes[0] as HTMLElement | undefined)?.click();
      })
      .catch(() => undefined);
    await page.waitForTimeout(1200).catch(() => undefined);
  }

  private summarizeDouyinCommentParsingRules(rules: Record<string, unknown>) {
    return {
      mode: rules.commentParsingMode || 'none',
      preset: rules.commentRulePreset || 'loose',
      allowShortText: rules.commentAllowShortText !== false,
      skipHandled: Boolean(rules.commentSkipHandled),
      questionOnly: Boolean(rules.commentQuestionOnly),
      minLength: rules.commentMinLength || 1,
      maxLength: rules.commentMaxLength || 500,
      whitelistCount: Array.isArray(rules.commentWhitelistKeywords)
        ? rules.commentWhitelistKeywords.length
        : 0,
    };
  }

  private douyinCommentScanScript(): string {
    return `({ limit, rules = {} }) => {
      const normalize = (value) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value) ?? ""
        .replace(/\\s+/g, ' ')
        .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
        .trim();
      const list = (value) => Array.isArray(value)
        ? value.map((item) => normalize(item)).filter(Boolean)
        : [];
      const parsingMode = rules.commentParsingMode === 'rules' ? 'rules' : 'none';
      const preset = rules.commentRulePreset === 'strict' ? 'strict' : 'loose';
      const allowShortText = rules.commentAllowShortText !== false;
      const skipHandled = Boolean(rules.commentSkipHandled);
      const questionOnly = Boolean(rules.commentQuestionOnly);
      const requireActionAndTime = Boolean(rules.commentRequireActionAndTime);
      const minLength = Math.max(1, Math.min(Number(rules.commentMinLength) || 1, 80));
      const maxLength = Math.max(10, Math.min(Number(rules.commentMaxLength) || 500, 500));
      const whitelistKeywords = list(rules.commentWhitelistKeywords);
      const authorKeywords = list(rules.commentExcludeAuthorKeywords);
      const configuredNoise = list(rules.commentNoiseKeywords);
      const priorityKeywords = list(rules.commentPriorityKeywords);
      const hasAny = (text, keywords) => keywords.some((keyword) => keyword && text.includes(keyword));
      const questionPattern = /[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信/;
      const visible = (node) => {
        if (!node || !node.getBoundingClientRect) return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none'
          && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
      };
      const hasReadableChar = (text) => /[\\u4e00-\\u9fa5a-zA-Z0-9]/.test(text) || /[\\u{1F300}-\\u{1FAFF}]/u.test(text);
      const exactNoise = new Set([
        '发布作品', '作品管理', '数据中心', '创作者服务中心', '全部作品',
        '公开视频', '图文', '合集', '搜索', '筛选', '下载', '置顶',
        '删除', '编辑', '查看数据', '发布', '草稿', '审核', '回复',
        '高清发布', '选择作品', '全部评论', '全部人群', '最新发布',
        '暂无更多评论', '暂无评论', '点击刷新', '发送', '评论管理',
        '请选择排序方式', '有爱评论，说点儿好听的～',
        '你对评论管理功能是否满意', '不再显示', '在线客服',
        '通知', '网址', '抖音', '首页', '内容管理', '互动管理',
        '关注管理', '粉丝管理', '弹幕管理', '私信管理', '变现中心',
        '创作中心', '我知道了', '加载中，请稍候...', '加载中',
      ]);
      const containsNoise = [
        'KAYPAL REAL PUB',
        'KAYPAL COMMERCIAL',
        'commercial #realtest',
        '#kaypal',
        '新增「共创中心」模块',
        '管理你的共创作品',
        '发布于202',
        '本通知发布',
        '如有疑问',
        '星图平台',
      ];
      const statPattern = /^(播放|点赞|评论|分享)\\s*[-\\d]+$|播放\\s*[-\\d]+\\s*点赞\\s*[-\\d]+\\s*评论\\s*[-\\d]+\\s*分享\\s*[-\\d]+|^\\d+$|^\\d{1,2}:\\d{2}$|^(昨天|今天)\\d{1,2}:\\d{2}$|^\\d{1,2}月\\d{1,2}日\\s*\\d{1,2}:\\d{2}$|^\\d+分钟前$|^\\d+小时前$|^\\d+天前$|^刚刚$/;
      const isNoise = (text) => {
        if (!text) return true;
        if (whitelistKeywords.length && hasAny(text, whitelistKeywords)) return false;
        if (text.length < minLength || text.length > maxLength) return true;
        if (!allowShortText && text.length < 2) return true;
        if (!hasReadableChar(text)) return true;
        if (exactNoise.has(text)) return true;
        if (configuredNoise.length && hasAny(text, configuredNoise)) return true;
        if (containsNoise.some((item) => text.includes(item))) return true;
        if (/^展开\\d+条回复$/.test(text)) return true;
        if (/^[\\u4e00-\\u9fa5A-Za-z0-9_·-]{1,24}(?:📷|✅|✔|V)?$/.test(text)
          && !questionPattern.test(text)
          && !/干净|好|不错|喜欢|想|要|买|来|发|帮|看/.test(text)) {
          return true;
        }
        if (questionOnly && !questionPattern.test(text) && !hasAny(text, whitelistKeywords)) return true;
        if (text.includes('#') && !hasAny(text, whitelistKeywords)) return true;
        if (/发布于20\\d{2}年/.test(text)) return true;
        if (statPattern.test(text)) return true;
        return false;
      };
      const isDirectCommentText = (text) => {
        if (!text) return false;
        if (!hasReadableChar(text)) return false;
        if (/^#/.test(text)) return false;
        if (exactNoise.has(text)) return false;
        if (/发布于20\\d{2}年/.test(text)) return false;
        if (/^\\d{4}年\\d{2}月\\d{2}日\\s+\\d{1,2}:\\d{2}$/.test(text)) return false;
        if (/^\\d{1,2}:\\d{2}$|^刚刚$|^\\d+分钟前$|^\\d+小时前$|^昨天$|^今天$/.test(text)) return false;
        if (/^(回复|删除|举报|发送|最新发布|没有更多评论)$/.test(text)) return false;
        return true;
      };
      const candidates = [];
      const commentTextFromRow = (row) => {
        const direct = Array.from(row.querySelectorAll('[class*="comment-content-text"], [class*="CommentContent"], [class*="commentContent"]'))
          .filter((node) => visible(node))
          .map((node) => normalize(node.innerText || node.textContent))
          .find((text) => isDirectCommentText(text));
        if (direct) return direct;
        const texts = [];
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent || !visible(parent)) continue;
          const text = normalize(node.nodeValue);
          if (!text || isNoise(text)) continue;
          const rect = parent.getBoundingClientRect();
          const nearActions = rect.y > row.getBoundingClientRect().bottom - 90;
          texts.push({
            text,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            nearActions,
            question: questionPattern.test(text),
          });
        }
        return texts
          .filter((item) => !item.nearActions || item.question)
          .sort((a, b) => (b.question ? 1 : 0) - (a.question ? 1 : 0) || b.y - a.y || b.x - a.x)[0]?.text || '';
      };
      const commentRowFor = (node) => {
        let current = node;
        for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
          if (!visible(current)) continue;
          const text = normalize(current.innerText || current.textContent || '');
          const rect = current.getBoundingClientRect();
          if (/回复|删除|举报/.test(text) && rect.width >= 180 && rect.height >= 40 && rect.height <= 220) {
            return current;
          }
        }
        return node.closest('tr, li, [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"], [class*="list"], [class*="List"]') || node.parentElement || node;
      };
      const pushCandidate = (text, node, source, baseScore = 0, trustedDirect = false) => {
        text = normalize(text);
        if (trustedDirect ? !isDirectCommentText(text) : isNoise(text)) return;
        const rect = node.getBoundingClientRect();
        if (rect.x < 260 || rect.y < 120) return;
        const row = commentRowFor(node);
        const context = normalize(row.innerText || row.textContent || '').slice(0, 260);
        const hasCommentAction = /回复|删除/.test(context);
        const hasCommentTime = /分钟前|小时前|刚刚|昨天|今天|\\d{1,2}:\\d{2}/.test(context);
        const hasCommentContext = requireActionAndTime
          ? hasCommentAction && hasCommentTime
          : (hasCommentAction || hasCommentTime);
        if (parsingMode === 'rules' && !hasCommentContext && preset === 'strict') return;
        if (skipHandled && /已回复|我已回复|商家回复|作者回复/.test(context)) return;
        if (/(^|\\s)(商家|客服)(\\s|$)/.test(context) || hasAny(context, authorKeywords)) return;
        const rowComment = commentTextFromRow(row);
        if (source === 'comment-row' && rowComment && isDirectCommentText(rowComment)) {
          text = rowComment;
        }
        let score = baseScore;
        if (trustedDirect || source === 'comment-content') score += 110;
        if (hasCommentContext) score += 30;
        if (source === 'comment-row') score += 18;
        if (questionPattern.test(text)) score += 18;
        if (hasAny(text, priorityKeywords)) score += 20;
        if (hasAny(text, whitelistKeywords)) score += 60;
        if (/[\\u{1F300}-\\u{1FAFF}]/u.test(text)) score += 12;
        if (/AI研究员|账号|用户|作者|达人|商家|客服$/.test(text)) score -= 12;
        if (text.includes('#') && !hasAny(text, whitelistKeywords)) score -= 15;
        candidates.push({
          text,
          looksLikeComment: true,
          source,
          score,
          context,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      };

      for (const element of Array.from(document.querySelectorAll('[class*="comment-content-text"], [class*="CommentContent"], [class*="commentContent"]'))) {
        if (!visible(element)) continue;
        const row = commentRowFor(element);
        const context = normalize(row.innerText || row.textContent || '');
        if (!/回复|删除|举报/.test(context)) continue;
        pushCandidate(element.innerText || element.textContent, element, 'comment-content', 80, true);
      }

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || !visible(parent)) continue;
        const text = normalize(node.nodeValue);
        pushCandidate(text, parent, 'text-node', 10);
      }

      for (const element of Array.from(document.querySelectorAll('div, li, tr, section'))) {
        if (!visible(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.x < 260 || rect.y < 120) continue;
        const text = normalize(element.innerText || element.textContent);
        if (parsingMode === 'rules' && preset === 'strict' && !/回复|删除/.test(text)) continue;
        if (parsingMode === 'rules' && preset === 'strict' && !/分钟前|小时前|刚刚|天前|今天|昨天/.test(text)) continue;
        const parts = text.split(/\\s+/).map(normalize).filter(Boolean);
        const rowComment = commentTextFromRow(element);
        if (rowComment) {
          pushCandidate(rowComment, element, 'comment-row', 20);
        } else {
          for (const part of parts) {
            pushCandidate(part, element, 'comment-row', 20);
          }
        }
      }

      const seen = new Set();
      const comments = [];
      for (const item of candidates.sort((a, b) => (b.score - a.score) || (a.y - b.y) || (a.x - b.x))) {
        if (seen.has(item.text)) continue;
        seen.add(item.text);
        comments.push(item);
        if (comments.length >= limit) break;
      }
      return {
        url: location.href,
        title: document.title,
        totalCandidates: candidates.length,
        comments,
        pageTextSample: normalize(document.body.innerText).slice(0, 800),
      };
    }`;
  }

  private async fillAndSendDouyinVideoCommentOnPage(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const openEditor = async () =>
      this.evaluateWithTimeout(
        page,
        'douyin-video-comment-open-editor',
        page.evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const editorSelector =
            'textarea, [contenteditable="true"], input[type="text"], input[type="search"], [role="textbox"], [role="searchbox"]';
          const isLikelySearchEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                node.getAttribute('role'),
                'type' in node ? (node as HTMLInputElement).type : '',
              ].join(' '),
            );
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[role="search"], [role="searchbox"], header, nav, [class*="search"], [class*="Search"], [id*="search"], [id*="Search"], [class*="header"], [class*="Header"], [class*="nav"], [class*="Nav"]',
            ) as HTMLElement | null;
            const ancestorMeta = normalize(
              [
                ancestor?.getAttribute('aria-label'),
                ancestor?.getAttribute('title'),
                ancestor?.getAttribute('id'),
                ancestor?.getAttribute('class'),
              ].join(' '),
            );
            const joinedMeta = `${meta} ${ancestorMeta}`.toLowerCase();
            const rect = node.getBoundingClientRect();
            return (
              /搜索|搜一搜|search|searchbox|douyin-search/.test(joinedMeta) ||
              (rect.y < 120 && /搜索|search|header|nav/.test(joinedMeta))
            );
          };
          const isLikelyDanmakuEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="danmaku"], [class*="Danmaku"], [class*="danmu"], [class*="Danmu"], [class*="barrage"], [class*="Barrage"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            ).toLowerCase();
            return /弹幕|danmaku|danmu|barrage/.test(meta);
          };
          const hasCommentEditorSignal = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="comment"], [class*="Comment"], [class*="cmt"], [class*="Cmt"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            );
            return /留下|精彩评论|有爱评论|说点|评论|comment|cmt/i.test(meta);
          };
          const pickEditor = () => {
            const editors = Array.from(
              document.querySelectorAll(editorSelector),
            )
              .filter((node): node is HTMLElement => visible(node))
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const placeholder = normalize(node.getAttribute('placeholder'));
                const value = normalize(
                  'value' in node
                    ? (node as HTMLInputElement).value
                    : node.textContent,
                );
                const topLevelHint =
                  /留下|精彩评论|有爱评论|说点|评论/.test(placeholder) &&
                  !/^回复/.test(placeholder);
                const isGenericInput =
                  String(node.tagName || '').toUpperCase() === 'INPUT' &&
                  !topLevelHint;
                return {
                  node,
                  rect,
                  placeholder,
                  value,
                  isGenericInput,
                  isSearchEditor: isLikelySearchEditor(node, placeholder),
                  isDanmakuEditor: isLikelyDanmakuEditor(node, placeholder),
                  isCommentEditor: hasCommentEditorSignal(node, placeholder),
                  score:
                    (topLevelHint ? 180 : 0) +
                    (rect.width > 180 ? 30 : 0) +
                    (rect.x > window.innerWidth * 0.35 ? 20 : 0) -
                    (placeholder.startsWith('回复') ? 160 : 0) -
                    Math.abs(rect.y - window.innerHeight * 0.75) / 12,
                };
              })
              .filter((item) => item.rect.width > 80 && item.rect.height >= 12)
              .filter((item) => !item.isSearchEditor)
              .filter((item) => !item.isDanmakuEditor)
              .filter((item) => item.isCommentEditor)
              .filter(
                (item) =>
                  !item.isGenericInput ||
                  item.rect.y > window.innerHeight * 0.45,
              )
              .sort((a, b) => b.score - a.score);
            return editors[0];
          };

          const editor = pickEditor();
          if (editor) {
            editor.node.focus();
            return {
              status: 'editor_found',
              rect: {
                x: editor.rect.x,
                y: editor.rect.y,
                width: editor.rect.width,
                height: editor.rect.height,
              },
            };
          }

          const clickTarget = Array.from(
            document.querySelectorAll('button, [role="button"], div, span, p'),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => ({
              node,
              text: normalize(node.innerText || node.textContent),
              rect: node.getBoundingClientRect(),
            }))
            .filter((item) =>
              /留下你的精彩评论吧|有爱评论|说点儿好听的|写评论|发表评论|评论一下/.test(
                item.text,
              ),
            )
            .filter((item) => item.rect.width > 80 && item.rect.height >= 18)
            .sort(
              (a, b) =>
                Math.abs(a.rect.y - window.innerHeight * 0.75) -
                  Math.abs(b.rect.y - window.innerHeight * 0.75) ||
                b.rect.x - a.rect.x,
            )[0];
          if (!clickTarget) {
            return {
              status: 'editor_missing',
              message: '公开视频评论区没有找到可编辑评论框。',
            };
          }
          clickTarget.node.scrollIntoView({
            block: 'center',
            inline: 'nearest',
          });
          clickTarget.node.click();
          return { status: 'placeholder_clicked' };
        }),
        6000,
        { status: 'editor_missing', message: '查找公开视频评论框超时。' },
      );

    let editor = await openEditor();
    if (editor.status === 'placeholder_clicked') {
      await page.waitForTimeout(900).catch(() => undefined);
      editor = await openEditor();
    }
    if (editor.status !== 'editor_found') {
      return {
        status: 'editor_missing',
        message: editor.message || '没有找到公开视频评论输入框。',
        nextAction: '确认抖音视频页面评论区已打开，账号可在网页端发表评论。',
      };
    }

    const rect: Record<string, number> = editor.rect || {};
    await page.mouse.click(
      Number(rect.x || 0) + Math.max(Number(rect.width || 1) / 2, 1),
      Number(rect.y || 0) + Math.max(Number(rect.height || 1) / 2, 1),
    );
    await page.keyboard.press(this.selectAllShortcut()).catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.keyboard.insertText(input.replyText);
    await page.waitForTimeout(600).catch(() => undefined);

    await this.evaluateWithTimeout(
      page,
      'douyin-video-comment-fill-dom',
      page.evaluate(
        ({ replyText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          };
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const isLikelySearchEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                node.getAttribute('role'),
                'type' in node ? (node as HTMLInputElement).type : '',
              ].join(' '),
            );
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[role="search"], [role="searchbox"], header, nav, [class*="search"], [class*="Search"], [id*="search"], [id*="Search"], [class*="header"], [class*="Header"], [class*="nav"], [class*="Nav"]',
            ) as HTMLElement | null;
            const ancestorMeta = normalize(
              [
                ancestor?.getAttribute('aria-label'),
                ancestor?.getAttribute('title'),
                ancestor?.getAttribute('id'),
                ancestor?.getAttribute('class'),
              ].join(' '),
            );
            const joinedMeta = `${meta} ${ancestorMeta}`.toLowerCase();
            const rect = node.getBoundingClientRect();
            return (
              /搜索|搜一搜|search|searchbox|douyin-search/.test(joinedMeta) ||
              (rect.y < 120 && /搜索|search|header|nav/.test(joinedMeta))
            );
          };
          const isLikelyDanmakuEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="danmaku"], [class*="Danmaku"], [class*="danmu"], [class*="Danmu"], [class*="barrage"], [class*="Barrage"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            ).toLowerCase();
            return /弹幕|danmaku|danmu|barrage/.test(meta);
          };
          const hasCommentEditorSignal = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="comment"], [class*="Comment"], [class*="cmt"], [class*="Cmt"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            );
            return /留下|精彩评论|有爱评论|说点|评论|comment|cmt/i.test(meta);
          };
          const editors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], input[type="search"], [role="textbox"], [role="searchbox"]',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const placeholder = normalize(node.getAttribute('placeholder'));
              const value = normalize(
                'value' in node
                  ? (node as HTMLInputElement).value
                  : node.textContent,
              );
              const topLevelHint =
                /留下|精彩评论|有爱评论|说点|评论/.test(placeholder) &&
                !placeholder.startsWith('回复');
              const isGenericInput =
                String(node.tagName || '').toUpperCase() === 'INPUT' &&
                !topLevelHint;
              const priority =
                (/留下|精彩评论|有爱评论|说点|评论/.test(placeholder)
                  ? 0
                  : 30) +
                (placeholder.startsWith('回复') ? 100 : 0) +
                Math.abs(rect.y - window.innerHeight * 0.75) / 20;
              return {
                node,
                value,
                priority,
                rect,
                isGenericInput,
                isSearchEditor: isLikelySearchEditor(node, placeholder),
                isDanmakuEditor: isLikelyDanmakuEditor(node, placeholder),
                isCommentEditor: hasCommentEditorSignal(node, placeholder),
              };
            })
            .filter((item) => !item.isSearchEditor)
            .filter((item) => !item.isDanmakuEditor)
            .filter((item) => item.isCommentEditor)
            .filter(
              (item) =>
                !item.isGenericInput || item.rect.y > window.innerHeight * 0.45,
            )
            .sort((a, b) => a.priority - b.priority);
          if (editors.some((item) => item.value.includes(replyPrefix))) {
            return { status: 'already_has_text' };
          }
          const editorNode = editors[0]?.node;
          if (!editorNode) return { status: 'editor_missing' };
          editorNode.focus();
          if ('value' in editorNode) {
            const descriptor = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(editorNode),
              'value',
            );
            if (descriptor?.set) {
              descriptor.set.call(editorNode, replyText);
            } else {
              (editorNode as HTMLInputElement).value = replyText;
            }
          } else {
            editorNode.textContent = replyText;
          }
          for (const type of ['input', 'change', 'compositionend']) {
            editorNode.dispatchEvent(
              new Event(type, { bubbles: true, cancelable: true }),
            );
          }
          return { status: 'filled_by_dom' };
        },
        { replyText: input.replyText },
      ),
      6000,
      { status: 'fill_timeout' },
    );

    if (input.action === 'draft') {
      return {
        status: 'draft_filled',
        message: '已在抖音公开视频评论框填入评论草稿，未点击发送。',
        readbackText: input.replyText,
        replyVisible: true,
      };
    }

    const sendButton = await this.evaluateWithTimeout(
      page,
      'douyin-video-comment-find-send-button',
      page.evaluate(
        ({ replyText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth
            );
          };
          const disabled = (node: Element) => {
            const aria = String(
              node.getAttribute('aria-disabled') || '',
            ).toLowerCase();
            return (
              Boolean((node as HTMLButtonElement).disabled) ||
              aria === 'true' ||
              /disabled/.test(
                String((node as HTMLElement).className || '').toLowerCase(),
              )
            );
          };
          const editorSelector =
            'textarea, [contenteditable="true"], input[type="text"], input[type="search"], [role="textbox"], [role="searchbox"]';
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const isLikelySearchEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                node.getAttribute('role'),
                'type' in node ? (node as HTMLInputElement).type : '',
              ].join(' '),
            );
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[role="search"], [role="searchbox"], header, nav, [class*="search"], [class*="Search"], [id*="search"], [id*="Search"], [class*="header"], [class*="Header"], [class*="nav"], [class*="Nav"]',
            ) as HTMLElement | null;
            const ancestorMeta = normalize(
              [
                ancestor?.getAttribute('aria-label'),
                ancestor?.getAttribute('title'),
                ancestor?.getAttribute('id'),
                ancestor?.getAttribute('class'),
              ].join(' '),
            );
            const joinedMeta = `${meta} ${ancestorMeta}`.toLowerCase();
            const rect = node.getBoundingClientRect();
            return (
              /搜索|搜一搜|search|searchbox|douyin-search/.test(joinedMeta) ||
              (rect.y < 120 && /搜索|search|header|nav/.test(joinedMeta))
            );
          };
          const isLikelyDanmakuEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="danmaku"], [class*="Danmaku"], [class*="danmu"], [class*="Danmu"], [class*="barrage"], [class*="Barrage"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            ).toLowerCase();
            return /弹幕|danmaku|danmu|barrage/.test(meta);
          };
          const hasCommentEditorSignal = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="comment"], [class*="Comment"], [class*="cmt"], [class*="Cmt"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            );
            return /留下|精彩评论|有爱评论|说点|评论|comment|cmt/i.test(meta);
          };
          const editors = Array.from(document.querySelectorAll(editorSelector))
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const placeholder = normalize(node.getAttribute('placeholder'));
              const value = normalize(
                'value' in node
                  ? (node as HTMLInputElement).value
                  : node.textContent,
              );
              return {
                node,
                rect,
                value,
                isSearchEditor: isLikelySearchEditor(node, placeholder),
                isDanmakuEditor: isLikelyDanmakuEditor(node, placeholder),
                isCommentEditor: hasCommentEditorSignal(node, placeholder),
              };
            })
            .filter((item) => !item.isSearchEditor)
            .filter((item) => !item.isDanmakuEditor)
            .filter((item) => item.isCommentEditor)
            .filter((item) => item.value.includes(replyPrefix))
            .sort((a, b) => b.rect.width - a.rect.width || b.rect.y - a.rect.y);
          const editor = editors[0];
          if (!editor)
            return {
              status: 'editor_missing',
              message: '评论内容没有进入评论框。',
            };
          const redArrowNodes = Array.from(
            document.querySelectorAll(
              '[class~="f5hSYimo"], [class~="siaMKBB_"], path[fill="#FE2C55"], path[fill="#fe2c55"]',
            ),
          )
            .map((node) => {
              const element =
                node.closest(
                  'button, [role="button"], [class~="f5hSYimo"], [class~="siaMKBB_"]',
                ) || node;
              return element as HTMLElement;
            })
            .filter(
              (node, index, list): node is HTMLElement =>
                visible(node) && list.indexOf(node) === index,
            );
          const textButtons = Array.from(
            document.querySelectorAll('button, [role="button"], span, div'),
          ).filter((node): node is HTMLElement => {
            if (!visible(node)) return false;
            const text = normalize(node.innerText || node.textContent);
            const rect = node.getBoundingClientRect();
            const tag = String(node.tagName || '').toUpperCase();
            const role = String(node.getAttribute('role') || '').toLowerCase();
            const isRealButton = tag === 'BUTTON' || role === 'button';
            return (
              /^(发送|回复|提交|发布)$/.test(text) &&
              (isRealButton || (rect.width <= 90 && rect.height <= 40))
            );
          });
          const nearEditorIconButtons = Array.from(
            document.querySelectorAll(
              'button, [role="button"], [aria-label], div, span',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText || node.textContent);
              const meta = normalize(
                [
                  text,
                  node.getAttribute('aria-label'),
                  node.getAttribute('title'),
                  node.getAttribute('class'),
                  node.getAttribute('data-e2e'),
                ].join(' '),
              ).toLowerCase();
              const hasIcon = Boolean(
                node.querySelector('svg, path, use, img') ||
                ['svg', 'path', 'use', 'img'].includes(
                  String(node.tagName || '').toLowerCase(),
                ),
              );
              const nearEditor =
                rect.y >= editor.rect.y - 36 &&
                rect.y <= editor.rect.y + 150 &&
                rect.x >=
                  editor.rect.x + Math.max(120, editor.rect.width * 0.55);
              const compact =
                rect.width >= 16 &&
                rect.width <= 96 &&
                rect.height >= 16 &&
                rect.height <= 72;
              const looksLikeSubmit =
                /发送|回复|提交|发布|send|reply|submit|publish|comment/.test(
                  meta,
                ) ||
                Boolean(
                  node.querySelector(
                    'path[fill="#FE2C55"], path[fill="#fe2c55"], path[fill="#ff2c55"], path[fill="#FF2C55"]',
                  ),
                );
              return {
                node,
                rect,
                text,
                hasIcon,
                nearEditor,
                compact,
                looksLikeSubmit,
                distanceToRight: Math.abs(
                  rect.x - (editor.rect.x + editor.rect.width),
                ),
              };
            })
            .filter((item) => item.nearEditor && item.compact && item.hasIcon)
            .filter((item) => item.looksLikeSubmit || !item.text)
            .sort(
              (a, b) =>
                Number(b.looksLikeSubmit) - Number(a.looksLikeSubmit) ||
                a.distanceToRight - b.distanceToRight,
            )
            .map((item) => item.node);
          const button = [
            ...redArrowNodes,
            ...textButtons,
            ...nearEditorIconButtons,
          ]
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const className = String(node.className || '');
              const inputTools = node.closest(
                '[class*="commentInput-right"], [class*="comment-input-right"], [class*="commentInputRight"]',
              );
              const redSubmitIcon = Boolean(
                inputTools &&
                (/(^|\s)(f5hSYimo|siaMKBB_)(\s|$)/.test(className) ||
                  node.querySelector(
                    'path[fill="#FE2C55"], path[fill="#fe2c55"]',
                  )),
              );
              const rawText = normalize(node.innerText || node.textContent);
              const isNearEditorIcon =
                !rawText &&
                rect.y >= editor.rect.y - 36 &&
                rect.y <= editor.rect.y + 150 &&
                rect.x >=
                  editor.rect.x + Math.max(120, editor.rect.width * 0.55) &&
                rect.width >= 16 &&
                rect.width <= 96 &&
                rect.height >= 16 &&
                rect.height <= 72 &&
                Boolean(
                  node.querySelector('svg, path, use, img') ||
                  ['svg', 'path', 'use', 'img'].includes(
                    String(node.tagName || '').toLowerCase(),
                  ),
                );
              return {
                rect,
                text:
                  rawText || (redSubmitIcon || isNearEditorIcon ? '发送' : ''),
                priority: redSubmitIcon ? 0 : isNearEditorIcon ? 2 : 1,
                disabled: disabled(node),
                distance:
                  Math.abs(rect.y - editor.rect.y) +
                  Math.abs(rect.x - editor.rect.x),
              };
            })
            .filter((item) => item.text === '发送')
            .filter(
              (item) =>
                item.rect.y >= editor.rect.y - 30 &&
                item.rect.y <= editor.rect.y + 150 &&
                item.rect.x >= editor.rect.x,
            )
            .sort(
              (a, b) =>
                a.priority - b.priority ||
                Number(a.disabled) - Number(b.disabled) ||
                a.distance - b.distance,
            )[0];
          if (!button)
            return {
              status: 'send_button_missing',
              message: '评论已输入，但没有找到发送按钮。',
            };
          return {
            status: button.disabled
              ? 'send_button_disabled'
              : 'send_button_ready',
            message: button.disabled
              ? '评论已输入，但发送按钮仍是禁用态。'
              : '评论已输入，发送按钮可点击。',
            rect: {
              x: button.rect.x,
              y: button.rect.y,
              width: button.rect.width,
              height: button.rect.height,
            },
          };
        },
        { replyText: input.replyText },
      ),
      6000,
      { status: 'send_button_missing', message: '查找发送按钮超时。' },
    );
    if (sendButton.status !== 'send_button_ready') {
      return {
        status:
          sendButton.status === 'editor_missing'
            ? 'editor_missing'
            : 'send_failed',
        message: sendButton.message || '评论已输入，但发送按钮不可用。',
        nextAction: '检查抖音是否弹出验证，或评论内容是否触发平台限制。',
      };
    }

    const buttonRect: Record<string, number> = sendButton.rect || {};
    const buttonWidth = Math.max(Number(buttonRect.width || 1), 1);
    const buttonX =
      Number(buttonRect.x || 0) +
      (buttonWidth > 48 ? buttonWidth - 18 : buttonWidth / 2);
    const buttonY =
      Number(buttonRect.y || 0) +
      Math.max(Number(buttonRect.height || 1) / 2, 1);
    await page.mouse.move(buttonX, buttonY).catch(() => undefined);
    await page.waitForTimeout(120).catch(() => undefined);
    await page.mouse.click(buttonX, buttonY);
    await page.waitForTimeout(900).catch(() => undefined);

    const verify = await this.evaluateWithTimeout(
      page,
      'douyin-video-comment-verify-sent',
      page.evaluate(
        async ({ replyText }) => {
          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0 &&
              rect.bottom > 0 &&
              rect.top < window.innerHeight &&
              rect.right > 0 &&
              rect.left < window.innerWidth
            );
          };
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const editorSelector =
            'textarea, [contenteditable="true"], input[type="text"], input[type="search"], [role="textbox"], [role="searchbox"]';
          const isLikelySearchEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                node.getAttribute('role'),
                'type' in node ? (node as HTMLInputElement).type : '',
              ].join(' '),
            );
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[role="search"], [role="searchbox"], header, nav, [class*="search"], [class*="Search"], [id*="search"], [id*="Search"], [class*="header"], [class*="Header"], [class*="nav"], [class*="Nav"]',
            ) as HTMLElement | null;
            const ancestorMeta = normalize(
              [
                ancestor?.getAttribute('aria-label'),
                ancestor?.getAttribute('title'),
                ancestor?.getAttribute('id'),
                ancestor?.getAttribute('class'),
              ].join(' '),
            );
            const joinedMeta = `${meta} ${ancestorMeta}`.toLowerCase();
            const rect = node.getBoundingClientRect();
            return (
              /搜索|搜一搜|search|searchbox|douyin-search/.test(joinedMeta) ||
              (rect.y < 120 && /搜索|search|header|nav/.test(joinedMeta))
            );
          };
          const isLikelyDanmakuEditor = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="danmaku"], [class*="Danmaku"], [class*="danmu"], [class*="Danmu"], [class*="barrage"], [class*="Barrage"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('name'),
                node.getAttribute('id'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            ).toLowerCase();
            return /弹幕|danmaku|danmu|barrage/.test(meta);
          };
          const hasCommentEditorSignal = (
            node: HTMLElement,
            placeholder: string,
          ) => {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            const ancestor = node.closest(
              '[class*="comment"], [class*="Comment"], [class*="cmt"], [class*="Cmt"]',
            ) as HTMLElement | null;
            const meta = normalize(
              [
                placeholder,
                node.getAttribute('aria-label'),
                node.getAttribute('title'),
                node.getAttribute('class'),
                ancestor?.getAttribute('class'),
                ancestor?.innerText,
              ].join(' '),
            );
            return /留下|精彩评论|有爱评论|说点|评论|comment|cmt/i.test(meta);
          };
          const readState = () => {
            const bodyText = normalize(
              document.body.innerText || document.body.textContent || '',
            );
            const visibleEditors = Array.from(
              document.querySelectorAll(editorSelector),
            )
              .filter((node): node is HTMLElement => visible(node))
              .filter(
                (node) =>
                  !isLikelySearchEditor(
                    node,
                    normalize(node.getAttribute('placeholder')),
                  ),
              )
              .filter(
                (node) =>
                  !isLikelyDanmakuEditor(
                    node,
                    normalize(node.getAttribute('placeholder')),
                  ),
              )
              .filter((node) =>
                hasCommentEditorSignal(
                  node,
                  normalize(node.getAttribute('placeholder')),
                ),
              )
              .map((node) =>
                normalize(
                  'value' in node
                    ? (node as HTMLInputElement).value
                    : node.textContent,
                ),
              );
            const replyStillInEditor = visibleEditors.some((value) =>
              value.includes(replyPrefix),
            );
            const bodyHasReply = bodyText.includes(replyPrefix);
            const identityVerificationRequired =
              bodyText.includes('身份验证') &&
              (bodyText.includes('接收短信验证') ||
                bodyText.includes('扫码验证') ||
                bodyText.includes('保障账号安全'));
            return {
              bodyHasReply,
              replyStillInEditor,
              identityVerificationRequired,
            };
          };
          let state = readState();
          for (let i = 0; i < 10; i += 1) {
            if (state.identityVerificationRequired) return state;
            if (state.bodyHasReply && !state.replyStillInEditor) return state;
            await delay(600);
            state = readState();
          }
          return state;
        },
        { replyText: input.replyText },
      ),
      9000,
      {
        bodyHasReply: false,
        replyStillInEditor: true,
        identityVerificationRequired: false,
      },
    );
    if (verify.identityVerificationRequired) {
      return {
        status: 'send_failed',
        message:
          '已点击发送按钮，但抖音弹出身份验证，需要完成短信或扫码验证后才能继续发送。',
        replyVisible: Boolean(verify.bodyHasReply),
        nextAction: '在持久浏览器里完成抖音身份验证后重试。',
      };
    }
    const sent = Boolean(verify.bodyHasReply) && !verify.replyStillInEditor;
    return {
      status: sent ? 'sent' : 'send_failed',
      message: sent
        ? '视频评论已点击发送，并已在抖音页面看到评论内容。'
        : '已点击发送按钮，但抖音页面未看到评论内容或编辑器未清空，未确认真实发出。',
      readbackText: sent ? input.replyText : undefined,
      replyVisible: sent,
      nextAction: sent
        ? undefined
        : '检查抖音是否弹出验证、账号是否限制发送或评论内容是否被拦截。',
    };
  }

  private async fillAndSendDouyinCommentReplyOnPage(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const target = await this.evaluateWithTimeout(
      page,
      'douyin-comment-find-target',
      page.evaluate(
        ({ targetText, targetName }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const expectedText = normalize(targetText);
          const expectedName = normalize(targetName);
          const textMatches = (text: string, expected: string) => {
            const normalizedText = normalize(text);
            const normalizedExpected = normalize(expected);
            return Boolean(
              normalizedExpected &&
              (normalizedText.includes(normalizedExpected) ||
                normalizedExpected.includes(normalizedText)),
            );
          };
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const commentTimeSignal =
            /删除|举报|\d{1,2}:\d{2}|昨天|今天|刚刚|分钟前|小时前|\d+天前|\d+周前|\d+月前|\d+年前|\d{1,2}月\d{1,2}日/;
          const scoreRoot = (node: HTMLElement) => {
            let current: HTMLElement | null = node;
            const roots: Array<{
              node: HTMLElement;
              rect: DOMRect;
              text: string;
              score: number;
            }> = [];
            for (
              let depth = 0;
              current && depth < 10;
              depth += 1, current = current.parentElement
            ) {
              if (!visible(current)) continue;
              const rect = current.getBoundingClientRect();
              const text = normalize(current.innerText || current.textContent);
              const className = String(current.className || '');
              if (!expectedText || !textMatches(text, expectedText)) continue;
              if (expectedName && !textMatches(text, expectedName)) continue;
              if (
                rect.x < 80 ||
                rect.y < 80 ||
                rect.width < 120 ||
                rect.height < 18
              )
                continue;
              const looksLikeCommentRow =
                /cmt-item|comment|Comment|item|Item/.test(className) ||
                (/回复/.test(text) && commentTimeSignal.test(text));
              const hasNearbyReplyAction =
                /回复/.test(text) &&
                Array.from(
                  current.querySelectorAll(
                    'button, [role="button"], span, div',
                  ),
                ).some(
                  (child) =>
                    visible(child) &&
                    /^回复/.test(
                      normalize(child.innerText || child.textContent),
                    ),
                );
              if (!looksLikeCommentRow && !hasNearbyReplyAction) continue;
              const compactPublicCommentRow =
                /回复/.test(text) &&
                commentTimeSignal.test(text) &&
                rect.height <= 180 &&
                text.length <= 180;
              roots.push({
                node: current,
                rect,
                text,
                score:
                  (className.includes('cmt-item') ? 120 : 0) +
                  (hasNearbyReplyAction ? 140 : 0) +
                  (compactPublicCommentRow ? 180 : 0) +
                  (text.includes('回复') ? 30 : 0) +
                  (text.includes('删除') ? 20 : 0) -
                  Math.min(text.length, 800) / 6 -
                  (rect.width * rect.height) / 50000,
              });
            }
            roots.sort((a, b) => b.score - a.score);
            return roots[0] || null;
          };
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
          const markedRoot = document.querySelector(
            '[data-kaypal-target-comment="1"]',
          ) as HTMLElement | null;
          if (
            markedRoot &&
            visible(markedRoot) &&
            textMatches(
              markedRoot.innerText || markedRoot.textContent || '',
              expectedText,
            ) &&
            (!expectedName ||
              textMatches(
                markedRoot.innerText || markedRoot.textContent || '',
                expectedName,
              ))
          ) {
            const markedText = normalize(
              markedRoot.innerText || markedRoot.textContent,
            );
            const markedRect = markedRoot.getBoundingClientRect();
            const alreadyOpen = Array.from(
              markedRoot.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            ).some((node) => visible(node));
            const replyNodes = Array.from(
              markedRoot.querySelectorAll('button, [role="button"], span, div'),
            )
              .filter(
                (node): node is HTMLElement =>
                  visible(node) &&
                  /^回复$/.test(normalize(node.innerText || node.textContent)),
              )
              .map((node) => ({ node, rect: node.getBoundingClientRect() }))
              .sort((a, b) => b.rect.y - a.rect.y);
            const reply = replyNodes[0];
            if (reply) {
              return {
                status: 'target_found',
                targetText: markedText.slice(0, 260),
                replyRect: {
                  x: reply.rect.x,
                  y: reply.rect.y,
                  width: reply.rect.width,
                  height: reply.rect.height,
                },
                rootRect: {
                  x: markedRect.x,
                  y: markedRect.y,
                  width: markedRect.width,
                  height: markedRect.height,
                },
                alreadyOpen,
              };
            }
          }
          const nodes = Array.from(
            document.querySelectorAll('div, span, p, li, td'),
          )
            .filter(
              (node): node is HTMLElement =>
                visible(node) &&
                textMatches(
                  node.innerText || node.textContent || '',
                  expectedText,
                ),
            )
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return {
                node,
                rect,
                text: normalize(node.innerText || node.textContent),
              };
            })
            .filter((item) => item.rect.x >= 120 && item.rect.y >= 120)
            .sort(
              (a, b) =>
                a.text.length - b.text.length ||
                a.rect.width * a.rect.height - b.rect.width * b.rect.height,
            );
          for (const item of nodes) {
            const root = scoreRoot(item.node);
            if (!root) continue;
            const alreadyOpen = Array.from(
              root.node.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            ).some((node) => visible(node));
            const replyNodes = Array.from(
              root.node.querySelectorAll('button, [role="button"], span, div'),
            )
              .filter(
                (node): node is HTMLElement =>
                  visible(node) &&
                  /^回复/.test(normalize(node.innerText || node.textContent)),
              )
              .map((node) => ({ node, rect: node.getBoundingClientRect() }))
              .sort((a, b) => b.rect.y - a.rect.y);
            const reply = replyNodes[0];
            if (!reply) continue;
            return {
              status: 'target_found',
              targetText: root.text.slice(0, 260),
              replyRect: {
                x: reply.rect.x,
                y: reply.rect.y,
                width: reply.rect.width,
                height: reply.rect.height,
              },
              rootRect: {
                x: root.rect.x,
                y: root.rect.y,
                width: root.rect.width,
                height: root.rect.height,
              },
              alreadyOpen,
            };
          }
          return {
            status: 'comment_missing',
            message: '未找到目标评论行或评论行回复按钮。',
          };
        },
        { targetText: input.targetText, targetName: input.targetName || '' },
      ),
      8000,
      { status: 'comment_missing', message: '定位目标评论超时，未发送。' },
    );
    if (target.status !== 'target_found') {
      return {
        status: 'comment_missing',
        message: target.message || '未在当前评论管理页找到目标评论，未发送。',
      };
    }

    const replyRect: Record<string, number> = target.replyRect || {};
    const rootRect: Record<string, number> = target.rootRect || {};
    if (!target.alreadyOpen) {
      await page.mouse.click(
        Number(replyRect.x || 0) +
          Math.max(Number(replyRect.width || 1) / 2, 1),
        Number(replyRect.y || 0) +
          Math.max(Number(replyRect.height || 1) / 2, 1),
      );
      await page.waitForTimeout(1500);
    }

    const replyOpened = await this.evaluateWithTimeout(
      page,
      'douyin-comment-open-reply-editor',
      page.evaluate(
        ({ targetText, rootRect }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const expectedText = normalize(targetText);
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const isTargetReplyEditor = (node: HTMLElement) => {
            if (!visible(node)) return false;
            const rect = node.getBoundingClientRect();
            const placeholder = normalize(node.getAttribute('placeholder'));
            const nearTarget =
              rect.y >= rootRect.y - 20 &&
              rect.y <= rootRect.y + rootRect.height + 140 &&
              rect.x >= rootRect.x - 20;
            return (
              nearTarget && (/^回复/.test(placeholder) || rect.y > rootRect.y)
            );
          };
          const hasTargetEditor = () =>
            Array.from(
              document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            ).some((node) => isTargetReplyEditor(node as HTMLElement));
          if (hasTargetEditor()) return { opened: true, method: 'mouse' };

          const roots = Array.from(
            document.querySelectorAll('li, div, section'),
          )
            .filter(
              (node): node is HTMLElement =>
                visible(node) &&
                normalize(node.innerText || node.textContent).includes(
                  expectedText,
                ),
            )
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return {
                node,
                rect,
                text: normalize(node.innerText || node.textContent),
              };
            })
            .filter(
              (item) =>
                item.rect.x >= rootRect.x - 5 &&
                item.rect.y >= rootRect.y - 5 &&
                item.rect.y <= rootRect.y + 5 &&
                item.rect.width >= Math.min(rootRect.width, 180),
            )
            .sort((a, b) => a.text.length - b.text.length);
          const root = roots[0]?.node;
          if (!root)
            return {
              opened: false,
              method: 'mouse',
              message: '未能重新定位目标评论行。',
            };
          const reply = Array.from(
            root.querySelectorAll('button, [role="button"], span, div'),
          )
            .filter(
              (node): node is HTMLElement =>
                visible(node) &&
                normalize(node.innerText || node.textContent) === '回复',
            )
            .sort(
              (a, b) =>
                b.getBoundingClientRect().y - a.getBoundingClientRect().y,
            )[0];
          if (!reply)
            return {
              opened: false,
              method: 'mouse',
              message: '未能重新定位目标评论回复按钮。',
            };
          for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
            reply.dispatchEvent(
              new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
          }
          return { opened: hasTargetEditor(), method: 'dom-event' };
        },
        { targetText: input.targetText, rootRect },
      ),
      6000,
      { opened: false, method: 'timeout', message: '打开回复框超时。' },
    );
    if (!replyOpened.opened) {
      await page.waitForTimeout(1000);
    }

    const editor = await this.evaluateWithTimeout(
      page,
      'douyin-comment-find-reply-editor',
      page.evaluate(
        ({ rootRect }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const allEditors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const placeholder = normalize(node.getAttribute('placeholder'));
              return { node, rect, placeholder };
            })
            .filter((item) => item.rect.width > 50 && item.rect.height >= 12);
          if (allEditors.length === 0) {
            return {
              status: 'editor_missing',
              message: '点击回复后没有找到任何可编辑输入框。',
            };
          }
          const rootY = rootRect?.y || 0;
          const rootX = rootRect?.x || 0;
          const rootHeight = rootRect?.height || 0;
          const targetReplyEditors = allEditors
            .filter(
              (item) =>
                item.rect.y >= rootY - 20 &&
                item.rect.y <= rootY + rootHeight + 140 &&
                item.rect.x >= rootX - 20,
            )
            .sort((a, b) => {
              const aReply = /^回复/.test(a.placeholder) ? 0 : 1;
              const bReply = /^回复/.test(b.placeholder) ? 0 : 1;
              const aEditable =
                String(
                  a.node.getAttribute('contenteditable') || '',
                ).toLowerCase() === 'true'
                  ? 0
                  : 1;
              const bEditable =
                String(
                  b.node.getAttribute('contenteditable') || '',
                ).toLowerCase() === 'true'
                  ? 0
                  : 1;
              return (
                aEditable - bEditable || aReply - bReply || a.rect.y - b.rect.y
              );
            });
          const explicitReplyEditors = allEditors
            .filter((item) => /^回复/.test(item.placeholder))
            .sort((a, b) => {
              const aDistance =
                Math.abs(a.rect.y - rootY) + Math.abs(a.rect.x - rootX);
              const bDistance =
                Math.abs(b.rect.y - rootY) + Math.abs(b.rect.x - rootX);
              return aDistance - bDistance;
            });
          const fallback = allEditors
            .map((item) => ({
              ...item,
              distance:
                Math.abs(item.rect.y - rootY) + Math.abs(item.rect.x - rootX),
            }))
            .sort((a, b) => a.distance - b.distance);
          const picked =
            targetReplyEditors[0] || explicitReplyEditors[0] || fallback[0];
          if (!picked)
            return {
              status: 'editor_missing',
              message: '没有找到可编辑回复框。',
            };
          picked.node.focus();
          if (typeof (picked.node as HTMLInputElement).select === 'function') {
            (picked.node as HTMLInputElement).select();
          }
          return {
            status: 'editor_found',
            rect: {
              x: picked.rect.x,
              y: picked.rect.y,
              width: picked.rect.width,
              height: picked.rect.height,
            },
          };
        },
        { rootRect },
      ),
      6000,
      { status: 'editor_missing', message: '查找回复框超时。' },
    );
    if (editor.status !== 'editor_found') {
      return {
        status: 'editor_missing',
        message: editor.message || '已找到目标评论，但没有找到可编辑回复框。',
      };
    }

    const activeEditor = await this.evaluateWithTimeout(
      page,
      'douyin-comment-activate-reply-editor',
      page.evaluate(
        ({ rootRect }) => {
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const rootY = rootRect?.y || 0;
          const rootX = rootRect?.x || 0;
          const rootHeight = rootRect?.height || 0;
          const editors = Array.from(
            document.querySelectorAll(
              '[contenteditable="true"], textarea, input[type="text"], [role="textbox"]',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const inTargetRow =
                rect.y >= rootY - 20 &&
                rect.y <= rootY + rootHeight + 140 &&
                rect.x >= rootX - 20;
              const editable =
                String(
                  node.getAttribute('contenteditable') || '',
                ).toLowerCase() === 'true';
              const placeholder = String(
                node.getAttribute('placeholder') || '',
              );
              const replyEditor = /^回复/.test(placeholder);
              const distance =
                Math.abs(rect.y - rootY) + Math.abs(rect.x - rootX);
              const priority =
                (replyEditor ? 0 : 40) +
                (inTargetRow ? 0 : 20) +
                (editable ? 0 : 5);
              return { node, rect, priority, distance };
            })
            .sort(
              (a, b) =>
                a.priority - b.priority ||
                a.distance - b.distance ||
                b.rect.width - a.rect.width,
            );
          const editor = editors[0]?.node;
          if (!editor) return { status: 'editor_missing' };
          editor.focus();
          for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
            editor.dispatchEvent(
              new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
          }
          const rect = editor.getBoundingClientRect();
          return {
            status: 'editor_active',
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          };
        },
        { rootRect },
      ),
      6000,
      { status: 'editor_missing' },
    );
    const zeroRect = { x: 0, y: 0, width: 0, height: 0 };
    const activeRect: Record<string, number> =
      activeEditor.status === 'editor_active'
        ? (activeEditor.rect ?? editor.rect ?? zeroRect)
        : (editor.rect ?? zeroRect);
    await page.mouse.click(
      Number(activeRect.x || 0) +
        Math.max(Number(activeRect.width || 1) / 2, 1),
      Number(activeRect.y || 0) +
        Math.max(Number(activeRect.height || 1) / 2, 1),
    );
    await page.keyboard.press(this.selectAllShortcut());
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(input.replyText);
    await page.waitForTimeout(800);

    await this.evaluateWithTimeout(
      page,
      'douyin-comment-fill-reply-dom',
      page.evaluate(
        ({ replyText, rootRect }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const editorValue = (node: Element) =>
            normalize(
              'value' in node
                ? (node as HTMLInputElement).value
                : node.textContent,
            );
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const rootY = rootRect?.y || 0;
          const rootX = rootRect?.x || 0;
          const rootHeight = rootRect?.height || 0;
          const editors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const placeholder = normalize(node.getAttribute('placeholder'));
              const inTargetRow =
                rect.y >= rootY - 20 &&
                rect.y <= rootY + rootHeight + 140 &&
                rect.x >= rootX - 20;
              const replyEditor = /^回复/.test(placeholder);
              const priority =
                (replyEditor ? 0 : 40) +
                (inTargetRow ? 0 : 20) +
                (String(
                  node.getAttribute('contenteditable') || '',
                ).toLowerCase() === 'true'
                  ? 0
                  : 2);
              return {
                node,
                rect,
                priority,
                targetDistance:
                  Math.abs(rect.y - rootY) + Math.abs(rect.x - rootX),
                value: editorValue(node),
              };
            })
            .sort(
              (a, b) =>
                a.priority - b.priority || a.targetDistance - b.targetDistance,
            );
          if (editors.some((item) => item.value.includes(replyPrefix))) {
            return { status: 'already_has_text' };
          }
          const editor = editors[0]?.node;
          if (!editor) return { status: 'editor_missing' };
          editor.focus();
          if ('value' in editor) {
            const descriptor = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(editor),
              'value',
            );
            if (descriptor?.set) {
              descriptor.set.call(editor, replyText);
            } else {
              (editor as HTMLInputElement).value = replyText;
            }
          } else {
            editor.textContent = replyText;
          }
          for (const type of ['input', 'change', 'compositionend']) {
            editor.dispatchEvent(
              new Event(type, { bubbles: true, cancelable: true }),
            );
          }
          return { status: 'filled_by_dom' };
        },
        { replyText: input.replyText, rootRect },
      ),
      6000,
      { status: 'fill_timeout' },
    );
    await page.waitForTimeout(500);

    if (input.action === 'draft') {
      return {
        status: 'draft_filled',
        message: '已在抖音目标评论行填入回复草稿，未点击发送。',
        readbackText: input.replyText,
        replyVisible: true,
      };
    }

    const sendButton = await this.evaluateWithTimeout(
      page,
      'douyin-comment-find-send-button',
      page.evaluate(
        ({ replyText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const disabled = (node: Element) => {
            const aria = String(
              node.getAttribute('aria-disabled') || '',
            ).toLowerCase();
            return (
              Boolean((node as HTMLButtonElement).disabled) ||
              aria === 'true' ||
              /disabled/.test(
                String((node as HTMLElement).className || '').toLowerCase(),
              )
            );
          };
          const allEditors = Array.from(
            document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ),
          )
            .filter((node): node is HTMLElement => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const value = normalize(
                'value' in node
                  ? (node as HTMLInputElement).value
                  : node.textContent,
              );
              const placeholder = normalize(node.getAttribute('placeholder'));
              return { node, rect, value, placeholder };
            })
            .filter((item) => item.rect.width > 50 && item.rect.height >= 12);
          const replyPrefix = replyText.slice(
            0,
            Math.min(replyText.length, 12),
          );
          const editor =
            allEditors.find((item) => item.value.includes(replyPrefix)) ||
            allEditors.find((item) => /^回复/.test(item.placeholder)) ||
            allEditors[0];
          if (!editor)
            return {
              status: 'editor_missing',
              message: '回复内容没有进入目标回复框。',
            };
          const redArrowNodes = Array.from(
            document.querySelectorAll(
              '[class~="f5hSYimo"], [class~="siaMKBB_"], path[fill="#FE2C55"], path[fill="#fe2c55"]',
            ),
          )
            .map((node) => {
              const element =
                node.closest(
                  'button, [role="button"], [class~="f5hSYimo"], [class~="siaMKBB_"]',
                ) || node;
              return element as HTMLElement;
            })
            .filter(
              (node, index, list): node is HTMLElement =>
                visible(node) && list.indexOf(node) === index,
            );
          const textButtons = Array.from(
            document.querySelectorAll('button, [role="button"], span, div'),
          ).filter((node): node is HTMLElement => {
            if (!visible(node)) return false;
            const text = normalize(node.innerText || node.textContent);
            const rect = node.getBoundingClientRect();
            const tag = String(node.tagName || '').toUpperCase();
            const role = String(node.getAttribute('role') || '').toLowerCase();
            const isRealButton = tag === 'BUTTON' || role === 'button';
            return (
              /^(发送|回复|提交|发布)$/.test(text) &&
              (isRealButton || (rect.width <= 90 && rect.height <= 40))
            );
          });
          const allButtons = [...redArrowNodes, ...textButtons]
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const tag = String(node.tagName || '').toUpperCase();
              const role = String(
                node.getAttribute('role') || '',
              ).toLowerCase();
              const rawText = normalize(node.innerText || node.textContent);
              const className = String(node.className || '');
              const inputTools = node.closest(
                '[class*="commentInput-right"], [class*="comment-input-right"], [class*="commentInputRight"]',
              );
              const redSubmitIcon = Boolean(
                inputTools &&
                (/(^|\s)(f5hSYimo|siaMKBB_)(\s|$)/.test(className) ||
                  node.querySelector(
                    'path[fill="#FE2C55"], path[fill="#fe2c55"]',
                  )),
              );
              return {
                rect,
                text: rawText || (redSubmitIcon ? '发送' : ''),
                priority: redSubmitIcon
                  ? 0
                  : tag === 'BUTTON'
                    ? 1
                    : role === 'button'
                      ? 2
                      : 3,
                isDisabled: disabled(node),
                distance:
                  Math.abs(rect.y - editor.rect.y) +
                  Math.abs(rect.x - editor.rect.x),
              };
            })
            .filter((item) => item.rect.width > 20 && item.rect.height > 15)
            .filter((item) => {
              if (item.text !== '发送') return false;
              if (item.isDisabled) return true;
              const nearVertical =
                item.rect.y >= editor.rect.y - 20 &&
                item.rect.y <= editor.rect.y + 120;
              const toRight = item.rect.x >= editor.rect.x;
              return nearVertical && toRight;
            })
            .sort(
              (a, b) =>
                a.priority - b.priority ||
                Number(a.isDisabled) - Number(b.isDisabled) ||
                a.distance - b.distance,
            );
          const button = allButtons[0];
          if (!button)
            return {
              status: 'send_button_missing',
              message: '回复已输入，但没有找到发送按钮。',
            };
          return {
            status: button.isDisabled
              ? 'send_button_disabled'
              : 'send_button_ready',
            message: button.isDisabled
              ? '回复已输入，但发送按钮仍是禁用态。'
              : '回复已输入，发送按钮可点击。',
            rect: {
              x: button.rect.x,
              y: button.rect.y,
              width: button.rect.width,
              height: button.rect.height,
            },
          };
        },
        { replyText: input.replyText },
      ),
      6000,
      { status: 'send_button_missing', message: '查找发送按钮超时。' },
    );
    if (sendButton.status !== 'send_button_ready') {
      return {
        status:
          sendButton.status === 'editor_missing'
            ? 'editor_missing'
            : 'send_failed',
        message: sendButton.message || '回复已输入，但发送按钮不可用。',
        nextAction: '检查抖音页面是否弹出验证，或回复内容是否触发平台限制。',
      };
    }

    const buttonRect: Record<string, number> = sendButton.rect || {};
    const buttonWidth = Math.max(Number(buttonRect.width || 1), 1);
    const buttonX =
      Number(buttonRect.x || 0) +
      (buttonWidth > 48 ? buttonWidth - 18 : buttonWidth / 2);
    const buttonY =
      Number(buttonRect.y || 0) +
      Math.max(Number(buttonRect.height || 1) / 2, 1);
    await page.waitForTimeout(300);
    await page.mouse.move(buttonX, buttonY);
    await page.waitForTimeout(100);
    await page.mouse.click(buttonX, buttonY);
    await page.waitForTimeout(500);

    const verifySentOnPage = () =>
      this.evaluateWithTimeout(
        page,
        'douyin-comment-verify-sent',
        page.evaluate(
          async ({ targetText, replyText, rootRect }) => {
            const delay = (ms: number) =>
              new Promise((resolve) => setTimeout(resolve, ms));
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .trim();
            const visible = (node: Element | null): node is HTMLElement => {
              if (!node || !(node as HTMLElement).getBoundingClientRect)
                return false;
              const rect = (node as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) !== 0
              );
            };
            const replyPrefix = replyText.slice(
              0,
              Math.min(replyText.length, 12),
            );
            const editorSelector =
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]';
            const editorValue = (node: Element) =>
              normalize(
                'value' in node
                  ? (node as HTMLInputElement).value
                  : node.textContent,
              );
            const readState = () => {
              const bodyText = normalize(document.body.innerText);
              const visibleEditors = Array.from(
                document.querySelectorAll(editorSelector),
              )
                .filter((node): node is HTMLElement => visible(node))
                .map((node) => ({
                  node,
                  value: editorValue(node),
                  rect: node.getBoundingClientRect(),
                }));
              const editorsWithReply = visibleEditors.filter((item) =>
                item.value.includes(replyPrefix),
              );
              const containsReplyEditor = (node: Element) =>
                editorsWithReply.some(
                  (item) => node === item.node || node.contains(item.node),
                );
              const rootY = Number(rootRect?.y || 0);
              const rootX = Number(rootRect?.x || 0);
              const rootHeight = Number(rootRect?.height || 0);
              const rowItems = Array.from(
                document.querySelectorAll(
                  '[class*="cmt-item"], [class*="comment"], [class*="Comment"], [class*="item"], [class*="Item"], li, tr, section, div',
                ),
              )
                .filter(
                  (node): node is HTMLElement =>
                    visible(node) &&
                    normalize(node.innerText || node.textContent).includes(
                      targetText,
                    ),
                )
                .map((node) => {
                  const rect = node.getBoundingClientRect();
                  const text = normalize(node.innerText || node.textContent);
                  const nearTarget =
                    rootY <= 0 ||
                    (rect.y >= rootY - 80 &&
                      rect.y <= rootY + rootHeight + 260 &&
                      rect.x >= rootX - 40);
                  return { node, rect, text, nearTarget };
                })
                .filter((item) => item.rect.width > 80 && item.rect.height > 12)
                .sort((a, b) => {
                  const aNear = a.nearTarget ? 0 : 1;
                  const bNear = b.nearTarget ? 0 : 1;
                  return (
                    aNear - bNear ||
                    Math.abs(a.rect.y - rootY) - Math.abs(b.rect.y - rootY) ||
                    a.text.length - b.text.length
                  );
                });
              const targetRows = rowItems.slice(0, 4);
              const editors = targetRows
                .flatMap((row) =>
                  Array.from(row.node.querySelectorAll(editorSelector)),
                )
                .filter((node): node is HTMLElement => visible(node))
                .map((node) => editorValue(node));
              const replyStillInEditor = editors.some((value) =>
                value.includes(replyPrefix),
              );
              const targetReplyNodes = targetRows.flatMap((row) => [
                row.node,
                ...Array.from(
                  row.node.querySelectorAll(
                    'div, span, p, li, section, article',
                  ),
                ),
              ]);
              const targetRowHasReply = targetReplyNodes.some(
                (node): node is HTMLElement =>
                  visible(node) &&
                  !String(node.getAttribute('contenteditable') || '')
                    .toLowerCase()
                    .includes('true') &&
                  !containsReplyEditor(node) &&
                  normalize(node.innerText || node.textContent).includes(
                    replyPrefix,
                  ),
              );
              const bodyHasReply = bodyText.includes(replyPrefix);
              const bodyOnlyReplyVisible =
                targetRowHasReply && !replyStillInEditor;
              const identityVerificationRequired =
                bodyText.includes('身份验证') &&
                (bodyText.includes('接收短信验证') ||
                  bodyText.includes('扫码验证') ||
                  bodyText.includes('保障账号安全'));
              const editorGone = editors.length === 0;
              return {
                replyStillInEditor,
                bodyHasReply,
                bodyOnlyReplyVisible,
                targetRowHasReply,
                editorGone,
                identityVerificationRequired,
              };
            };
            let state = readState();
            for (let i = 0; i < 10; i += 1) {
              if (state.identityVerificationRequired) return state;
              if (
                state.bodyOnlyReplyVisible ||
                (!state.replyStillInEditor && state.editorGone)
              ) {
                return state;
              }
              await delay(600);
              state = readState();
            }
            return state;
          },
          {
            targetText: input.targetText,
            replyText: input.replyText,
            rootRect,
          },
        ),
        9000,
        {
          replyStillInEditor: true,
          bodyHasReply: false,
          bodyOnlyReplyVisible: false,
          targetRowHasReply: false,
          editorGone: false,
          identityVerificationRequired: false,
        },
      );
    let verify = await verifySentOnPage();
    let sent = Boolean(verify.targetRowHasReply) && !verify.replyStillInEditor;
    if (
      !sent &&
      !verify.identityVerificationRequired &&
      verify.replyStillInEditor
    ) {
      await page.waitForTimeout(300);
      await page.mouse.click(buttonX, buttonY).catch(() => undefined);
      await this.evaluateWithTimeout(
        page,
        'douyin-comment-retry-send-click',
        page.evaluate(
          ({ replyText, rootRect }) => {
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .trim();
            const visible = (node: Element | null): node is HTMLElement => {
              if (!node || !(node as HTMLElement).getBoundingClientRect)
                return false;
              const rect = (node as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity) !== 0
              );
            };
            const replyPrefix = replyText.slice(
              0,
              Math.min(replyText.length, 12),
            );
            const rootY = Number(rootRect?.y || 0);
            const rootX = Number(rootRect?.x || 0);
            const rootHeight = Number(rootRect?.height || 0);
            const editors = Array.from(
              document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            )
              .filter((node): node is HTMLElement => visible(node))
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const value = normalize(
                  'value' in node
                    ? (node as HTMLInputElement).value
                    : node.textContent,
                );
                const nearTarget =
                  rootY <= 0 ||
                  (rect.y >= rootY - 20 &&
                    rect.y <= rootY + rootHeight + 180 &&
                    rect.x >= rootX - 20);
                return { node, rect, value, nearTarget };
              })
              .filter((item) => item.value.includes(replyPrefix))
              .sort(
                (a, b) =>
                  Number(b.nearTarget) - Number(a.nearTarget) ||
                  a.rect.y - b.rect.y,
              );
            const editor = editors[0];
            if (!editor)
              return { clicked: false, reason: 'editor_without_reply' };
            const redArrowNodes = Array.from(
              document.querySelectorAll(
                '[class~="f5hSYimo"], [class~="siaMKBB_"], path[fill="#FE2C55"], path[fill="#fe2c55"]',
              ),
            )
              .map(
                (node) =>
                  (node.closest(
                    'button, [role="button"], [class~="f5hSYimo"], [class~="siaMKBB_"]',
                  ) || node) as HTMLElement,
              )
              .filter(
                (node, index, list): node is HTMLElement =>
                  visible(node) && list.indexOf(node) === index,
              );
            const textButtons = Array.from(
              document.querySelectorAll('button, [role="button"], span, div'),
            ).filter((node): node is HTMLElement => {
              if (!visible(node)) return false;
              const text = normalize(node.innerText || node.textContent);
              const rect = node.getBoundingClientRect();
              const tag = String(node.tagName || '').toUpperCase();
              const role = String(
                node.getAttribute('role') || '',
              ).toLowerCase();
              const isRealButton = tag === 'BUTTON' || role === 'button';
              return (
                /^(发送|回复|提交|发布)$/.test(text) &&
                (isRealButton || (rect.width <= 90 && rect.height <= 40))
              );
            });
            const button = [...redArrowNodes, ...textButtons]
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const className = String(node.className || '');
                const inputTools = node.closest(
                  '[class*="commentInput-right"], [class*="comment-input-right"], [class*="commentInputRight"]',
                );
                const redSubmitIcon = Boolean(
                  inputTools &&
                  (/(^|\s)(f5hSYimo|siaMKBB_)(\s|$)/.test(className) ||
                    node.querySelector(
                      'path[fill="#FE2C55"], path[fill="#fe2c55"]',
                    )),
                );
                return {
                  node,
                  rect,
                  priority: redSubmitIcon ? 0 : 1,
                  distance:
                    Math.abs(rect.y - editor.rect.y) +
                    Math.abs(rect.x - editor.rect.x),
                };
              })
              .filter(
                (item) =>
                  item.rect.y >= editor.rect.y - 24 &&
                  item.rect.y <= editor.rect.y + 130 &&
                  item.rect.x >= editor.rect.x,
              )
              .sort(
                (a, b) => a.priority - b.priority || a.distance - b.distance,
              )[0];
            if (!button)
              return { clicked: false, reason: 'send_button_missing' };
            for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
              button.node.dispatchEvent(
                new MouseEvent(type, {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }),
              );
            }
            button.node.click();
            return { clicked: true };
          },
          { replyText: input.replyText, rootRect },
        ),
        4000,
        { clicked: false, reason: 'retry_timeout' },
      );
      await page.waitForTimeout(900);
      verify = await verifySentOnPage();
      sent = Boolean(verify.targetRowHasReply) && !verify.replyStillInEditor;
    }
    if (verify.identityVerificationRequired) {
      return {
        status: 'send_failed',
        message:
          '已点击发送按钮，但抖音弹出身份验证，需要完成短信或扫码验证后才能继续发送。',
        replyVisible: Boolean(verify.bodyHasReply),
        nextAction: '在持久 Chrome/CDP 浏览器里完成抖音身份验证后重试。',
      };
    }
    return {
      status: sent ? 'sent' : 'send_failed',
      message: sent
        ? '评论回复已点击发送，并已在抖音页面看到回复内容或回复框关闭。'
        : '已点击发送按钮，但抖音页面未看到回复内容或编辑器未关闭，未确认真实发出。',
      readbackText: sent && verify.bodyHasReply ? input.replyText : undefined,
      replyVisible: sent && Boolean(verify.bodyHasReply),
      nextAction: sent
        ? undefined
        : '检查抖音是否弹出验证、账号是否限制发送或目标评论是否已变化。',
    };
  }

  private async openMessageConversation(
    frame: Page | Frame,
    targetText: string,
  ) {
    const clickTarget = await frame
      .evaluate((targetText) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0
          );
        };
        const textMatches = (text: string, target: string) => {
          const normalizedText = normalize(text);
          const normalizedTarget = normalize(target);
          if (!normalizedTarget) return false;
          return (
            normalizedText.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedText)
          );
        };
        const candidates = Array.from(
          document.querySelectorAll(
            'li, [role="row"], [role="listitem"], [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="session"], [class*="Session"], [class*="item"], [class*="Item"], div',
          ),
        )
          .filter(
            (node) =>
              visible(node) && textMatches(node.textContent || '', targetText),
          )
          .map((node) => {
            const rect = (node as HTMLElement).getBoundingClientRect();
            const text = normalize(node.textContent || '');
            const rowLike =
              rect.x > 220 &&
              rect.x < Math.min(900, window.innerWidth * 0.55) &&
              rect.y > 120 &&
              rect.width >= 180 &&
              rect.width <= Math.min(900, window.innerWidth * 0.6) &&
              rect.height >= 36 &&
              rect.height <= 220;
            const score =
              (rowLike ? 100 : 0) +
              (/\d{1,2}:\d{2}|昨天|今天|星期|分钟前|小时前/.test(text)
                ? 20
                : 0) -
              Math.min(text.length, 800) / 20;
            return { rect, text, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || a.rect.y - b.rect.y);
        const picked = candidates[0];
        if (!picked) return null;
        return {
          x:
            picked.rect.x +
            Math.min(
              Math.max(picked.rect.width * 0.28, 80),
              picked.rect.width / 2,
            ),
          y: picked.rect.y + picked.rect.height / 2,
          text: picked.text.slice(0, 160),
        };
      }, targetText)
      .catch(() => null);

    if (!clickTarget) return;
    const page = 'mouse' in frame ? frame : frame.page();
    await page.mouse.click(clickTarget.x, clickTarget.y);
    await page.waitForTimeout(2200);
  }

  private async readWechatChannelWithLocalBrowser(
    page: Page,
    session: {
      key: string;
      profileDir: string;
      debuggingPort?: number;
      browser?: string;
      browserReused?: boolean;
    },
    input: PlatformReadInput,
  ): Promise<Record<string, any>> {
    const targetKind =
      input.taskType === 'comment-reply' ? 'comments' : 'messages';
    const label = targetKind === 'comments' ? '评论' : '私信';
    const limit = Math.max(1, Math.min(Number(input.limit || 10), 20));
    const trace = this.startWechatChannelResponseTrace(page, targetKind, limit);
    try {
      await this.openWechatChannelPage(page, targetKind);
      await this.ensureWechatChannelReadyPage(page, label);
      let contentFrame = await this.wechatChannelContentFrame(page, targetKind);
      const itemKey =
        targetKind === 'comments' ? 'looksLikeComment' : 'looksLikeMessage';
      let scanResult: Record<string, any> = {};
      let navigationState: Record<string, any> = {};
      let items: Array<Record<string, any>> = [];
      const evaluateWechatChannelScan = async (): Promise<
        Record<string, any> & { items: Array<Record<string, any>> }
      > => {
        const scan = (await contentFrame
          .evaluate(
            ({ script, params }) => {
              const fn = (0, eval)(script);
              if (typeof fn !== 'function') {
                throw new Error('视频号页面扫描脚本未返回可执行函数。');
              }
              return fn(params);
            },
            {
              script: this.wechatChannelScanScript(),
              params: {
                limit,
                itemKey,
              },
            },
          )
          .catch((error) => ({
            url: page.url(),
            title: '',
            totalCandidates: 0,
            items: [],
            pageTextSample: '',
            scanError: error instanceof Error ? error.message : String(error),
          }))) as Record<string, any> | null | undefined;
        if (!scan || typeof scan !== 'object') {
          return {
            url: page.url(),
            title: await page.title().catch(() => ''),
            totalCandidates: 0,
            items: [],
            pageTextSample: await this.pageText(page, 800),
            scanError: '视频号页面扫描未返回可用结果',
          };
        }
        return {
          ...scan,
          url: scan.url || page.url(),
          title: scan.title || (await page.title().catch(() => '')),
          totalCandidates: Number(scan.totalCandidates || 0),
          items: Array.isArray(scan.items) ? scan.items : [],
          pageTextSample: String(
            scan.pageTextSample || (await this.pageText(page, 800)),
          ),
        };
      };
      if (targetKind === 'comments') {
        navigationState = await this.selectWechatChannelCommentWork(page);
        await page.waitForTimeout(2200).catch(() => undefined);
        contentFrame = await this.wechatChannelContentFrame(page, targetKind);
        scanResult = await evaluateWechatChannelScan();
        items = this.mergeWechatChannelCandidates(
          scanResult.items || [],
          trace.events,
          targetKind,
          limit,
        );
      } else {
        const tabStates: Array<Record<string, any>> = [];
        const scanMessageState = async (
          labelName: string,
          tabState: Record<string, any>,
        ) => {
          const sessionState = await this.openWechatChannelMessageSession(page);
          await page.waitForTimeout(1800).catch(() => undefined);
          contentFrame = await this.wechatChannelContentFrame(page, targetKind);
          const currentScan = await evaluateWechatChannelScan();
          const currentItems = this.mergeWechatChannelCandidates(
            currentScan.items || [],
            trace.events,
            targetKind,
            limit,
          );
          tabStates.push({
            ...(tabState || {}),
            session: sessionState,
            usableCount: currentItems.length,
            totalCandidates: currentScan.totalCandidates || 0,
          });
          scanResult = currentScan;
          if (currentItems.length) {
            items = currentItems;
            navigationState = { tabs: tabStates, selectedTab: labelName };
            return true;
          }
          return false;
        };
        const privateTabState = await this.prepareWechatChannelMessageTab(page);
        if (
          await scanMessageState(
            String(privateTabState.selectedTab || '私信'),
            privateTabState,
          )
        ) {
          // 已在私信会话内读到真实对象。
        } else {
          // 私信入口没有可处理对象时才看打招呼消息，避免把已切到私信的页面再切回空状态。
          const privateAttempt = tabStates[tabStates.length - 1] || {};
          const privateHasRows =
            Boolean(privateTabState.hasItems) ||
            Boolean(privateAttempt.session?.clicked) ||
            Number(privateAttempt.totalCandidates || 0) > 0;
          if (!privateHasRows) {
            for (const labelName of ['打招呼消息']) {
              const tabState = await this.clickWechatChannelMessageTab(
                page,
                labelName,
              );
              if (await scanMessageState(labelName, tabState)) break;
            }
          }
        }
        if (!Object.keys(navigationState).length) {
          navigationState = { tabs: tabStates, selectedTab: 'none' };
        }
      }
      const evidence = await this.captureSessionScreenshot(
        session.key,
        `wechat-channel-${targetKind}-read-${input.accountId}`,
      );
      return {
        accountId: Number(input.accountId) || input.accountId,
        platformName: '视频号',
        platformType: 2,
        url: scanResult.url || page.url(),
        title: scanResult.title || (await page.title().catch(() => '')),
        [targetKind === 'comments' ? 'comments' : 'messages']: items,
        summary: this.interactionReadSummary(
          Math.max(Number(scanResult.totalCandidates || 0), items.length),
          items,
          label,
        ),
        navigationState,
        pageTextSample: scanResult.pageTextSample || '',
        evidence: evidence.evidencePath
          ? {
              type: 'screenshot',
              label: `视频号${label}读取截图`,
              path: evidence.evidencePath,
              value: evidence.evidencePath,
            }
          : null,
        readAt: new Date().toISOString(),
        runtimeMode: 'persistent-cdp-browser',
        profileDir: session.profileDir,
        cdpPort: session.debuggingPort ?? null,
        browser: session.browser ?? null,
        browserReused: session.browserReused ?? null,
        networkTrace: trace.events.slice(-30),
      };
    } finally {
      trace.detach();
    }
  }

  private async performWechatChannelInteraction(
    page: Page,
    input: PlatformDispatchInput,
  ): Promise<{
    status: PlatformDispatchResult['status'];
    message: string;
    readbackText?: string;
    replyVisible?: boolean;
    nextAction?: string;
  }> {
    const targetKind =
      input.taskType === 'comment-reply' ? 'comments' : 'messages';
    const itemLabel = targetKind === 'comments' ? '评论' : '私信';
    const trace = this.startWechatChannelResponseTrace(page, targetKind, 20);
    try {
      await this.openWechatChannelPage(page, targetKind);
      await this.ensureWechatChannelReadyPage(page, itemLabel);
      if (targetKind === 'comments') {
        await this.selectWechatChannelCommentWork(page, input.targetText);
      } else {
        await this.prepareWechatChannelMessageTab(page, input.targetText);
        await this.openWechatChannelMessageSession(page, input.targetText);
      }
      const contentFrame = await this.wechatChannelContentFrame(
        page,
        targetKind,
      );
      await page.waitForTimeout(2500).catch(() => undefined);
      const traceTarget = this.findWechatChannelTraceCandidate(
        trace.events,
        targetKind,
        input.targetText,
      );
      const missingStatus =
        targetKind === 'comments' ? 'comment_missing' : 'message_missing';
      let actionResult = await contentFrame.evaluate<
        FrameActionResult,
        {
          targetText: string;
          replyText: string;
          send: boolean;
          missingStatus: string;
          traceTarget: Record<string, unknown>;
        }
      >(
        async ({ targetText, replyText, send, missingStatus, traceTarget }) => {
          const delay = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.pointerEvents !== 'none'
            );
          };
          const setEditorValue = (editor: Element, value: string) => {
            (editor as HTMLElement).focus();
            if ('value' in editor) {
              const setter = Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(editor),
                'value',
              )?.set;
              if (setter) setter.call(editor, value);
              else (editor as HTMLInputElement).value = value;
              editor.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  inputType: 'insertText',
                  data: value,
                }),
              );
              editor.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              editor.textContent = value;
              editor.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  inputType: 'insertText',
                  data: value,
                }),
              );
            }
          };
          const allNodes = Array.from(
            document.querySelectorAll('div, span, p, li, td'),
          );
          const targetAuthor = normalize(traceTarget?.author || '');
          const normalizedTarget = normalize(targetText);
          const targetVariants = Array.from(
            new Set(
              [
                normalizedTarget,
                normalizedTarget.replace(/\]\[/g, '] ['),
              ].filter(Boolean),
            ),
          );
          const targetAuthorAliases = Array.from(
            new Set(
              [
                targetAuthor,
                targetAuthor.replace(/\s+/g, ''),
                targetAuthor.replace(/[：:，,。.\s]/g, ''),
              ].filter(Boolean),
            ),
          );
          const editorBelongsToTarget = (
            node: Element,
            ownerRoot?: Element | null,
          ) => {
            const placeholder = normalize(
              (node as HTMLElement).getAttribute('placeholder'),
            );
            const editorRoot =
              node.closest(
                '.comment-create-wrap, [class*="create"], [class*="reply"], [class*="Reply"]',
              ) ||
              node.parentElement ||
              node;
            const text = normalize(
              (editorRoot as HTMLElement).innerText || editorRoot.textContent,
            );
            const rootText = normalize(
              (ownerRoot as HTMLElement | null)?.innerText ||
                (ownerRoot as HTMLElement | null)?.textContent ||
                '',
            );
            const placeholderMatchesAuthor =
              targetAuthorAliases.length > 0 &&
              targetAuthorAliases.some(
                (author) =>
                  placeholder.includes(author) ||
                  text.includes(`回复 ${author}`) ||
                  text.includes(`回复${author}`),
              );
            const placeholderMatchesTarget = targetVariants.some(
              (variant) =>
                placeholder.includes(variant) || text.includes(variant),
            );
            const rootMatchesTarget =
              Boolean(ownerRoot) &&
              (targetVariants.some((variant) => rootText.includes(variant)) ||
                targetAuthorAliases.some((author) =>
                  rootText.includes(author),
                ));
            return (
              placeholderMatchesAuthor ||
              placeholderMatchesTarget ||
              rootMatchesTarget
            );
          };
          const isMessageTarget = missingStatus === 'message_missing';
          if (!isMessageTarget) {
            const staleCancelButtons = Array.from(
              document.querySelectorAll('button, [role="button"], span, div'),
            )
              .filter((node): node is HTMLElement => {
                if (!visible(node)) return false;
                if (normalize(node.innerText || node.textContent) !== '取消')
                  return false;
                const holder =
                  node.closest(
                    '.comment-create-wrap, [class*="create"], [class*="reply"], [class*="Reply"]',
                  ) || node.parentElement;
                const parentText = normalize(
                  (holder as HTMLElement | null)?.innerText ||
                    (holder as HTMLElement | null)?.textContent ||
                    '',
                );
                const editor = holder?.querySelector?.(
                  'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
                ) as Element | null;
                const isReplyEditor =
                  parentText.includes('评论') || parentText.includes('发送');
                return (
                  isReplyEditor && (!editor || !editorBelongsToTarget(editor))
                );
              })
              .sort(
                (a, b) =>
                  b.getBoundingClientRect().y - a.getBoundingClientRect().y,
              );
            for (const button of staleCancelButtons.slice(0, 5)) {
              try {
                button.dispatchEvent(
                  new MouseEvent('mouseover', { bubbles: true }),
                );
                button.dispatchEvent(
                  new MouseEvent('mousedown', { bubbles: true }),
                );
                button.click();
                button.dispatchEvent(
                  new MouseEvent('mouseup', { bubbles: true }),
                );
                await delay(400);
              } catch {
                /* 容错：非关键路径失败忽略 */
              }
            }
          }
          const includesTarget = (node: Element) => {
            const text = normalize(
              (node as HTMLElement).innerText || node.textContent,
            );
            return targetVariants.some((variant) => text.includes(variant));
          };
          let targetNode: Element | null = null;
          if (!isMessageTarget) {
            targetNode =
              allNodes
                .filter((node) => visible(node) && includesTarget(node))
                .map((node) => {
                  const element = node as HTMLElement;
                  const rect = element.getBoundingClientRect();
                  const text = normalize(
                    element.innerText || element.textContent,
                  );
                  const className = String(element.className || '');
                  const exactTarget = targetVariants.some(
                    (variant) => text === variant,
                  );
                  const inReplyList = Boolean(
                    element.closest(
                      '.comment-reply-list, [class*="reply-list"], [class*="ReplyList"]',
                    ),
                  );
                  const replyToAuthor =
                    /^回复/.test(text) ||
                    (targetAuthor && text.includes(`回复${targetAuthor}`));
                  const ownReplySignal = /作者/.test(text) && !exactTarget;
                  const contentPriority =
                    /comment-content|comment-row__main/.test(className) ? 0 : 8;
                  const score =
                    (exactTarget ? 0 : 30) +
                    (inReplyList ? 90 : 0) +
                    (replyToAuthor ? 60 : 0) +
                    (ownReplySignal ? 35 : 0) +
                    contentPriority +
                    Math.max(1, rect.width * rect.height) / 10000;
                  return { node, rect, score };
                })
                .sort(
                  (a, b) =>
                    a.score - b.score ||
                    a.rect.width * a.rect.height - b.rect.width * b.rect.height,
                )[0]?.node || null;
          }
          if (isMessageTarget) {
            targetNode =
              allNodes
                .filter((node) => visible(node) && includesTarget(node))
                .sort((a, b) => {
                  const ar = (a as HTMLElement).getBoundingClientRect();
                  const br = (b as HTMLElement).getBoundingClientRect();
                  const aBubble = /bubble|content-left|message/i.test(
                    String((a as HTMLElement).className || ''),
                  )
                    ? 0
                    : 1;
                  const bBubble = /bubble|content-left|message/i.test(
                    String((b as HTMLElement).className || ''),
                  )
                    ? 0
                    : 1;
                  return (
                    aBubble - bBubble ||
                    ar.width * ar.height - br.width * br.height
                  );
                })[0] || null;
          }
          if (isMessageTarget && !targetNode) {
            targetNode =
              Array.from(
                document.querySelectorAll(
                  '.session-wrap, [class*="session"], [class*="Session"]',
                ),
              )
                .filter((node) => visible(node))
                .filter((node) => {
                  const text = normalize(node.innerText || node.textContent);
                  const hasTargetText = targetVariants.some((variant) =>
                    text.includes(variant),
                  );
                  const hasTargetAuthor =
                    targetAuthor && text.includes(targetAuthor);
                  return (
                    hasTargetText ||
                    (hasTargetAuthor && !/暂无私信|暂无消息/.test(text))
                  );
                })
                .sort((a, b) => {
                  const ar = a.getBoundingClientRect();
                  const br = b.getBoundingClientRect();
                  const exactPriority =
                    (includesTarget(a) ? 0 : 1) - (includesTarget(b) ? 0 : 1);
                  const classPriority =
                    (String(a.className || '').includes('session-wrap')
                      ? 0
                      : 1) -
                    (String(b.className || '').includes('session-wrap')
                      ? 0
                      : 1);
                  return (
                    exactPriority ||
                    classPriority ||
                    (a.contains(b) ? 1 : b.contains(a) ? -1 : 0) ||
                    ar.y - br.y
                  );
                })[0] || null;
          }
          if (!targetNode) {
            targetNode =
              allNodes
                .filter((node) => visible(node) && includesTarget(node))
                .sort((a, b) => {
                  const ar = (a as HTMLElement).getBoundingClientRect();
                  const br = (b as HTMLElement).getBoundingClientRect();
                  return ar.width * ar.height - br.width * br.height;
                })[0] || null;
          }
          if (!targetNode && targetAuthor) {
            targetNode =
              allNodes
                .filter(
                  (node) =>
                    visible(node) &&
                    normalize(node.innerText || node.textContent).includes(
                      targetAuthor,
                    ),
                )
                .sort((a, b) => {
                  const ar = (a as HTMLElement).getBoundingClientRect();
                  const br = (b as HTMLElement).getBoundingClientRect();
                  return (
                    (String((a as HTMLElement).className || '').includes(
                      'comment-item',
                    )
                      ? 0
                      : 1) -
                      (String((b as HTMLElement).className || '').includes(
                        'comment-item',
                      )
                        ? 0
                        : 1) || ar.width * ar.height - br.width * br.height
                  );
                })[0] || null;
          }
          if (!targetNode) {
            return {
              status: missingStatus,
              sent: false,
              message: '未在当前视频号页面找到目标对象，未操作。',
            };
          }
          const targetRect = (
            targetNode as HTMLElement
          ).getBoundingClientRect();
          try {
            targetNode.scrollIntoView({ block: 'center', inline: 'nearest' });
            (targetNode as HTMLElement).click();
          } catch {
            /* 容错：非关键路径失败忽略 */
          }
          await delay(isMessageTarget ? 1400 : 700);
          const root = isMessageTarget
            ? document.body
            : targetNode.closest(
                '.comment-item, tr, li, [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="item"], [class*="Item"]',
              ) || document.body;
          if (!isMessageTarget) {
            const commentRect =
              (root as HTMLElement).getBoundingClientRect?.() || targetRect;
            const replyTriggers = Array.from(
              document.querySelectorAll(
                '.action-item, button, [role="button"], span, div, a',
              ),
            )
              .filter((node) => {
                if (
                  !visible(node) ||
                  normalize(node.innerText || node.textContent) !== '回复'
                )
                  return false;
                const rect = node.getBoundingClientRect();
                const inRoot = root.contains(node);
                const nearTarget =
                  rect.y >= Math.min(commentRect.y, targetRect.y) - 40 &&
                  rect.y <=
                    Math.max(
                      commentRect.y + commentRect.height,
                      targetRect.y + targetRect.height,
                    ) +
                      180 &&
                  rect.x >= Math.min(commentRect.x, targetRect.x) - 80;
                return inRoot || nearTarget;
              })
              .sort((a, b) => {
                const ar = (a as HTMLElement).getBoundingClientRect();
                const br = (b as HTMLElement).getBoundingClientRect();
                const actionPriority =
                  (String((a as HTMLElement).className || '').includes(
                    'action-item',
                  )
                    ? 0
                    : 1) -
                  (String((b as HTMLElement).className || '').includes(
                    'action-item',
                  )
                    ? 0
                    : 1);
                const aDistance =
                  Math.abs(ar.y - targetRect.y) + Math.abs(ar.x - targetRect.x);
                const bDistance =
                  Math.abs(br.y - targetRect.y) + Math.abs(br.x - targetRect.x);
                return (
                  actionPriority ||
                  aDistance - bDistance ||
                  ar.width * ar.height - br.width * br.height
                );
              });
            if (replyTriggers.length) {
              const trigger = replyTriggers[0] as HTMLElement;
              try {
                trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
              } catch {
                /* 容错：非关键路径失败忽略 */
              }
              trigger.dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true }),
              );
              trigger.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
              );
              trigger.click();
              trigger.dispatchEvent(
                new MouseEvent('mouseup', { bubbles: true }),
              );
              await delay(1000);
            }
          }
          const findEditor = () => {
            const selectors = [
              'textarea.edit_area',
              'textarea',
              '[contenteditable="true"]',
              'input[type="text"]',
              '[role="textbox"]',
            ];
            const rootRect =
              (root as HTMLElement).getBoundingClientRect?.() || targetRect;
            for (const selector of selectors) {
              const nodes = Array.from(document.querySelectorAll(selector))
                .filter(visible)
                .map((node) => {
                  const rect = node.getBoundingClientRect();
                  const placeholder = normalize(
                    node.getAttribute('placeholder'),
                  );
                  const inRoot = root.contains(node);
                  const nearTarget =
                    rect.y >= Math.min(rootRect.y, targetRect.y) - 40 &&
                    rect.y <=
                      Math.max(
                        rootRect.y + rootRect.height,
                        targetRect.y + targetRect.height,
                      ) +
                        220 &&
                    rect.x >= Math.min(rootRect.x, targetRect.x) - 80;
                  const replyLike =
                    /^回复|写评论|评论/.test(placeholder) ||
                    /reply|comment|textarea|input/i.test(
                      String(node.className || ''),
                    );
                  const belongsToTarget =
                    isMessageTarget || editorBelongsToTarget(node, root);
                  const score =
                    (belongsToTarget ? 0 : 1000) +
                    (inRoot ? 0 : 40) +
                    (nearTarget ? 0 : 30) +
                    (replyLike ? 0 : 12) +
                    Math.abs(rect.y - targetRect.y) / 100 +
                    Math.abs(rect.x - targetRect.x) / 200;
                  return { node, score, belongsToTarget };
                })
                .sort((a, b) => a.score - b.score)
                .map((item) => item.node);
              const scoped = nodes.find(
                (node) =>
                  root.contains(node) &&
                  (isMessageTarget || editorBelongsToTarget(node, root)),
              );
              if (scoped) return scoped;
              const owned = nodes.find(
                (node) => isMessageTarget || editorBelongsToTarget(node, root),
              );
              if (owned) return owned;
            }
            return null;
          };
          const editor = findEditor();
          if (!editor) {
            const editorCount = document.querySelectorAll(
              'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
            ).length;
            const replyCount = Array.from(
              document.querySelectorAll(
                'button, [role="button"], span, div, a',
              ),
            ).filter(
              (node) =>
                normalize(
                  (node as HTMLElement).innerText || node.textContent,
                ) === '回复',
            ).length;
            return {
              status: 'editor_missing',
              sent: false,
              message: `已找到目标对象，但没有找到可编辑回复框。replyTriggers=${replyCount} editors=${editorCount} targetRect=${JSON.stringify(
                {
                  x: Math.round(targetRect.x),
                  y: Math.round(targetRect.y),
                  width: Math.round(targetRect.width),
                  height: Math.round(targetRect.height),
                },
              )}`,
            };
          }
          if (!send) {
            setEditorValue(editor, replyText);
            await delay(500);
            return {
              status: 'draft_filled',
              sent: false,
              message: '视频号回复草稿已填入，未点击发送。',
              editorTag: editor.tagName,
            };
          }
          const editorKey = `wechat-target-editor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          editor.setAttribute('data-kaypal-editor-key', editorKey);
          const editorRect = editor.getBoundingClientRect();
          return {
            status: 'editor_found',
            sent: false,
            message: '已找到视频号回复框，准备输入并发送。',
            editorTag: editor.tagName,
            editorKey,
            editorRect: {
              x: editorRect.x,
              y: editorRect.y,
              width: editorRect.width,
              height: editorRect.height,
            },
          };
        },
        {
          targetText: input.targetText,
          replyText: input.replyText,
          send: input.action === 'send',
          missingStatus,
          traceTarget,
        },
      );

      if (input.action === 'send' && actionResult.status === 'editor_found') {
        const editorRect = actionResult.editorRect || {};
        await page.mouse.click(
          Number(editorRect.x || 0) +
            Math.min(Math.max(Number(editorRect.width || 1) / 2, 2), 180),
          Number(editorRect.y || 0) +
            Math.max(Number(editorRect.height || 1) / 2, 1),
        );
        await page.keyboard.press('Meta+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.insertText(input.replyText);
        await page.waitForTimeout(800);
        actionResult = await contentFrame.evaluate<
          FrameActionResult,
          {
            replyText: string;
            traceTarget: Record<string, unknown>;
            editorKey?: string;
          }
        >(
          ({ replyText, traceTarget: _traceTarget, editorKey }) => {
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                .trim();
            const visible = (node: Element | null): node is HTMLElement => {
              if (!node || !(node as HTMLElement).getBoundingClientRect)
                return false;
              const rect = (node as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(node);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.pointerEvents !== 'none'
              );
            };
            const editorValue = (editor: Element) =>
              normalize(
                'value' in editor
                  ? (editor as HTMLInputElement).value
                  : (editor as HTMLElement).innerText || editor.textContent,
              );
            const allEditors = Array.from(
              document.querySelectorAll(
                'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
              ),
            )
              .filter((node): node is HTMLElement => visible(node))
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const value = editorValue(node);
                const keyMatches =
                  editorKey &&
                  node.getAttribute('data-kaypal-editor-key') === editorKey;
                return { node, rect, value, keyMatches };
              });
            const replyPrefix = replyText.slice(
              0,
              Math.min(replyText.length, 12),
            );
            const editors = allEditors
              .filter(
                (item) => item.keyMatches || item.value.includes(replyPrefix),
              )
              .sort(
                (a, b) =>
                  Number(b.keyMatches) - Number(a.keyMatches) ||
                  b.rect.y - a.rect.y,
              );
            const editor = editors[0];
            if (!editor) {
              return {
                status: 'editor_missing',
                sent: false,
                message: '回复内容没有进入视频号回复框。',
              };
            }
            const isDisabled = (node: Element) => {
              const aria = String(
                node.getAttribute('aria-disabled') || '',
              ).toLowerCase();
              return (
                Boolean((node as HTMLButtonElement).disabled) ||
                aria === 'true' ||
                /disabled/.test(
                  String((node as HTMLElement).className || '').toLowerCase(),
                )
              );
            };
            const candidates = Array.from(
              document.querySelectorAll('button, [role="button"], span, div'),
            )
              .filter((node): node is HTMLElement => {
                if (!visible(node) || isDisabled(node)) return false;
                const text = normalize(node.innerText || node.textContent);
                if (!/^(发送|回复|提交|评论)$/.test(text)) return false;
                const rect = node.getBoundingClientRect();
                const isRealButton =
                  node.tagName === 'BUTTON' ||
                  node.getAttribute('role') === 'button';
                if (!isRealButton && (rect.width > 180 || rect.height > 64))
                  return false;
                return Math.abs(rect.y - editor.rect.y) <= 260;
              })
              .map((node) => {
                const rect = node.getBoundingClientRect();
                const priority =
                  node.tagName === 'BUTTON'
                    ? 0
                    : node.getAttribute('role') === 'button'
                      ? 1
                      : node.tagName === 'SPAN'
                        ? 2
                        : 3;
                const clickKey = `wechat-send-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                node.setAttribute('data-kaypal-click-key', clickKey);
                return {
                  clickKey,
                  text: normalize(node.innerText || node.textContent),
                  priority,
                  distance:
                    Math.abs(rect.y - editor.rect.y) +
                    Math.abs(rect.x - editor.rect.x),
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                };
              })
              .sort(
                (a, b) => a.priority - b.priority || a.distance - b.distance,
              );
            if (!candidates.length) {
              return {
                status: 'send_failed',
                sent: false,
                message: '回复已写入，但没有识别到视频号发送按钮。',
                editorTag: editor.node.tagName,
              };
            }
            return {
              status: 'send_button_ready',
              sent: false,
              message: '回复已写入，已识别视频号发送按钮。',
              editorTag: editor.node.tagName,
              editorKey,
              sendButtonText: candidates[0]?.text || '',
              sendButtonRect: candidates[0]?.rect,
              sendButtonClickKey: candidates[0]?.clickKey,
            };
          },
          {
            replyText: input.replyText,
            traceTarget,
            editorKey: actionResult.editorKey || '',
          },
        );
        if (actionResult.status !== 'send_button_ready') {
          return {
            status:
              actionResult.status === 'editor_missing'
                ? 'editor_missing'
                : actionResult.status === 'send_failed'
                  ? 'send_failed'
                  : 'failed',
            message: actionResult.message || `视频号${itemLabel}执行失败。`,
            readbackText:
              actionResult.readbackText ||
              (actionResult.replyVisible ? input.replyText : undefined),
            replyVisible: Boolean(actionResult.replyVisible),
            nextAction: `检查视频号${itemLabel}页面是否加载完成、目标对象是否仍可见、账号是否要求重新登录。`,
          };
        }

        const frameElement =
          'frameElement' in contentFrame
            ? await contentFrame.frameElement().catch(() => null)
            : null;
        const frameBox = frameElement
          ? await frameElement.boundingBox().catch(() => null)
          : null;
        const clickFrameButton = async (clickKey?: string | null) => {
          if (!clickKey) return false;
          return contentFrame
            .evaluate((key) => {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
              const node = document.querySelector(
                `[data-kaypal-click-key="${key}"]`,
              ) as HTMLElement | null;
              if (!node) return false;
              try {
                node.scrollIntoView({ block: 'center', inline: 'nearest' });
              } catch {
                /* 容错：非关键路径失败忽略 */
              }
              node.dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true }),
              );
              node.dispatchEvent(
                new MouseEvent('mousedown', { bubbles: true }),
              );
              node.click();
              node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
              return true;
            }, clickKey)
            .catch(() => false);
        };
        const clickFrameRect = async (rectLike: Record<string, unknown>) => {
          const buttonX =
            (frameBox?.x ?? 0) +
            Number(rectLike.x || 0) +
            Math.max(2, Math.min(Number(rectLike.width || 1) / 2, 120));
          const buttonY =
            (frameBox?.y ?? 0) +
            Number(rectLike.y || 0) +
            Math.max(2, Math.min(Number(rectLike.height || 1) / 2, 30));
          await page.mouse.move(buttonX, buttonY).catch(() => undefined);
          await page.waitForTimeout(120).catch(() => undefined);
          await page.mouse.click(buttonX, buttonY).catch(async () => {
            await page.mouse.down().catch(() => undefined);
            await page.mouse.up().catch(() => undefined);
          });
        };
        if (!(await clickFrameButton(actionResult.sendButtonClickKey || ''))) {
          await clickFrameRect(actionResult.sendButtonRect || {});
        }
        await page.waitForTimeout(3200);
        const verifySendState = async (sendAttempt: number) =>
          contentFrame.evaluate<
            FrameActionResult,
            {
              replyText: string;
              traceTarget: Record<string, unknown>;
              sendButtonText: string;
              sendAttempt: number;
              editorKey: string;
            }
          >(
            async ({
              replyText,
              traceTarget,
              sendButtonText,
              sendAttempt,
              editorKey,
            }) => {
              const delay = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));
              const normalize = (value: unknown) =>
                (typeof value === 'string'
                  ? value
                  : value == null
                    ? ''
                    : (JSON.stringify(value) ?? '')
                )
                  .replace(/\s+/g, ' ')
                  .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                  .trim();
              const visible = (node: Element | null): node is HTMLElement => {
                if (!node || !(node as HTMLElement).getBoundingClientRect)
                  return false;
                const rect = (node as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  style.pointerEvents !== 'none'
                );
              };
              const editorValue = (editor: Element) =>
                normalize(
                  'value' in editor
                    ? (editor as HTMLInputElement).value
                    : (editor as HTMLElement).innerText || editor.textContent,
                );
              const replyPrefix = replyText.slice(
                0,
                Math.min(replyText.length, 12),
              );
              const readState = () => {
                const editors = Array.from(
                  document.querySelectorAll(
                    'textarea, [contenteditable="true"], input[type="text"], [role="textbox"]',
                  ),
                )
                  .filter((node): node is HTMLElement => visible(node))
                  .map((node) => ({
                    node,
                    value: editorValue(node),
                    rect: node.getBoundingClientRect(),
                    keyMatches:
                      editorKey &&
                      node.getAttribute('data-kaypal-editor-key') === editorKey,
                  }))
                  .filter(
                    (item) =>
                      item.keyMatches || item.value.includes(replyPrefix),
                  );
                const editorStillHasReply = editors.length > 0;
                const bodyText = normalize(document.body.innerText);
                const bodyHasReply = bodyText.includes(replyPrefix);
                const sent = !editorStillHasReply || bodyHasReply;
                return { editors, editorStillHasReply, bodyHasReply, sent };
              };
              const findRetryButton = (editors: Array<{ rect: DOMRect }>) => {
                const editor = editors.sort((a, b) => b.rect.y - a.rect.y)[0];
                if (!editor) return null;
                const isDisabled = (node: Element) => {
                  const aria = String(
                    node.getAttribute('aria-disabled') || '',
                  ).toLowerCase();
                  return (
                    Boolean((node as HTMLButtonElement).disabled) ||
                    aria === 'true' ||
                    /disabled/.test(
                      String(
                        (node as HTMLElement).className || '',
                      ).toLowerCase(),
                    )
                  );
                };
                const candidate = Array.from(
                  document.querySelectorAll(
                    'button, [role="button"], span, div',
                  ),
                )
                  .filter((node): node is HTMLElement => {
                    if (!visible(node) || isDisabled(node)) return false;
                    const text = normalize(node.innerText || node.textContent);
                    if (!/^(发送|回复|提交|评论)$/.test(text)) return false;
                    const rect = node.getBoundingClientRect();
                    const isRealButton =
                      node.tagName === 'BUTTON' ||
                      node.getAttribute('role') === 'button';
                    if (!isRealButton && (rect.width > 180 || rect.height > 64))
                      return false;
                    return Math.abs(rect.y - editor.rect.y) <= 260;
                  })
                  .map((node) => {
                    const rect = node.getBoundingClientRect();
                    const priority =
                      node.tagName === 'BUTTON'
                        ? 0
                        : node.getAttribute('role') === 'button'
                          ? 1
                          : node.tagName === 'SPAN'
                            ? 2
                            : 3;
                    const clickKey = `wechat-send-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    node.setAttribute('data-kaypal-click-key', clickKey);
                    return {
                      clickKey,
                      text: normalize(node.innerText || node.textContent),
                      priority,
                      distance:
                        Math.abs(rect.y - editor.rect.y) +
                        Math.abs(rect.x - editor.rect.x),
                      rect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                      },
                    };
                  })
                  .sort(
                    (a, b) =>
                      a.priority - b.priority || a.distance - b.distance,
                  )[0];
                return candidate || null;
              };
              let state = readState();
              for (let i = 0; i < 10; i += 1) {
                if (state.sent) break;
                await delay(650);
                state = readState();
              }
              const retryButton = state.sent
                ? null
                : findRetryButton(state.editors);
              const createdReply =
                traceTarget?.text === replyText
                  ? traceTarget.text
                  : state.bodyHasReply
                    ? replyText
                    : '';
              return {
                status: state.sent ? 'sent' : 'send_failed',
                sent: state.sent,
                message: state.sent
                  ? `视频号回复已点击发送，已在页面看到回复内容或输入框已清空。attempt=${sendAttempt}`
                  : `已点击发送，但输入框仍保留内容且页面未看到回复，未确认发出。attempt=${sendAttempt}`,
                editorStillHasReply: state.editorStillHasReply,
                sendButtonText: retryButton?.text || sendButtonText,
                replyVisible: state.bodyHasReply,
                readbackText: createdReply,
                retryButtonRect: retryButton?.rect,
                retryButtonClickKey: retryButton?.clickKey,
              };
            },
            {
              replyText: input.replyText,
              traceTarget,
              sendButtonText: actionResult.sendButtonText || '',
              sendAttempt,
              editorKey: actionResult.editorKey || '',
            },
          );
        actionResult = await verifySendState(1);
        if (
          actionResult.status === 'send_failed' &&
          actionResult.retryButtonRect
        ) {
          if (
            !(await clickFrameButton(actionResult.retryButtonClickKey || ''))
          ) {
            await clickFrameRect(actionResult.retryButtonRect);
          }
          await page.waitForTimeout(4200);
          actionResult = await verifySendState(2);
        }
      }
      return {
        status:
          actionResult.status === 'comment_missing' ||
          actionResult.status === 'message_missing'
            ? actionResult.status
            : actionResult.status === 'editor_missing'
              ? 'editor_missing'
              : actionResult.status === 'sent'
                ? 'sent'
                : actionResult.status === 'draft_filled'
                  ? 'draft_filled'
                  : actionResult.status === 'send_failed'
                    ? 'send_failed'
                    : 'failed',
        message: actionResult.message || `视频号${itemLabel}执行完成。`,
        readbackText:
          actionResult.readbackText ||
          (actionResult.replyVisible ? input.replyText : undefined),
        replyVisible: Boolean(actionResult.replyVisible),
        nextAction:
          actionResult.sent || actionResult.status === 'draft_filled'
            ? undefined
            : `检查视频号${itemLabel}页面是否加载完成、目标对象是否仍可见、账号是否要求重新登录。`,
      };
    } finally {
      trace.detach();
    }
  }

  private async openWechatChannelPage(
    page: Page,
    targetKind: 'comments' | 'messages',
  ): Promise<void> {
    const targetUrl =
      targetKind === 'comments'
        ? 'https://channels.weixin.qq.com/platform/interaction/comment'
        : 'https://channels.weixin.qq.com/platform/private_msg';
    await this.gotoBestEffort(page, targetUrl, 30000);
    await page
      .waitForLoadState('networkidle', { timeout: 10000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500).catch(() => undefined);
    const labels =
      targetKind === 'comments'
        ? ['评论管理', '互动管理', '评论', '留言管理']
        : ['私信管理', '消息管理', '互动管理', '私信', '消息', '用户消息'];
    for (const label of labels) {
      try {
        await page
          .getByText(label, { exact: true })
          .first()
          .click({ timeout: 2500 });
        await page.waitForTimeout(1200);
      } catch {
        // 继续尝试其他入口。
      }
    }
  }

  private async wechatChannelContentFrame(
    page: Page,
    targetKind: 'comments' | 'messages',
    timeoutMs = 8000,
  ): Promise<Page | Frame> {
    const expected =
      targetKind === 'comments'
        ? 'micro/interaction/comment'
        : 'micro/interaction/private_msg';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = page
        .frames()
        .find((candidate) => candidate.url().includes(expected));
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return page;
  }

  private async ensureWechatChannelReadyPage(
    page: Page,
    targetLabel: string,
  ): Promise<void> {
    const url = page.url().toLowerCase();
    const bodyText = await this.pageText(page, 1500).catch(() => '');
    const loggedOut =
      url.includes('login') ||
      (/一站式服务/.test(bodyText) &&
        /让创作更简单/.test(bodyText) &&
        /多人运营/.test(bodyText));
    if (loggedOut) {
      throw new Error(
        `视频号账号未登录，不能读取或回复${targetLabel}。请先重新登录视频号账号。`,
      );
    }
  }

  private async selectWechatChannelCommentWork(
    page: Page,
    targetText = '',
  ): Promise<Record<string, any>> {
    const frame = await this.wechatChannelContentFrame(page, 'comments');
    const result = await frame
      .evaluate(
        ({ targetText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const bodyText = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          if (targetText && bodyText.includes(targetText)) {
            return { clicked: false, reason: 'target-already-visible' };
          }
          const parseCommentCount = (text: string) => {
            const numbers = (normalize(text).match(/\b\d+\b/g) || []).map(
              Number,
            );
            return numbers.length ? numbers[numbers.length - 1] || 0 : 0;
          };
          const rows = Array.from(
            document.querySelectorAll('li, tr, section, div'),
          )
            .filter((node) => {
              if (!visible(node)) return false;
              const rect = node.getBoundingClientRect();
              if (rect.x < 260 || rect.x > window.innerWidth * 0.58)
                return false;
              if (
                rect.y < 130 ||
                rect.width < 160 ||
                rect.height < 42 ||
                rect.height > 220
              )
                return false;
              const text = normalize(node.innerText || node.textContent);
              if (!text || text.length > 320) return false;
              if (!/20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}/.test(text))
                return false;
              return parseCommentCount(text) > 0;
            })
            .map((node) => {
              const rect = (node as HTMLElement).getBoundingClientRect();
              const text = normalize(
                (node as HTMLElement).innerText || node.textContent,
              );
              return {
                node: node as HTMLElement,
                text,
                commentCount: parseCommentCount(text),
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            })
            .sort(
              (a, b) =>
                a.y - b.y ||
                b.commentCount - a.commentCount ||
                a.height - b.height,
            );
          const row = rows[0];
          if (!row) return { clicked: false, reason: 'no-work-with-comments' };
          row.node.scrollIntoView({ block: 'center', inline: 'nearest' });
          row.node.click();
          return {
            clicked: true,
            selectedText: row.text.slice(0, 220),
            commentCount: row.commentCount,
            candidates: rows
              .slice(0, 6)
              .map(({ text, commentCount, x, y, width, height }) => ({
                text: text.slice(0, 180),
                commentCount,
                x,
                y,
                width,
                height,
              })),
          };
        },
        { targetText },
      )
      .catch((error) => ({
        clicked: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
    if (result?.clicked) {
      await page.waitForTimeout(2800).catch(() => undefined);
    }
    return result || {};
  }

  private async prepareWechatChannelMessageTab(
    page: Page,
    targetText = '',
  ): Promise<Record<string, any>> {
    const frame = await this.wechatChannelContentFrame(page, 'messages');
    await this.waitForWechatChannelMessageListReady(page).catch(
      () => undefined,
    );
    const hasTargetOrItems = async () =>
      frame
        .evaluate(
          ({ targetText }) => {
            const normalize = (value: unknown) =>
              (typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : (JSON.stringify(value) ?? '')
              )
                .replace(/\s+/g, ' ')
                .trim();
            const text = normalize(
              document.body.innerText || document.body.textContent || '',
            );
            if (targetText && text.includes(targetText))
              return { matchedTarget: true, hasItems: true };
            const empty = /暂无私信|暂无消息|还没有收到私信|没有私信/.test(
              text,
            );
            const hasListSignal =
              /今天|昨天|\d{1,2}:\d{2}|分钟前|小时前|未读|回复/.test(text);
            return { matchedTarget: false, hasItems: hasListSignal && !empty };
          },
          { targetText },
        )
        .catch(() => ({ matchedTarget: false, hasItems: false }));

    const current = await hasTargetOrItems();
    if (current.matchedTarget || (current.hasItems && !targetText)) {
      return { selectedTab: 'current', ...current };
    }
    for (const label of ['私信', '全部私信', '打招呼消息']) {
      const clicked = (await this.clickWechatChannelMessageTab(page, label))
        .clicked;
      if (!clicked) continue;
      await this.waitForWechatChannelMessageListReady(page).catch(
        () => undefined,
      );
      const state = await hasTargetOrItems();
      if (state.matchedTarget || state.hasItems) {
        return { selectedTab: label, ...state };
      }
    }
    return { selectedTab: 'none', ...(await hasTargetOrItems()) };
  }

  private async clickWechatChannelMessageTab(
    page: Page,
    label: string,
  ): Promise<Record<string, any>> {
    const frame = await this.wechatChannelContentFrame(page, 'messages');
    const readTabState = async () =>
      frame
        .evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const bodyText = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          const currentNode = Array.from(
            document.querySelectorAll(
              '.weui-desktop-tab__nav_current, [class*="tab__nav_current"], [class*="nav_current"]',
            ),
          ).find((node) =>
            /私信|打招呼消息/.test(
              normalize((node as HTMLElement).innerText || node.textContent),
            ),
          );
          const activeTab = normalize(
            (currentNode as HTMLElement | undefined)?.innerText ||
              currentNode?.textContent ||
              '',
          );
          return {
            activeTab,
            bodyText,
            hasPrivateItems: /全部私信|共\d+个|视频号助手\s*·\s*私信/.test(
              bodyText,
            ),
            hasGreetingEmpty: /暂无打招呼消息|视频号助手\s*·\s*打招呼/.test(
              bodyText,
            ),
          };
        })
        .catch(() => ({
          activeTab: '',
          bodyText: '',
          hasPrivateItems: false,
          hasGreetingEmpty: false,
        }));
    const labelIsActive = (state: Record<string, any>) => {
      const activeTab = String(state.activeTab || '');
      const bodyText = String(state.bodyText || '');
      if (label === '私信') {
        return (
          activeTab === '私信' ||
          (state.hasPrivateItems && !state.hasGreetingEmpty)
        );
      }
      if (label === '打招呼消息') {
        return (
          activeTab === '打招呼消息' ||
          /暂无打招呼消息|视频号助手\s*·\s*打招呼/.test(bodyText)
        );
      }
      if (label === '全部私信') {
        return /全部私信|共\d+个/.test(bodyText);
      }
      return activeTab === label || bodyText.includes(label);
    };
    const beforeState = await readTabState();
    if (labelIsActive(beforeState)) {
      return {
        selectedTab: label,
        clicked: true,
        alreadySelected: true,
        state: beforeState,
      };
    }

    const targetRect = await frame
      .evaluate((label) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number(style.opacity) !== 0
          );
        };
        const rolePriority = (node: Element) => {
          const tag = node.tagName.toLowerCase();
          if (tag === 'a' || tag === 'button') return 0;
          if (node.getAttribute('role') === 'button') return 1;
          if (tag === 'span') return 2;
          return 3;
        };
        const nodes = Array.from(
          document.querySelectorAll('a, button, [role="button"], span, div'),
        )
          .filter(
            (node) =>
              visible(node) &&
              normalize(node.innerText || node.textContent) === label,
          )
          .sort((a, b) => {
            const ar = (a as HTMLElement).getBoundingClientRect();
            const br = (b as HTMLElement).getBoundingClientRect();
            return (
              rolePriority(a) - rolePriority(b) || ar.y - br.y || ar.x - br.x
            );
          });
        const node = nodes[0] as HTMLElement | undefined;
        if (!node) return null;
        try {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
        } catch {
          /* 容错：非关键路径失败忽略 */
        }
        const rect = node.getBoundingClientRect();
        node.setAttribute('data-kaypal-message-tab-target', label);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          tag: node.tagName,
          text: normalize(node.innerText || node.textContent),
        };
      }, label)
      .catch(() => null as null | Record<string, any>);

    let clicked = false;
    let verified = false;
    let clickMethod = '';
    if (targetRect) {
      clicked = await frame
        .evaluate((label) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const node =
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
            (document.querySelector(
              `[data-kaypal-message-tab-target="${label}"]`,
            ) as HTMLElement | null) ||
            (Array.from(
              document.querySelectorAll(
                'a, button, [role="button"], span, div',
              ),
            ).find(
              (item) =>
                normalize(
                  (item as HTMLElement).innerText || item.textContent,
                ) === label,
            ) as HTMLElement | undefined);
          if (!node) return false;
          const rect = node.getBoundingClientRect();
          try {
            node.scrollIntoView({ block: 'center', inline: 'nearest' });
          } catch {
            /* 容错：非关键路径失败忽略 */
          }
          for (const type of [
            'pointerover',
            'mouseover',
            'pointerdown',
            'mousedown',
            'pointerup',
            'mouseup',
            'click',
          ]) {
            const eventInit = {
              bubbles: true,
              cancelable: true,
              clientX: rect.x + Math.max(2, Math.min(rect.width / 2, 80)),
              clientY: rect.y + Math.max(2, Math.min(rect.height / 2, 30)),
            };
            try {
              const event = type.startsWith('pointer')
                ? new PointerEvent(type, { ...eventInit, pointerType: 'mouse' })
                : new MouseEvent(type, eventInit);
              node.dispatchEvent(event);
            } catch {
              /* 容错：非关键路径失败忽略 */
            }
          }
          return true;
        }, label)
        .catch(() => false);
      if (clicked) {
        clickMethod = 'dom-events';
        await page.waitForTimeout(1200).catch(() => undefined);
        verified = labelIsActive(await readTabState());
      }
    }

    if (targetRect && !verified) {
      const frameElement =
        'frameElement' in frame
          ? await frame.frameElement().catch(() => null)
          : null;
      const frameBox = frameElement
        ? await frameElement.boundingBox().catch(() => null)
        : null;
      const rawClick = {
        x:
          Number(targetRect.x || 0) +
          Math.max(2, Math.min(Number(targetRect.width || 1) / 2, 80)),
        y:
          Number(targetRect.y || 0) +
          Math.max(2, Math.min(Number(targetRect.height || 1) / 2, 30)),
      };
      const offsetClick = frameBox
        ? {
            x: Number(frameBox.x || 0) + rawClick.x,
            y: Number(frameBox.y || 0) + rawClick.y,
          }
        : null;
      const clickPoints = [rawClick, offsetClick]
        .filter(Boolean)
        .filter((point, index, arr) => {
          const current = point as { x: number; y: number };
          return (
            arr.findIndex((item) => {
              const other = item as { x: number; y: number };
              return (
                Math.abs(other.x - current.x) < 2 &&
                Math.abs(other.y - current.y) < 2
              );
            }) === index
          );
        }) as Array<{ x: number; y: number }>;
      for (const point of clickPoints) {
        await page.mouse.move(point.x, point.y).catch(() => undefined);
        await page.waitForTimeout(120).catch(() => undefined);
        await page.mouse.click(point.x, point.y).catch(() => undefined);
        clicked = true;
        clickMethod =
          clickMethod || (point === rawClick ? 'raw-mouse' : 'offset-mouse');
        await page.waitForTimeout(1200).catch(() => undefined);
        verified = labelIsActive(await readTabState());
        if (verified) break;
      }
    }

    if (!verified) {
      clicked = await frame
        .evaluate((label) => {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- closest/querySelector 返回 Element|null，断言为必要收窄（eslint 类型推断与 tsc 不一致的误报）
          const node = document.querySelector(
            `[data-kaypal-message-tab-target="${label}"]`,
          ) as HTMLElement | null;
          if (!node) return false;
          node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          node.click();
          node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          return true;
        }, label)
        .catch(() => false);
      if (clicked) {
        clickMethod = clickMethod || 'dom-click';
        await page.waitForTimeout(1200).catch(() => undefined);
        verified = labelIsActive(await readTabState());
      }
    }

    if (verified) {
      await page.waitForTimeout(1400).catch(() => undefined);
    }
    const state = await readTabState();
    return {
      selectedTab: label,
      clicked: Boolean(clicked && (verified || labelIsActive(state))),
      verified: Boolean(verified || labelIsActive(state)),
      clickMethod,
      targetRect,
      state,
    };
  }

  private async openWechatChannelMessageSession(
    page: Page,
    targetText = '',
  ): Promise<Record<string, any>> {
    await this.waitForWechatChannelMessageListReady(page).catch(
      () => undefined,
    );
    const frame = await this.wechatChannelContentFrame(page, 'messages');
    const result = await frame
      .evaluate(
        ({ targetText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const looksOwnReply = (text: string) =>
            /收到，看到你发的是|你把具体想咨询的问题发我|有具体问题直接发我|我按实际情况/.test(
              text,
            );
          const rows = Array.from(
            document.querySelectorAll(
              '.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"]',
            ),
          )
            .filter((node) => visible(node))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              const text = normalize(node.innerText || node.textContent);
              const author = normalize(
                node.querySelector(
                  '.name, [class*="name"], [class*="Name"], .title',
                )?.textContent || '',
              );
              const content = normalize(
                node.querySelector(
                  '.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"]',
                )?.textContent || '',
              );
              const cls = String(node.className || '').toLowerCase();
              return {
                node: node,
                text,
                author,
                content,
                unread: /未读|新消息/.test(text) || /unread|new/.test(cls),
                targetMatched: targetText ? text.includes(targetText) : false,
                ownReply: looksOwnReply(content),
                y: rect.y,
              };
            })
            .sort(
              (a, b) =>
                (b.targetMatched ? 1 : 0) - (a.targetMatched ? 1 : 0) ||
                (b.unread ? 1 : 0) - (a.unread ? 1 : 0) ||
                (a.ownReply ? 1 : 0) - (b.ownReply ? 1 : 0) ||
                a.y - b.y,
            );
          const row = rows[0];
          if (!row) return { clicked: false, reason: 'no-session-row' };
          row.node.scrollIntoView({ block: 'center', inline: 'nearest' });
          const rect = row.node.getBoundingClientRect();
          for (const type of [
            'pointerover',
            'mouseover',
            'pointerdown',
            'mousedown',
            'pointerup',
            'mouseup',
            'click',
          ]) {
            const eventInit = {
              bubbles: true,
              cancelable: true,
              clientX: rect.x + Math.max(2, Math.min(rect.width / 2, 160)),
              clientY: rect.y + Math.max(2, Math.min(rect.height / 2, 44)),
            };
            try {
              const event = type.startsWith('pointer')
                ? new PointerEvent(type, { ...eventInit, pointerType: 'mouse' })
                : new MouseEvent(type, eventInit);
              row.node.dispatchEvent(event);
            } catch {
              /* 容错：非关键路径失败忽略 */
            }
          }
          return {
            clicked: true,
            author: row.author,
            content: row.content,
            unread: row.unread,
            ownReply: row.ownReply,
            selectedText: row.text.slice(0, 240),
          };
        },
        { targetText },
      )
      .catch((error) => ({
        clicked: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
    if (result?.clicked) {
      await page.waitForTimeout(2400).catch(() => undefined);
    }
    return result || {};
  }

  private async waitForWechatChannelMessageListReady(
    page: Page,
    timeoutMs = 16000,
  ): Promise<Record<string, any>> {
    const deadline = Date.now() + timeoutMs;
    let lastState: Record<string, any> = {};
    while (Date.now() < deadline) {
      const frame = await this.wechatChannelContentFrame(
        page,
        'messages',
        2000,
      );
      lastState = await frame
        .evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              Number(style.opacity) !== 0
            );
          };
          const bodyText = normalize(
            document.body?.innerText || document.body?.textContent || '',
          );
          const sessionRows = Array.from(
            document.querySelectorAll(
              '.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"]',
            ),
          ).filter((node) => visible(node));
          const countMatch = bodyText.match(/共\s*(\d+)\s*个/);
          const declaredCount = countMatch ? Number(countMatch[1]) : null;
          const syncing = /消息同步中|同步中|加载中|请稍候/.test(bodyText);
          const empty =
            /暂无私信|暂无消息|还没有收到私信|没有私信|暂无打招呼消息/.test(
              bodyText,
            );
          return {
            syncing,
            empty,
            declaredCount,
            rowCount: sessionRows.length,
            hasRows: sessionRows.length > 0,
            bodyTextSample: bodyText.slice(0, 300),
          };
        })
        .catch((error) => ({
          syncing: true,
          empty: false,
          declaredCount: null,
          rowCount: 0,
          hasRows: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      if (lastState.hasRows || lastState.empty) return lastState;
      if (
        typeof lastState.declaredCount === 'number' &&
        lastState.declaredCount <= 0 &&
        !lastState.syncing
      ) {
        return lastState;
      }
      await page.waitForTimeout(600).catch(() => undefined);
    }
    return lastState;
  }

  private wechatChannelScanScript(): string {
    return `({ limit, itemKey }) => {
      const hidden = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
      };
      const normalize = (value) => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value) ?? ""
        .replace(/\\s+/g, ' ')
        .replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '')
        .trim();
      const noise = [
        '视频号助手', '首页', '发表记录', '动态管理', '评论管理', '私信管理',
        '消息管理', '数据中心', '创作者中心', '通知', '设置', '搜索',
        '筛选', '全部', '全部私信', '暂无', '加载中', '发送', '回复', '取消', '确定',
        '微信', '视频号', '发表视频', '发表直播', '原创声明', '合集管理',
        '没有更多了', '暂无评论', '暂无消息', '暂无私信', '暂无打招呼消息',
        '一站式服务', '让创作更简单', '助力优质内容', '加速作者成长',
        '加热视频', '加热直播', '企业账户', '订单分析', '人群分析',
      ];
      const systemNotice = ['平台通知', '系统通知', '功能介绍', '使用说明', '隐私', '协议', '违规', '处罚', '审核', '申诉', '该消息类型暂不支持'];
      const isComment = (typeof itemKey === "string" ? itemKey : itemKey == null ? "" : JSON.stringify(itemKey) ?? "").toLowerCase().includes('comment');
      const statPattern = /^\\d+$|^\\d{1,2}:\\d{2}$|^\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}$|^\\d+分钟前$|^\\d+小时前$|^\\d+天前$|^刚刚$|^昨天$|^今天$/;
      const rowSelectors = 'li, tr, section, [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="item"], [class*="Item"], div';
      const hasReadableChar = (text) => /[\\u4e00-\\u9fa5a-zA-Z0-9]/.test(text) || /[\\u{1F300}-\\u{1FAFF}]/u.test(text);
      const isNoise = (text) => {
        if (!text || text.length > 220) return true;
        if (!hasReadableChar(text)) return true;
        if (statPattern.test(text)) return true;
        if (noise.some((item) => text === item || (text.length > 8 && text.includes(item)))) return true;
        if (systemNotice.some((item) => text.includes(item))) return true;
        if (/^共\\d+个$/.test(text)) return true;
        if (/收到，看到你发的是|你把具体想咨询的问题发我|有具体问题直接发我|我按实际情况/.test(text)) return true;
        if (/不再接收对方消息|扫描二维码后|填写投诉/.test(text)) return true;
        return false;
      };
      const rowLooksUseful = (rowText) => {
        if (isComment) {
          return /回复|删除|点赞|评论|分钟前|小时前|刚刚|昨天|今天|\\d{1,2}:\\d{2}/.test(rowText);
        }
        return /私信|消息|回复|未读|打招呼|刚刚|今天|昨天|\\d{1,2}:\\d{2}|分钟前|小时前/.test(rowText);
      };
      const candidates = [];
      if (isComment) {
        const commentRows = Array.from(document.querySelectorAll('[class*="comment"], [class*="Comment"], li, [role="listitem"], div'))
          .filter((node) => !hidden(node))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const rowText = normalize(node.innerText || node.textContent);
            if (rect.x < window.innerWidth * 0.42 || rect.y < 100 || rect.width < 180 || rect.height < 26 || rect.height > 240) return null;
            if (!/回复|删除|举报|点赞|刚刚|今天|昨天|分钟前|小时前|\\d{1,2}:\\d{2}|20\\d{2}[/-]\\d{1,2}[/-]\\d{1,2}/.test(rowText)) return null;
            if (/作者/.test(rowText)) return null;
            const childTexts = Array.from(node.querySelectorAll('span, p, div'))
              .filter((child) => !hidden(child))
              .map((child) => normalize(child.innerText || child.textContent))
              .filter(Boolean)
              .filter((text, index, arr) => arr.indexOf(text) === index)
              .filter((text) => !isNoise(text))
              .filter((text) => !/^(回复|删除|举报|点赞|刚刚|今天|昨天|\\d{1,2}:\\d{2}|\\d+分钟前|\\d+小时前|\\d+)$/.test(text))
              .filter((text) => !/^20\\d{2}[/-]\\d{1,2}[/-]\\d{1,2}\\s+\\d{1,2}:\\d{2}$/.test(text))
              .filter((text) => !/作者/.test(text));
            const text =
              childTexts.find((item) => /[？?吗呢吧呀哦]|价格|多少|怎么|哪里|联系|电话|微信|私信|预约|内容|具体|可以|想问|请问|买|发|帮|看|风格/.test(item)) ||
              childTexts.find((item) => item.length >= 4) ||
              '';
            if (!text) return null;
            const author =
              childTexts.find((item) => item !== text && item.length <= 24 && !/[？?吗呢吧呀哦]/.test(item)) || '';
            return {
              text,
              author,
              context: rowText.slice(0, 260),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              source: 'wechat-channel-dom-customer-comment-row',
              score: 130,
              looksLikeComment: true,
            };
          })
          .filter(Boolean);
        for (const item of commentRows) {
          item[itemKey] = true;
          candidates.push(item);
        }
      }
      if (!isComment) {
        const unreadSessionRows = Array.from(document.querySelectorAll('.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"]'))
          .filter((node) => !hidden(node))
          .filter((node) => {
            const text = normalize(node.innerText || node.textContent);
            const cls = String(node.className || '').toLowerCase();
            return /未读|新消息/.test(text) || /unread|new/.test(cls);
          })
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.innerText || node.textContent);
            const authorNode = node.querySelector('.name, [class*="name"], [class*="Name"], .title');
            const dateNode = node.querySelector('.date, [class*="date"], [class*="Date"], time');
            const contentNode = node.querySelector('.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"]');
            const author = normalize(authorNode?.innerText || authorNode?.textContent || '');
            const timestamp = normalize(dateNode?.innerText || dateNode?.textContent || '');
            const content = normalize(contentNode?.innerText || contentNode?.textContent || '');
            if (!author || !timestamp || !content || rect.width <= 0 || rect.height <= 0) return null;
            return {
              text: content,
              author,
              timestamp,
              context: text.slice(0, 260),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              sessionRow: true,
              unread: true,
              source: 'wechat-channel-dom-unread-session-row',
              score: 98,
            };
          })
          .filter(Boolean)
          .filter((item) => !isNoise(item.text) && !isNoise(item.author));
        for (const item of unreadSessionRows) {
          item[itemKey] = true;
          candidates.push(item);
        }
        const leftBubbles = Array.from(document.querySelectorAll('.content-left, [class*="content-left"], .bubble-left, [class*="bubble-left"], .plain-left, [class*="plain-left"]'))
          .filter((node) => !hidden(node))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const bubbleTextNode =
              node.querySelector?.('.message-plain, pre, [class*="plain"]') ||
              node.querySelector?.('.bubble-left, [class*="bubble-left"]') ||
              node;
            const text = normalize(bubbleTextNode.innerText || bubbleTextNode.textContent || node.innerText || node.textContent);
            if (!text || rect.width <= 0 || rect.height <= 0) return null;
            if (!/content-left|bubble-left|plain-left/i.test(String(node.className || ''))) return null;
            const dialog = node.closest('.session-dialog, [class*="session-dialog"], [class*="dialog"]') || document.body;
            const header = normalize(dialog.querySelector('.header, [class*="header"]')?.innerText || '');
            if (header && text === header) return null;
            return {
              text,
              author: header,
              context: normalize(dialog.innerText || dialog.textContent).slice(0, 260),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              messageBubble: true,
              source: 'wechat-channel-dom-left-bubble',
              score: 120,
            };
          })
          .filter(Boolean)
          .filter((item) => !isNoise(item.text));
        for (const item of leftBubbles) {
          item[itemKey] = true;
          candidates.push(item);
        }
        const sessionRows = Array.from(document.querySelectorAll('.session-wrap, .scroll-list .session-wrap, [class*="session-wrap"], [class*="SessionWrap"], [class*="session-item"], [class*="SessionItem"], [class*="chat-item"], [class*="ChatItem"]'))
          .filter((node) => !hidden(node))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const text = normalize(node.innerText || node.textContent);
            const authorNode = node.querySelector('.name, [class*="name"], [class*="Name"], .title, [class*="nick"], [class*="Nick"]');
            const dateNode = node.querySelector('.date, [class*="date"], [class*="Date"], time, [class*="time"], [class*="Time"]');
            const contentNode = node.querySelector('.feed-info, [class*="feed-info"], [class*="content"], [class*="Content"], [class*="desc"], [class*="Desc"], [class*="msg"], [class*="Msg"], [class*="last"], [class*="Last"]');
            const directAuthor = normalize(authorNode?.innerText || authorNode?.textContent || '');
            const directTimestamp = normalize(dateNode?.innerText || dateNode?.textContent || '');
            const directContent = normalize(contentNode?.innerText || contentNode?.textContent || '');
            const match = text.match(/^(.+?)\\s+(\\d{1,2}月\\d{1,2}日\\s+\\d{1,2}:\\d{2}|今天\\s*\\d{1,2}:\\d{2}|昨天\\s*\\d{1,2}:\\d{2}|\\d{1,2}:\\d{2})\\s+(.+)$/)
              || text.match(/^(.+?)\\s+(.+?)\\s+(\\d{1,2}月\\d{1,2}日|\\d{1,2}:\\d{2}|今天|昨天|\\d+分钟前|\\d+小时前)$/);
            const author = directAuthor || normalize(match?.[1]);
            const timestamp = directTimestamp || normalize(match?.[2]);
            const content = directContent || normalize(match?.[3]);
            const looksOwnReply = /收到，看到你发的是|你把具体想咨询的问题发我|有具体问题直接发我|我按实际情况|感谢反馈|我看到你提到/.test(content);
            if (!author || !content || rect.width <= 0 || rect.height <= 0) return null;
            return {
              text: content,
              author,
              timestamp: timestamp || '',
              context: text.slice(0, 260),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              sessionRow: true,
              ownReply: looksOwnReply,
              source: 'wechat-channel-dom-session-row',
              score: looksOwnReply ? 60 : 92,
            };
          })
          .filter(Boolean)
          .filter((item) => !isNoise(item.text) && !isNoise(item.author));
        for (const item of sessionRows) {
          item[itemKey] = true;
          candidates.push(item);
        }
      }
      const nodes = Array.from(document.querySelectorAll('div, span, p, a, li, td, section'));
      for (const node of nodes) {
        if (hidden(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.x < 160) continue;
        const text = normalize(node.innerText || node.textContent);
        if (isNoise(text)) continue;
        const row = node.closest(rowSelectors) || node.parentElement || node;
        const rowText = normalize(row.innerText || row.textContent || '');
        if (!rowLooksUseful(rowText)) continue;
        if (isComment && rowText.includes(text) && !/回复|删除|点赞/.test(rowText) && /\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}/.test(rowText)) {
          continue;
        }
        const item = {
          text,
          context: rowText.slice(0, 260),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        item[itemKey] = true;
        candidates.push(item);
      }
      const seen = new Set();
      const items = [];
      for (const item of candidates.sort((a, b) => {
        const messagePriority = (item) => {
          if (isComment) return 0;
          if (item.messageBubble) return 0;
          if (item.sessionRow && !item.ownReply) return 1;
          if (item.sessionRow) return 3;
          return 2;
        };
        const priority = messagePriority(a) - messagePriority(b);
        const latestBubble =
          !isComment && a.messageBubble && b.messageBubble
            ? (b.y || 0) - (a.y || 0)
            : 0;
        return priority || latestBubble || (b.score || 0) - (a.score || 0) || (a.y - b.y) || (a.x - b.x);
      })) {
        if (seen.has(item.text)) continue;
        seen.add(item.text);
        items.push(item);
        if (items.length >= limit) break;
      }
      return {
        url: location.href,
        title: document.title,
        totalCandidates: candidates.length,
        items,
        pageTextSample: normalize(document.body.innerText).slice(0, 600),
      };
    }`;
  }

  private startWechatChannelResponseTrace(
    page: Page,
    targetKind: 'comments' | 'messages',
    limit: number,
  ): { events: DouyinImTraceEvent[]; detach: () => void } {
    const events: DouyinImTraceEvent[] = [];
    const handler = async (response: import('playwright').Response) => {
      const url = response.url();
      const lowerUrl = url.toLowerCase();
      const shouldCapture =
        lowerUrl.includes('channels.weixin.qq.com') &&
        lowerUrl.includes('/cgi-bin/') &&
        ['comment', 'private', 'message', 'msg', 'session', 'post_list'].some(
          (fragment) => lowerUrl.includes(fragment),
        );
      if (!shouldCapture) return;
      try {
        const text = await response.text();
        const candidates = this.extractWechatChannelCandidatesFromPayload(
          text,
          lowerUrl,
          limit,
        );
        const event: DouyinImTraceEvent = {
          kind: 'responseBody',
          url: url.slice(0, 500),
          status: response.status(),
          wechatChannelCandidates: candidates,
          bodyPreview: candidates.length ? text.slice(0, 1200) : '',
          targetKind,
          timestamp: new Date().toISOString(),
        };
        events.push(event);
        events.splice(0, Math.max(0, events.length - 80));
      } catch (error) {
        events.push({
          kind: 'responseBodyFailed',
          url: url.slice(0, 500),
          errorText:
            error instanceof Error
              ? error.message.slice(0, 240)
              : String(error).slice(0, 240),
          timestamp: new Date().toISOString(),
        });
        events.splice(0, Math.max(0, events.length - 80));
      }
    };
    page.on('response', handler);
    return {
      events,
      detach: () => page.off('response', handler),
    };
  }

  private extractWechatChannelCandidatesFromPayload(
    payloadText: string,
    url = '',
    limit = 20,
  ): Array<Record<string, any>> {
    const parsed = this.tryParseJsonText(payloadText);
    if (parsed == null) return [];
    const candidates: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const lowerUrl = safeText(url).toLowerCase();
    const defaultKind = lowerUrl.includes('comment') ? 'comment' : 'message';
    const addCandidate = (
      kind: 'comment' | 'message',
      text: unknown,
      source: string,
      author?: unknown,
      context?: unknown,
      extra?: Record<string, unknown>,
    ) => {
      const normalized = this.normalizeInteractionText(safeText(text));
      if (!this.looksLikeWechatChannelCustomerText(normalized)) return;
      const authorText = this.normalizeInteractionText(safeText(author));
      const key = `${kind}:${authorText}:${normalized}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const item: Record<string, any> = {
        text: normalized,
        author: authorText,
        source,
        context: this.normalizeInteractionText(safeText(context)).slice(0, 260),
        score: kind === 'comment' ? 95 : 90,
      };
      if (kind === 'comment') item.looksLikeComment = true;
      else item.looksLikeMessage = true;
      if (extra) {
        for (const keyName of [
          'commentId',
          'sessionId',
          'username',
          'readFlag',
          'createTime',
        ]) {
          const value = extra[keyName];
          if (value != null && value !== '') item[keyName] = safeText(value);
        }
      }
      candidates.push(item);
    };
    const walk = (value: unknown, path = '') => {
      if (candidates.length >= limit) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        if ('commentContent' in obj) {
          addCandidate(
            'comment',
            obj.commentContent,
            `${path}.commentContent`,
            obj.commentNickname || obj.nickname,
            ['commentNickname', 'commentContent', 'commentCreatetime']
              .map((key) => obj[key])
              .filter(Boolean)
              .map((item) => this.normalizeInteractionText(String(item)))
              .join(' '),
            {
              commentId: obj.commentId,
              username: obj.username,
              readFlag: obj.readFlag,
              createTime: obj.commentCreatetime,
            },
          );
        }
        if (
          [
            'msgContent',
            'messageContent',
            'lastMsg',
            'lastMsgContent',
            'content',
          ].some((key) => key in obj)
        ) {
          const author =
            obj.nickname || obj.name || obj.sessionName || obj.fromNickname;
          for (const key of [
            'msgContent',
            'messageContent',
            'lastMsgContent',
            'lastMsg',
            'content',
            'summary',
          ]) {
            if (typeof obj[key] !== 'string') continue;
            const kind =
              defaultKind === 'message'
                ? 'message'
                : (defaultKind as 'comment' | 'message');
            addCandidate(
              kind,
              obj[key],
              `${path}.${key}`,
              author,
              ['nickname', 'name', 'sessionName', key]
                .map((ctxKey) => obj[ctxKey])
                .filter(Boolean)
                .map((item) => this.normalizeInteractionText(String(item)))
                .join(' '),
              {
                sessionId: obj.sessionId || obj.id,
                username: obj.username || obj.fromUsername,
                readFlag: obj.readFlag,
                createTime: obj.createTime || obj.timestamp,
              },
            );
          }
        }
        for (const [key, child] of Object.entries(obj)) {
          const childPath = path ? `${path}.${key}` : key;
          if (typeof child === 'string') {
            const nested = this.tryParseJsonText(child);
            if (nested != null) walk(nested, childPath);
          } else {
            walk(child, childPath);
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
      }
    };
    walk(parsed);
    return candidates.slice(0, limit);
  }

  private mergeWechatChannelCandidates(
    domItems: Array<Record<string, any>>,
    trace: DouyinImTraceEvent[],
    targetKind: 'comments' | 'messages',
    limit: number,
  ): Array<Record<string, any>> {
    const merged: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    const expectedKey =
      targetKind === 'comments' ? 'looksLikeComment' : 'looksLikeMessage';
    const sortWechatChannelDomItems = (items: Array<Record<string, any>>) => {
      if (targetKind !== 'messages') return items;
      return [...items].sort((a, b) => {
        const priority = (item: Record<string, any>) => {
          if (item.messageBubble) return 0;
          if (item.sessionRow && !item.ownReply) return 1;
          if (item.sessionRow) return 3;
          return 2;
        };
        const priorityDelta = priority(a) - priority(b);
        const latestBubbleDelta =
          a.messageBubble && b.messageBubble
            ? Number(b.y || 0) - Number(a.y || 0)
            : 0;
        return (
          priorityDelta ||
          latestBubbleDelta ||
          Number(b.score || 0) - Number(a.score || 0) ||
          Number(a.y || 0) - Number(b.y || 0) ||
          Number(a.x || 0) - Number(b.x || 0)
        );
      });
    };
    const push = (item: Record<string, any>, sourceHint: string) => {
      if (!item || typeof item !== 'object') return;
      const text = this.normalizeInteractionText(String(item.text || ''));
      if (!this.looksLikeWechatChannelCustomerText(text)) return;
      const author = this.normalizeInteractionText(String(item.author || ''));
      const key = `${author}:${text}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      merged.push({
        ...item,
        text,
        [expectedKey]: true,
        source: item.source || sourceHint,
      });
    };
    for (const item of sortWechatChannelDomItems(domItems || [])) {
      push(item, 'wechat-channel-dom');
      if (merged.length >= limit) return merged;
    }
    for (const event of trace || []) {
      for (const item of event.wechatChannelCandidates || []) {
        if (targetKind === 'comments' && !item.looksLikeComment) continue;
        if (targetKind === 'messages' && !item.looksLikeMessage) continue;
        push(item, 'wechat-channel-network');
        if (merged.length >= limit) return merged;
      }
    }
    return merged;
  }

  private findWechatChannelTraceCandidate(
    trace: DouyinImTraceEvent[],
    targetKind: 'comments' | 'messages',
    targetText: string,
  ): Record<string, any> {
    const expectedKey =
      targetKind === 'comments' ? 'looksLikeComment' : 'looksLikeMessage';
    const normalizedTarget = this.normalizeInteractionText(targetText);
    for (const event of [...(trace || [])].reverse()) {
      for (const item of event.wechatChannelCandidates || []) {
        if (!item?.[expectedKey]) continue;
        const text = this.normalizeInteractionText(String(item.text || ''));
        if (
          !normalizedTarget ||
          text === normalizedTarget ||
          text.includes(normalizedTarget) ||
          normalizedTarget.includes(text)
        ) {
          return item;
        }
      }
    }
    return {};
  }

  private looksLikeWechatChannelCustomerText(text: string): boolean {
    const normalized = this.normalizeInteractionText(text);
    if (!normalized || normalized.length > 280) return false;
    const hasCjk = /[\u4e00-\u9fff]/.test(normalized);
    const hasAlnum = /[A-Za-z0-9]/.test(normalized);
    const hasEmoji = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(normalized);
    const hasBracketEmoji = /\[[\u4e00-\u9fff]+\]/.test(normalized);
    if (!(hasCjk || hasAlnum || hasEmoji || hasBracketEmoji)) return false;
    if (hasBracketEmoji || hasEmoji) return true;
    const noiseFragments = [
      '视频号助手',
      '评论管理',
      '私信管理',
      '互动管理',
      '全部视频',
      '全部私信',
      '全部消息',
      '共143个',
      '关于腾讯',
      '微信视频号运营规范',
      '问题咨询',
      'Tencent Inc',
      'All Rights Reserved',
      '暂无评论',
      '暂无私信',
      '暂无消息',
      '暂无打招呼消息',
      '没有更多',
      '加载中',
      '通知中心',
      '数据中心',
      '收入与服务',
      '带货助手',
      '收到，看到你发的是',
      '你把具体想咨询的问题发我',
      '有具体问题直接发我',
      '我按实际情况',
      '不再接收对方消息',
      '扫描二维码后',
      '填写投诉',
    ];
    if (
      noiseFragments.some((fragment) =>
        normalized.toLowerCase().includes(fragment.toLowerCase()),
      )
    ) {
      return false;
    }
    if (
      [
        '评论',
        '私信',
        '打招呼消息',
        '全部',
        '视频',
        '图文',
        '回复',
        '发送',
        '删除',
        '点赞',
      ].includes(normalized)
    ) {
      return false;
    }
    if (
      [
        '私信 打招呼消息',
        '全部私信',
        '全部评论',
        '评论权限 写评论',
        '评论权限',
        '写评论',
      ].includes(normalized)
    ) {
      return false;
    }
    if (/^共\d+个$/.test(normalized)) return false;
    if (
      / 20/.test(normalized) &&
      /20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/.test(normalized)
    )
      return false;
    if (/^20\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}$/.test(normalized))
      return false;
    if (/^.+?\s+\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}$/.test(normalized))
      return false;
    if (
      normalized.startsWith('共') &&
      (normalized.includes('条评论') || normalized.includes('个'))
    )
      return false;
    if (
      /20\d{2}[/-]\d{1,2}[/-]\d{1,2}/.test(normalized) &&
      (normalized.includes('#') || normalized.length > 36)
    )
      return false;
    if (
      /^\d+|20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}|刚刚|今天|昨天$/.test(
        normalized,
      )
    )
      return false;
    if (/^\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}$/.test(normalized)) return false;
    return true;
  }

  private async resolveTargetFrame(
    page: Page,
    input: Pick<PlatformDispatchInput, 'platform' | 'taskType'>,
  ): Promise<Page | Frame> {
    if (input.platform !== 'wechat-channel') return page;
    const expected =
      input.taskType === 'comment-reply'
        ? ['micro/interaction/comment', 'platform/post/comment']
        : ['micro/interaction/private_msg', 'platform/private_msg'];
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const frame = page
        .frames()
        .find((candidate) =>
          expected.some((fragment) => candidate.url().includes(fragment)),
        );
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return page;
  }

  private async prepareWechatMessageSession(
    frame: Page | Frame,
    targetText: string,
  ) {
    await frame
      .evaluate(
        ({ targetText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          };
          const labels = ['打招呼消息', '私信', '全部私信'];
          for (const label of labels) {
            const node = Array.from(
              document.querySelectorAll(
                'button, [role="button"], div, span, a',
              ),
            ).find(
              (item) => visible(item) && normalize(item.textContent) === label,
            );
            if (node) {
              try {
                (node as HTMLElement).click();
              } catch {
                /* 容错：非关键路径失败忽略 */
              }
            }
            const bodyText = normalize(
              document.body.innerText || document.body.textContent || '',
            );
            if (targetText && bodyText.includes(targetText)) break;
          }
        },
        { targetText },
      )
      .catch(() => undefined);
    await this.waitForOwnerPage(frame, 1200);
  }

  private async selectWechatCommentWork(
    frame: Page | Frame,
    targetText: string,
  ) {
    await frame
      .evaluate(
        ({ targetText }) => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              .trim();
          const visible = (node: Element | null): node is HTMLElement => {
            if (!node || !(node as HTMLElement).getBoundingClientRect)
              return false;
            const rect = (node as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            );
          };
          const isNavText = (text: string) =>
            /^(视频|图文|视频 图文|全部|全部视频|全部图文|评论|评论管理|互动管理|视频号助手|视频号助手 · 评论|搜索|筛选|导出)$/.test(
              text,
            );
          const bodyText = normalize(
            document.body.innerText || document.body.textContent || '',
          );
          const hasLoadedCommentDetail =
            /回复|删除|举报|点赞|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
              bodyText,
            ) && !isNavText(normalize(targetText));
          if (
            targetText &&
            bodyText.includes(targetText) &&
            hasLoadedCommentDetail
          )
            return;
          const rows = Array.from(
            document.querySelectorAll('li, tr, section, div'),
          )
            .map((node) => {
              if (!visible(node)) return false;
              const rect = node.getBoundingClientRect();
              const text = normalize(node.textContent);
              if (isNavText(text)) return false;
              if (
                rect.x < 20 ||
                rect.x > window.innerWidth * 0.62 ||
                rect.y < 120 ||
                rect.width < 120 ||
                rect.height < 32 ||
                rect.height > 220 ||
                text.length < 2 ||
                text.length > 420
              ) {
                return false;
              }
              const hasWorkSignal =
                /评论|\d{1,2}:\d{2}|20\d{2}[/-]\d{1,2}[/-]\d{1,2}|昨天|今天|分钟前|小时前/.test(
                  text,
                );
              const hasNonZeroCount =
                /(?:评论|留言)?\s*[1-9]\d*\s*(?:条|$)|[1-9]\d*\s*(?:评论|留言)/.test(
                  text,
                );
              const score =
                (hasNonZeroCount ? 100 : 0) +
                (hasWorkSignal ? 60 : 0) +
                (rect.x < window.innerWidth * 0.45 ? 20 : 0) -
                Math.min(text.length, 300) / 15 -
                rect.y / 1000;
              if (!hasWorkSignal && score < 40) return false;
              return { node: node, score, y: rect.y };
            })
            .filter(Boolean) as Array<{
            node: HTMLElement;
            score: number;
            y: number;
          }>;
          rows.sort((a, b) => b.score - a.score || a.y - b.y);
          try {
            rows[0]?.node.click();
          } catch {
            /* 容错：非关键路径失败忽略 */
          }
        },
        { targetText },
      )
      .catch(() => undefined);
    await this.waitForOwnerPage(frame, 1500);
  }

  private async waitForOwnerPage(
    target: Page | Frame,
    ms: number,
  ): Promise<void> {
    const page = 'page' in target ? target.page() : target;
    await page.waitForTimeout(ms).catch(() => undefined);
  }

  private async extractCandidateTexts(
    page: Page,
    input: PlatformReadInput,
  ): Promise<Array<Record<string, unknown>>> {
    const targetFrame = await this.resolveTargetFrame(page, input);
    const limit = Math.max(1, Math.min(Number(input.limit || 10), 20));
    const rows = await targetFrame.evaluate(
      ({ limit, isMessage, platform }) => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const visible = (node: Element | null): node is HTMLElement => {
          if (!node || !(node as HTMLElement).getBoundingClientRect)
            return false;
          const rect = (node as HTMLElement).getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
          );
        };
        const bodyText = normalize(
          document.body.innerText || document.body.textContent || '',
        );
        if (platform === 'douyin' && isMessage) {
          const contentText = bodyText
            .replace(
              /高清发布|首页|内容管理|作品管理|合集管理|共创中心|原创保护中心|互动管理|数据中心|变现中心|创作中心|通知|网址|抖音/g,
              '',
            )
            .replace(/全部|朋友私信|陌生人私信|群消息/g, '')
            .trim();
          const visibleLoaders = Array.from(
            document.querySelectorAll(
              '[class*="loading"], [class*="Loading"], [class*="spin"], [class*="Spin"], .semi-spin, .semi-spin-wrapper, svg',
            ),
          ).filter((node) => {
            if (!visible(node)) return false;
            const rect = node.getBoundingClientRect();
            return (
              rect.x > 250 &&
              rect.y > 120 &&
              rect.width <= 180 &&
              rect.height <= 180
            );
          }).length;
          const hasConversationHint =
            /未读|分钟前|小时前|昨天|今天|\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|回复|发送/.test(
              bodyText,
            );
          const hasEmptyState =
            /暂无私信|暂无消息|没有私信|没有收到私信|还没有收到私信|暂无会话/.test(
              bodyText,
            );
          if (
            !hasEmptyState &&
            visibleLoaders > 0 &&
            (!hasConversationHint || contentText.length < 20)
          ) {
            return [];
          }
        }
        const exactNoise = new Set([
          '发布作品',
          '作品管理',
          '数据中心',
          '创作者服务中心',
          '首页',
          '活动管理',
          '内容管理',
          '互动管理',
          '变现中心',
          '创作中心',
          '通知',
          '网址',
          '抖音',
          '发送',
          '搜索',
          '全部',
          '朋友私信',
          '陌生人私信',
          '群消息',
          '加载中',
          '暂无',
          '高清发布',
          '发布视频',
          '发布图文',
          '站内信',
          '星图',
          '关注管理',
          '粉丝管理',
          '评论管理',
          '弹幕管理',
          '私信管理',
          '我知道了',
          '稍后再看',
          '关闭',
          '加载中，请稍候...',
          '视频',
          '图文',
          '视频 图文',
          '全部视频',
          '全部图文',
          '视频号助手',
          '视频号助手 · 评论',
          '私信',
          '打招呼消息',
          '全部私信',
          '视频号助手 · 私信',
        ]);
        const containsNoise = [
          '你收到一条新类型消息',
          '请打开抖音app查看',
          '请打开抖音 app 查看',
          '请打开抖音APP查看',
          '分享[视频]',
          '[视频]',
          '[图片]',
          '新增「共创中心」模块',
          '管理你的共创作品',
          '创作者您好',
          '感谢您的理解与支持',
          '平台通知',
          '系统通知',
          '抖音社区自律公约',
          '账号授权协议',
          '用户服务协议',
          '隐私政策',
          '通知网址抖音',
          '通知 网址 抖音',
        ];
        const rowLooksUnreplyable = (text: string) =>
          /你收到一条新类型消息|请打开抖音\s*app\s*查看|分享\[视频\]|\[视频\]|\[图片\]|该消息类型暂不支持|当前版本暂不支持|只有群主和管理员可以发消息|但你可以浏览/.test(
            text,
          );
        const looksLikeDouyinGroupConversation = (text: string) =>
          /群消息|粉丝群|群聊|官方群|交流群|客户群|社群/.test(text) ||
          /群\s*(?:\d{1,2}:\d{2}|刚刚|今天|昨天|\d+分钟前|\d+小时前)/.test(
            text,
          );
        const cleanDouyinMessageText = (value: string) =>
          normalize(value)
            .replace(
              /^(?:刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前)\s*/,
              '',
            )
            .replace(/\s*(置顶|已读|删除|回复|举报|拉黑|标记未读)+\s*$/g, '')
            .replace(/\s*(置顶|已读|删除|回复|举报|拉黑|标记未读)\s*/g, '')
            .trim();
        const cleanDouyinCommentText = (value: string) =>
          normalize(value)
            .replace(
              /^(?:刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前)\s*/,
              '',
            )
            .replace(/\s*(?:作者|回复|删除|举报|点赞|置顶|展开|收起)+\s*/g, ' ')
            .replace(/\s*\d+\s*(?:回复|点赞)?\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const isDouyinCommentControlText = (value: string) =>
          /^(?:\d+)?(?:回复|删除|举报|点赞|展开|收起)+$/.test(value) ||
          /^(?:\d+\s*)?(?:回复\s*)?(?:删除\s*)?(?:举报\s*)?$/.test(value) ||
          /^(?:刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前)$/.test(value);
        const noise = [
          '首页',
          '评论管理',
          '私信管理',
          '互动管理',
          '创作者中心',
          '视频号助手',
          '全部',
          '搜索',
          '筛选',
          '发送',
          '回复',
          '取消',
          '确定',
          '暂无',
          '加载中',
          '隐私政策',
          '用户服务协议',
          '平台通知',
          '系统通知',
        ];
        const looksLikeNavigationNoise = (value: string, rowValue: string) =>
          /通知\s*网址\s*抖音|高清发布|作品管理|内容管理|互动管理|创作者服务中心/.test(
            value,
          ) ||
          (/通知/.test(rowValue) &&
            /网址/.test(rowValue) &&
            /抖音/.test(rowValue));
        const nodes = Array.from(
          document.querySelectorAll(
            'li, tr, section, article, [role="row"], [role="listitem"], [class*="comment"], [class*="Comment"], [class*="message"], [class*="Message"], [class*="chat"], [class*="Chat"], [class*="session"], [class*="Session"], [class*="item"], [class*="Item"], div, span, p',
          ),
        );
        const seen = new Set<string>();
        const candidates: Array<Record<string, unknown>> = [];
        if (platform === 'wechat-channel' && isMessage) {
          const isNavText = (text: string) =>
            /^(私信|打招呼消息|全部私信|消息|用户消息|视频号助手|视频号助手 · 私信|搜索|筛选|暂无|加载中)$/.test(
              text,
            );
          const cleanWechatMessageText = (value: string) =>
            normalize(value)
              .replace(
                /^(?:刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前)\s*/,
                '',
              )
              .replace(
                /\s*(?:已读|未读|回复|删除|举报|拉黑|标记未读)+\s*/g,
                ' ',
              )
              .replace(/\s+/g, ' ')
              .trim();
          const rowNodes = Array.from(
            document.querySelectorAll(
              'li, [role="row"], [role="listitem"], [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="session"], [class*="Session"], [class*="item"], [class*="Item"], div',
            ),
          )
            .filter((node) => visible(node))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              const rowText = normalize(node.textContent);
              if (
                rect.x < 160 ||
                rect.y < 120 ||
                rect.width < 180 ||
                rect.height < 32
              )
                return false;
              if (rowText.length < 2 || rowText.length > 360) return false;
              if (isNavText(rowText) || exactNoise.has(rowText)) return false;
              if (/视频号助手\s*·\s*私信/.test(rowText) && rowText.length < 40)
                return false;
              return /未读|回复|发送|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前|客户|用户|粉丝/.test(
                rowText,
              );
            })
            .sort(
              (a, b) =>
                a.getBoundingClientRect().y - b.getBoundingClientRect().y ||
                a.getBoundingClientRect().height -
                  b.getBoundingClientRect().height,
            );
          for (const node of rowNodes) {
            const childTexts = Array.from(node.querySelectorAll('span, p, div'))
              .filter((child) => visible(child))
              .map((child) =>
                cleanWechatMessageText(normalize(child.textContent)),
              )
              .filter(Boolean)
              .filter((text, index, arr) => arr.indexOf(text) === index)
              .filter((text) => text.length >= 2 && text.length <= 180)
              .filter(
                (text) =>
                  !isNavText(text) &&
                  !exactNoise.has(text) &&
                  !noise.includes(text),
              )
              .filter(
                (text) =>
                  !/^(?:回复|发送|删除|举报|刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前|\d+)$/.test(
                    text,
                  ),
              );
            const rowText = cleanWechatMessageText(normalize(node.textContent));
            const text =
              childTexts.find((item) =>
                /[？?吗呢吧呀哦]|价格|多少|怎么|哪里|联系|电话|微信|私信|预约|内容|具体|可以|想问|请问|买|发|帮|看|在吗/.test(
                  item,
                ),
              ) ||
              childTexts.find((item) => item.length >= 4) ||
              (rowText.length >= 4 && !isNavText(rowText) ? rowText : '');
            if (!text || isNavText(text)) continue;
            const key = text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const rect = node.getBoundingClientRect();
            const sender = childTexts.find(
              (item) => item !== text && item.length <= 24,
            );
            candidates.push({
              text,
              sender,
              looksLikeMessage: true,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
            });
            if (candidates.length >= limit) break;
          }
          return candidates;
        }
        if (platform === 'wechat-channel' && !isMessage) {
          const isNavText = (text: string) =>
            /^(视频|图文|视频 图文|全部|全部视频|全部图文|评论|评论管理|互动管理|视频号助手|视频号助手 · 评论|搜索|筛选|导出)$/.test(
              text,
            );
          const cleanWechatCommentText = (value: string) =>
            normalize(value)
              .replace(
                /^(?:刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前)\s*/,
                '',
              )
              .replace(
                /\s*(?:作者|回复|删除|举报|点赞|置顶|展开|收起)+\s*/g,
                ' ',
              )
              .replace(/\s*\d+\s*(?:回复|点赞|评论|留言)?\s*$/g, '')
              .replace(/\s+/g, ' ')
              .trim();
          const rowNodes = Array.from(
            document.querySelectorAll(
              '[class*="comment"], [class*="Comment"], li, [role="row"], [role="listitem"], section, article, div',
            ),
          )
            .filter((node) => visible(node))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              const rowText = normalize(node.textContent);
              if (
                rect.x < window.innerWidth * 0.42 ||
                rect.y < 120 ||
                rect.width < 180 ||
                rect.height < 28
              )
                return false;
              if (rowText.length < 2 || rowText.length > 360) return false;
              if (isNavText(rowText) || exactNoise.has(rowText)) return false;
              if (/视频号助手\s*·\s*评论/.test(rowText) && rowText.length < 40)
                return false;
              return /回复|删除|举报|点赞|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
                rowText,
              );
            })
            .sort(
              (a, b) =>
                a.getBoundingClientRect().y - b.getBoundingClientRect().y ||
                a.getBoundingClientRect().height -
                  b.getBoundingClientRect().height,
            );
          for (const node of rowNodes) {
            const childTexts = Array.from(node.querySelectorAll('span, p, div'))
              .filter((child) => visible(child))
              .map((child) =>
                cleanWechatCommentText(normalize(child.textContent)),
              )
              .filter(Boolean)
              .filter((text, index, arr) => arr.indexOf(text) === index)
              .filter((text) => text.length >= 2 && text.length <= 180)
              .filter(
                (text) =>
                  !isNavText(text) &&
                  !exactNoise.has(text) &&
                  !noise.includes(text),
              )
              .filter(
                (text) =>
                  !/^(?:回复|删除|举报|点赞|刚刚|今天|昨天|\d{1,2}:\d{2}|\d+分钟前|\d+小时前|\d+)$/.test(
                    text,
                  ),
              );
            const rowText = cleanWechatCommentText(normalize(node.textContent));
            const text =
              childTexts.find((item) =>
                /[？?吗呢吧呀哦]|价格|多少|怎么|哪里|联系|电话|微信|私信|预约|内容|具体|好听|不错|可以|想问|请问|买|发|帮|看/.test(
                  item,
                ),
              ) ||
              childTexts.find((item) => item.length >= 4) ||
              (rowText.length >= 4 && !isNavText(rowText) ? rowText : '');
            if (!text || isNavText(text)) continue;
            const key = text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const rect = node.getBoundingClientRect();
            candidates.push({
              text,
              looksLikeComment: true,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
            });
            if (candidates.length >= limit) break;
          }
          return candidates;
        }
        if (platform === 'douyin' && isMessage) {
          const rowNodes = Array.from(
            document.querySelectorAll(
              'li, [role="row"], [role="listitem"], [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="session"], [class*="Session"], [class*="item"], [class*="Item"], div',
            ),
          )
            .filter((node) => visible(node))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return (
                rect.x >= 220 &&
                rect.y >= 130 &&
                rect.width >= 260 &&
                rect.height >= 34
              );
            })
            .sort(
              (a, b) =>
                a.getBoundingClientRect().y - b.getBoundingClientRect().y ||
                a.getBoundingClientRect().height -
                  b.getBoundingClientRect().height,
            );
          for (const node of rowNodes) {
            const rowText = normalize(node.textContent);
            if (!rowText || rowLooksUnreplyable(rowText)) continue;
            if (looksLikeDouyinGroupConversation(rowText)) continue;
            if (
              !/\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|星期|昨天|今天|分钟前|小时前/.test(
                rowText,
              )
            )
              continue;
            const childTexts = Array.from(node.querySelectorAll('span, p, div'))
              .filter((child) => visible(child))
              .map((child) => normalize(child.textContent))
              .filter(Boolean)
              .filter((text, index, arr) => arr.indexOf(text) === index)
              .filter((text) => text.length >= 2 && text.length <= 180)
              .filter((text) => !exactNoise.has(text))
              .filter(
                (text) => !containsNoise.some((item) => text.includes(item)),
              )
              .map(cleanDouyinMessageText)
              .filter(Boolean);
            const textPool = childTexts.length
              ? childTexts
              : [cleanDouyinMessageText(rowText)];
            const bodyCandidates = textPool
              .filter(
                (text) =>
                  !/^\d{1,2}:\d{2}$|^\d{1,2}-\d{1,2}$|^星期.|^昨天$|^今天$|^\d+分钟前$|^\d+小时前$/.test(
                    text,
                  ),
              )
              .filter(
                (text) =>
                  !/^[\u4e00-\u9fa5A-Za-z0-9_·-]{1,24}(?:📷|✅|✔|V)?$/.test(
                    text,
                  ),
              )
              .filter((text) =>
                /[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信|地址|入口|购买|商品|门店|想问|请问|可以|需要|发我|帮/.test(
                  text,
                ),
              );
            const text =
              bodyCandidates[0] ||
              textPool.find(
                (item) =>
                  item.length >= 6 &&
                  !/^\S{1,24}(?:📷)?\d{1,2}:\d{2}$/.test(item),
              );
            if (!text || rowLooksUnreplyable(text)) continue;
            if (looksLikeDouyinGroupConversation(text)) continue;
            const key = text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const rect = node.getBoundingClientRect();
            const nickname = textPool.find(
              (item) => item !== text && item.length <= 24,
            );
            candidates.push({
              text,
              sender: nickname,
              looksLikeMessage: true,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
            });
            if (candidates.length >= limit) break;
          }
          if (candidates.length) return candidates;
        }
        if (platform === 'douyin' && !isMessage) {
          const rowNodes = Array.from(
            document.querySelectorAll(
              '[class*="comment"], [class*="Comment"], li, [role="row"], [role="listitem"], section, article, div',
            ),
          )
            .filter((node) => visible(node))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              const rowText = normalize(node.textContent);
              if (
                rect.x < 240 ||
                rect.y < 300 ||
                rect.width < 260 ||
                rect.height < 44
              )
                return false;
              if (looksLikeNavigationNoise(rowText, rowText)) return false;
              if (
                !/回复|删除|举报|点赞|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
                  rowText,
                )
              )
                return false;
              return true;
            })
            .sort(
              (a, b) =>
                a.getBoundingClientRect().y - b.getBoundingClientRect().y ||
                a.getBoundingClientRect().height -
                  b.getBoundingClientRect().height,
            );
          for (const node of rowNodes) {
            const childTexts = Array.from(node.querySelectorAll('span, p, div'))
              .filter((child) => visible(child))
              .map((child) =>
                cleanDouyinCommentText(normalize(child.textContent)),
              )
              .filter(Boolean)
              .filter((text, index, arr) => arr.indexOf(text) === index)
              .filter((text) => text.length >= 2 && text.length <= 180)
              .filter((text) => !exactNoise.has(text) && !noise.includes(text))
              .filter(
                (text) => !containsNoise.some((item) => text.includes(item)),
              )
              .filter((text) => !isDouyinCommentControlText(text))
              .filter(
                (text) => !/^[\u4e00-\u9fa5A-Za-z0-9_·-]{1,24}$/.test(text),
              );
            const rowText = cleanDouyinCommentText(normalize(node.textContent));
            const text =
              childTexts.find((item) =>
                /[？?吗呢吧呀哦]|价格|多少|怎么|哪里|联系|电话|微信|私信|预约|内容|具体|好听|不错|可以|想问|请问|买|发|帮|看/.test(
                  item,
                ),
              ) ||
              childTexts.find((item) => item.length >= 4) ||
              (rowText.length >= 4 && !isDouyinCommentControlText(rowText)
                ? rowText
                : '');
            if (!text || looksLikeNavigationNoise(text, rowText)) continue;
            const key = text.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const rect = node.getBoundingClientRect();
            candidates.push({
              text,
              looksLikeComment: true,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
            });
            if (candidates.length >= limit) break;
          }
          if (candidates.length) return candidates;
        }
        for (const node of nodes) {
          if (!visible(node)) continue;
          const rect = node.getBoundingClientRect();
          let text = normalize(node.textContent);
          const row =
            node.closest(
              'li, tr, [role="row"], [role="listitem"], [class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"], [class*="conversation"], [class*="Conversation"], [class*="item"], [class*="Item"]',
            ) ||
            node.parentElement ||
            node;
          const rowText = normalize(row.textContent);
          if (!isMessage && platform === 'douyin') {
            if (rect.x < 240 || rect.y < 300) continue;
            if (looksLikeNavigationNoise(text, rowText)) continue;
            text = cleanDouyinCommentText(text);
            if (isDouyinCommentControlText(text)) continue;
          }
          if (
            platform === 'douyin' &&
            isMessage &&
            rowLooksUnreplyable(rowText)
          )
            continue;
          if (platform === 'douyin' && isMessage) {
            text = cleanDouyinMessageText(text);
          }
          if (!text || text.length < 2 || text.length > 240) continue;
          if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(text)) continue;
          if (exactNoise.has(text)) continue;
          if (containsNoise.some((item) => text.includes(item))) continue;
          if (
            platform === 'douyin' &&
            isMessage &&
            /^[\u4e00-\u9fa5A-Za-z0-9_·-]{1,24}(?:📷|✅|✔|V)?$/.test(text) &&
            !/[？?吗呢吧呀哦]|预约|价格|多少|怎么|哪里|联系|电话|微信|私信|在吗|在哪|要|买|发|帮|看/.test(
              text,
            )
          )
            continue;
          if (
            /^\d+$|^\d{1,2}:\d{2}$|^\d{1,2}-\d{1,2}$|^\d+分钟前$|^\d+小时前$|^刚刚$|^昨天$|^今天$/.test(
              text,
            )
          )
            continue;
          if (
            noise.some(
              (item) =>
                text === item || (text.length > 8 && text.includes(item)),
            )
          )
            continue;
          const signal = isMessage
            ? /私信|消息|回复|未读|刚刚|今天|昨天|\d{1,2}:\d{2}|\d{1,2}-\d{1,2}|分钟前|小时前/.test(
                text,
              )
            : /回复|删除|点赞|评论|刚刚|今天|昨天|\d{1,2}:\d{2}|分钟前|小时前/.test(
                text,
              );
          if (!isMessage && platform === 'douyin' && !signal) continue;
          if (!signal && candidates.length > 0) continue;
          const key = text.slice(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            text,
            looksLikeComment: !isMessage,
            looksLikeMessage: isMessage,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          });
          if (candidates.length >= limit) break;
        }
        return candidates;
      },
      {
        limit,
        isMessage: input.taskType === 'direct-message-reply',
        platform: input.platform,
      },
    );
    return rows;
  }

  private async pageText(page: Page, maxLength = 1200): Promise<string> {
    try {
      const text = await page.locator('body').innerText({ timeout: 3000 });
      return text.slice(0, maxLength);
    } catch {
      return '';
    }
  }

  private async captureSessionScreenshot(
    sessionKey: string,
    label: string,
  ): Promise<{ evidencePath?: string; evidenceUrl?: string }> {
    try {
      const result = await this.browser.captureEvidence({ sessionKey, label });
      return { evidencePath: result.path, evidenceUrl: result.url };
    } catch {
      return {};
    }
  }

  private async captureScreenshot(
    label: string,
  ): Promise<{ evidencePath?: string; evidenceUrl?: string }> {
    try {
      const sessionKey = `${label}-${Date.now()}`;
      const result = await this.browser.captureEvidence({ sessionKey, label });
      return { evidencePath: result.path, evidenceUrl: result.url };
    } catch {
      return {};
    }
  }

  private snapshotContainsReply(
    snapshotText: string | undefined,
    replyText: string,
  ) {
    const normalize = (value: string | undefined) =>
      safeText(value).replace(/\s+/g, '').trim();
    const snapshot = normalize(snapshotText);
    const reply = normalize(replyText);
    return Boolean(reply && snapshot.includes(reply));
  }
}
